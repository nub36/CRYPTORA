-- ============================================================================
-- 006: Strategy settings (per-strategy ON/OFF for the server signal engine)
-- ============================================================================
-- Purpose
-- -------
-- Make the three product strategies genuinely operable: a real switch per
-- strategy, persisted in PostgreSQL, read by the server-side engine so that
-- scanning continues when the browser is closed.
--
-- Deliberate constraints
-- ----------------------
-- 1. NO MATHEMATICAL PARAMETERS HERE. RVOL thresholds, wick/body ratios, ATR
--    periods, corridor fractions, stop buffers, targets — all of it stays in
--    code (`src/services/strategyArchive/definitions/**`). This table only
--    decides WHETHER a strategy runs and HOW OFTEN. The algorithm cannot be
--    changed from the admin panel.
-- 2. EVERY STRATEGY STARTS DISABLED. The migration inserts the three known
--    rows with `enabled = FALSE`, so nothing begins scanning automatically
--    after `npm run migrate`. An administrator enables strategies manually.
-- 3. `strategy_id` is the PRIMARY KEY, so a fourth, arbitrary strategy cannot
--    be created through the API — only the three shipped ids exist.
--
-- Migrations 001-005 are NOT modified.
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_settings (
    -- Registry id, e.g. 'V3_3_HTF_ZONE_MITIGATION'. Primary key by design:
    -- the set of strategies is fixed by code, not by rows anyone can insert.
    strategy_id            TEXT        PRIMARY KEY,

    -- Master switch. FALSE means the scheduler performs ZERO evaluations for
    -- this strategy — no candle fetch, no indicator run.
    enabled                BOOLEAN     NOT NULL DEFAULT FALSE,

    -- How often the scheduler may re-scan. A floor is enforced by CHECK so an
    -- administrator cannot set an interval that hammers the public endpoints.
    scan_interval_seconds  INTEGER     NOT NULL DEFAULT 60,

    -- Universe to scan. NULL means "use the strategy's own default universe
    -- from code" — the code list stays authoritative, this is only an override.
    symbols                JSONB       NULL,

    -- ── Operational telemetry (never a source of truth for the math) ──────
    last_scan_at           TIMESTAMPTZ NULL,
    last_signal_at         TIMESTAMPTZ NULL,
    last_error             TEXT        NULL,

    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Who flipped the switch. NULL for the seeded rows, because no human has
    -- touched them yet. Every change is additionally written to audit_log.
    updated_by             UUID        NULL
        REFERENCES users (id) ON DELETE SET NULL,

    CONSTRAINT strategy_settings_scan_interval_floor
        CHECK (scan_interval_seconds >= 15),

    -- The set of strategies is fixed by code. Without this a rogue INSERT (or
    -- a bug in the API) could register a fourth strategy and the scheduler
    -- would happily start scanning it. Enforced in the database, not only in
    -- the request handler, because the scheduler trusts this table.
    CONSTRAINT strategy_settings_known_strategy
        CHECK (strategy_id IN (
            'V3_0_HTF_LIQUIDATION_TRAP',
            'V3_3_HTF_ZONE_MITIGATION',
            'V2_8_ZERO_FEE_SNIPER_TRAILING'
        ))
);

COMMENT ON TABLE strategy_settings IS
    'Per-strategy ON/OFF and scheduling for the server signal engine. Contains NO strategy math: thresholds, ATR periods and target formulas live in code only.';

-- Scheduler hot path: "give me everything enabled, ordered deterministically".
CREATE INDEX IF NOT EXISTS idx_strategy_settings_enabled
    ON strategy_settings (enabled, strategy_id);

-- ── Seed the three product strategies, ALL DISABLED ─────────────────────────
-- ON CONFLICT DO NOTHING keeps the migration idempotent and, more importantly,
-- never re-disables a strategy an administrator has already switched on.
INSERT INTO strategy_settings (strategy_id, enabled, scan_interval_seconds, symbols)
VALUES
    ('V3_0_HTF_LIQUIDATION_TRAP',      FALSE, 60, NULL),
    ('V3_3_HTF_ZONE_MITIGATION',       FALSE, 60, NULL),
    ('V2_8_ZERO_FEE_SNIPER_TRAILING',  FALSE, 60, NULL)
ON CONFLICT (strategy_id) DO NOTHING;
