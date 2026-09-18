-- ============================================================================
-- 005: Email verification
-- ============================================================================
-- Adds mandatory mailbox verification for public registration.
--
-- Migration 001 is NOT modified: it is already defined and applied. This
-- migration layers the new columns and the token table on top.
-- ============================================================================

-- ── users: verification state ───────────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;

-- Partial index: only unverified rows are ever queried during login/resend.
CREATE INDEX IF NOT EXISTS idx_users_email_unverified
    ON users (lower(email))
    WHERE email_verified = FALSE;

-- ── email_verification_tokens ───────────────────────────────────────────────
-- Only the SHA-256 hash of the raw token is stored. The raw token is sent to
-- the mailbox once and is never persisted or logged.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL
        REFERENCES users (id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by token hash on the verify endpoint (the hot path).
CREATE UNIQUE INDEX IF NOT EXISTS idx_evt_token_hash
    ON email_verification_tokens (token_hash);

-- Invalidate a user's outstanding tokens on resend / verify.
CREATE INDEX IF NOT EXISTS idx_evt_user_id
    ON email_verification_tokens (user_id);

-- Expiry sweep / diagnostics.
CREATE INDEX IF NOT EXISTS idx_evt_expires_at
    ON email_verification_tokens (expires_at);