-- ============================================================================
-- 004: Create audit_log table
-- ============================================================================
-- Append-only audit trail for all admin mutations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   UUID    NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    action          TEXT    NOT NULL,
    target_type     TEXT    NOT NULL,
    target_id       TEXT,
    metadata        JSONB   NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by actor
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
    ON audit_log (actor_user_id);

-- Lookup by action
CREATE INDEX IF NOT EXISTS idx_audit_log_action
    ON audit_log (action);

-- Lookup by target
CREATE INDEX IF NOT EXISTS idx_audit_log_target
    ON audit_log (target_type, target_id);

-- Time-ordered for pagination
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
    ON audit_log (created_at DESC);