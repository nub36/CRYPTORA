-- ============================================================================
-- 003: Create user_preferences table
-- ============================================================================
-- Per-user UI preferences (theme, locale, etc.). Phase 1 minimal schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id         UUID PRIMARY KEY
        REFERENCES users (id) ON DELETE CASCADE,
    theme           TEXT    NOT NULL DEFAULT 'dark'
        CHECK (theme IN ('light', 'dark', 'system')),
    locale          TEXT    NOT NULL DEFAULT 'ru',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);