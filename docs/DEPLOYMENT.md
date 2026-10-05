# CRYPTORA — Production Deployment Guide & Operations Manual

> **Проект:** CRYPTORA — Crypto Market Intelligence Terminal  
> **Версия релиза:** 0.7.0  
> **Инвариант продукта:** CRYPTORA IS STRICTLY A MARKET INTELLIGENCE TERMINAL. NO TRADE EXECUTION, NO TRADING BOTS, NO CUSTODY, NO PRIVATE KEYS, NO TRADING API KEYS.

---

## 1. Архитектура Production

```text
                             [ User Browser ]
                                     │
                                     ▼
                ┌─────────────────────────────────────────┐
                │          Internet / Public DNS          │
                └────────────────────┬────────────────────┘
                                     │ (Port 80 / 443 HTTPS)
                                     ▼
                ┌─────────────────────────────────────────┐
                │              Nginx Proxy                │
                │   - SSL/TLS termination and security   │
                │   - Static dist/ assets + SPA fallback  │
                │   - Same-origin /api/* reverse proxy   │
                │   - Per-IP rate limiting                │
                └──────────────┬──────────────────────────┘
                               │ (API: 127.0.0.1:3000)
                               ▼
                ┌─────────────────────────────────────────┐
                │       Node.js Express backend           │
                │       (server/index.js / server/app.js) │
                │   - Auth/session and application APIs   │
                │   - Allowlisted /api/market gateway    │
                │   - Fixed Binance/KuCoin upstreams     │
                │   - Server Radar monitor (one Binance  │
                │     ticker WS + PostgreSQL history)    │
                │   - One systemd process only           │
                └─────────────────────────────────────────┘
```

`server/productionServer.js` is a legacy static-server utility and is **not** a supported
production backend: it has no PostgreSQL, auth/sessions, `/api/signals`, `/api/strategies`,
`/api/admin/*`, or Radar monitor. `npm start` now maps to `server/index.js`, but the only supported
production process manager is the repository `systemd/cryptora.service` unit. It is `Type=simple`
with exactly one `ExecStart=/usr/local/bin/node /root/CRYPTORA/server/index.js`; PM2 cluster
mode, Node cluster workers, and multiple service replicas are unsupported because `RadarMonitor` is
a process-local singleton, not a distributed leader. Nginx serves static assets directly and proxies
`/api/` to that one backend on port 3000.

### Политика режима данных: PRODUCTION = ТОЛЬКО LIVE

- **Production (`vite build`):** единственный режим — **LIVE**. Browser REST adapters use the same-origin
  `/api/market` gateway; the server forwards only fixed public Binance Spot/Futures and KuCoin endpoints.
  Browser realtime WSS remains browser-to-exchange for ordinary ticker/trade/depth UI. Radar is the exception: its authoritative Binance ticker WSS is backend-to-exchange and its UI reads same-origin `/api/radar/*`; closing browsers never stops it. Пользовательского DEMO-режима нет: ни переключателей
  DEMO/LIVE, ни кнопок «включить демо», ни восстановления demo из `localStorage` (устаревший ключ
  `cryptora_data_mode` не читается и не пишется). Если upstream API недоступен с сервера, выводится
  честный статус «Источник недоступен / Нет данных» — demo-fallback строго запрещён.
- **Dev / Test:** `DemoMarketDataProvider` и детерминированные фикстуры сохранены для разработки и
  автотестов. Включаются только явным механизмом, отсутствующим в production-сборке: dev-сервер Vite
  (`import.meta.env.DEV`) **или** сборка с `VITE_CRYPTORA_QA_FIXTURE=1`, **и** ключ
  `localStorage.cryptora_qa_fixture = '1'`. Фикстура всегда маркируется `QA` и никогда не выдаётся за LIVE.
  Источник правды — `src/config/dataModePolicy.ts`.

---

## 2. Требования к серверу (VPS Prerequisites)

