# CRYPTORA — Миграция production-домена на cryptonic.online (финальное решение + runbook)

**Дата:** 2026-10-05 · **Статус:** domain PR подготовлен; production из песочницы НЕ менялся.
**Финальное решение владельца (заменяет предыдущую fallback-схему):** canonical =
`https://cryptonic.online`; `www.cryptonic.online/*` и legacy `cryptora.duckdns.org/*` —
**постоянный 301-редирект** на `https://cryptonic.online/*` с сохранением path и query. Это НЕ
fallback-схема: legacy-хост до приложения не доходит, `APP_TRUSTED_ORIGINS` не вводится.

---

## 1. Установленные факты

**От владельца (2026-10-05):** WorkingDirectory живого юнита = `/root/CRYPTORA`; service
`cryptora.service`; nginx active; бэкенд на `:3000` (живой процесс слушает **все интерфейсы** —
подлежит исправлению, Задача 4); TLS `cryptora.duckdns.org` существует; DNS уже изменён владельцем.

**Проверено независимо (2026-10-05, read-only):**

- `cryptonic.online` A → **89.125.24.50** ✓ (правка уже разошлась в публичные резолверы).
- `www.cryptonic.online` A → **95.163.244.138 (парковка reg.ru)** ⚠️ — либо www-запись ещё не
  изменена у авторитативных NS, либо публичные резолверы держат старый кэш (TTL был 21600 = 6 ч).
  **Гейт перед certbot:** `dig @ns1.reg.ru www.cryptonic.online A +short` обязана вернуть
  `89.125.24.50` (авторитативный ответ, без кэша). Если нет — владелец правит A `www` в панели reg.ru.
- `cryptora.duckdns.org` A → `89.125.24.50` ✓ (продолжает указывать на VPS — это нужно для
  legacy-редиректа).
- NS зоны: `ns1.reg.ru`, `ns2.reg.ru` ✓; AAAA-записей нет ✓.
- Production жив: `https://cryptora.duckdns.org/api/health` → ok (production, v0.9.3, все мониторы ok).
- **PR #56 (Telegram):** state OPEN, **head = `5726732`**, mergeable, 4/4 checks pass
  (Typecheck+Unit+Build, e2e Chromium, e2e-smoke, screenshots) — перепроверить в момент merge.
- Egress песочницы блокируется VPS на сетевом уровне — все команды ниже выполняются ВЛАДЕЛЬЦЕМ на
  VPS (или с его машины); агент production не трогает.

**Расхождение живой конфигурации с репозиторием (важно):** checked-in `nginx/cryptora.conf` до
этого PR содержал только HTTP-блок с `server_name _` (HTTPS-блок был закомментированным шаблоном),
а живой nginx уже обслуживает HTTPS на DuckDNS-домене → на VPS существует vhost, которого нет в
репо. Поэтому **шаг 0 процедуры обязательно снимает живой `nginx -T`**, а новые блоки переносятся в
структуру живого конфига (не поверх вслепую). Repo-шаблон в этом PR приведён к целевой схеме и
является эталоном, а не копипастой.

## 2. Целевая схема (Задачи 2–4)

| Hostname | HTTP (:80) | HTTPS (:443) |
| --- | --- | --- |
| `cryptonic.online` | 301 → `https://cryptonic.online$request_uri` | **приложение** (canonical vhost) |
| `www.cryptonic.online` | 301 → canonical | 301 → canonical (отдельный server-block, без приложения) |
| `cryptora.duckdns.org` | 301 → canonical | 301 → canonical (legacy; **сертификат DuckDNS сохраняется**) |

- Редиректы: `return 301 https://cryptonic.online$request_uri;` — path+query сохраняются; циклов
  нет (canonical никогда не редиректит сам на себя; ACME-путь обслуживается до редиректа).
- `APP_ORIGIN=https://cryptonic.online` — единственный origin приложения (CSRF/OAuth/mail).
  www и legacy до приложения не доходят → в allowlist'ы не добавляются; wildcard запрещён.
