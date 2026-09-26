import { describe, expect, it } from 'vitest';
import { AnomalyCalculationCore } from '../../shared/radar/anomalyCalculationCore.js';
import { RadarMonitor } from '../../server/services/radar/radarMonitor.js';

class FakeTickerStream {
  public symbols: string[] = [];
  public setCalls: string[][] = [];
  private readonly onTick: (tick: any) => void;
  private readonly onStateChange: (state: any) => void;
  private state = 'idle';

  constructor({ onTick, onStateChange }: any) {
    this.onTick = onTick;
    this.onStateChange = onStateChange;
  }

  setSymbols(symbols: string[]) {
    this.symbols = [...symbols];
    this.setCalls.push([...symbols]);
    this.state = symbols.length ? 'connected' : 'idle';
    this.onStateChange(this.getStatus());
  }

  emit(tick: any) {
    this.onTick(tick);
  }

  getStatus() {
    return { state: this.state, subscribedSymbols: this.symbols.length, lastMessageAt: '2026-09-26T10:00:00.000Z', stale: false, reconnectAttempt: 0 };
  }

  stop() {
    this.symbols = [];
    this.state = 'disconnected';
    this.onStateChange(this.getStatus());
  }
}

function tick(symbol: string, index: number, price = 100, timestamp = Date.UTC(2026, 8, 26, 10, 0, index)) {
  return {
    symbol,
    price,
    priceChangePercent24h: 0,
    high24h: price + 1,
    low24h: price - 1,
    volume24h: 1_000 + (index % 2),
    quoteVolume24h: (1_000 + (index % 2)) * price,
    timestamp,
  };
}

function universe(symbols: string[]) {
  return { saved: symbols, effective: symbols, inactive: [], activeKnown: true, activeCount: 999 };
}

function makeMonitor({ current = universe(['BTC']), persisted = new Set<string>(), cooldownMs = 30_000 }: {
  current?: ReturnType<typeof universe>;
  persisted?: Set<string>;
  cooldownMs?: number;
} = {}) {
  let currentUniverse = current;
  let notify: (() => void) | null = null;
  let stream: FakeTickerStream | null = null;
  const writes: any[] = [];
  const monitor = new RadarMonitor({
    core: new AnomalyCalculationCore({ cooldownMs }),
    createStream: (handlers: any) => (stream = new FakeTickerStream(handlers)),
    getUniverse: async () => currentUniverse,
    subscribeUniverseChanges: (listener: () => void) => {
      notify = listener;
      return () => { notify = null; };
    },
    persistEvent: async ({ event, sourceTickTimestamp }: any) => {
      const key = `${event.symbol}:${event.type}:${sourceTickTimestamp}:${event.metricValue}`;
      if (persisted.has(key)) return { inserted: false, event: null };
      persisted.add(key);
      writes.push({ event, sourceTickTimestamp, key });
      return { inserted: true, event, key };
    },
    purgeExpired: async () => 0,
    retentionDays: 30,
    logger: { error: () => undefined },
  });
  return {
    monitor,
    stream: () => stream!,
    writes,
    setUniverse: (value: ReturnType<typeof universe>) => { currentUniverse = value; },
    notify: () => notify?.(),
  };
}

describe('server RadarMonitor lifecycle', () => {
  it('starts exactly once and creates one bounded server ticker topology', async () => {
    const fixture = makeMonitor({ current: universe(['BTC', 'ETH']) });
    await Promise.all([fixture.monitor.start(), fixture.monitor.start()]);

    expect(fixture.stream().setCalls).toEqual([['BTC', 'ETH']]);
    expect(fixture.monitor.getStatus()).toMatchObject({
      running: true,
      activeUniverseCount: 2,
      lifecycle: 'warming',
      marketFeed: { state: 'connected', subscribedSymbols: 2 },
    });
    await fixture.monitor.stop();
  });

  it('owns warm-up and persists an anomaly without a browser runtime', async () => {
    const fixture = makeMonitor();
    await fixture.monitor.start();
    for (let i = 0; i < 20; i += 1) fixture.stream().emit(tick('BTC', i));
    expect(fixture.monitor.getStatus().detector.warm).toBe(true);

    fixture.stream().emit(tick('BTC', 100, 105, Date.UTC(2026, 8, 26, 10, 2, 0)));
    await fixture.monitor.drain();

    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0].event).toMatchObject({ symbol: 'BTC', type: 'PRICE_MOVE', isDemo: false });
    expect(fixture.monitor.getStatus().persistedEvents).toBe(1);
    await fixture.monitor.stop();
  });

  it('converges after an Admin Scan Universe change and clears removed symbol state', async () => {
    const fixture = makeMonitor({ current: universe(['BTC', 'ETH']) });
    await fixture.monitor.start();
    for (let i = 0; i < 20; i += 1) fixture.stream().emit(tick('BTC', i));
    expect(fixture.monitor.getStatus().detector.warmedSymbols).toBe(1);

    fixture.setUniverse(universe(['ETH', 'SOL']));
    fixture.notify();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.stream().symbols).toEqual(['ETH', 'SOL']);
    const state = fixture.monitor.getStatus();
    expect(state.activeUniverseCount).toBe(2);
    expect(state.detector.symbols.find((entry: any) => entry.symbol === 'BTC')).toBeUndefined();
    expect(state.detector.warmedSymbols).toBe(0);
    fixture.stream().emit(tick('BTC', 101, 105));
    await fixture.monitor.drain();
    expect(fixture.writes).toHaveLength(0);
    await fixture.monitor.stop();
  });

  it('uses durable dedupe across a monitor restart without changing detector cooldown semantics', async () => {
    const persisted = new Set<string>();
    const first = makeMonitor({ persisted, cooldownMs: 0 });
    await first.monitor.start();
    for (let i = 0; i < 20; i += 1) first.stream().emit(tick('BTC', i));
    const replayTimestamp = Date.UTC(2026, 8, 26, 10, 2, 0);
    first.stream().emit(tick('BTC', 100, 105, replayTimestamp));
    await first.monitor.drain();
    expect(first.writes).toHaveLength(1);
    await first.monitor.stop();

    const second = makeMonitor({ persisted, cooldownMs: 0 });
    await second.monitor.start();
    for (let i = 0; i < 20; i += 1) second.stream().emit(tick('BTC', i));
    second.stream().emit(tick('BTC', 100, 105, replayTimestamp));
    await second.monitor.drain();
    expect(second.writes).toHaveLength(0);
    expect(second.monitor.getStatus().deduplicatedEvents).toBe(1);
    await second.monitor.stop();
  });
});
