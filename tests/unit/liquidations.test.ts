import { describe, it, expect, beforeEach } from 'vitest';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
import { BinanceFuturesLiquidationStream } from '@/services/realtime/BinanceFuturesLiquidationStream';

describe('LiquidationPipeline Unit Tests', () => {
  it('parses raw Binance forceOrder SELL into LONG liquidation event', () => {
    const pipeline = new LiquidationPipeline();

    const rawPayload = {
      e: 'forceOrder',
      E: 1726444800000,
      o: {
        s: 'BTCUSDT',
        S: 'SELL', // Liquidation of LONG position
        o: 'LIMIT',
        p: '64800.00',
        q: '1.25',
        ap: '64800.00',
        T: 1726444800000,
      },
    };

    const event = pipeline.processBinanceForceOrder(rawPayload);

    expect(event).toBeDefined();
    expect(event?.symbol).toBe('BTC');
    expect(event?.side).toBe('LONG');
    expect(event?.price).toBe(64800);
    expect(event?.amountUsd).toBe(64800 * 1.25);
    expect(event?.exchange).toBe('Binance Futures');
    expect(event?.isDemo).toBe(false);
  });

  it('parses raw Binance forceOrder BUY into SHORT liquidation event', () => {
    const pipeline = new LiquidationPipeline();

    const rawPayload = {
      e: 'forceOrder',
      E: 1726444800000,
      o: {
        s: 'ETHUSDT',
        S: 'BUY', // Liquidation of SHORT position
        p: '3520.00',
        q: '10.0',
        T: 1726444800000,
      },
    };

    const event = pipeline.processBinanceForceOrder(rawPayload);

    expect(event).toBeDefined();
    expect(event?.symbol).toBe('ETH');
    expect(event?.side).toBe('SHORT');
    expect(event?.amountUsd).toBe(35200);
  });

  it('safely returns null for invalid forceOrder payload', () => {
    const pipeline = new LiquidationPipeline();
    const result = pipeline.processBinanceForceOrder({ invalid: 'data' });
    expect(result).toBeNull();
  });

  it('calculates theoretical estimated liquidation clusters for 10x, 25x, 50x, 100x leverage', () => {
    const clusters = LiquidationPipeline.calculateEstimatedClusters(60000, 1000000000);

    expect(clusters.length).toBe(8); // 4 long tiers + 4 short tiers

    const longClusters = clusters.filter((c) => c.side === 'LONG');
    const shortClusters = clusters.filter((c) => c.side === 'SHORT');

    expect(longClusters.length).toBe(4);
    expect(shortClusters.length).toBe(4);

    // Long liqs must be strictly below current price
    for (const lc of longClusters) {
      expect(lc.priceLevel).toBeLessThan(60000);
      expect(lc.estimatedVolumeUsd).toBeGreaterThan(0);
    }

    // Short liqs must be strictly above current price
    for (const sc of shortClusters) {
      expect(sc.priceLevel).toBeGreaterThan(60000);
      expect(sc.estimatedVolumeUsd).toBeGreaterThan(0);
    }
  });

  it('builds a complete snapshot (breakdown + timeline) strictly from ingested events', () => {
    const pipeline = new LiquidationPipeline();
    const t = Date.now();

    pipeline.processBinanceForceOrder({
      e: 'forceOrder',
      o: { s: 'BTCUSDT', S: 'SELL', p: '64800.00', q: '1.25', ap: '64800.00', T: t },
    });
    pipeline.processBinanceForceOrder({
      e: 'forceOrder',
      o: { s: 'ETHUSDT', S: 'BUY', p: '3520.00', q: '10.0', ap: '3520.00', T: t - 1000 },
    });

    const snapshot = pipeline.getLiquidationSnapshot(t);

    expect(snapshot.total24h).toBeGreaterThan(0);
    expect(snapshot.totalLong24h).toBeGreaterThan(0);
    expect(snapshot.totalShort24h).toBeGreaterThan(0);
    expect(snapshot.largestEvent).not.toBeNull();
    expect(snapshot.recentEvents.length).toBe(2);
    expect(snapshot.exchangeBreakdown.length).toBeGreaterThan(0);
    expect(snapshot.timeline.length).toBeGreaterThan(0);
    expect(snapshot.isDemo).toBe(false);
  });
});