- Cookies: host-only `Secure; HttpOnly; SameSite=Lax` — без изменений; `Domain=.cryptonic.online`
  НЕ устанавливается. Существующие сессии DuckDNS после переключения не переносятся — пользователи
  перелогиниваются на новом домене (ожидаемо; сессии серверные, старые остаются валидными на legacy,
  пока он не заредиректит).
- Фронтенд: same-origin relative `/api` (без изменений); абсолютные публичные URL — только
  `cryptonic.online` (canonical/og:url/robots/sitemap — добавлены в этом PR; до миграции SPA их не
  имел). Браузерные WSS — напрямую к биржам (CSP-allowlist), от домена не зависят. Mixed content
  исключён (весь API-трафик same-origin).
- Порт 3000: наружу НЕ публикуется; бэкенд переводится на `HOST=127.0.0.1` (Задача 4).
- TLS: новая линейка `cryptonic.online` + `www.cryptonic.online` (одна, оба SAN); линейка
  `cryptora.duckdns.org` и её certbot-renewal сохраняются (HTTPS-редирект требует валидного TLS).

## 3. Что входит в domain PR (Задача 1)

Код/конфиг: `server/config.js`, `server/middleware/csrf.js`, `server/services/mail/templates.js`
(комментарии и fallback-хост → canonical), `.env.example` (APP_ORIGIN-комментарий + OAuth callback
примеры), `tests/unit/csrf.test.ts` (production-фикстуры → `https://cryptonic.online`),
`nginx/cryptora.conf` (целевая схема: canonical vhost + два redirect-vhost + HTTP→HTTPS),
`systemd/cryptora.service` (пути → фактический `/root/CRYPTORA`; loopback-привязка подтверждена),
`index.html` (canonical/OG/Twitter-мета), `src/seo/canonicalUrl.ts` + `CanonicalUrlUpdater.tsx` +
`src/main.tsx` (динамический canonical/og:url по маршруту), `public/robots.txt` + `public/sitemap.xml`.
Доки: DEPLOYMENT.md (§4 rewritten + пути `/root/CRYPTORA`), BACKEND_SETUP.md, AUTH_SETUP.md,
SERVER_ARCHITECTURE_DESIGN.md (строки production URL), deploy.yml-комментарий, CHANGELOG, STATUS.

**Guard на регрессию** — `tests/unit/productionDomainReferences.test.ts`: runtime-код
(server/src/shared), тесты/e2e и конфиг-артефакты не содержат `cryptora.duckdns.org`; nginx-шаблон
содержит legacy-хост ТОЛЬКО в redirect-block (без root/proxy_pass); canonical-домен в SEO-артефактах;
systemd = loopback + `/root/CRYPTORA`. Это CI-версия обязательного after-deploy скана.

Название продукта остаётся **CRYPTORA** (смена домена ≠ смена бренда).

## 4. ПОЛНАЯ ПРОИЗВОДСТВЕННАЯ ПРОЦЕДУРА (Задача 6)

> Выполняется владельцем на VPS. **Проверка после КАЖДОГО шага обязательна** — не продолжать при
> ошибке. Все `nginx`-изменения: `sudo nginx -t` → только потом `systemctl reload nginx`.
> Приложение: `/root/CRYPTORA`; сервис: `cryptora.service`.

### Шаг 0 — Предполётный аудит и бэкапы (ничего не меняя)

