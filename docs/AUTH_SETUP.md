# CRYPTORA — Auth Setup (SMTP + Social Login)

Полное руководство по настройке почты (коды подтверждения email) и социального
входа (Google / Telegram / Yandex / VK ID) для production-домена
`https://cryptonic.online` (постоянный 301-редирект с legacy
`cryptora.duckdns.org` и с `www.cryptonic.online` выполняет nginx).

Все секреты живут **только** в `.env` на сервере. Ни один секрет не попадает в
git, в логи или в ответы API. Плейсхолдеры всех переменных — в `.env.example`.

---

## 1. SMTP (письма с 6-значным кодом)

Транспорт vendor-agnostic: подходит любой стандартный SMTP-релей. Переменные:

```ini
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false        # true = implicit TLS (порт 465), false = STARTTLS (порт 587)
SMTP_USER=
SMTP_PASS=               # никогда не коммитится
SMTP_FROM_EMAIL=noreply@cryptonic.online
SMTP_FROM_NAME=CRYPTORA
SMTP_TIMEOUT_MS=10000
MAIL_TRANSPORT=          # пусто = auto: smtp при заданном SMTP_HOST
```

Поведение при НЕнастроенном SMTP в production: регистрация отвечает 201 с
`verification.delivery: "unavailable"`, повторная отправка кода — честный
`503 MAIL_UNAVAILABLE`. Никакого «фейкового» транспорта в production нет —
`json`-транспорт разрешён только вне production и никогда не является фолбэком.

### Пример: Brevo (ex-Sendinblue)

1. Зарегистрируйтесь на brevo.com → **SMTP & API → SMTP**.
2. Значения:

```ini
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<ваш логин Brevo, вида 7xxxxx001@smtp-brevo.com>
SMTP_PASS=<SMTP key из панели Brevo>
SMTP_FROM_EMAIL=noreply@cryptonic.online
SMTP_FROM_NAME=CRYPTORA
```

### Пример: Resend

1. resend.com → **API Keys** → создать ключ; включите SMTP-доступ.
2. Значения:

```ini
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=<re_... API key>
SMTP_FROM_EMAIL=noreply@cryptonic.online
SMTP_FROM_NAME=CRYPTORA
```

### Доставляемость: SPF / DKIM / DMARC

Без этих DNS-записей письма уходят в спам. У провайдера (Brevo/Resend) в
разделе «Domains» будут точные значения; общий вид:

| Тип | Имя | Значение (пример) |
| --- | --- | --- |
| TXT (SPF) | `@` | `v=spf1 include:spf.brevo.com ~all` (или `include:resend.com`) |
| TXT (DKIM) | `<selector>._domainkey` | выдаёт провайдер (публичный ключ DKIM) |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:admin@cryptonic.online` |

Примечание: `cryptonic.online` обслуживается NS reg.ru и поддерживает
произвольные TXT-записи (SPF/DKIM/DMARC) — в отличие от прежнего
`cryptora.duckdns.org` (динамический DNS без таких записей). Подтвердите домен
у провайдера рассылки и используйте отправителя на собственном домене
(`noreply@cryptonic.online`); адрес отправителя не обязан совпадать с доменом
сайта.

### Прочие переменные кода подтверждения

```ini
EMAIL_VERIFY_CODE_TTL_MINUTES=10   # срок жизни кода
EMAIL_VERIFY_CODE_MAX_ATTEMPTS=5   # попыток на один код
EMAIL_CODE_HMAC_SECRET=            # openssl rand -hex 32 (иначе берётся SESSION_SECRET)
RESEND_MIN_INTERVAL_SECONDS=60     # кулдаун повторной отправки на email
```

---

## 2. Общие переменные OAuth

```ini
APP_ORIGIN=https://cryptora.duckdns.org   # единственный canonical origin
OAUTH_RATE_LIMIT=30                       # запросов / 5 мин / IP
OAUTH_HTTP_TIMEOUT_MS=10000
FRESH_AUTH_MAX_AGE_MINUTES=30             # «свежий» вход для link/unlink
```

Провайдер с пустыми кредами автоматически скрыт на странице входа
(`GET /api/auth/providers`) — ничего не падает.

---

## 3. Google (OIDC)

1. https://console.cloud.google.com/apis/credentials → **Create Credentials →
   OAuth client ID → Web application**.
2. **Authorized redirect URIs** — ровно один, символ в символ:

   ```
   https://cryptora.duckdns.org/api/auth/oauth/google/callback
   ```

3. OAuth consent screen: External, scopes `openid email profile`.
4. В `.env`:

   ```ini
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

