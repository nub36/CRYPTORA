/**
 * PostgreSQL repository for server-authoritative Radar history.
 *
 * No anomaly calculation lives here. The monitor supplies already-derived
 * frozen-core events and this module only gives them durable, replay-safe IDs.
 */

import { createHash, randomUUID } from 'node:crypto';
import { query } from '../../db/pool.js';

const MAX_HISTORY_LIMIT = 100;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic storage dedupe key; it deliberately does not alter core cooldown/event rules. */
export function radarEventDedupeKey(event, sourceTickTimestamp, source = { exchange: 'binance', market: 'spot' }) {
  return createHash('sha256')
    .update(stableJson({
      source: { exchange: source.exchange, market: source.market },
      sourceTickTimestamp,
      symbol: event.symbol,
      type: event.type,
      severity: event.severity,
      metricValue: event.metricValue,
      metadata: event.metadata ?? {},
    }))
    .digest('hex');
}

function asIso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Radar event timestamp is invalid');
  return parsed.toISOString();
}

export function mapRadarEventRow(row) {
  const sourceTickTimestamp = new Date(row.source_tick_timestamp).getTime();
  return {
    id: row.id,
    timestamp: new Date(row.event_timestamp).toISOString(),
    symbol: row.symbol,
    type: row.event_type,
    severity: row.severity,
    metricValue: row.metric_value,
    observation: row.observation,
    isDemo: false,
    provenance: {
      exchange: row.source_exchange,
      market: row.source_market,
      symbol: `${row.symbol}USDT`,
      timestamp: sourceTickTimestamp,
    },
    metadata: row.metadata ?? {},
  };
}

/**
 * Inserts a single emitted event exactly once. A conflict means an identical
 * exchange ticker replay was already persisted, not that the detector changed.
 */
export async function persistRadarEvent({ event, sourceTickTimestamp, source = { exchange: 'binance', market: 'spot' } }) {
  const tickMs = Number(sourceTickTimestamp);
  if (!Number.isFinite(tickMs)) throw new Error('Radar source ticker timestamp is invalid');
  const dedupeKey = radarEventDedupeKey(event, tickMs, source);
  const { rows } = await query(
    `INSERT INTO radar_events (
       id, dedupe_key, symbol, event_type, severity, event_timestamp,
       source_tick_timestamp, metric_value, observation, metadata,
       source_exchange, source_market
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      dedupeKey,
      event.symbol,
      event.type,
      event.severity,
      asIso(event.timestamp),
      new Date(tickMs).toISOString(),
      event.metricValue,
      event.observation,
      JSON.stringify(event.metadata ?? {}),
      source.exchange,
      source.market,
    ],
  );

  return rows.length > 0
    ? { inserted: true, event: mapRadarEventRow(rows[0]), dedupeKey }
    : { inserted: false, event: null, dedupeKey };
}

export async function listRadarEvents({ limit = MAX_HISTORY_LIMIT, symbol = null, before = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || MAX_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  const params = [];
  const filters = [];

  if (symbol) {
    params.push(String(symbol).trim().toUpperCase());
    filters.push(`symbol = $${params.length}`);
  }
  if (before) {
    const parsed = new Date(before);
    if (Number.isNaN(parsed.getTime())) throw new Error('Invalid before timestamp');
    params.push(parsed.toISOString());
    filters.push(`event_timestamp < $${params.length}`);
  }
  params.push(safeLimit);

  const { rows } = await query(
    `SELECT * FROM radar_events
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY event_timestamp DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapRadarEventRow);
}

/** Bounded cleanup batch; monitor calls it on a slow timer using documented retention. */
export async function purgeExpiredRadarEvents({ retentionDays, batchSize = 5_000 }) {
  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1) throw new Error('Radar retentionDays must be a positive integer');
  const limit = Math.min(Math.max(Number(batchSize) || 1, 1), 10_000);
  const { rowCount } = await query(
    `WITH expired AS (
       SELECT id FROM radar_events
       WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY created_at ASC
       LIMIT $2
     )
     DELETE FROM radar_events r USING expired
     WHERE r.id = expired.id`,
    [days, limit],
  );
  return rowCount ?? 0;
}

export const RADAR_HISTORY_MAX_LIMIT = MAX_HISTORY_LIMIT;