```bash
# 0.1 Фактическое состояние
systemctl show cryptora.service -p WorkingDirectory -p ActiveState -p ExecMainStartTimestamp
systemctl cat cryptora.service
git -C /root/CRYPTORA rev-parse HEAD && git -C /root/CRYPTORA status --short
curl -4 -s https://api.ipify.org; echo                     # ожидаемо 89.125.24.50
sudo ss -ltnp | grep -E ':(80|443|3000)[[:space:]]'        # зафиксировать тек. состояние :3000
sudo ufw status verbose
sudo nginx -T > /root/backup-$(date +%F)/nginx-T.txt       # ЖИВОЙ конфиг — основа для правок
sudo certbot certificates                                  # зафиксировать линейки TLS
systemctl list-timers | grep -i certbot

# 0.2 DNS-гейты (обязательны ДО выпуска TLS)
dig @ns1.reg.ru cryptonic.online A +short      # 89.125.24.50
dig @ns2.reg.ru cryptonic.online A +short      # 89.125.24.50
dig @ns1.reg.ru www.cryptonic.online A +short  # 89.125.24.50  ← если 95.163.244.138: STOP,
dig @ns2.reg.ru www.cryptonic.online A +short  #    владелец правит A www в reg.ru и ждёт
dig cryptonic.online A +short; dig www.cryptonic.online A +short   # публичные резолверы

# 0.3 PR-гейты
#    PR #56: head = 5726732, все checks green (проверить на GitHub).
#    Domain PR: merged в main, CI green.

# 0.4 Бэкапы (ДО любых изменений)
sudo mkdir -p /root/backup-$(date +%F) && cd /root/backup-$(date +%F)
sudo -u postgres pg_dump -Fc cryptora > cryptora-$(date +%F-%H%M).dump
sudo -u postgres pg_restore --list cryptora-*.dump >/dev/null && echo "BACKUP OK"
sudo tar --exclude='CRYPTORA/node_modules' --exclude='CRYPTORA/dist' -czf repo-$(date +%F-%H%M).tgz -C /root CRYPTORA
sudo tar -czf etc-nginx-$(date +%F-%H%M).tgz -C / etc/nginx
sudo cp /root/CRYPTORA/.env env-$(date +%F-%H%M).bak && sudo chmod 600 env-*.bak   # НЕ печатать
cp nginx-T.txt nginx-T-$(date +%H%M).txt
git -C /root/CRYPTORA rev-parse HEAD > production-commit-before.txt                # зафиксирован
sudo nginx -t && echo "NGINX CONFIG OK"    # текущий конфиг валиден ДО начала
```

### Шаг 1 — Deploy Telegram PR #56 (НЕ смешивать с доменом)

```bash
cd /root/CRYPTORA && git fetch origin
git log --oneline -1 origin/main            # убедиться: merge-commit PR #56 сверху, head был 5726732
CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/update.sh <merge-sha-PR56>
```

Проверка (шаги 2–4 по ТЗ):

```bash
npm run migrate:status                      # 2. миграции 018 И 019 применены ДО рестарта
systemctl is-active cryptora                # 3. build/restart выполнены update.sh
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool | grep -E '"status"|"database"'   # ok
curl -s http://127.0.0.1:3000/api/health | grep -o 'notificationRedelivery'   # 4. цикл появился
sudo journalctl -u cryptora -n 100 --no-pager | grep -i redelivery            # старт worker-а
curl -s https://cryptora.duckdns.org/api/health | head -c 120; echo           # снаружи тоже ок
```

Rollback (если失败): `CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/update.sh $(cat production-commit-before.txt)`;
миграции 018/019 аддитивные — отката не требуют.

### Шаг 2 — Deploy domain PR (код), APP_ORIGIN → cryptonic.online (шаги 5–6 по ТЗ)

```bash
cd /root/CRYPTORA && git fetch origin
git log --oneline -1 origin/main            # merge-commit domain PR сверху
CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/update.sh <merge-sha-domainPR>
```

Затем правка окружения (единственное место, где задаётся production URL):

```bash
sudo nano /root/CRYPTORA/.env
#   APP_ORIGIN=https://cryptonic.online        (заменить https://cryptora.duckdns.org)
#   проверить: HOST=127.0.0.1 (см. Шаг 4), COOKIE_SECURE не трогать (юнит задаёт)
sudo systemctl restart cryptora && systemctl is-active cryptora
curl -s http://127.0.0.1:3000/api/health | head -c 120; echo    # ok — приложение живо
```