Сервер использует authorization-code flow с `state`, PKCE (S256) и `nonce`.
ID-токен проходит полную OIDC-верификацию (`jose`): подпись RS256 против
официального JWKS Google (URI из OIDC discovery, выбор ключа по `kid`,
кеширование и авто-refetch при ротации ключей), затем `iss`, `aud ==
GOOGLE_CLIENT_ID`, `exp`/`iat` (±60с clock tolerance), `nonce`. Токены с
`alg:none`, чужим ключом или неизвестным `kid` отклоняются. Email считается
подтверждённым только при `email_verified: true` от Google.

## 4. Telegram (Login Widget)

1. В @BotFather: `/newbot` → получите токен и username бота.
2. `/setdomain` → укажите `cryptora.duckdns.org` (без него виджет не работает).
3. В `.env`:

   ```ini
   TELEGRAM_BOT_TOKEN=123456789:AA...   # подписывает payload — это секрет
   TELEGRAM_BOT_USERNAME=cryptora_bot   # без @, публичный
   TELEGRAM_AUTH_MAX_AGE_SECONDS=300
   ```

Callback (data-auth-url виджета): `https://cryptora.duckdns.org/api/auth/oauth/telegram/callback`.
Подпись проверяется по официальному алгоритму (HMAC-SHA256 поверх
data-check-string, ключ = SHA256(bot token)), `auth_date` старше 5 минут
отклоняется (защита от replay). Telegram не отдаёт email — такой аккаунт
валиден с `email = NULL`.

## 5. Yandex OAuth

1. https://oauth.yandex.ru/ → «Зарегистрировать новое приложение».
2. Платформа «Веб-сервисы», Redirect URI:

   ```
   https://cryptora.duckdns.org/api/auth/oauth/yandex/callback
   ```

3. Доступы: «Доступ к email адресу», «Доступ к логину, имени и фамилии».
4. В `.env`:

   ```ini
   YANDEX_CLIENT_ID=...
   YANDEX_CLIENT_SECRET=...
   ```

## 6. VK ID (OAuth 2.1, id.vk.com)

Внимание: используется **новый VK ID** (`id.vk.com`), а не устаревший
`oauth.vk.com`. PKCE S256 обязателен; `device_id` из callback пробрасывается в
token-запрос — всё это сервер делает сам.

1. https://id.vk.com/about/business → создать приложение (тип Web).
2. Доверенный Redirect URL:

   ```
   https://cryptora.duckdns.org/api/auth/oauth/vk/callback
   ```

3. Домен приложения: `cryptora.duckdns.org`.
4. В `.env`:

   ```ini
   VK_CLIENT_ID=<ID приложения>
   VK_CLIENT_SECRET=<сервисный/защищённый ключ>
   ```

---

## 7. Политика привязки аккаунтов (кратко)

- Автослияния по email НЕТ никогда: совпадение email у соц-профиля с
  существующим аккаунтом → отказ `oauth_error=email_exists` (защита от
  захвата аккаунта).
- Привязка — только явная, из профиля, в аутентифицированной сессии со
  «свежим» входом (`FRESH_AUTH_MAX_AGE_MINUTES`); для Telegram дополнительно
  требуется предварительный CSRF-защищённый intent.
- Отвязка запрещена, если это последний способ входа (409 `LAST_LOGIN_METHOD`).

## 8. Чек-лист прод-включения

1. Заполнить SMTP-блок в `.env` → перезапустить сервис → в `/api/health`
   блок `mail` должен показать `configured: true, kind: "smtp"`.
2. Прогнать регистрацию на собственный ящик, убедиться что код доходит.
3. Добавлять провайдеров по одному: заполнить креды → рестарт → кнопка
   появляется на `/login` автоматически.
4. Никогда не запускать миграции на production без бэкапа: `013` аддитивна и
   обратно-совместима, но правило есть правило.
5. Секреты — только в `.env` на сервере (chmod 600), не в git.
