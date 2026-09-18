# CRYPTORA — Backend Setup Guide

## Overview

CRYPTORA Phase 1 backend: Express 5 + PostgreSQL + Argon2id authentication + server-side sessions.

**Production URL:** `https://cryptora.duckdns.org`

**Architecture:**
```
Internet → Nginx (:443) → Static frontend (/var/www/cryptora)
                        → /api/* → http://127.0.0.1:3000
```

---

## Prerequisites

- **Node.js** ≥ 18 (v22 recommended)
- **PostgreSQL** ≥ 14
- **Nginx** (reverse proxy + static serving)

---

## 1. PostgreSQL Setup

### Create database and user

```bash
sudo -u postgres psql

CREATE DATABASE cryptora;
CREATE USER cryptora WITH PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE cryptora TO cryptora;
\q
```

### Connection string

```
postgresql://cryptora:your-secure-password@127.0.0.1:5432/cryptora
```

---

## 2. Environment Variables

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

### Required variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://cryptora:pass@127.0.0.1:5432/cryptora` |
| `SESSION_SECRET` | 64-char random hex for session signing | `openssl rand -hex 32` |
| `NODE_ENV` | Environment | `production` |
| `HOST` | Bind address | `127.0.0.1` (production) |
| `PORT` | Backend port | `3000` |
| `COOKIE_SECURE` | HTTPS-only cookies | `true` (production) |
| `SESSION_STORE` | Session store backend | `postgres` (production). `memory` is test-only and refused when `NODE_ENV=production` |
| `APP_ORIGIN` | Canonical public origin. The **only** origin the CSRF middleware accepts in production, and the base for verification links. Must be `https://` in production — a plain-`http` value is rejected. No trailing slash, no path. | `https://cryptora.duckdns.org` |
| `SMTP_HOST` | SMTP relay host. Empty ⇒ mail is **unavailable** in production (registration still works, resend answers `503 MAIL_UNAVAILABLE`). Production never silently falls back to a fake transport. | `smtp.example.com` |
| `MAIL_FROM` | Display sender | `CRYPTORA <noreply@example.com>` |

### Optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REGISTRATION_ENABLED` | `true` | Set to `false` to close registration |
| `LOGIN_RATE_LIMIT` | `10` | Login attempts per minute per IP |
| `REGISTER_RATE_LIMIT` | `5` | Registrations per minute per IP |
| `API_RATE_LIMIT` | `100` | API requests per minute per IP |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | `true` = implicit TLS (port 465); `false` = STARTTLS (port 587) |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password. **Never commit a real value.** Not logged anywhere. |
| `MAIL_TRANSPORT` | `` (auto) | `smtp`, `json` (stdout echo, dev only) or auto: smtp when `SMTP_HOST` is set, `json` outside production, `unavailable` inside production |
| `EMAIL_VERIFY_TOKEN_TTL_MINUTES` | `60` | Verification link lifetime |
| `RESEND_RATE_LIMIT` | `3` | `resend-verification` requests per window per IP |
| `RESEND_RATE_WINDOW_MINUTES` | `15` | Window for the above |
| `RESEND_MIN_INTERVAL_SECONDS` | `60` | Per-email resend throttle (SMTP flood protection) |
| `VERIFY_RATE_LIMIT` | `20` | `verify-email` attempts per window per IP |
| `VERIFY_RATE_WINDOW_MINUTES` | `15` | Window for the above |

### Email verification

Registration creates the account with `email_verified = false` and **no session**.
The user must follow the link `${APP_ORIGIN}/verify-email?token=…` before they can log in.

- The raw token is generated with `crypto.randomBytes(32)` and sent **only** to the mailbox.
- PostgreSQL stores the **SHA-256 hex digest** — never the plaintext.
- Tokens are single-use. On success the token is consumed and every other outstanding
  token for that user is invalidated, so replay is impossible.
- A mail outage never breaks registration: the account stays created and unverified,
  the API reports `verification.delivery = 'unavailable'`, and resend recovers later.
- Login checks the password **first**. Wrong password ⇒ generic `401`. Correct password
  but unverified ⇒ `403 {"error":"EMAIL_NOT_VERIFIED"}` — verification state is never
  disclosed before the password check.
- `POST /api/auth/resend-verification` answers the same generic body whether or not the
  address exists, so it cannot be used for account enumeration.

---

## 3. Database Migrations

```bash
# Run all pending migrations
npm run migrate

# Check migration status
npm run migrate:status
```

**Migrations created:**
- `001_create_users.sql` — Users table with Argon2id password_hash
- `002_create_sessions.sql` — Server-side sessions (connect-pg-simple)
- `003_create_user_preferences.sql` — User preferences
- `004_create_audit_log.sql` — Admin action audit trail

---

## 4. Create First Admin

The first admin is created **only** by the interactive CLI. There is no
"admin seed" mechanism in production, and no admin credential belongs in any
configuration file.

```bash
npm run create-admin
```

Interactive prompts:
1. Email
2. Display name
3. Password (typed hidden, then confirmed)

The password is hashed with **Argon2id** (memoryCost 64 MB, timeCost 3,
parallelism 1) and written straight to PostgreSQL as `password_hash`
with `role = 'admin'`.

### Plaintext admin password must never be stored in:

