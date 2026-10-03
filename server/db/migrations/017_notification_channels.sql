-- 017: Account-scoped notification channels and sanitized delivery diagnostics.
-- Telegram bot tokens are AES-256-GCM ciphertext produced by the application;
-- plaintext tokens must never be written to PostgreSQL.

CREATE TABLE IF NOT EXISTS notification_channels (
    user_id                  UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    browser_enabled          BOOLEAN NOT NULL DEFAULT false,
    telegram_enabled         BOOLEAN NOT NULL DEFAULT false,
    telegram_chat_id         TEXT NOT NULL DEFAULT '',
    telegram_token_ciphertext TEXT,
    webhook_enabled          BOOLEAN NOT NULL DEFAULT false,
    webhook_url              TEXT NOT NULL DEFAULT '',
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (telegram_chat_id = '' OR telegram_chat_id ~ '^-?[1-9][0-9]*$'),
    CHECK (telegram_token_ciphertext IS NULL OR telegram_token_ciphertext LIKE 'v1:%')
);

CREATE TABLE IF NOT EXISTS notification_delivery_log (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel             TEXT NOT NULL CHECK (channel IN ('TELEGRAM')),
    event_type          TEXT NOT NULL,
    event_id            TEXT,
    result              TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
    provider_status     INTEGER,
    provider_error_code INTEGER,
    error_code          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_user_created
    ON notification_delivery_log (user_id, created_at DESC);