Проверка CSRF-политики сразу (до nginx-правок приложение всё ещё за duckdns-именем —
CSRF-запросы с duckdns теперь будут 403, это ожидаемо до Шага 4, окно короткое):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://cryptonic.online' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/auth/login    # НЕ 403-CSRF
```

### Шаг 3 — HTTP vhost нового домена (шаг 7 по ТЗ)

В живой конфиг (по `nginx -T`: обычно `/etc/nginx/sites-available/…` + symlink в sites-enabled)
добавить port-80 блок для новых имён. Если в живом конфиге уже есть port-80 блок для
`cryptora.duckdns.org` — расширить его `server_name`-ом, а не создавать дубль:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cryptonic.online www.cryptonic.online;   # + cryptora.duckdns.org, если ещё не в другом блоке
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://cryptonic.online$request_uri; }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx          # шаг 8 по ТЗ
curl -I http://cryptonic.online/ | head -3            # 301 → https://cryptonic.online/
dig @ns1.reg.ru www.cryptonic.online A +short         # ещё раз гейт www = 89.125.24.50
```

### Шаг 4 — TLS cryptonic.online + www (шаг 9 по ТЗ; только после DNS-гейта 0.2)

```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d cryptonic.online -d www.cryptonic.online
sudo certbot certificates | grep -A2 'cryptonic.online'    # новая линейка Issued
sudo certbot renew --dry-run                                # renewal не сломан (обе линейки)
```

### Шаг 5 — HTTPS application vhost (шаги 10–12 по ТЗ)

Добавить в живой конфиг два HTTPS-блока (НЕ трогая существующий duckdns-vhost — он ещё обслуживает
приложение до проверки!). Эталон — `nginx/cryptora.conf` из domain PR; не дублировать
`limit_req_zone`, если зона уже объявлена в живом конфиге:

```nginx
server {   # canonical — ПОЛНОЕ приложение (перенести блоки из живого duckdns-vhost:
           # root /root/CRYPTORA/dist, headers+CSP, /assets/, /api/ → 127.0.0.1:3000, SPA-fallback)
    listen 443 ssl http2;
    server_name cryptonic.online;
    ssl_certificate     /etc/letsencrypt/live/cryptonic.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cryptonic.online/privkey.pem;
    # … + HSTS: add_header Strict-Transport-Security "max-age=15768000; includeSubDomains" always;
}
server {   # www — ТОЛЬКО редирект
    listen 443 ssl http2;
    server_name www.cryptonic.online;
    ssl_certificate     /etc/letsencrypt/live/cryptonic.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cryptonic.online/privkey.pem;
    return 301 https://cryptonic.online$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
# Шаг 12 по ТЗ: ПРОВЕРИТЬ НОВЫЙ ДОМЕН ПЕРЕД ЛЮБЫМ ИЗМЕНЕНИЕМ СТАРОГО:
curl -I https://cryptonic.online/                     # 200, приложение
curl -I https://cryptonic.online/signals              # 200 SPA deep route
curl -I 'https://www.cryptonic.online/test?a=1'       # 301 Location: https://cryptonic.online/test?a=1
curl -s https://cryptonic.online/api/health | head -c 120; echo    # ok + notificationRedelivery
openssl s_client -connect cryptonic.online:443 -servername cryptonic.online </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
# Браузером: логин, сигналы, консоль без mixed-content/CSP ошибок, статика /assets/*
```

Только после успеха — Шаг 6.

### Шаг 6 — Legacy DuckDNS → redirect (шаги 13–14 по ТЗ)

Изменить СУЩЕСТВУЮЩИЙ duckdns-HTTPS-vhost: приложение заменяется редиректом (блоки root/api/SPA
удаляются из него, остаются только TLS + `return 301`). Сертификат и renewal DuckDNS НЕ трогать:

