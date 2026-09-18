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

### Optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REGISTRATION_ENABLED` | `true` | Set to `false` to close registration |
| `LOGIN_RATE_LIMIT` | `10` | Login attempts per minute per IP |
| `REGISTER_RATE_LIMIT` | `5` | Registrations per minute per IP |
| `API_RATE_LIMIT` | `100` | API requests per minute per IP |

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

**NEVER expose admin creation as an HTTP endpoint.**

```bash
npm run create-admin
```

Interactive CLI prompts:
- Email
- Display name
- Password (Argon2id hashed)

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
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Authenticate
- `POST /api/auth/logout` — Destroy session
- `GET /api/auth/session` — Current session user

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
- **CSRF:** Origin/Referer validation for state-changing requests
- **Rate limiting:** Per-IP for auth endpoints
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