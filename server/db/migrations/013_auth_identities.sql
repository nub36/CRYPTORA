-- ============================================================================
-- 013: Social auth identities + 6-digit email verification codes
-- ============================================================================
-- Adds the foundation for social login (Google / Telegram / Yandex / VK ID)
-- and for code-based email verification, WITHOUT touching existing data.
--
-- BACKWARD COMPATIBILITY / ROLLBACK NOTES
--   * Purely additive: no DROP, no DELETE, no UPDATE of existing rows.
--   * Existing users keep their rows, password hashes, sessions and
--     email_verified state untouched. Verified users continue to log in.
--   * Outstanding link-style verification tokens (kind='link' by default)
--     keep working through POST /api/auth/verify-email.
--   * Forward: `npm run migrate` applies this file once (schema_migrations).
--   * Rollback: the app built before this migration ignores the new table and
--     columns entirely (all columns have defaults / are nullable), so rolling
--     back the CODE without rolling back the SCHEMA is safe. To roll back the
--     schema itself: DROP TABLE auth_identities; ALTER TABLE
--     email_verification_tokens DROP COLUMN kind, DROP COLUMN attempts;
--     restore NOT NULL on users.password_hash/users.email only after ensuring
--     no social-only accounts exist.
-- ============================================================================

-- ── users: social-only accounts ─────────────────────────────────────────────
-- A user created through an OAuth provider has no password. Telegram does not
-- expose an email address at all, so email becomes nullable too. The unique
-- index idx_users_email_lower (001) ignores NULLs, so uniqueness of real
-- addresses is preserved.
ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
    ALTER COLUMN email DROP NOT NULL;

-- ── email_verification_tokens: 6-digit codes ────────────────────────────────
-- Existing rows default to kind='link' (the legacy long-token links already in
-- mailboxes). New registrations issue kind='code' rows whose token_hash column
-- stores an HMAC-SHA256 of the code (never the plaintext code) and whose
-- attempts counter enforces a per-code guess budget.
ALTER TABLE email_verification_tokens
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'link'
        CHECK (kind IN ('link', 'code')),
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- Hot path for the code flow: newest active code for a user.
CREATE INDEX IF NOT EXISTS idx_evt_user_kind_created
    ON email_verification_tokens (user_id, kind, created_at DESC);

-- ── auth_identities ──────────────────────────────────────────────────────────
-- One row per (provider, provider account). A user may have several providers;
-- a provider account can belong to exactly one user (UNIQUE below) — this is
-- what makes duplicate-identity and account-takeover scenarios impossible at
-- the schema level.
CREATE TABLE IF NOT EXISTS auth_identities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL
        REFERENCES users (id) ON DELETE CASCADE,
    -- 'password' identities are NOT stored here: the password hash stays in
    -- users.password_hash (its existing, audited location).
    provider          TEXT        NOT NULL
        CHECK (provider IN ('google', 'telegram', 'yandex', 'vk')),
    -- The provider's immutable subject: Google `sub`, Telegram user id,
    -- Yandex `id`, VK ID `user_id`. Never an email — emails can be recycled.
    provider_subject  TEXT        NOT NULL,
    -- Informational only. NEVER used for account matching or takeover-prone
    -- auto-linking. Nullable: Telegram has no email at all.
    provider_email    TEXT        NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_auth_identities_provider_subject
        UNIQUE (provider, provider_subject)
);

-- "Which providers does this user have?" (profile page, unlink guard).
CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id
    ON auth_identities (user_id);
