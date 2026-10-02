-- 016: Saved Strategy Lab research drafts (isolated from production strategy tables)
CREATE TABLE IF NOT EXISTS strategy_lab_saved_strategies (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    payload       JSONB NOT NULL,
    api_version   INTEGER NOT NULL CHECK (api_version = 2),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT strategy_lab_saved_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_saved_owner_updated
    ON strategy_lab_saved_strategies (owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_saved_owner_name
    ON strategy_lab_saved_strategies (owner_id, lower(name));

COMMENT ON TABLE strategy_lab_saved_strategies IS
    'User-owned Strategy Lab authoring drafts only; never read by production scheduler or signal engine.';