class MockLiquidationSocket {
  public static instances: MockLiquidationSocket[] = [];
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockLiquidationSocket.instances.push(this);
  }

  public close() {
    if (this.onclose) this.onclose();
  }

  public simulateServerMessage(data: unknown) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }
}

const buildForceOrder = (overrides: Record<string, unknown> = {}) => {
  const t = Date.now();
  return {
    e: 'forceOrder',
    E: t,
    o: {
      s: 'BTCUSDT',
      S: 'SELL',
      p: '64800.00',
      q: '1.25',
      ap: '64800.00',
      T: t,
      ...overrides,
    },
  };
};

describe('LiquidationPipeline honesty invariants (RULES §1, §3; AGENTS §3.1)', () => {
  let pipeline: LiquidationPipeline;

  beforeEach(() => {
    LiquidationPipeline.resetInstance();
    pipeline = new LiquidationPipeline();
  });

  it('never fabricates aggregates: empty pipeline reports zero totals and null largest event', () => {
    const snapshot = pipeline.getLiquidationSnapshot();

    expect(snapshot.totalLong24h).toBe(0);
    expect(snapshot.totalShort24h).toBe(0);
    expect(snapshot.total24h).toBe(0);
    expect(snapshot.largestEvent).toBeNull();
    expect(snapshot.recentEvents).toEqual([]);
    expect(snapshot.assetBreakdown).toEqual([]);
    expect(snapshot.exchangeBreakdown).toEqual([]);
    expect(snapshot.eventsCount24h).toBe(0);
    expect(snapshot.lastEventAt).toBeNull();
  });

  it('reports UNAVAILABLE when the stream transport is not connected and no events exist', () => {
    pipeline.setStreamState('unavailable');
    expect(pipeline.getLiquidationSnapshot().dataStatus).toBe('UNAVAILABLE');
  });

  it('reports AWAITING_STREAM (not fake numbers) when connected but no events arrived yet', () => {
    pipeline.setStreamState('connected');
    const snapshot = pipeline.getLiquidationSnapshot();

    expect(snapshot.dataStatus).toBe('AWAITING_STREAM');
    expect(snapshot.total24h).toBe(0);
    expect(snapshot.largestEvent).toBeNull();
  });

  it('reports LIVE_STREAM once factual events are ingested', () => {
    pipeline.setStreamState('connected');
    pipeline.processBinanceForceOrder(buildForceOrder());

    const snapshot = pipeline.getLiquidationSnapshot();
    expect(snapshot.dataStatus).toBe('LIVE_STREAM');
    expect(snapshot.eventsCount24h).toBe(1);
    expect(snapshot.lastEventAt).not.toBeNull();
  });

  it('generates deterministic event ids without Math.random()', () => {
    const fixedT = 1726444800000;
    const first = new LiquidationPipeline().processBinanceForceOrder(
      buildForceOrder({ T: fixedT })
    );
    const second = new LiquidationPipeline().processBinanceForceOrder(
      buildForceOrder({ T: fixedT })
    );

    expect(first?.id).toBe(second?.id);
    expect(first?.id).toContain('liq-BTC-1726444800000');
  });

  it('computes totals, breakdowns and timeline solely from ingested events', () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    const longLiq = pipeline.processBinanceForceOrder(buildForceOrder({ T: now - 60_000 }));
    const shortLiq = pipeline.processBinanceForceOrder(
      buildForceOrder({ s: 'ETHUSDT', S: 'BUY', p: '3520.00', q: '10.0', T: now - 120_000 })
    );

    const snapshot = pipeline.getLiquidationSnapshot(now);

    expect(snapshot.totalLong24h).toBe(longLiq!.amountUsd);
    expect(snapshot.totalShort24h).toBe(shortLiq!.amountUsd);
    expect(snapshot.total24h).toBe(longLiq!.amountUsd + shortLiq!.amountUsd);
    expect(snapshot.exchangeBreakdown).toHaveLength(1);
    expect(snapshot.exchangeBreakdown[0].exchange).toBe('Binance Futures');
    expect(snapshot.exchangeBreakdown[0].percentage).toBe(100);
    expect(snapshot.assetBreakdown.map((a) => a.symbol).sort()).toEqual(['BTC', 'ETH']);
    expect(snapshot.timeline).toHaveLength(8);
    const timelineSum = snapshot.timeline.reduce((acc, b) => acc + b.longUsd + b.shortUsd, 0);
    expect(timelineSum).toBeCloseTo(snapshot.total24h, 2);
  });

  it('excludes events older than the 24h rolling window from aggregates', () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    pipeline.processBinanceForceOrder(buildForceOrder({ T: now - 25 * 60 * 60 * 1000 }));

    const snapshot = pipeline.getLiquidationSnapshot(now);
    expect(snapshot.total24h).toBe(0);
    expect(snapshot.largestEvent).toBeNull();
    expect(snapshot.recentEvents).toEqual([]);
  });

  it('never marks ingested exchange events as demo data', () => {
    const event = pipeline.processBinanceForceOrder(buildForceOrder());
    expect(event?.isDemo).toBe(false);
    expect(event?.exchange).toBe('Binance Futures');
  });
});

