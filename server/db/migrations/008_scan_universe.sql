-- ============================================================================
-- 008: Scan universe (server-side, shared by all processes and users)
-- ============================================================================
-- Purpose
-- -------
-- Every ACTIVE Binance Spot USDT instrument is available on the website
-- automatically (derived from exchangeInfo at runtime, never stored here).
-- This table only answers ONE question: which of those instruments the signal
-- engine SCANS. The administrator toggles membership in Admin → Монеты.
--
-- Deliberate constraints
-- ----------------------
-- 1. NO STRATEGY MATH. Membership only; strategy rules stay in code.
-- 2. The saved list may contain an instrument that later stops trading on the
--    exchange. The engine intersects this table with the live exchangeInfo
--    universe before every scan, so a delisted symbol is never scanned even if
--    it is still stored here.
-- 3. Seeded with the 25 canonical assets — the same default the browser-local
--    scan universe used before this migration, so behaviour does not change on
--    deploy. Strategies themselves remain as migration 006 left them
--    (seeded DISABLED); this migration does not touch strategy_settings.
--
-- Migrations 001-007 are NOT modified.
-- ============================================================================

CREATE TABLE IF NOT EXISTS scan_universe (
    -- Base ticker as used by /coin/:symbol, e.g. 'BTC', 'PEPE'. Quote is USDT.
    symbol      TEXT        PRIMARY KEY,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL for seeded rows. Every change is additionally written to audit_log.
    added_by    UUID        NULL REFERENCES users (id) ON DELETE SET NULL,

    CONSTRAINT scan_universe_symbol_format
        CHECK (symbol ~ '^[A-Z0-9]{1,20}$')
);

COMMENT ON TABLE scan_universe IS
    'Instruments scanned by the signal engine. Site availability is NOT stored here (it comes from Binance exchangeInfo). Contains NO strategy math.';

INSERT INTO scan_universe (symbol)
VALUES
    ('BTC'), ('ETH'), ('SOL'), ('BNB'), ('XRP'), ('ADA'), ('DOGE'), ('AVAX'),
    ('LINK'), ('DOT'), ('SUI'), ('NEAR'), ('APT'), ('RENDER'), ('TAO'), ('INJ'),
    ('UNI'), ('AAVE'), ('OP'), ('ARB'), ('TIA'), ('FET'), ('KAS'), ('RUNE'), ('SEI')
ON CONFLICT (symbol) DO NOTHING;
