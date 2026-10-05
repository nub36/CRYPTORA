# CRYPTORA — Production Security Audit

**Дата:** 2026-10-05
**Базовая ревизия:** `main` после PR #54
**Режим:** READ-ONLY аудит РЕПОЗИТОРИЯ. Реальный сервер не опрашивался и не
изменялся: ни SSH-подключения, ни правок systemd/nginx/firewall, ни
обращений к production-БД.

## Как читать этот документ

Каждый пункт помечен одним из трёх способов проверки:

| Метка | Что это значит |
|---|---|
| **CODE** | Проверено по исходникам репозитория — вывод доказуем |
| **CONFIG** | Проверено по конфигу в репозитории (`nginx/`, `systemd/`); на сервере может отличаться |
| **MANUAL** | Проверить может только оператор на сервере; здесь — чек-лист и команда |

Уровни: **CRITICAL** (эксплуатируется удалённо, ведёт к компрометации) ·
**HIGH** (существенное ослабление защиты) · **MEDIUM** (защита в глубину) ·
**LOW** (гигиена) · **INFO** (наблюдение, действия не требуются).

---

## 1. Сводка находок

| # | Находка | Уровень | Способ | Статус |
|---|---|---|---|---|
| A-1 | `server_tokens off` отсутствует в `nginx/cryptora.conf` | MEDIUM | CONFIG | Не исправлено (конфиг сервера — вне PR) |
| A-2 | Нет явного запрета доступа к `/.env`, `/.git`, dotfiles | MEDIUM | CONFIG | Не исправлено (конфиг сервера — вне PR) |
| A-3 | HSTS присутствует только в закомментированном HTTPS-шаблоне | MEDIUM | CONFIG | Не исправлено (включается вместе с TLS-блоком) |
| A-4 | `ssl_protocols` задан только в закомментированном блоке | MEDIUM | CONFIG | Не исправлено |
| A-5 | `Connection 'upgrade'` проставляется всем `/api/` запросам, а не через `map` | LOW | CONFIG | Не исправлено |
| A-6 | `X-XSS-Protection` устарел (может вредить в старых браузерах) | LOW | CONFIG | Не исправлено |
| A-7 | CSP содержит `script-src 'unsafe-inline'` | MEDIUM | CONFIG | Не исправлено (требует nonce/hash-рефакторинга сборки — вне scope) |
| A-8 | Health-эндпоинты публичны без аутентификации | INFO | CODE | Осознанно; раскрытие секретов исключено тестом |
| A-9 | Rate limiting — in-memory (однопроцессный) | LOW | CODE | Приемлемо: деплой однопроцессный |
| A-10 | `/api/health` раньше отдавал статус БД без таймаута | MEDIUM | CODE | **Исправлено в этом PR** (таймаут + категория ошибки) |

Нет находок уровня **CRITICAL** или **HIGH**.

---

## 2. Application (проверено по коду)

### 2.1 Security headers

