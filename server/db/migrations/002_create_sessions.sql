-- ============================================================================
-- 002: Create sessions table (connect-pg-simple compatible)
-- ============================================================================
-- Server-side sessions. No JWT. connect-pg-simple manages this table.
--
-- This schema deliberately mirrors the canonical definition shipped by
-- connect-pg-simple (node_modules/connect-pg-simple/table.sql):
--
--     "sid"    varchar        NOT NULL   + PRIMARY KEY
--     "sess"   json           NOT NULL
--     "expire" timestamp(6)   NOT NULL
--     INDEX on "expire"
--
-- Two intentional, documented deviations:
--   * sid is bounded at VARCHAR(128) rather than unbounded varchar. Our cookie
--     id is far shorter; the bound only guards against pathological input.
--   * expire is TIMESTAMPTZ, not timestamp(6). connect-pg-simple always writes
--     it via to_timestamp(), which returns timestamptz, and always compares it
--     against to_timestamp() in SQL. Keeping the column timestamptz means both
--     sides are absolute instants, so no implicit session-timezone cast is
--     involved. connect-pg-simple never parses `expire` in JavaScript, so the
--     change is invisible to the store.
--
-- WHY THERE IS NO GIN INDEX ON `sess`
-- -----------------------------------
-- An earlier revision created `USING GIN (sess)`, which fails on a real
-- server with:
--
--     ERROR: data type json has no default operator class for access
--            method "gin"
--
-- PostgreSQL ships no default GIN operator class for `json` (only for
-- `jsonb`: jsonb_ops / jsonb_path_ops). Converting the column to jsonb would
-- let the index be created, but it would still be dead weight: the only query
-- in the codebase that filters on `sess` is
--
--     DELETE FROM sessions WHERE sess->>'userId' = $1     (server/routes/admin.js)
--
-- and the default GIN opclass supports @>, ?, ?& and ?| only — NOT `->>`.
-- That query would still sequential-scan.
--
-- An expression index `((sess->>'userId'))` would match it, but the sessions
-- table is small and self-pruning (sessions expire within SESSION_MAX_AGE and
-- connect-pg-simple prunes them), and this DELETE runs only on the rare admin
-- "block user" action. A sequential scan there is not worth a permanent index
-- maintained on every session write, so no index is created. If this ever
-- becomes hot, the correct fix is that expression B-tree index — never GIN.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
    sid         VARCHAR(128)    NOT NULL PRIMARY KEY,
    sess        JSON            NOT NULL,
    expire      TIMESTAMPTZ     NOT NULL
);

-- Required by connect-pg-simple's garbage collection:
--     DELETE FROM sessions WHERE expire < to_timestamp($1)
CREATE INDEX IF NOT EXISTS idx_sessions_expire
    ON sessions (expire);
