-- ============================================================================
-- 012: Persistent server-authoritative Radar anomaly events
-- ============================================================================
-- The Radar monitor emits derived events from the frozen shared anomaly core.
-- This table is append-only from the monitor's perspective; event rows make an
-- anomaly detected while no browser is open available to later API consumers.
--
-- `dedupe_key` is a deterministic digest of source ticker identity + emitted
-- event facts. The unique constraint makes reconnect/replay persistence safe
-- and survives process restarts without changing detector calculations.

CREATE TABLE IF NOT EXISTS radar_events (
  id UUID PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  symbol VARCHAR(20) NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN (
    'VOLUME_SPIKE', 'OI_SPIKE', 'FUNDING_EXTREME', 'LIQUIDATION_BURST',
    'PRICE_MOVE', 'VOLATILITY_EXPANSION'
  )),
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'INFO')),
  event_timestamp TIMESTAMPTZ NOT NULL,
  source_tick_timestamp TIMESTAMPTZ NOT NULL,
  metric_value TEXT NOT NULL,
  observation TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_exchange VARCHAR(32) NOT NULL DEFAULT 'binance',
  source_market VARCHAR(32) NOT NULL DEFAULT 'spot',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History/API reads are newest-first; this index keeps the bounded Radar feed
-- independent of table growth. Retention is performed by the monitor and is
-- configured/documented in code rather than hidden in this migration.
CREATE INDEX IF NOT EXISTS idx_radar_events_event_timestamp_desc
  ON radar_events (event_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_radar_events_symbol_event_timestamp_desc
  ON radar_events (symbol, event_timestamp DESC, id DESC);