| Location | Status |
|----------|--------|
| `.env` / `.env.production` | ✗ no `ADMIN_PASSWORD` / `ADMIN_SEED_PASSWORD` |
| shell scripts (`deploy.sh`, `update.sh`, …) | ✗ no `ADMIN_PASSWORD=...` |
| git (any file, any commit) | ✗ |
| SQL migrations | ✗ `001_create_users.sql` contains no admin INSERT |
| logs (`stdout`, `journalctl`, `server.log`) | ✗ the password is never printed |

Additional guarantees:
- `create-admin` is **not** an HTTP endpoint — no public create-admin route exists.
- Email and password are not hardcoded in source.
- The CLI rejects an email that already exists in `users`.
- The CLI rejects passwords shorter than 8 characters and mismatched confirmation.
- After the first admin exists, the mechanism is not needed again.

These constraints are enforced by `tests/unit/adminBootstrapPolicy.test.ts`,
which fails the build if an admin-seed mechanism is reintroduced.

---

## 5. Start Backend

### Development

```bash
# Terminal 1: Frontend dev server
npm run dev

# Terminal 2: Backend
npm run server
```

Backend listens on `http://127.0.0.1:3000`.

### Production

```bash
# Start via systemd
sudo systemctl start cryptora

# Or manually
NODE_ENV=production node server/index.js
```

---

## 6. Nginx Configuration

### API proxy snippet

Add to your Nginx server block:

```nginx
# General API proxy
location /api/ {
    limit_req zone=cryptora_api burst=50 nodelay;

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
}

# Auth endpoints (tighter rate limit)
# Add to server{} level: limit_req_zone $binary_remote_addr zone=cryptora_auth:10m rate=5r/m;
location /api/auth/ {
    limit_req zone=cryptora_auth burst=3 nodelay;

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**⚠️ Do NOT modify production Nginx automatically. Review and apply manually.**

---

## 7. systemd Service

```ini
[Unit]
Description=CRYPTORA Backend (Express + PostgreSQL)
After=network.target postgresql.service

[Service]
Type=simple
User=user
Group=user
WorkingDirectory=/home/CRYPTORA
ExecStart=/usr/local/bin/node server/index.js
Restart=always
RestartSec=5s

Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DATABASE_URL=postgresql://cryptora:<password>@127.0.0.1:5432/cryptora
Environment=SESSION_SECRET=<random-64-char-hex>
Environment=COOKIE_SECURE=true

[Install]
WantedBy=multi-user.target
```

---

## 8. API Endpoints

### Health
- `GET /api/health` — Backend health, version, DB status

### Auth
- `POST /api/auth/register` — Create account (unverified, **no session** created)
- `POST /api/auth/verify-email` — Consume a verification token. `200` ok, `410` expired, `400` invalid/unknown. Does **not** create a session.
- `POST /api/auth/resend-verification` — New token, previous ones invalidated. Always the same generic response; `503 MAIL_UNAVAILABLE` if mail is down.
- `POST /api/auth/login` — Authenticate. `403 EMAIL_NOT_VERIFIED` if the password is correct but the address is not yet confirmed.
- `POST /api/auth/logout` — Destroy session
- `GET /api/auth/session` — Current session user (includes `emailVerified`)

### Profile
- `GET /api/me` — Current user profile
- `PATCH /api/me` — Update display name

### Admin (requires admin role)
- `GET /api/admin/dashboard` — Health, user stats, recent audit
- `GET /api/admin/users` — List users with search/pagination
- `PATCH /api/admin/users/:id/block` — Block user
- `PATCH /api/admin/users/:id/unblock` — Unblock user
- `GET /api/admin/system` — System info (version, uptime, memory)

---

## 9. Security

- **Passwords:** Argon2id (64MB memory, 3 iterations)
- **Sessions:** Server-side PostgreSQL (connect-pg-simple)
- **Cookies:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d`
- **CSRF:** In production only the exact canonical `APP_ORIGIN` is accepted for `Origin`/`Referer`. `http://cryptora.duckdns.org`, `https://evil.cryptora.duckdns.org` and `https://cryptora.duckdns.org.evil.com` are all rejected. The domain is never hardcoded — it comes from `APP_ORIGIN`. Dev `localhost` origins keep working.
- **Email verification:** mandatory before login; raw token only in the mailbox, SHA-256 digest only in PostgreSQL, single-use, transactional
- **Rate limiting:** Per-IP for auth endpoints, plus a separate tight budget for `resend-verification` and a per-email resend throttle
- **No secret logging:** SMTP password, session secret, verification token and the full verification link are never written to logs or the audit trail
- **RBAC:** Server-side only (never trust client state)

---

## 10. Rollback

If backend fails:

```bash
# Stop backend
sudo systemctl stop cryptora

# Revert to previous version
cd /home/CRYPTORA
git checkout <previous-commit>
npm install
npm run build
sudo cp -r dist/* /var/www/cryptora/
sudo systemctl start cryptora
```

---

## 11. Troubleshooting

### Database connection refused
```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT 1"
```

### Migrations fail
```bash
npm run migrate:status
# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

### Backend won't start
```bash
# Check port 3000
sudo lsof -i :3000

# Check logs
sudo journalctl -u cryptora -f
```

---

*Document generated for CRYPTORA Phase 1: Backend + Auth + Profile + Admin foundation.*