| Заголовок | Состояние | Источник |
|---|---|---|
| Content-Security-Policy | Задан на Nginx; в приложении отключён намеренно (`helmet({contentSecurityPolicy: false})`) | `server/app.js`, `nginx/cryptora.conf:67` |
| Strict-Transport-Security | Только в HTTPS-шаблоне (закомментирован) → **A-3** | `nginx/cryptora.conf:129` |
| X-Content-Type-Options | `nosniff` — есть | `nginx/cryptora.conf:63` + helmet |
| Referrer-Policy | `strict-origin-when-cross-origin` — есть | `nginx/cryptora.conf:65` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=()` — есть | `nginx/cryptora.conf:66` |
| X-Frame-Options / frame-ancestors | `SAMEORIGIN` + `frame-ancestors 'self'` — есть | `nginx/cryptora.conf:62,67` |
| X-Powered-By | Снят helmet'ом | `server/app.js` |

**Вывод:** набор заголовков полный, кроме HSTS и TLS-настроек, которые живут в
закомментированном HTTPS-блоке и активируются оператором вместе с сертификатом.

### 2.2 CORS

CORS-middleware нет вообще. Это не упущение, а решение: фронтенд и API
обслуживаются с одного origin, поэтому кросс-доменные запросы с
credentials невозможны по умолчанию браузера. Добавление `cors()` было бы
расширением поверхности атаки без потребителя. **Статус: OK.**

### 2.3 CSRF

`server/middleware/csrf.js` проверяет `Origin`/`Referer` для всех
state-changing методов. В production разрешён РОВНО один origin —
`config.APP_ORIGIN`; downgrade схемы, поддомен и suffix-атака
(`…duckdns.org.evil.com`) отклоняются; отсутствие обоих заголовков в
production — отказ. Плюс `SameSite` на cookie сессии. **Статус: OK.**

### 2.4 Cookies / сессии

| Свойство | Значение | Источник |
|---|---|---|
| `httpOnly` | `true` | `server/app.js` |
| `secure` | `true` при `NODE_ENV=production` | `server/config.js` (`COOKIE_SECURE`) |
| `sameSite` | `lax` (настраивается) | `server/config.js` |
| `maxAge` | 7 суток | `SESSION_MAX_AGE` |
| Хранилище | PostgreSQL; `SESSION_STORE=memory` ЗАПРЕЩЁН в production (бросает на старте) | `server/app.js` |

**Статус: OK.** Отдельно отмечено как хорошая практика: невозможность
случайно деградировать хранилище сессий в production.

### 2.5 Аутентификация и brute-force

- Пароли — Argon2id (`memoryCost 64 MB`, `timeCost 3`). **OK.**
- `POST /api/auth/login` под `loginLimiter` — 10 попыток/мин/IP. **OK.**
- Регистрация — 5/мин/IP; resend verification — 3/15 мин/IP + минимальный
  интервал 60 с между письмами на один адрес. **OK.**
- Коды подтверждения e-mail хранятся как HMAC (а не голый дайджест) —
  6-значный код из дампа БД не брутфорсится. **OK.**
- Перечисление аккаунтов: ответы «неизвестный аккаунт / уже подтверждён /
  заблокирован» неразличимы. **OK.**
- Чувствительные операции (привязка провайдеров) требуют свежей
  аутентификации (`FRESH_AUTH_MAX_AGE_MINUTES=30`). **OK.**

**A-9 (LOW):** лимиты in-memory. При переходе на несколько процессов счётчик
придётся вынести в общий store — сейчас деплой однопроцессный, поэтому
находка остаётся наблюдением.

### 2.6 Логирование секретов

Проверены все пути логирования ошибок БД, почты, Telegram и OAuth:

- `server/db/pool.js` → `formatPoolError` печатает код/сообщение/счётчики
  пула; `connectionString` не печатается никогда;
- `notificationChannels.js` → лог доставки содержит канал, тип события,
  статус и КОД ошибки; токен и chat id не логируются;
- `radarMonitor.js` → наружу отдаётся категория (`RADAR_PUBLIC_ERROR_CODES`),
  сырой текст остаётся в server-side логе;
- `errorHandler.js` → клиенту всегда «Внутренняя ошибка сервера», stack
  trace и текст драйвера не покидают процесс.

**Статус: OK.**

### 2.7 Error responses

404 и 500 — обобщённые. Zod-ошибки отдают только сообщение и имя поля.
Stack trace клиенту не уходит ни при каком `NODE_ENV`. **Статус: OK.**

### 2.8 Health-эндпоинты (новое в этом PR)

- `/api/health`, `/api/health/live`, `/api/health/ready` публичны — их
  опрашивает Nginx/systemd/внешний мониторинг. **A-8 (INFO).**
- Состав ответа ограничен статусами, временами, длительностями и
  счётчиками. Отсутствие секретов проверяется тестами
  (`tests/unit/healthService.test.ts`, `tests/integration/healthEndpointPostgres.test.ts`):
  регулярные выражения на DSN, `password`, `token`, `secret`, chat id и
  e-mail выполняются при каждом прогоне CI.
- Ошибка БД отдаётся КАТЕГОРИЕЙ (`TIMEOUT` / `UNAVAILABLE`), а не
  сообщением pg: сообщение драйвера содержит хост, порт и имя базы
  (**A-10, исправлено**).
- `SELECT 1` ограничен таймаутом `HEALTH_DB_TIMEOUT_MS` (по умолчанию 2 с):
  зависшая база не превращает health-пробу в висящее соединение.

---

## 3. Nginx checklist (CONFIG — проверено по `nginx/cryptora.conf`)

> Реальный `/etc/nginx/` НЕ изменялся этим PR. Ниже — что нужно проверить и
> применить оператору вручную.

| Пункт | В репозитории | Требуется |
|---|---|---|
| `ssl_protocols TLSv1.2 TLSv1.3;` | только в закомментированном блоке (**A-4**) | раскомментировать вместе с TLS |
| `ssl_prefer_server_ciphers off;` + современный набор шифров | отсутствует | добавить в TLS-блок |
| `server_tokens off;` | **отсутствует (A-1)** | добавить в `http{}` или в server-блок |
| HSTS | только в шаблоне (**A-3**) | `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` |
| `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP | есть | — |
| `client_max_body_size` | `2M` | OK для read-only аналитики |
| `proxy_connect_timeout` / `proxy_read_timeout` | `5s` / `15s` | OK; проверить, что долгие health/radar запросы укладываются |
| WebSocket proxy | `Upgrade`/`Connection` проставлены, но жёстко (**A-5**) | использовать `map $http_upgrade $connection_upgrade` |
| `/.env`, `/.git` | **запрета нет (A-2)** | `location ~ /\.(?!well-known) { deny all; return 404; }` |
| Кэш статики | `/assets/` — `max-age=31536000, immutable`; SPA — `no-store` | OK |
| Directory listing | `autoindex off` | OK |
| Rate limiting | `limit_req_zone … rate=30r/s; burst=50` | OK |

