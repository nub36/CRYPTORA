-- ============================================================================
-- 002: Create sessions table (connect-pg-simple compatible)
-- ============================================================================
-- Server-side sessions. No JWT. connect-pg-simple manages this table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
    sid         VARCHAR(128)    NOT NULL PRIMARY KEY,
    sess        JSON            NOT NULL,
    expire      TIMESTAMPTZ     NOT NULL
);

-- Expire index for session cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_expire
    ON sessions (expire);

-- User session lookup (for forced logout / block propagation)
CREATE INDEX IF NOT EXISTS idx_sessions_sess_user_id
    ON sessions USING GIN (sess);