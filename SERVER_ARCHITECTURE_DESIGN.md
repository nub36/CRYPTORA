# CRYPTORA — Server Architecture Design Document

> **Цель**: спроектировать полноценную серверную систему для CRYPTORA.
> **Текущее состояние**: React+Vite SPA, Node.js productionServer.js, localStorage, нет БД, один VPS.
> **Версия проекта**: v0.8.44 (HEAD 78b56b3).
> **Код пока не пишем.**

---

## A. Предлагаемая архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Internet                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                         Nginx (443/80)                               │
│  - SSL termination (Let's Encrypt)                                  │
│  - Rate limiting (API: 30r/s, Auth: 5r/s)                           │
│  - Static files: dist/ (Vite build)                                 │
│  - /api/* → proxy_pass http://127.0.0.1:3000                        │
│  - Security headers, CSP, HSTS                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    Node.js (Express) :3000                           │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │
│  │ Auth Layer  │  │  RBAC Layer  │  │  Rate Limiter            │    │
│  │ (sessions)  │  │  (user/admin)│  │  (login: 5/min, API: 30/s)│   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────────┘    │
│         │                │                      │                    │
│  ┌──────▼────────────────▼──────────────────────▼───────────────┐    │
│  │                    Express Router                             │    │
│  │  /api/auth/*    /api/me/*    /api/admin/*    /api/signals/*  │    │
│  └──────┬────────────┬────────────┬────────────────┬───────────┘    │
│         │            │            │                │                │
│  ┌──────▼──────┐ ┌───▼────┐ ┌────▼─────┐ ┌───────▼──────────┐     │
│  │ AuthService │ │ UserSvc│ │ AdminSvc │ │ SignalEngineSvc  │     │
│  └──────┬──────┘ └───┬────┘ └────┬─────┘ └───────┬──────────┘     │
│         │            │           │                │                │
│  ┌──────▼────────────▼───────────▼────────────────▼───────────┐     │
│  │                   PostgreSQL (pg)                            │     │
│  │  users | sessions | user_preferences | site_settings        │     │
│  │  strategy_settings | user_strategy_subscriptions            │     │
│  │  signals | audit_log                                        │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │              Background Services (in-process)                 │    │
│  │  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │    │
│  │  │ LiveSignalEngine │  │ Liquidation  │  │ MarketData    │  │    │
│  │  │ (V3.0/V3.3/V2.8)│  │ Pipeline     │  │ Collector     │  │    │
│  │  └────────┬────────┘  └──────┬───────┘  └───────┬───────┘  │    │
│  │           │                  │                   │          │    │
│  │           ▼                  ▼                   ▼          │    │
│  │     signals table     liquidation_cache    market_cache     │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │              WebSocket (ws)                                    │    │
│  │  Server → Browser: live prices, signal notifications          │    │
│  │  Binance/Bybit/OKX → Server: market data streams              │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Ключевые принципы

1. **Backend = source of truth.** Стратегии, сигналы, настройки, пользователи — всё в PostgreSQL.
2. **Frontend = клиент.** Читает данные через API. Не хранит бизнес-логику.
3. **LiveSignalEngine переезжает на сервер.** Больше не работает в браузере.
4. **WebSocket от сервера к браузеру** — real-time обновления (цены, сигналы).
5. **Один VPS** — всё в одном процессе (Express + background workers + WS).

---

## B. Backend Stack

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Runtime | Node.js 22 (ESM) | Уже используется |
| HTTP Framework | **Express 5** | Лёгкий, middleware-экосистема, известен |
| БД | **PostgreSQL 16** | Надёжный, JSONB для гибких полей, row-level security |
| ORM/Query | **pg (node-postgres)** + миграции через **node-pg-migrate** | Без ORM-оверхеда, прямой SQL, контроль |
| Auth sessions | **express-session** + **connect-pg-simple** | Сессии в PostgreSQL, httpOnly cookies |
| Password hash | **argon2** (argon2id) | Лучший стандарт |
| Validation | **zod** | Уже в проекте |
| Rate limiting | **express-rate-limit** + **rate-limit-postgres** | Persistent rate limits |
| WebSocket | **ws** | Нативный, без socket.io overhead |
| CSRF | **csrf-csrf** (double-submit cookie) | Для cookie-based auth |
| Logging | **pino** | Structured JSON logging |
| Process manager | **systemd** (уже есть) | Один процесс, рестарт при падении |

### Структура директорий (новая)

```
CRYPTORA/
├── server/
│   ├── index.js                    # Точка входа (Express app)
│   ├── config.js                   # ENV-based конфигурация
│   ├── db/
│   │   ├── pool.js                 # pg Pool
│   │   ├── migrations/             # node-pg-migrate миграции
│   │   │   ├── 001_create_users.sql
│   │   │   ├── 002_create_sessions.sql
│   │   │   ├── 003_create_preferences.sql
│   │   │   ├── 004_create_site_settings.sql
│   │   │   ├── 005_create_strategy_settings.sql
│   │   │   ├── 006_create_signals.sql
│   │   │   ├── 007_create_audit_log.sql
│   │   │   └── 008_create_subscriptions.sql
│   │   └── seed.js                 # Начальные данные (admin user, default settings)
│   ├── middleware/
│   │   ├── auth.js                 # Session check + user injection
│   │   ├── rbac.js                 # requireRole('admin')
│   │   ├── rateLimit.js            # Login/register/API rate limits
│   │   ├── validate.js             # Zod schema validation middleware
│   │   └── audit.js                # Audit log middleware
│   ├── routes/
│   │   ├── auth.js                 # POST /register, /login, /logout
│   │   ├── me.js                   # GET/PUT /profile, /preferences
│   │   ├── admin.js                # Admin dashboard, users, strategies, settings
│   │   ├── strategies.js           # GET /strategies, strategy status
│   │   └── signals.js              # GET /signals, signal details
│   ├── services/
│   │   ├── AuthService.js          # Registration, login, password change
│   │   ├── UserService.js          # Profile, preferences
│   │   ├── AdminService.js         # Dashboard stats, user management
│   │   ├── StrategyService.js      # Strategy settings CRUD
│   │   ├── SignalService.js        # Signal persistence, queries
│   │   ├── AuditService.js         # Audit log writes
│   │   ├── SettingsService.js      # Site settings
│   │   └── MarketDataService.js    # Market data collection (перенос из фронта)
│   ├── engine/
│   │   ├── LiveSignalEngine.js     # Портированный с фронта (server-side)
│   │   ├── StrategyRunner.js       # Запуск стратегий по расписанию
│   │   └── ohlcvAdapter.js         # Конвертер свечей
│   ├── websocket/
│   │   └── wsServer.js             # WS для real-time обновлений
│   └── ai/
│       ├── explain.mjs             # Существующий AI endpoint
│       └── groundingGuard.mjs      # Существующий guard
├── src/                            # Frontend (React, существующий)
│   ├── services/
│   │   └── api/
│   │       └── client.ts           # NEW: HTTP client к backend
│   ├── context/
│   │   └── AuthContext.tsx          # NEW: auth state provider
│   └── ...
└── ...
```

---

## C. DB Schema (PostgreSQL)

### 001 — users

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    username        VARCHAR(50) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,          -- argon2id
    role            VARCHAR(20) NOT NULL DEFAULT 'user'
                        CHECK (role IN ('user', 'admin')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_blocked      BOOLEAN NOT NULL DEFAULT false,
    blocked_at      TIMESTAMPTZ,
    blocked_reason  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

### 002 — sessions

```sql
CREATE TABLE sessions (
    sid         VARCHAR(255) PRIMARY KEY,            -- session ID
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    sess        JSONB NOT NULL,                      -- session data (express-session)
    expire      TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_expire ON sessions(expire);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Автоочистка expired sessions
-- (express-session + connect-pg-simple делает это автоматически)
```

### 003 — user_preferences

```sql
CREATE TABLE user_preferences (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    watchlist               TEXT[] DEFAULT '{}',       -- ['BTC', 'ETH', 'SOL']
    notification_channels   JSONB DEFAULT '{"in_app": true, "browser": false, "telegram": false}',
    telegram_chat_id        VARCHAR(50),
    theme                   VARCHAR(10) DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
    timezone                VARCHAR(50) DEFAULT 'UTC',
    default_timeframe       VARCHAR(5) DEFAULT '1h',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 004 — site_settings

```sql
CREATE TABLE site_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    description     TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Начальные настройки:
INSERT INTO site_settings (key, value, description) VALUES
('registration_enabled', 'true', 'Регистрация новых пользователей'),
('maintenance_mode', 'false', 'Режим обслуживания'),
('announcement', 'null', 'Глобальное объявление (null = скрыто)'),
('max_users', '1000', 'Максимальное количество пользователей');
```

### 005 — strategy_settings

```sql
CREATE TABLE strategy_settings (
    id              VARCHAR(50) PRIMARY KEY,           -- 'V3.0', 'V3.3', 'V2.8'
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    is_enabled      BOOLEAN NOT NULL DEFAULT true,     -- GLOBAL enabled (только admin)
    status          VARCHAR(50) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'error', 'disabled')),
    timeframes      TEXT[] NOT NULL DEFAULT '{1h, 4h}',
    symbols         TEXT[] NOT NULL DEFAULT '{BTC, ETH, BNB, SOL, XRP, DOGE}',
    scan_interval_s INTEGER NOT NULL DEFAULT 60,
    last_scan_at    TIMESTAMPTZ,
    last_signal_at  TIMESTAMPTZ,
    last_error      TEXT,
    last_error_at   TIMESTAMPTZ,
    signal_count_24h INTEGER NOT NULL DEFAULT 0,
    parameters      JSONB NOT NULL DEFAULT '{}',       -- замороженные параметры (read-only)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Начальные стратегии:
INSERT INTO strategy_settings (id, name, description, status) VALUES
('V3.0', 'HTF Liquidation Trap', 'Ложный пробой 4H экстремума с подтверждением объёмом', 'active'),
('V3.3', 'HTF Zone Mitigation', 'Отбой от 4H зоны спроса/предложения с откатной тенью', 'active'),
('V2.8', 'Sniper (Sweep + Reclaim)', 'Свип 1H свинга с выкупом и импульсным закрытием', 'active');
```

**⚠️ `parameters` — read-only.** Содержит замороженные константы (MIN_BODY_RATIO, MIN_RVOL и т.д.) для отображения в UI. Изменение параметров алгоритма — только через код + deploy + audit (см. раздел I).

### 006 — user_strategy_subscriptions

```sql
CREATE TABLE user_strategy_subscriptions (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    strategy_id     VARCHAR(50) REFERENCES strategy_settings(id) ON DELETE CASCADE,
    is_subscribed   BOOLEAN NOT NULL DEFAULT true,     -- подписка пользователя
    notify_in_app   BOOLEAN NOT NULL DEFAULT true,
    notify_browser  BOOLEAN NOT NULL DEFAULT false,
    notify_telegram BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, strategy_id)
);

-- Каждый пользователь автоматически подписан на все стратегии при регистрации
-- (seed в AuthService.register)
```

**Разделение ответственности:**

| Что | Кто управляет | Таблица |
|-----|--------------|---------|
| Стратегия работает вообще | Admin | `strategy_settings.is_enabled` |
| Пользователь видит сигналы | User | `user_strategy_subscriptions.is_subscribed` |
| Канал уведомлений | User | `user_strategy_subscriptions.notify_*` |

### 007 — signals

```sql
CREATE TABLE signals (
    id                      VARCHAR(100) PRIMARY KEY,     -- 'v30-BTC-1695000000'
    strategy_id             VARCHAR(50) NOT NULL REFERENCES strategy_settings(id),
    symbol                  VARCHAR(20) NOT NULL,         -- 'BTC/USDT'
    direction               VARCHAR(10) NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    timeframe               VARCHAR(5) NOT NULL,          -- '1h'
    signal_candle_ts        TIMESTAMPTZ NOT NULL,         -- openTime свечи, на которой сработал

    entry_zone_low          NUMERIC(20, 8) NOT NULL,
    entry_zone_high         NUMERIC(20, 8) NOT NULL,
    invalidation_level      NUMERIC(20, 8) NOT NULL,      -- stop-loss
    targets                 NUMERIC(20, 8)[] NOT NULL,     -- [tp1, tp2]
    risk_reward_ratio       NUMERIC(10, 4),

    confirming_factors      TEXT[] NOT NULL DEFAULT '{}',
    invalidation_factors    TEXT[] NOT NULL DEFAULT '{}',

    status                  VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE', 'TARGET_REACHED', 'INVALIDATED', 'EXPIRED')),
    closed_at               TIMESTAMPTZ,
    close_price             NUMERIC(20, 8),
    pnl_result_pct          NUMERIC(10, 4),

    audit_hash              VARCHAR(100) NOT NULL,        -- SHA-256 chain
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Защита от дублей: один сигнал на (стратегия + символ + таймфрейм + свеча)
    UNIQUE (strategy_id, symbol, timeframe, signal_candle_ts)
);

CREATE INDEX idx_signals_strategy ON signals(strategy_id);
CREATE INDEX idx_signals_symbol ON signals(symbol);
CREATE INDEX idx_signals_status ON signals(status);
CREATE INDEX idx_signals_created ON signals(created_at DESC);
CREATE INDEX idx_signals_strategy_status ON signals(strategy_id, status);
```

### 008 — audit_log

```sql
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     UUID REFERENCES users(id),             -- NULL = system action
    action      VARCHAR(100) NOT NULL,                 -- 'user.login', 'admin.strategy.toggle', etc.
    entity_type VARCHAR(50),                            -- 'user', 'strategy', 'signal', 'setting'
    entity_id   VARCHAR(200),                           -- ID затронутой сущности
    details     JSONB,                                  -- произвольные детали
    ip_address  INET,
    user_agent  TEXT
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- Автоочистка: удалять записи старше 90 дней (cron job)
```

### Миграции

Используем **node-pg-migrate**. Каждая миграция — отдельный SQL-файл в `server/db/migrations/`. Миграции запускаются при старте сервера (`npm run migrate`) или через CLI.

```bash
npx node-pg-migrate create create-users --sql-file
npx node-pg-migrate up
npx node-pg-migrate down  # rollback
```

---

## D. Authentication / Session Architecture

### Регистрация

```
POST /api/auth/register
Body: { email, username, password }
→ Валидация (zod)
→ Проверка уникальности email/username
→ argon2id hash(password)
→ INSERT INTO users
→ INSERT INTO user_preferences (default)
→ INSERT INTO user_strategy_subscriptions (all 3 strategies, subscribed)
→ audit_log: 'user.register'
→ Set session cookie
→ Response: { user: { id, email, username, role } }
```

### Login

```
POST /api/auth/login
Body: { email, password }
→ Rate limit: 5 attempts / minute per IP
→ SELECT user WHERE email = ?
→ argon2.verify(hash, password)
→ Проверка is_active, is_blocked
→ express-session: создать sid
→ INSERT INTO sessions
→ UPDATE users SET last_login_at, last_login_ip
→ audit_log: 'user.login'
→ Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d
→ Response: { user: { id, email, username, role } }
```

### Logout

```
POST /api/auth/logout
→ Удалить session из БД
→ Clear cookie
→ audit_log: 'user.logout'
```

### Сессии

- **Хранение**: PostgreSQL (connect-pg-simple)
- **Cookie**: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d`
- **НЕ localStorage** для auth tokens
- **НЕ JWT** — сессии в БД проще отозвать (logout, block user)
- **Автоочистка**: connect-pg-simple удаляет expired sessions

### Password change

```
PUT /api/me/password
Body: { currentPassword, newPassword }
→ Проверка текущего пароля
→ argon2id hash(newPassword)
→ UPDATE users SET password_hash
→ Удалить все sessions кроме текущей
→ audit_log: 'user.password_change'
```

---

## E. RBAC (Role-Based Access Control)

### Роли

| Роль | Может | Не может |
|------|-------|----------|
| `user` | Читать сигналы, управлять подписками, свой профиль | Видеть admin-эндпоинты, менять strategy enabled, видеть других пользователей |
| `admin` | Всё что user + admin dashboard, управление стратегиями, пользователями, настройками сайта | Менять математические параметры алгоритмов без deploy |

### Middleware

```javascript
// server/middleware/auth.js
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  req.user = await getUser(req.session.userId);
  if (!req.user.is_active || req.user.is_blocked) return res.status(403).json({ error: 'Blocked' });
  next();
}

// server/middleware/rbac.js
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
```

### Применение

```javascript
// Public
app.post('/api/auth/register', ...);
app.post('/api/auth/login', ...);
app.get('/api/health', ...);

// Authenticated (user)
app.get('/api/me/profile', requireAuth, ...);
app.put('/api/me/preferences', requireAuth, ...);
app.get('/api/signals', requireAuth, ...);
app.get('/api/strategies', requireAuth, ...);

// Admin only
app.get('/api/admin/dashboard', requireAuth, requireRole('admin'), ...);
app.get('/api/admin/users', requireAuth, requireRole('admin'), ...);
app.put('/api/admin/strategies/:id', requireAuth, requireRole('admin'), ...);
app.put('/api/admin/site-settings', requireAuth, requireRole('admin'), ...);
```

**Admin определяется ТОЛЬКО сервером** (`users.role = 'admin'` в БД). Frontend не может elevatить привилегии.

---

## F. Admin Panel — все разделы

### F.1 Dashboard (`/api/admin/dashboard`)

```json
{
  "server": {
    "uptime": 86400,
    "version": "0.8.44",
    "commit": "78b56b3",
    "nodeVersion": "v22.22.3",
    "memoryMb": 128,
    "cpuUsage": 0.15
  },
  "database": {
    "connected": true,
    "poolSize": 10,
    "activeConnections": 3,
    "queriesPerSecond": 12
  },
  "marketData": {
    "binance": { "connected": true, "lastUpdate": "...", "errors24h": 0 },
    "kucoin": { "connected": true, "lastUpdate": "...", "errors24h": 2 },
    "websocket": { "state": "connected", "subscribedStreams": 6 }
  },
  "strategies": {
    "engineActive": true,
    "activeStrategies": 3,
    "signalsLast24h": 5,
    "lastScan": "..."
  },
  "liquidations": {
    "collectorStatus": "LIVE_STREAM",
    "exchanges": ["binance", "bybit", "okx"],
    "eventsCount24h": 1420,
    "lastEventAt": "..."
  },
  "errors": {
    "last24h": 3,
    "lastError": { "message": "...", "timestamp": "...", "service": "..." }
  }
}
```

### F.2 Users (`/api/admin/users`)

```
GET    /api/admin/users?search=&role=&status=&page=&limit=
GET    /api/admin/users/:id
PUT    /api/admin/users/:id/block    { reason }
PUT    /api/admin/users/:id/unblock
PUT    /api/admin/users/:id/role     { role: 'admin' | 'user' }
```

### F.3 Strategies (`/api/admin/strategies`)

```
GET    /api/admin/strategies                  — список 3 стратегий с полным статусом
PUT    /api/admin/strategies/:id              — { is_enabled, status, scan_interval_s, symbols }
GET    /api/admin/strategies/:id/signals      — сигналы конкретной стратегии
```

**Ответ `GET /api/admin/strategies`:**

```json
[
  {
    "id": "V3.0",
    "name": "HTF Liquidation Trap",
    "isEnabled": true,
    "status": "active",
    "timeframes": ["1h", "4h"],
    "symbols": ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"],
    "scanIntervalS": 60,
    "lastScanAt": "...",
    "lastSignalAt": "...",
    "lastError": null,
    "lastErrorAt": null,
    "signalCount24h": 3,
    "parameters": {
      "MIN_BODY_RATIO": 0.35,
      "MIN_RVOL": 1.25,
      "CORRIDOR_ATR_FRAC": 0.10,
      "STOP_BUFFER_ATR": 0.15,
      "TIMEOUT_BARS": 50
    }
  },
  ...
]
```

**⚠️ `parameters` — read-only.** Admin видит их, но не может менять через API. Только deploy.

### F.4 Signals (`/api/admin/signals`)

```
GET    /api/admin/signals?strategy=&symbol=&status=&from=&to=&page=&limit=
GET    /api/admin/signals/:id
GET    /api/admin/signals/engine-status       — состояние LiveSignalEngine
```

### F.5 Data Sources (`/api/admin/data-sources`)

```
GET    /api/admin/data-sources
```

```json
{
  "binance": { "type": "REST+WS", "connected": true, "lastUpdate": "...", "errors24h": 0, "reconnects": 0 },
  "kucoin": { "type": "REST", "connected": true, "lastUpdate": "...", "errors24h": 2 },
  "binanceFutures": { "type": "REST+WS", "connected": true, "lastUpdate": "...", "errors24h": 0 },
  "bybit": { "type": "WS", "connected": true, "purpose": "liquidations", "lastEvent": "..." },
  "okx": { "type": "WS", "connected": false, "purpose": "liquidations", "lastEvent": null }
}
```

### F.6 Site Settings (`/api/admin/site-settings`)

```
GET    /api/admin/site-settings
PUT    /api/admin/site-settings    { key: value, ... }
```

```json
{
  "registration_enabled": true,
  "maintenance_mode": false,
  "announcement": null,
  "max_users": 1000
}
```

### F.7 Audit Log (`/api/admin/audit-log`)

```
GET    /api/admin/audit-log?action=&user=&entity=&from=&to=&page=&limit=
```

---

## G. User Profile

### Endpoints

```
GET    /api/me/profile
PUT    /api/me/profile           { username? }
PUT    /api/me/password          { currentPassword, newPassword }
GET    /api/me/preferences
PUT    /api/me/preferences       { watchlist?, theme?, timezone?, notificationChannels? }
GET    /api/me/subscriptions
PUT    /api/me/subscriptions/:strategyId    { isSubscribed?, notifyInApp?, notifyBrowser?, notifyTelegram? }
```

### Profile Response

```json
{
  "id": "...",
  "email": "user@example.com",
  "username": "trader42",
  "role": "user",
  "createdAt": "...",
  "lastLoginAt": "...",
  "preferences": {
    "watchlist": ["BTC", "ETH", "SOL"],
    "theme": "dark",
    "timezone": "Europe/Moscow",
    "defaultTimeframe": "1h",
    "notificationChannels": { "inApp": true, "browser": false, "telegram": false }
  },
  "subscriptions": [
    { "strategyId": "V3.0", "name": "HTF Liquidation Trap", "isSubscribed": true, "notifyInApp": true },
    { "strategyId": "V3.3", "name": "HTF Zone Mitigation", "isSubscribed": true, "notifyInApp": true },
    { "strategyId": "V2.8", "name": "Sniper", "isSubscribed": false, "notifyInApp": false }
  ]
}
```

---

## H. REST API

### Публичные (без auth)

| Method | Endpoint | Описание |
|--------|----------|----------|
| GET | `/api/health` | Health check + version |
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Вход |
| GET | `/api/strategies` | Публичный список стратегий (id, name, status, без admin-деталей) |

### Authenticated (user)

| Method | Endpoint | Описание |
|--------|----------|----------|
| POST | `/api/auth/logout` | Выход |
| GET | `/api/me/profile` | Профиль |
| PUT | `/api/me/profile` | Обновить профиль |
| PUT | `/api/me/password` | Сменить пароль |
| GET | `/api/me/preferences` | Настройки |
| PUT | `/api/me/preferences` | Обновить настройки |
| GET | `/api/me/subscriptions` | Подписки на стратегии |
| PUT | `/api/me/subscriptions/:id` | Обновить подписку |
| GET | `/api/signals` | Сигналы (с учётом подписок пользователя) |
| GET | `/api/signals/:id` | Детали сигнала |
| GET | `/api/strategies` | Стратегии + статус + подписка текущего пользователя |

### Admin

| Method | Endpoint | Описание |
|--------|----------|----------|
| GET | `/api/admin/dashboard` | Dashboard stats |
| GET | `/api/admin/users` | Список пользователей |
| GET | `/api/admin/users/:id` | Детали пользователя |
| PUT | `/api/admin/users/:id/block` | Заблокировать |
| PUT | `/api/admin/users/:id/unblock` | Разблокировать |
| PUT | `/api/admin/users/:id/role` | Сменить роль |
| GET | `/api/admin/strategies` | Стратегии + admin-детали |
| PUT | `/api/admin/strategies/:id` | Обновить настройки стратегии |
| GET | `/api/admin/signals` | Все сигналы |
| GET | `/api/admin/signals/engine-status` | Состояние engine |
| GET | `/api/admin/data-sources` | Статус источников |
| GET | `/api/admin/site-settings` | Настройки сайта |
| PUT | `/api/admin/site-settings` | Обновить настройки |
| GET | `/api/admin/audit-log` | Аудит-лог |

### WebSocket (authenticated)

| Path | Направление | Описание |
|------|------------|----------|
| `/ws` | Server → Client | Real-time: live prices, new signals, status updates |

---

## I. Strategy Settings Architecture

### Разделение уровней

```
┌─────────────────────────────────────────────────────────┐
│ Level 1: CODE (deploy only)                             │
│                                                         │
│   v30Core.ts: MIN_BODY_RATIO = 0.35                    │
│   v30Core.ts: MIN_RVOL = 1.25                          │
│   LiveSignalEngine: runV30(), runV33(), runV28()        │
│                                                         │
│   ⚠️ Только через git commit + deploy                   │
│   ⚠️ Admin НЕ может менять через API                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Level 2: DB (admin API, real-time)                      │
│                                                         │
│   strategy_settings.is_enabled   (вкл/выкл стратегии)  │
│   strategy_settings.symbols      (символы для скана)    │
│   strategy_settings.scan_interval_s (интервал скана)    │
│   strategy_settings.status       (active/paused/error)  │
│                                                         │
│   ✅ Admin может менять через /api/admin/strategies/:id │
│   ✅ Изменения применяются немедленно                   │
│   ✅ Аудит-лог фиксирует каждое изменение               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Level 3: User preferences (user API)                    │
│                                                         │
│   user_strategy_subscriptions.is_subscribed             │
│   user_strategy_subscriptions.notify_*                  │
│                                                         │
│   ✅ Пользователь управляет своими подписками           │
│   ⚠️ НЕ влияет на глобальный engine                     │
└─────────────────────────────────────────────────────────┘
```

### Mathematical parameters — advanced механизм (будущее)

Если когда-либо понадобится менять параметры алгоритмов через UI:

```
1. Параметры хранятся в strategy_parameters_versions (versioning)
2. Изменение создаёт новую версию (status: 'pending')
3. Требует admin + подтверждение (confirmationToken)
4. Audit log фиксирует: кто, когда, что изменил, старое значение, новое
5. Новая версия активируется только после validation run (dry-run на исторических данных)
6. Откат к предыдущей версии одной кнопкой
```

**На первом этапе: параметры в коде, period.**

---

## J. Signals Persistence

### Жизненный цикл сигнала (server-side)

```
1. StrategyRunner (setInterval, каждые scan_interval_s секунд)
   → Проверяет strategy_settings.is_enabled
   → Для каждой enabled стратегии:
     → Для каждого символа из strategy_settings.symbols:
       → Запрашивает свечи 1h + 4h (server-side Binance REST)
       → Запускает runV30/runV33/runV28
       → При нахождении паттерна → INSERT INTO signals
       → Dedup: INSERT ... ON CONFLICT (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING

2. WebSocket уведомление:
   → Новый сигнал → broadcast всем подписанным пользователям

3. TP/SL tracking (будущее):
   → Периодически проверяет актуальную цену для ACTIVE сигналов
   → При достижении TP → UPDATE status = 'TARGET_REACHED'
   → При достижении SL → UPDATE status = 'INVALIDATED'
   → При timeout → UPDATE status = 'EXPIRED'
```

### Защита от дублей

```sql
UNIQUE (strategy_id, symbol, timeframe, signal_candle_ts)
```

Один сигнал на (стратегия + символ + таймфрейм + timestamp свечи). Повторный INSERT для того же бара — `DO NOTHING`.

### SHA-256 chain (сохраняется)

Audit hash chain переносится в БД. Каждый сигнал хэшируется с предыдущим:

```javascript
const prevHash = await getLastSignalHash(strategy_id);
const auditHash = sha256(JSON.stringify({ ...signalData, prevHash }));
```

### Миграция с текущего ledger

Текущий `SignalsAuditLedger` (in-memory + localStorage) заменяется на:
1. Server-side: `SignalService` → INSERT/SELECT в PostgreSQL
2. Frontend: `GET /api/signals` → читает из БД
3. localStorage ledger: deprecated, можно оставить как offline-fallback

---

## K. Audit Architecture

### Что логируется

| Действие | entity_type | Пример details |
|----------|-------------|----------------|
| `user.register` | user | `{ email, username }` |
| `user.login` | user | `{ ip, userAgent }` |
| `user.logout` | user | |
| `user.password_change` | user | |
| `user.blocked` | user | `{ reason, blockedBy }` |
| `user.unblocked` | user | `{ unblockedBy }` |
| `user.role_change` | user | `{ from: 'user', to: 'admin' }` |
| `strategy.enabled_toggle` | strategy | `{ strategyId, from: true, to: false }` |
| `strategy.settings_change` | strategy | `{ field, oldValue, newValue }` |
| `signal.created` | signal | `{ signalId, strategyId, symbol, direction }` |
| `signal.status_change` | signal | `{ from: 'ACTIVE', to: 'EXPIRED' }` |
| `setting.changed` | setting | `{ key, oldValue, newValue }` |
| `system.error` | system | `{ service, error, stack }` |

### Middleware

```javascript
// Автоматический audit для admin endpoints
app.use('/api/admin', auditMiddleware);

function auditMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) {
      AuditService.log({
        userId: req.user.id,
        action: `${req.method} ${req.path}`,
        entityType: extractEntityType(req.path),
        entityId: req.params.id,
        details: { body: req.body, response: body },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    }
    return originalJson(body);
  };
  next();
}
```

### Retention

- Audit log: 90 дней (cron job: `DELETE FROM audit_log WHERE timestamp < now() - interval '90 days'`)
- Signals: indefinitely (historical data)
- Sessions: auto-cleanup by connect-pg-simple

---

## L. Security Model

| Мера | Реализация |
|------|-----------|
| **Password hashing** | argon2id (memory: 64MB, iterations: 3, parallelism: 4) |
| **Session storage** | PostgreSQL (connect-pg-simple), httpOnly cookie |
| **Cookie flags** | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d` |
| **CSRF** | Double-submit cookie pattern для state-changing requests |
| **Rate limiting — login** | 5 attempts/min per IP |
| **Rate limiting — register** | 3 attempts/min per IP |
| **Rate limiting — API** | 30 req/s per IP (nginx) + per-user limits |
| **Input validation** | Zod schemas on all endpoints |
| **RBAC** | Server-side only, role in DB, middleware checks |
| **SQL injection** | Parameterized queries (pg driver) |
| **XSS** | CSP headers (nginx), React auto-escapes |
| **Admin isolation** | Admin endpoints require `role = 'admin'` in DB |
| **No plaintext passwords** | Password never stored, logged, or returned |
| **No trading keys** | CRYPTORA не хранит exchange API keys |
| **Audit log** | All admin actions logged with IP + user agent |
| **Session revocation** | Logout = delete from DB. Block user = delete all sessions |
| **Secure headers** | HSTS, X-Frame-Options, CSP, X-Content-Type-Options |

---

## M. Миграционный план

### Текущее состояние → целевое

| Сейчас | Будет |
|--------|-------|
| `productionServer.js` (static + proxy) | `server/index.js` (Express + auth + API + WS) |
| localStorage (watchlist, settings) | PostgreSQL |
| localStorage (signals) | PostgreSQL |
| `LiveSignalEngine` в браузере | `LiveSignalEngine` на сервере |
| `SignalsAuditLedger` в браузере | `SignalService` на сервере |
| Frontend MarketDataProvider напрямую к биржам | Backend MarketDataService → Frontend через API/WS |
| Нет auth | Session-based auth + RBAC |
| Нет admin | Admin panel + audit log |

### Совместимость

- Существующие routes (`/`, `/market`, `/coin/:symbol` и т.д.) — **не ломаются**. SPA по-прежнему работает.
- Frontend постепенно переключается с прямых запросов к биржам на backend API.
- Во время миграции: бэкенд может проксировать market data (как раньше proxy делал, но с валидацией).

---

## N. Существующие файлы, которые придётся изменить

| Файл | Что менять |
|------|-----------|
| `server/productionServer.js` | Заменить на `server/index.js` (Express) |
| `nginx/cryptora.conf` | Добавить WS upgrade, auth rate limits |
| `systemd/cryptora.service` | Обновить ExecStart |
| `src/context/MarketDataContext.tsx` | Переключить на backend API вместо прямых запросов |
| `src/services/signals/live/LiveSignalEngine.ts` | Перенести на сервер (Node.js версия) |
| `src/services/signals/SignalsAuditLedger.ts` | Заменить на API calls |
| `src/pages/SignalsPage.tsx` | Читать из `/api/signals` вместо in-memory ledger |
| `src/pages/StrategiesPage.tsx` | Читать из `/api/strategies` |
| `src/components/layout/Header.tsx` | Добавить auth UI (login/register/profile) |
| `package.json` | Добавить серверные зависимости |
| `vite.config.ts` | Добавить proxy для dev-режима к backend |

---

## O. Новые файлы/директории

```
server/
├── index.js                          # Express app + startup
├── config.js                         # ENV config (DB_URL, SESSION_SECRET, etc.)
├── db/
│   ├── pool.js                       # pg Pool
│   ├── migrations/
│   │   ├── 001_create_users.sql
│   │   ├── 002_create_sessions.sql
│   │   ├── 003_create_preferences.sql
│   │   ├── 004_create_site_settings.sql
│   │   ├── 005_create_strategy_settings.sql
│   │   ├── 006_create_signals.sql
│   │   ├── 007_create_audit_log.sql
│   │   └── 008_create_subscriptions.sql
│   └── seed.js                       # Admin user + default settings
├── middleware/
│   ├── auth.js
│   ├── rbac.js
│   ├── rateLimit.js
│   ├── validate.js
│   └── audit.js
├── routes/
│   ├── auth.js
│   ├── me.js
│   ├── admin.js
│   ├── strategies.js
│   └── signals.js
├── services/
│   ├── AuthService.js
│   ├── UserService.js
│   ├── AdminService.js
│   ├── StrategyService.js
│   ├── SignalService.js
│   ├── AuditService.js
│   ├── SettingsService.js
│   └── MarketDataService.js
├── engine/
│   ├── LiveSignalEngine.js           # Портированный с фронта
│   ├── StrategyRunner.js
│   └── ohlcvAdapter.js
└── websocket/
    └── wsServer.js

src/
├── services/
│   └── api/
│       └── client.ts                  # HTTP client (fetch wrapper)
├── context/
│   └── AuthContext.tsx                 # Auth state + login/logout/register
└── pages/
    └── AdminPage.tsx                   # Admin panel (новая страница)
```

---

## P. Порядок реализации (маленькие независимые этапы)

### Этап 1: Backend foundation (1-2 дня)
- `server/index.js` — Express app
- PostgreSQL: установка, `server/db/pool.js`
- Миграция 001: `users` table
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- argon2id hashing
- express-session + connect-pg-simple
- Seed: admin user

### Этап 2: Auth middleware + RBAC (1 день)
- `requireAuth`, `requireRole` middleware
- Rate limiting (login/register)
- CSRF protection
- `GET /api/me/profile`

### Этап 3: User preferences (1 день)
- Миграция 003: `user_preferences`
- Миграция 008: `user_strategy_subscriptions`
- `GET/PUT /api/me/preferences`
- `GET/PUT /api/me/subscriptions`

### Этап 4: Strategy settings + persistence (1 день)
- Миграция 005: `strategy_settings`
- `GET /api/strategies` (public)
- `GET/PUT /api/admin/strategies/:id`
- Seed: V3.0, V3.3, V2.8

### Этап 5: Signal persistence (1-2 дня)
- Миграция 006: `signals`
- `SignalService` — INSERT/SELECT
- Портировать `LiveSignalEngine` на сервер
- `StrategyRunner` — setInterval + strategy_settings
- `GET /api/signals` (user)
- `GET /api/admin/signals` (admin)
- SHA-256 chain в БД

### Этап 6: Audit log (0.5 дня)
- Миграция 007: `audit_log`
- `AuditService`
- Audit middleware для admin endpoints
- `GET /api/admin/audit-log`

### Этап 7: Admin dashboard (1 день)
- `GET /api/admin/dashboard` — server stats, DB, market data, engine
- `GET /api/admin/users` — user list, search, block/unblock
- `GET /api/admin/data-sources` — exchange connection status

### Этап 8: Site settings (0.5 дня)
- Миграция 004: `site_settings`
- `GET/PUT /api/admin/site-settings`
- Maintenance mode middleware
- Registration toggle

### Этап 9: WebSocket (1 день)
- `ws` server на том же Express
- Auth через cookie при WS upgrade
- Broadcast: live prices, new signals
- Frontend: `AuthContext` + API client

### Этап 10: Frontend integration (2-3 дня)
- `src/services/api/client.ts` — HTTP client
- `src/context/AuthContext.tsx`
- Login/Register pages
- Admin page
- Переключить MarketDataContext на backend API
- Переключить SignalsPage на `/api/signals`
- Переключить StrategiesPage на `/api/strategies`

### Этап 11: Deployment + testing (1-2 дня)
- PostgreSQL установка на VPS
- nginx: WS upgrade, auth rate limits
- systemd: обновить service
- SSL: Let's Encrypt
- Smoke tests
- E2E tests для auth flow

**Итого: ~10-14 дней на полную реализацию.**

---

## Q. Что НЕ следует делать

| Не делать | Почему |
|-----------|--------|
| JWT вместо сессий | Сложнее отозвать (logout, block). Сессии в БД проще и безопаснее. |
| MongoDB вместо PostgreSQL | Реляционные данные (users, signals, audit). PostgreSQL надёжнее для ACID. |
| Microservices | Один VPS, один процесс. Достаточно Express + background workers. |
| React SSR / Next.js | SPA уже работает. Не переписывать фронтенд. |
| Менять математику стратегий | Параметры в коде. Admin видит, но не меняет. |
| Хранить exchange API keys | CRYPTORA — аналитика, не трейдинг-бот. |
| Trading execution | Заявлено: сигналы только, без ордеров. |
| OAuth / social login | На первом этапе достаточно email+password. |
| GraphQL | REST достаточен для текущих потребностей. |
| Redis | PostgreSQL достаточно для сессий и кэша. Не добавлять лишнюю инфраструктуру на одном VPS. |
| Docker | Один VPS, systemd. Docker добавит complexity без benefit. |
| Celery / Bull queue | Background workers в том же процессе (setInterval + event-driven). |

---

## R. Production Environment (supplement)

### Production URL

```
https://cryptora.duckdns.org
```

### Network topology

```
Internet
  │
  ▼
Nginx (:443 HTTPS, :80 → 301 HTTPS)
  │
  ├── / (static) ──→ /var/www/cryptora/ (React build)
  │
  ├── /api/* ──→ http://127.0.0.1:3000/api/*
  │
  └── /ws ──→ http://127.0.0.1:3000/ws (WebSocket upgrade)
```

### Backend binding

```javascript
// server/config.js
const HOST = process.env.HOST || '127.0.0.1';  // NEVER 0.0.0.0 in production
const PORT = parseInt(process.env.PORT || '3000', 10);
```

**Порт 3000 НЕ открывать в firewall.** Доступ только через Nginx.

### Same-origin

Frontend и API на одном домене (`cryptora.duckdns.org`). CORS не нужен. Не настраивать `Access-Control-Allow-Origin: *`.

### Auth cookies (production)

```
Set-Cookie: sid=<session-id>;
  HttpOnly;       // JS cannot read
  Secure;         // HTTPS only
  SameSite=Lax;   // same-origin, no CSRF from external sites
  Path=/;         // available for all API routes
  Max-Age=604800; // 7 days
```

### Example Nginx config (参考, не автодеплой)

```nginx
# ── General API proxy ─────────────────────────────────────────────
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

# ── Auth endpoints (tighter rate limit) ───────────────────────────
# limit_req_zone defined at server{} level:
# limit_req_zone $binary_remote_addr zone=cryptora_auth:10m rate=5r/m;
location /api/auth/ {
    limit_req zone=cryptora_auth burst=3 nodelay;

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ── WebSocket ─────────────────────────────────────────────────────
location /ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

**⚠️ Это пример. Существующий production Nginx автоматически НЕ изменяется.**

### systemd service (updated)

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

### Environment variables (.env.production)

```bash
# Database
DATABASE_URL=postgresql://cryptora:<password>@127.0.0.1:5432/cryptora

# Session
SESSION_SECRET=<random-64-char-hex>
SESSION_MAX_AGE=604800000       # 7 days in ms

# Cookie
COOKIE_SECURE=true
COOKIE_SAMESITE=lax

# Server
HOST=127.0.0.1
PORT=3000
NODE_ENV=production

# Rate limits
LOGIN_RATE_LIMIT=5              # per minute per IP
REGISTER_RATE_LIMIT=3           # per minute per IP
API_RATE_LIMIT=100              # per minute per user

# Admin seed
ADMIN_EMAIL=admin@cryptora.duckdns.org
ADMIN_PASSWORD=<strong-password>
```

### CORS policy

Same-origin — CORS **не нужен**. Не добавлять `cors()` middleware в production.

```javascript
// Explicitly DO NOT add:
// app.use(cors({ origin: '*' }));
```

### Deployment checklist (manual, after code review)

```
1.  SSH to VPS
2.  cd /home/CRYPTORA && git pull origin main
3.  npm install
4.  sudo -u postgres createdb cryptora          # if DB doesn't exist
5.  npm run migrate                               # run DB migrations
6.  npm run seed                                  # create admin + default settings
7.  npm run build                                 # build frontend
8.  sudo cp -r dist/* /var/www/cryptora/          # deploy static files
9.  sudo systemctl restart cryptora               # restart backend
10. sudo nginx -t && sudo systemctl reload nginx
11. curl -s https://cryptora.duckdns.org/api/health
```

**Агент НЕ выполняет команды на production VPS.** Только local dev/test/build.

---

*Документ составлен на основании HEAD 78b56b3, v0.8.44.*
*Production URL: https://cryptora.duckdns.org*