**Проверка на сервере (read-only, оператор):**

```bash
nginx -T | grep -E 'server_tokens|ssl_protocols|Strict-Transport-Security'
curl -sI https://<домен>/.env        # ожидается 404/403
curl -sI https://<домен>/.git/config # ожидается 404/403
```

---

## 4. SSH checklist (MANUAL — агент сервер не трогал)

| Параметр | Требуемое значение | Команда проверки |
|---|---|---|
| `PermitRootLogin` | `no` (или `prohibit-password`) | `sshd -T \| grep permitrootlogin` |
| `PasswordAuthentication` | `no` | `sshd -T \| grep passwordauthentication` |
| `PubkeyAuthentication` | `yes` | `sshd -T \| grep pubkeyauthentication` |
| `MaxAuthTries` | `3`–`4` | `sshd -T \| grep maxauthtries` |
| `AllowUsers` / `AllowGroups` | явный список | `sshd -T \| grep -E 'allowusers\|allowgroups'` |
| `PermitEmptyPasswords` | `no` | `sshd -T \| grep permitemptypasswords` |
| `X11Forwarding` | `no` | `sshd -T \| grep x11forwarding` |
| fail2ban / sshguard | активен, jail `sshd` включён | `fail2ban-client status sshd` |

Изменения применять только после `sshd -t` и **с открытой второй сессией** —
ошибка в `sshd_config` отрезает доступ к серверу.

---

## 5. Firewall checklist (MANUAL — правила НЕ менялись)

Ожидаемая публичная поверхность:

| Порт | Назначение | Должен быть публичным |
|---|---|---|
| 22 | SSH | да (лучше — с ограничением по источнику) |
| 80 | HTTP (редирект + ACME) | да |
| 443 | HTTPS | да |
| VPN (если используется) | WireGuard/иное | да, только нужный UDP/TCP порт |
| **3000** | **Node backend** | **НЕТ** — только `127.0.0.1` |
| **5432** | **PostgreSQL** | **НЕТ** — только `127.0.0.1` |

Бэкенд по умолчанию слушает `127.0.0.1` (`server/config.js`: `HOST` по
умолчанию `127.0.0.1`) — это подтверждено кодом. Фактическую привязку и
правила фильтра проверяет оператор:

```bash
ss -tlnp | grep -E ':(3000|5432)\b'   # ожидается только 127.0.0.1
ufw status verbose                     # или: nft list ruleset
```

Если `0.0.0.0:3000` или `0.0.0.0:5432` — это **CRITICAL**, и закрывать надо
немедленно. Проверка выполняется оператором: PR правила фильтра не меняет.

---

## 6. Что этот PR изменил в части безопасности

1. `/api/health` больше не может подвиснуть на недоступной БД (таймаут).
2. Ошибка БД в публичном ответе заменена категорией — хост/порт/имя базы
   больше не могут утечь через health.
3. Отсутствие секретов в health-ответе закреплено автотестами, то есть
   перестало быть обещанием и стало проверяемым инвариантом CI.
4. Health-alert'ы используют СУЩЕСТВУЮЩИЙ Telegram delivery layer:
   второго бота, второго набора секретов и второго пути доставки не
   появилось. Получатели — только администраторы.
5. Диагностический скрипт `npm run audit:production-health` физически не
   способен выполнить изменяющий запрос: `BEGIN READ ONLY`, белый список
   префиксов SQL, `ROLLBACK` в `finally`, маскирование DSN. Это закреплено
   тестом.

## 7. Что сознательно НЕ сделано

- Не изменены `sshd_config`, правила firewall, юниты systemd и
  `/etc/nginx/` на реальном сервере.
- Не выполнен деплой и не затронута production-БД.
- Не устранён `script-src 'unsafe-inline'` (**A-7**): корректное решение —
  nonce/hash для инлайн-скриптов, что затрагивает сборку и шаблон страницы и
  выходит за scope production-hardening PR.