- **ОС:** Ubuntu 22.04 LTS / Debian 12 / Rocky Linux 9 (x86_64).
- **CPU / RAM:** 1 vCPU, 1 GB RAM (минимум); 2 vCPU, 2 GB RAM (рекомендуется).
- **Диск:** 10 GB SSD.
- **Сетевые порты:**
  - `80/tcp` (HTTP — Nginx / Let's Encrypt validation)
  - `443/tcp` (HTTPS — TLS encrypted web traffic)
  - `22/tcp` (SSH — управление сервером)
  - Внутренний порт `3000/tcp` привязан к `127.0.0.1` или `0.0.0.0` (закрыт внешним фаерволом UFW).
- **Установленное ПО:**
  - Node.js >= 18.x (рекомендуется Node.js 20.x LTS)
  - npm >= 9.x
  - Nginx >= 1.18
  - Git
  - Certbot (для SSL-сертификатов)

---

## 3. Supported production release path

> This is the only supported production path. It is written for a **merged,
> owner-approved immutable commit SHA**, never an unreviewed branch tip. Do not
> run it from this documentation without a change window and explicit approval.

### 3.1 One-time service and Nginx setup

```bash
sudo cp systemd/cryptora.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cryptora

sudo cp nginx/cryptora.conf /etc/nginx/sites-available/cryptora.conf
sudo ln -sf /etc/nginx/sites-available/cryptora.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

`cryptora.service` is the sole supported backend process. Do not run PM2
cluster mode, Node cluster workers, `server/productionServer.js`, or another
replica of `server/index.js`: RadarMonitor is intentionally a process-local
singleton and this deployment topology supplies exactly one process.

The installed unit reads production secrets from exactly
`/root/CRYPTORA/.env` via `EnvironmentFile=`. It does **not** load
`.env.production` and the Node process does not invoke dotenv. Before deploying
notification migration 017, generate `NOTIFICATION_ENCRYPTION_KEY` locally on
the VPS, add it to that `.env` without printing it, preserve the existing
owner-only file permissions, and back it up under the production secret policy.
The key must remain stable: changing it makes existing Telegram ciphertext
undecryptable. Never commit or regenerate it during normal deployments.

### 3.2 Future approved release runbook

The order is mandatory:

**backup → fetch approved SHA → locked dependencies → migrations → build →
frontend publication → systemd restart → health/Radar verification.**

```bash
# 0. Choose the owner-approved, already-merged immutable SHA.
export RELEASE_SHA='<approved merged commit SHA>'
cd /root/CRYPTORA

# 1. Backup PostgreSQL before changing code or schema. Store outside the repo
# and verify the backup according to the database restore policy.
pg_dump --format=custom \
  --file="/secure/backups/cryptora-before-${RELEASE_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "$DATABASE_URL"

# 2. Fetch and verify the exact approved object, then use that immutable SHA.
git fetch origin --tags
git rev-parse --verify "${RELEASE_SHA}^{commit}"
git checkout --detach "$RELEASE_SHA"

# 3. Locked production dependencies, including the server `ws` dependency.
npm ci

# 4. Mandatory before restart: migration runner is transactional per file and
# records successful files in schema_migrations, so reruns are idempotent.
npm run migrate:status
npm run migrate
npm run migrate:status

# 5. Validate and build the release.
npm run typecheck
npm test
npm run build
```

The checked-in Nginx configuration serves `/root/CRYPTORA/dist` directly,
so a build in that supported checkout publishes the frontend there. If a
separate approved staging build is used, the only allowed publication command
is an explicit static artifact sync to that same Nginx root — never source-code
rsync:

```bash
sudo rsync -a --delete --delay-updates \
  /path/to/approved-staging/dist/ /root/CRYPTORA/dist/
```

Only after migration and frontend publication succeed, restart the one supported
backend process:

```bash
sudo systemctl restart cryptora
sudo systemctl is-active --quiet cryptora
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/radar/status
curl --fail 'http://127.0.0.1:3000/api/radar/events?limit=1'
```

Immediately after a normal backend restart, Radar status should be server-owned
and normally `warming`, not `live`; after valid ticker observations for every
effective Scan Universe symbol, verify `marketFeed.state = connected` and
`lifecycle = live`.

`RADAR_EVENT_RETENTION_DAYS=30` is a configurable **proposed default** pending
owner/compliance approval. Set a positive integer number of days to change it;
set `0` only when the owner explicitly chooses to disable automatic expiry. The
setting affects `radar_events` retention only and never changes anomaly math.

### 3.3 Automation contract

For the supported shell path, first complete the backup and then run:

```bash
CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/update.sh "$RELEASE_SHA"
```

`scripts/update.sh` refuses a dirty checkout, requires an explicit approved SHA,
runs `scripts/deploy.sh`, and only then restarts systemd. `scripts/deploy.sh`
runs `npm ci → npm run migrate → quality gates → build`; its migration runner
uses `schema_migrations` and is safe to rerun. `scripts/restart.sh` requires the
same backup confirmation, reruns the idempotent migration check before restart,
and refuses any non-systemd fallback.

**Never start the new server before migration 012.** The process can boot, but
Radar writes and history reads will fail while `radar_events` is absent.

---

## 4. Домены и HTTPS (canonical: cryptonic.online)

Финальная схема (миграция домена 2026-10-05; полный runbook —
`docs/agent-plan/DOMAIN_MIGRATION.md`):

| Hostname | HTTP (порт 80) | HTTPS (порт 443) |
| --- | --- | --- |
| `cryptonic.online` | 301 → `https://cryptonic.online$request_uri` | **приложение** (canonical vhost) |
| `www.cryptonic.online` | 301 → canonical | 301 → canonical |
| `cryptora.duckdns.org` (legacy) | 301 → canonical | 301 → canonical |

Правила схемы:

- **Редиректы сохраняют path и query** (`$request_uri`), статус 301.
- **Canonical application URL:** `https://cryptonic.online`; `APP_ORIGIN` в
  production = ровно это значение. Legacy-хост и `www` до приложения не
  доходят (редирект на уровне nginx), поэтому `APP_TRUSTED_ORIGINS` не нужен.
- **TLS:** одна линейка Let's Encrypt на `cryptonic.online` + `www.cryptonic.online`
  и отдельная — на `cryptora.duckdns.org`. Сертификат legacy обязателен, пока
  живёт HTTPS-редирект; **renewal DuckDNS не удалять**.
- **Порт 3000 наружу не публикуется:** nginx проксирует `/api/*` на
  `127.0.0.1:3000`; бэкенд (`HOST=127.0.0.1` в systemd-юните) слушает только
  loopback. Проверка: `ss -ltnp | grep :3000` → ожидаемо `127.0.0.1:3000`.
- **Cookies:** host-only `Secure; HttpOnly; SameSite=Lax` — без `Domain=`;
  `Domain=.cryptonic.online` не используется.

Порядок настройки (подробно — runbook):

1. **DNS (панель reg.ru):** A `@` → IPv4 VPS, A `www` → IPv4 VPS. Проверить у
   авторитативных NS: `dig @ns1.reg.ru cryptonic.online A +short` (и для www) —
   только потом выпускать сертификат.
2. **HTTP vhost + ACME webroot** (`/var/www/certbot`) → `nginx -t` → reload.
3. **Сертификат:** `sudo certbot certonly --webroot -w /var/www/certbot -d cryptonic.online -d www.cryptonic.online`.
4. **HTTPS vhost'ы** (приложение на canonical; редиректы www/legacy) → `nginx -t` → reload.
5. **Автопродление:** `sudo certbot renew --dry-run` (охватывает обе линейки).

Порядок смены домена на живом сервере — строго по шагам runbook: сначала
новый домен проверяется отдельно и только потом включается редирект с legacy.

---

## 5. Операционные команды (CLI Operations)

В директории `scripts/` подготовлены исполняемые команды управления:

| Команда | Описание |
| :--- | :--- |
| `CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/deploy.sh` | Locked dependencies → idempotent migrations → quality gates → build. Refuses to run without the backup confirmation. |
| `CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/restart.sh` | Rechecks idempotent migrations, then restarts only `cryptora.service`; refuses the legacy standalone fallback. |
| `./scripts/status.sh` | Verifies systemd, `server/index.js`, and `/api/health`. |
| `./scripts/logs.sh 100` | Shows the systemd/journald service log. |
| `CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/update.sh <approved-SHA>` | Supported release orchestration: exact SHA → deploy/migrate/build → systemd restart. |

---

## 6. Процедура отката (Rollback Procedure)

В случае деградации приложения откатите код на предыдущий approved SHA, снова
соберите frontend и перезапустите только systemd service:

```bash
git checkout --detach <PREVIOUS_APPROVED_COMMIT_SHA>
npm ci
npm run build
sudo systemctl restart cryptora
```

Migration 012 is additive. Old application code ignores `radar_events`, so a
code rollback does **not** require dropping that table. Do not run destructive
SQL as a rollback shortcut: restore the verified backup only under the separate
owner-approved database-incident procedure. The retention setting remains an
owner policy decision.

---

## 7. Безопасность и защита инфраструктуры

1. **Non-Custodial Invariant:** Терминал физически не содержит программного кода для отправки транзакций в блокчейн или создания торговых ордеров.
2. **Zero Secrets:** Исходный код и бандл фронтенда не содержат приватных ключей или API-токенов.
3. **CSP (Content Security Policy):**
   ```http
   Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss://stream.binance.com:9443 wss://fstream.binance.com wss://stream.bybit.com wss://ws.okx.com:8443 https://www.okx.com https://api.alternative.me https://api.llama.fi https://mempool.space https://api.coingecko.com https://api.telegram.org; frame-ancestors 'self';
   ```
   Биржевые REST origins отсутствуют: страницы соединяются с `/api/market` на `'self'`; WSS и остальные
   внешние источники перечислены отдельно. Проверка `tests/unit/cspConnectSrc.test.ts` сверяет CSP с URL в `src/`.

   ```
4. **Запрет Directory Listing:** Опция `autoindex off` отключена на уровне Nginx и серверного обработчика.
5. **Отсутствие Source Maps в Production:** В `vite.config.ts` жестко зафиксировано `build: { sourcemap: false }`.

---

## 8. Известные ограничения сетевой среды

- **Песочницы и внешние фаерволы:** В изолированных контейнерных средах без прямого исходящего доступа в Интернет сетевые запросы к публичным API (`api.binance.com`, `api.kucoin.com`) могут блокироваться локальным сетевым фильтром хоста. При работе на боевом VPS с открытым внешним сетевым шлюзом данные ограничения отсутствуют.
- **Ограничения частоты запросов (Rate Limits):** Для защиты от лимитов бирж (Binance 1200 weight/min) в терминале реализован клиентский и серверный TTL-кэш (10 секунд).
