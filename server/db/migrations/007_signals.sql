-- ============================================================================
-- 007: Signals (server-generated, PostgreSQL-backed)
-- ============================================================================
-- Purpose
-- -------
-- The server signal engine writes its findings here. `/signals` reads this
-- table instead of the browser's localStorage ledger, so the signal list
-- survives a closed browser, a page refresh and a VPS restart, and has exactly
-- ONE source of truth.
--
-- Deliberate constraints
-- ----------------------
-- 1. DEDUPLICATION AT THE DATABASE LEVEL. `UNIQUE (strategy_id, symbol,
--    timeframe, signal_candle_ts)` makes it impossible for a rescan of the
--    same closed candle to create a second signal, even under concurrency.
--    Writers must use `INSERT ... ON CONFLICT DO NOTHING`.
-- 2. EVERY SIGNAL CARRIES `strategy_id`. There are no sourceless signals: the
--    UI can always say which of the three product strategies produced a setup.
-- 3. Prices are NUMERIC, not REAL. A price is not an approximation, and
--    NUMERIC avoids binary-float artefacts in equality/dedup comparisons.
-- 4. The hash chain is an APPEND-ONLY INTEGRITY LOG, not a blockchain. It only
--    proves that stored rows were not edited after the fact.
--
-- Migrations 001-006 are NOT modified.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signals (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which product strategy produced this setup. Not a FK: the authoritative
    -- list lives in code, and strategy_settings is keyed by the same ids.
    strategy_id       TEXT        NOT NULL,

    -- Normalised pair, always quoted exactly once: 'ETH/USDT', never
    -- 'ETH/USDT/USDT'. See src/utils/labels.ts pairLabel().
    symbol            TEXT        NOT NULL,

    timeframe         TEXT        NOT NULL,

    direction         TEXT        NOT NULL
        CHECK (direction IN ('LONG', 'SHORT')),

    -- Open time of the CLOSED candle that triggered the setup. Together with
    -- (strategy_id, symbol, timeframe) this is the dedup key.
    signal_candle_ts  TIMESTAMPTZ NOT NULL,

    -- ── Levels ─────────────────────────────────────────────────────────────
    -- NULL is allowed: a strategy may legitimately not define a limit corridor
    -- or a second target. NULL means "not defined", never "zero".
    entry_min         NUMERIC     NULL,
    entry_max         NUMERIC     NULL,
    stop_loss         NUMERIC     NULL,
    tp1               NUMERIC     NULL,
    tp2               NUMERIC     NULL,

    -- ── Lifecycle ──────────────────────────────────────────────────────────
    status            TEXT        NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INVALIDATED', 'TARGET_REACHED', 'EXPIRED')),

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    closed_at         TIMESTAMPTZ NULL,
    close_price       NUMERIC     NULL,
    close_reason      TEXT        NULL,

    -- Free-form analytical context (confirming factors, R:R, funnel ids).
    -- Kept out of the hot path and never indexed with GIN.
    metadata          JSONB       NULL,

    -- ── Append-only integrity chain ────────────────────────────────────────
    -- Same format as the existing client ledger so semantics are unchanged:
    --   hash          = 'sha256-' || sha256(JSON(payload) with prevHash)
    --   previous_hash = 'GENESIS' for the first row
    hash              TEXT        NOT NULL,
    previous_hash     TEXT        NOT NULL DEFAULT 'GENESIS',

    -- ── Deduplication ──────────────────────────────────────────────────────
    -- One signal per strategy/symbol/timeframe/closed-candle. Mandatory.
    CONSTRAINT signals_unique_per_candle
        UNIQUE (strategy_id, symbol, timeframe, signal_candle_ts)
);

COMMENT ON TABLE signals IS
    'Signals produced by the server strategy engine. Single source of truth for /signals. Deduplicated per (strategy, symbol, timeframe, closed candle).';

-- `/signals` default view: newest first, optionally filtered by status.
CREATE INDEX IF NOT EXISTS idx_signals_created_at_desc
    ON signals (created_at DESC);

-- Filter by strategy (the /signals strategy filter, and the active-signal
-- count shown on /strategies).
CREATE INDEX IF NOT EXISTS idx_signals_strategy_status
    ON signals (strategy_id, status);

-- Filter by symbol.
CREATE INDEX IF NOT EXISTS idx_signals_symbol
    ON signals (symbol, created_at DESC);

-- Chain verification walks `previous_hash` backwards from the tip.
CREATE INDEX IF NOT EXISTS idx_signals_previous_hash
    ON signals (previous_hash);

-- ── updated_at maintenance ──────────────────────────────────────────────────
-- Keeps `updated_at` honest without the application having to remember to set
-- it on every status transition.
CREATE OR REPLACE FUNCTION signals_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signals_touch_updated_at ON signals;
CREATE TRIGGER trg_signals_touch_updated_at
    BEFORE UPDATE ON signals
    FOR EACH ROW
    EXECUTE FUNCTION signals_touch_updated_at();