```nginx
server {
    listen 443 ssl http2;
    server_name cryptora.duckdns.org;
    ssl_certificate     /etc/letsencrypt/live/cryptora.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cryptora.duckdns.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    return 301 https://cryptonic.online$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx          # шаг 14 по ТЗ
```

### Шаг 7 — Backend port → loopback (Задача 4; до этого проверить, что внешний :3000 никому не нужен)

```bash
# 7.1 Исследование: кто ходит на :3000 извне? (ожидаемо — никто)
sudo ss -ltnp | grep :3000                          # сейчас, вероятно, 0.0.0.0:3000 или *:3000
sudo grep -h '"GET /api' /var/log/nginx/cryptora_access.log | tail -3   # Host: из лога — только домены?
sudo iptables -L -n | grep 3000; sudo ufw status | grep 3000            # есть ли отдельное правило
# 7.2 Причина 0.0.0.0: systemctl cat cryptora | grep -i host; grep -i '^HOST' /root/CRYPTORA/.env
#     (живой юнит старее репо-версии, либо .env переопределяет HOST)
# 7.3 Исправление: установить юнит из репо (domain PR: HOST=127.0.0.1, пути /root/CRYPTORA)
#     или drop-in: sudo systemctl edit cryptora → [Service] → Environment=HOST=127.0.0.1
#     и удалить/исправить HOST=... в .env, если он там задан не как 127.0.0.1
sudo systemctl daemon-reload && sudo systemctl restart cryptora
# 7.4 ПРОВЕРКА:
sudo ss -ltnp | grep :3000                          # ожидаемо: 127.0.0.1:3000
curl -s https://cryptonic.online/api/health | head -c 120; echo    # через nginx по-прежнему ok
curl -s --max-time 5 http://89.125.24.50:3000/api/health || echo "внешний :3000 закрыт ✓"
```

⚠️ Если investigation (7.1) найдёт внешний потребитель :3000 — STOP и решение владельца.

### Шаг 8 — Финальные smoke-тесты (шаг 15 по ТЗ)

```bash
curl -I https://cryptonic.online/                                  # 200
curl -I https://cryptonic.online/signals                           # 200 (deep route)
curl -I 'https://www.cryptonic.online/test?a=1'                    # 301/308 → https://cryptonic.online/test?a=1
curl -I 'https://cryptora.duckdns.org/test?a=1'                    # 301/308 → https://cryptonic.online/test?a=1
curl -I 'https://cryptora.duckdns.org/login?next=/signals'         # 301 → …/login?next=/signals
curl -I http://cryptonic.online/ http://www.cryptonic.online/ http://cryptora.duckdns.org/  # все → 301 https
curl -s https://cryptonic.online/api/health | grep -o 'notificationRedelivery'              # есть
curl -I -H 'Origin: https://evil.example' https://cryptonic.online/api/health               # нет ACAO
curl -i -X POST -H 'Origin: https://cryptonic.online' -H 'Content-Type: application/json' -d '{}' \
  https://cryptonic.online/api/auth/login                          # 400/401, НЕ 403 CSRF
curl -i -X POST -H 'Origin: https://cryptonic.online.evil.com' -H 'Content-Type: application/json' -d '{}' \
  https://cryptonic.online/api/auth/login                          # 403 CSRF
curl -s https://cryptonic.online/robots.txt; curl -s https://cryptonic.online/sitemap.xml | head -5
curl -I https://cryptonic.online/assets/$(curl -s https://cryptonic.online/ | grep -o 'assets/index-[^"]*\.js' | head -1)
sudo ss -ltnp | grep :3000                                         # 127.0.0.1:3000
```

Браузером (оба имени): логин/логаут/регистрация на cryptonic.online; deep-URL refresh; signals;
Telegram-уведомление по живому событию; консоль без mixed-content и без запросов к DuckDNS
(DevTools → Network → фильтр duckdns — пусто); сертификат без предупреждений.

### Шаг 9 — After-deploy repository/config scan