describe('BinanceFuturesLiquidationStream Unit Tests', () => {
  beforeEach(() => {
    MockLiquidationSocket.instances = [];
    LiquidationPipeline.resetInstance();
  });

  it('reports unavailable state (no fake data) when no WebSocket transport exists', () => {
    const pipeline = new LiquidationPipeline();
    const stream = new BinanceFuturesLiquidationStream(pipeline, { webSocketClass: null });

    stream.connect();

    expect(stream.isSupported).toBe(false);
    expect(stream.getState()).toBe('unavailable');
    expect(pipeline.getLiquidationSnapshot().dataStatus).toBe('UNAVAILABLE');
  });

  it('connects to the Binance USD-M forceOrder aggregate stream', () => {
    const pipeline = new LiquidationPipeline();
    const stream = new BinanceFuturesLiquidationStream(pipeline, {
      webSocketClass: MockLiquidationSocket,
    });

    stream.connect();

    expect(MockLiquidationSocket.instances).toHaveLength(1);
    expect(MockLiquidationSocket.instances[0].url).toBe(
      'wss://fstream.binance.com/ws/!forceOrder@arr'
    );
  });

  it('ingests single and batched forceOrder payloads into the pipeline', () => {
    const pipeline = new LiquidationPipeline();
    const stream = new BinanceFuturesLiquidationStream(pipeline, {
      webSocketClass: MockLiquidationSocket,
    });

    stream.connect();
    const socket = MockLiquidationSocket.instances[0];
    socket.simulateServerMessage(buildForceOrder());
    socket.simulateServerMessage([
      buildForceOrder({ s: 'SOLUSDT', p: '150.00', q: '100.0', ap: '150.00' }),
      { e: 'forceOrder', o: null },
    ]);

    const snapshot = pipeline.getLiquidationSnapshot();
    expect(stream.getReceivedMessages()).toBe(2);
    expect(snapshot.eventsCount24h).toBe(2);
    expect(snapshot.total24h).toBeCloseTo(64800 * 1.25 + 15000, 2);
  });

  it('ignores malformed stream frames without corrupting aggregates', () => {
    const pipeline = new LiquidationPipeline();
    const stream = new BinanceFuturesLiquidationStream(pipeline, {
      webSocketClass: MockLiquidationSocket,
    });

    stream.connect();
    const socket = MockLiquidationSocket.instances[0];
    socket.onmessage?.({ data: 'not-json{{{ ' } as any);

    expect(pipeline.getLiquidationSnapshot().total24h).toBe(0);
  });

  it('stops the stream and resets transport state on disconnect', () => {
    const pipeline = new LiquidationPipeline();
    const stream = new BinanceFuturesLiquidationStream(pipeline, {
      webSocketClass: MockLiquidationSocket,
    });

    stream.connect();
    stream.disconnect();

    expect(stream.getState()).toBe('idle');
    expect(pipeline.getStreamState()).toBe('idle');
  });
});
