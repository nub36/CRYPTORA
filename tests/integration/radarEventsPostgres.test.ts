import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPgHarness, type PgHarness } from '../helpers/embeddedPgHarness';

let harness: PgHarness | null = null;
let skipReason: string | null = null;
let repository: typeof import('../../server/services/radar/radarEventRepository.js') | null = null;

beforeAll(async () => {
  const started = await startPgHarness({ prefix: 'cryptora-radar-pg-' });
  if (!started.ok) {
    skipReason = started.skipReason;
    return;
  }
  harness = started.harness;
  repository = await import('../../server/services/radar/radarEventRepository.js');
});

afterAll(async () => {
  await harness?.close();
});

function guard(ctx: { skip: (reason?: string) => void }) {
  if (skipReason || !harness || !repository) {
    ctx.skip(skipReason ?? 'Radar PostgreSQL harness unavailable');
    return true;
  }
  return false;
}

const emitted = {
  id: 'browser-ephemeral-id-not-persisted',
  timestamp: '2026-09-26T10:05:00.000Z',
  symbol: 'BTC',
  type: 'PRICE_MOVE',
  severity: 'HIGH',
  metricValue: '+5.00%',
  observation: 'Server detector persisted this event while no browser existed.',
  isDemo: false,
  metadata: { priceChangePct: 5, currentPrice: 105, baselinePrice: 100, elapsedMs: 60_000 },
} as const;

describe('Radar persistent server history (real PostgreSQL)', () => {
  it('applies migration 012, persists a stable Radar event, and retrieves it through the real API', async (ctx) => {
    if (guard(ctx)) return;
    const first = await repository!.persistRadarEvent({
      event: emitted,
      sourceTickTimestamp: Date.UTC(2026, 8, 26, 10, 5, 0),
    });
    expect(first.inserted).toBe(true);
    expect(first.event?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.event).toMatchObject({
      symbol: 'BTC', type: 'PRICE_MOVE', severity: 'HIGH', isDemo: false,
      provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT' },
      metadata: emitted.metadata,
    });

    const rows = await harness!.q('SELECT id, dedupe_key, source_exchange, source_market, metadata FROM radar_events');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.event?.id);
    expect(rows[0].dedupe_key).toBe(first.dedupeKey);
    expect(rows[0].metadata).toMatchObject(emitted.metadata);

    const history = await harness!.client.get('/api/radar/events?limit=10');
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ count: 1, source: 'server' });
    expect((history.body as any).events[0]).toMatchObject({ id: first.event?.id, observation: emitted.observation, isDemo: false });
  });

  it('deduplicates an exchange replay in PostgreSQL, including after a hypothetical process restart', async (ctx) => {
    if (guard(ctx)) return;
    const duplicate = await repository!.persistRadarEvent({
      event: emitted,
      sourceTickTimestamp: Date.UTC(2026, 8, 26, 10, 5, 0),
    });
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.dedupeKey).toBeDefined();
    expect(await harness!.q('SELECT id FROM radar_events WHERE symbol = $1', ['BTC'])).toHaveLength(1);
  });

  it('applies bounded configured retention only to expired persisted history', async (ctx) => {
    if (guard(ctx)) return;
    await harness!.q(`UPDATE radar_events SET created_at = NOW() - INTERVAL '31 days' WHERE symbol = 'BTC'`);
    expect(await repository!.purgeExpiredRadarEvents({ retentionDays: 30, batchSize: 100 })).toBe(1);
    expect(await harness!.q('SELECT id FROM radar_events')).toHaveLength(0);
  });

  it('exposes honest stopped status when the Express app is not booted through server/index.js', async (ctx) => {
    if (guard(ctx)) return;
    const status = await harness!.client.get('/api/radar/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ source: 'server', running: false, lifecycle: 'stopped' });
  });
});
