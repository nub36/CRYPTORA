import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnomalyCalculationCore } from '../../shared/radar/anomalyCalculationCore.js';
import { startPgHarness, type PgHarness } from '../helpers/embeddedPgHarness';

let harness: PgHarness | null = null;
let skipReason: string | null = null;
let repository: typeof import('../../server/services/radar/radarEventRepository.js') | null = null;
let radarMonitorModule: typeof import('../../server/services/radar/radarMonitor.js') | null = null;

beforeAll(async () => {
  const started = await startPgHarness({ prefix: 'cryptora-radar-pg-' });
  if (!started.ok) {
    skipReason = started.skipReason;
    return;
  }
  harness = started.harness;
  repository = await import('../../server/services/radar/radarEventRepository.js');
  radarMonitorModule = await import('../../server/services/radar/radarMonitor.js');
});

afterAll(async () => {
  await harness?.close();
});

function guard(ctx: { skip: (reason?: string) => void }) {
  if (skipReason || !harness || !repository || !radarMonitorModule) {
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

class FakeServerTickerStream {
  private state = 'idle';
  private readonly onTick: (tick: any) => void;
  private readonly onStateChange: (state: any) => void;

  constructor({ onTick, onStateChange }: any) {
    this.onTick = onTick;
    this.onStateChange = onStateChange;
  }

  setSymbols(symbols: string[]) {
    this.state = symbols.length ? 'connected' : 'idle';
    this.onStateChange(this.getStatus(symbols.length));
  }

  emit(tick: any) {
    this.onTick(tick);
  }

  getStatus(symbolCount = 1) {
    return {
      state: this.state,
      subscribedSymbols: symbolCount,
      lastMessageAt: '2026-09-26T10:00:00.000Z',
      stale: false,
      reconnectAttempt: 0,
    };
  }

  stop() {
    this.state = 'disconnected';
    this.onStateChange(this.getStatus(0));
  }
}

function monitorTick(symbol: string, index: number, price = 100, timestamp = Date.UTC(2026, 8, 26, 10, 0, index)) {
  return {
    symbol,
    price,
    priceChangePercent24h: 0,
    high24h: price + 1,
    low24h: price - 1,
    volume24h: 1_000,
    quoteVolume24h: 1_000 * price,
    timestamp,
  };
}

function monitorWithRealRepository(symbol = 'ETH') {
  let stream: FakeServerTickerStream | null = null;
  const monitor = new radarMonitorModule!.RadarMonitor({
    core: new AnomalyCalculationCore({ cooldownMs: 0 }),
    createStream: (handlers: any) => (stream = new FakeServerTickerStream(handlers)),
    getUniverse: async () => ({ saved: [symbol], effective: [symbol], inactive: [], activeKnown: true, activeCount: 1 }),
    subscribeUniverseChanges: () => () => undefined,
    retentionDays: 30,
    logger: { error: () => undefined },
  });
  return { monitor, stream: () => stream! };
}

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

  it('creates the created_at/index-id ordering needed by the bounded retention selection', async (ctx) => {
    if (guard(ctx)) return;
    const rows = await harness!.q(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'radar_events'
         AND indexname = 'idx_radar_events_created_at_asc'`,
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].indexdef)).toMatch(/\(created_at, id\)/i);
  });

  it('deduplicates an identical exchange replay in real PostgreSQL', async (ctx) => {
    if (guard(ctx)) return;
    const duplicate = await repository!.persistRadarEvent({
      event: emitted,
      sourceTickTimestamp: Date.UTC(2026, 8, 26, 10, 5, 0),
    });
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.dedupeKey).toBeDefined();
    expect(await harness!.q('SELECT id FROM radar_events WHERE symbol = $1', ['BTC'])).toHaveLength(1);
  });

  it('keeps one authoritative row when a real repository-backed monitor is recreated and receives the same replayed tick', async (ctx) => {
    if (guard(ctx)) return;
    const replayTimestamp = Date.UTC(2026, 8, 26, 10, 2, 0);

    const first = monitorWithRealRepository();
    await first.monitor.start();
    for (let index = 0; index < 20; index += 1) first.stream().emit(monitorTick('ETH', index));
    first.stream().emit(monitorTick('ETH', 100, 105, replayTimestamp));
    await first.monitor.drain();
    await first.monitor.stop();
    expect(await harness!.q(`SELECT id FROM radar_events WHERE symbol = 'ETH' AND event_type = 'PRICE_MOVE'`)).toHaveLength(1);

    const second = monitorWithRealRepository();
    await second.monitor.start();
    for (let index = 0; index < 20; index += 1) second.stream().emit(monitorTick('ETH', index));
    second.stream().emit(monitorTick('ETH', 100, 105, replayTimestamp));
    await second.monitor.drain();

    expect(second.monitor.getStatus().deduplicatedEvents).toBe(1);
    expect(await harness!.q(`SELECT id FROM radar_events WHERE symbol = 'ETH' AND event_type = 'PRICE_MOVE'`)).toHaveLength(1);
    await second.monitor.stop();
  });

  it('applies bounded configured retention only to expired persisted history', async (ctx) => {
    if (guard(ctx)) return;
    await harness!.q(`UPDATE radar_events SET created_at = NOW() - INTERVAL '31 days'`);
    expect(await repository!.purgeExpiredRadarEvents({ retentionDays: 30, batchSize: 100 })).toBe(2);
    expect(await harness!.q('SELECT id FROM radar_events')).toHaveLength(0);
  });

  it('returns only a bounded error category from the public status API, never a raw sensitive monitor exception', async (ctx) => {
    if (guard(ctx)) return;
    const raw = 'postgres://radar_user:super-secret@internal-db.example:5432/cryptora';
    await radarMonitorModule!.resetRadarMonitor();
    const monitor = radarMonitorModule!.getRadarMonitor();
    (monitor as any).logger = { error: () => undefined };
    monitor.recordError(new Error(raw), 'PERSISTENCE_ERROR');

    const status = await harness!.client.get('/api/radar/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ source: 'server', errorCode: 'PERSISTENCE_ERROR' });
    expect(JSON.stringify(status.body)).not.toContain(raw);
    expect(status.body).not.toHaveProperty('lastError');
    expect((status.body as any).marketFeed).not.toHaveProperty('error');
    await radarMonitorModule!.resetRadarMonitor();
  });

  it('exposes honest stopped status when the Express app is not booted through server/index.js', async (ctx) => {
    if (guard(ctx)) return;
    const status = await harness!.client.get('/api/radar/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ source: 'server', running: false, lifecycle: 'stopped' });
  });
});
