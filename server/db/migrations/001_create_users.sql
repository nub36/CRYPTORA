-- ============================================================================
-- 001: Create users table
-- ============================================================================
-- CRYPTORA Phase 1 — Backend + Auth + Profile + Admin foundation
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL,
    display_name    TEXT        NOT NULL,
    password_hash   TEXT        NOT NULL,
    role            TEXT        NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

-- Email must be unique and normalized (lowercase, trimmed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (lower(email));

-- Index for active user lookups (admin panel)
CREATE INDEX IF NOT EXISTS idx_users_is_active
    ON users (is_active);

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role
    ON users (role);