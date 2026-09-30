-- ============================================================================
-- 014: Register strategy V3.4 (HTF Zone Mitigation + Target Quality)
-- ============================================================================
-- Why this migration exists AT ALL
-- --------------------------------
-- The preference for this change was "no migration". It is not achievable:
-- migration 006 pinned the strategy universe INSIDE the database via
--
--     CONSTRAINT strategy_settings_known_strategy
--         CHECK (strategy_id IN ('V3_0_...', 'V3_3_...', 'V2_8_...'))
--
-- That CHECK is exactly the safety property we do not want to give up (it stops
-- a rogue INSERT from registering an arbitrary strategy the scheduler would
-- then scan). Therefore a fourth strategy cannot be stored without editing the
-- constraint, and PostgreSQL has no way to edit a CHECK in place: it must be
-- dropped and recreated. That is all this migration does.
--
-- Note that `signals.strategy_id` is free-form TEXT and needed no change.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
-- ---------------------------------
--   • It does not enable anything. The V3.4 row is inserted with
--     enabled = FALSE, exactly like 006 seeded the first three.
--   • It does not touch the enabled state of V3.0 / V3.3 / V2.8 — the UPDATE
--     path is absent on purpose and ON CONFLICT DO NOTHING protects rows an
--     administrator has already switched on.
--   • It does not read, rewrite, recompute or delete a single row of
--     `signals`. Historical V3.0 / V3.3 signals are untouched evidence.
--   • It has NOT been applied to production. Shipping the file is the whole
--     deliverable; running it is a separate, deliberate operator action.
--
-- Idempotent: safe to run repeatedly (DROP ... IF EXISTS + ON CONFLICT).
-- Migrations 001-013 are NOT modified.
-- ============================================================================

-- ── 1. Widen the allow-list by exactly one id ───────────────────────────────
ALTER TABLE strategy_settings
    DROP CONSTRAINT IF EXISTS strategy_settings_known_strategy;

ALTER TABLE strategy_settings
    ADD CONSTRAINT strategy_settings_known_strategy
        CHECK (strategy_id IN (
            'V3_0_HTF_LIQUIDATION_TRAP',
            'V3_3_HTF_ZONE_MITIGATION',
            'V2_8_ZERO_FEE_SNIPER_TRAILING',
            -- V3.4 = V3.3 setup detection, entry, stop, TP1 and TP2 unchanged,
            -- plus a target-quality gate (TP1 >= 0.50 R, TP2 >= 1.00 R measured
            -- from the worst corridor edge). The gate lives in code
            -- (src/services/signals/live/targetQuality.ts); no threshold is
            -- stored in this table, in keeping with rule 1 of migration 006.
            'V3_4_HTF_ZONE_MITIGATION_QUALITY'
        ));

-- ── 2. Seed the row DISABLED ────────────────────────────────────────────────
-- A missing row already means "disabled" in the server layer
-- (`getEnabledStrategies()` selects WHERE enabled = TRUE), so this INSERT only
-- makes the switch visible in the admin panel. It can never enable anything.
INSERT INTO strategy_settings (strategy_id, enabled, scan_interval_seconds, symbols)
VALUES ('V3_4_HTF_ZONE_MITIGATION_QUALITY', FALSE, 60, NULL)
ON CONFLICT (strategy_id) DO NOTHING;