```bash
# В репо (уже enforced CI-тестом productionDomainReferences):
git grep -n "cryptora.duckdns.org" -- server/ src/ shared/ tests/ e2e/ .env.example systemd/ index.html public/
#   ожидаемо: пусто
git grep -n "cryptora.duckdns.org" -- nginx/       # ТОЛЬКО redirect-block
git grep -n "cryptora.duckdns.org" -- docs/ | wc -l  # только исторические записи
# На сервере:
sudo nginx -T | grep -n "cryptora.duckdns.org"     # только server_name + ssl_certificate legacy-редиректа
grep -n "duckdns" /root/CRYPTORA/.env              # ожидаемо: НЕТ (APP_ORIGIN=cryptonic.online)
```

## 5. Rollback (обязателен; по шагам)

| Сбой | Действие |
| --- | --- |
| Шаг 1 (Telegram deploy) | `CRYPTORA_DB_BACKUP_CONFIRMED=YES ./scripts/update.sh $(cat production-commit-before.txt)`; миграции 018/019 аддитивные — не мешают старому коду |
| Шаг 2 (domain code/APP_ORIGIN) | `.env`: `APP_ORIGIN=https://cryptora.duckdns.org` → `systemctl restart cryptora`; код — update.sh на предыдущий SHA |
| Шаги 3–5 (новый vhost/TLS) | Убрать cryptonic-блоки из sites-enabled (или закомментировать) → `nginx -t` → reload; duckdns-vhost не менялся — приложение мгновенно снова на нём. Сертификат можно оставить (`certbot delete --cert-name cryptonic.online` — только при полном отказе от домена) |
| Шаг 6 (legacy redirect) — главный откат | Вернуть прежнее содержимое duckdns-vhost (из бэкапа `etc-nginx-*.tgz` / `nginx-T-*.txt`) → `nginx -t` → reload; legacy снова обслуживает приложение |
| Шаг 7 (loopback) | Вернуть прежнее HOST-значение (юнит/`.env`) → daemon-reload → restart; проверить ss |
| БД | `sudo -u postgres pg_restore --clean --if-exists -d cryptora /root/backup-…/cryptora-….dump` (полный отказ — только по решению владельца) |
| DNS | Рычаг владельца в reg.ru (вернуть A-записи) — независимо от сервера; DuckDNS A всегда указывал на VPS и не менялся |

Порядок отката домена целиком: Шаг 6 rollback (вернуть приложение на duckdns) → Шаг 2 rollback
(APP_ORIGIN) → при необходимости Шаги 3–5 rollback. PR #56 (Telegram) откатывается независимо.

## 6. Риски/примечания

1. **www DNS** — главный открытый гейт: публичные резолверы ещё отдают парковочный IP (TTL 6 ч).
   Certbot для SAN www требует авторитативного `89.125.24.50`; если запись не изменена — владелец
   правит её в reg.ru (гейт 0.2 / Шаг 3).
2. **Живой nginx ≠ репо-шаблон**: все правки — по снятому `nginx -T`; `limit_req_zone` не
   дублировать; стиль listen/http2 — как в живом конфиге.
3. **HSTS** включается только на canonical-vhost (per-hostname) — legacy-хост не затронут.
4. **Куки**: старые DuckDNS-сессии на новом домене не работают (host-only) — ожидаемое поведение,
   требуется перелогин; это же упрощает откат.
5. **SEO**: до миграции SPA не имел canonical/OG/robots/sitemap; в domain PR добавлены только
   корректные механизмы (статические теги для корня + динамические canonical/og:url по маршруту;
   sitemap только реальных статических маршрутов) — фиктивных страниц не создаётся.
6. **Telegram Login Widget / OAuth** (сейчас выключены): при будущем включении callback-URL
   вычисляются из `APP_ORIGIN` → регистрировать только `https://cryptonic.online/...`;
   Telegram-виджету потребуется `/setdomain cryptonic.online`.
7. **Бренд** остаётся CRYPTORA; домен меняет только URL.
