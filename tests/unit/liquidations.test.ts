import { describe, it, expect, beforeEach } from 'vitest';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
import { BinanceFuturesLiquidationStream } from '@/services/realtime/BinanceFuturesLiquidationStream';
import { LiquidationPulse } from '@/services/liquidations/LiquidationPulse';
import { LiquidationHeatmapModelBuilder } from '@/services/liquidations/LiquidationHeatmap';

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

describe('LiquidationPulse — снимок по активу (честность и детерминизм)', () => {
  const futures = (overrides: Record<string, unknown> = {}) => ({
    symbol: 'ETH/USDT',
    markPrice: 3451.2,
    indexPrice: 3450.6,
    fundingRate: 0.0084,
    predictedFundingRate: 0.0091,
    annualizedFundingRate: 9.19,
    openInterest: 8940000000,
    openInterestChange1h: 0.62,
    openInterestChange24h: 4.15,
    futuresVolume24h: 22150000000,
    longLiquidations24h: 8450000,
    shortLiquidations24h: 19800000,
    basisPct: 0.035,
    isDemo: true,
    ...overrides,
  });

  const event = (symbol: string, side: 'LONG' | 'SHORT', amountUsd: number, id: string) => ({
    id,
    timestamp: new Date().toISOString(),
    symbol,
    side,
    amountUsd,
    price: 3450,
    exchange: 'Binance Futures',
    isDemo: false,
  });

  const factualSnapshot = (events: any[]) => ({
    totalLong24h: events.filter((e) => e.side === 'LONG').reduce((a, e) => a + e.amountUsd, 0),
    totalShort24h: events.filter((e) => e.side === 'SHORT').reduce((a, e) => a + e.amountUsd, 0),
    total24h: events.reduce((a, e) => a + e.amountUsd, 0),
    largestEvent: events[0] ?? null,
    eventsCount24h: events.length,
    lastEventAt: events.length ? events[0].timestamp : null,
    dataStatus: events.length ? ('LIVE_STREAM' as const) : ('AWAITING_STREAM' as const),
    recentEvents: events,
    assetBreakdown: [],
    exchangeBreakdown: [],
    timeline: [],
    isDemo: false,
  });

  it('использует фактические события актива, когда они есть (FACTUAL)', () => {
    const snapshot = factualSnapshot([
      event('ETH/USDT', 'LONG', 1_000_000, 'e1'),
      event('ETH/USDT', 'SHORT', 3_000_000, 'e2'),
      event('BTC/USDT', 'SHORT', 9_000_000, 'e3'),
    ]);
    const pulse = LiquidationPulse.buildAssetPulse({
      symbol: 'ETH',
      liquidations: snapshot as any,
      futures: futures({ isDemo: false }) as any,
      priceChange24h: 2.45,
    });

    // Фактические события по активу имеют приоритет над любой модельной оценкой.
    expect(pulse.liquidation.source).toBe('FACTUAL');
    expect(pulse.liquidation.longUsd).toBe(1_000_000);
    expect(pulse.liquidation.shortUsd).toBe(3_000_000);
    expect(pulse.liquidation.longSharePct).toBeCloseTo(25, 0);
    expect(pulse.liquidation.topEvents).toHaveLength(2);
    expect(pulse.liquidation.topEvents[0].id).toBe('e2');
  });

  it('показывает модельную оценку только как ESTIMATED и предупреждает об этом', () => {
    const snapshot = factualSnapshot([]);
    const pulse = LiquidationPulse.buildAssetPulse({
      symbol: 'ETH',
      liquidations: snapshot as any,
      futures: futures({ isDemo: false }) as any,
      priceChange24h: 2.45,
    });

    expect(pulse.liquidation.source).toBe('ESTIMATED');
    expect(pulse.liquidation.note).toBeTruthy();
    expect(pulse.liquidation.note).toContain('модель');
  });

  it('в демо-режиме отдаёт демонстрационный набор с явной маркировкой DEMO', () => {
    const demo = {
      ...factualSnapshot([]),
      dataStatus: 'DEMO' as const,
      isDemo: true,
      assetBreakdown: [{ symbol: 'ETH', totalUsd: 28_250_000, longUsd: 8_450_000, shortUsd: 19_800_000 }],
      recentEvents: [event('ETH/USDT', 'SHORT', 920_000, 'liq-003')],
    };
    const pulse = LiquidationPulse.buildAssetPulse({
      symbol: 'ETH',
      liquidations: demo as any,
      futures: futures() as any,
      priceChange24h: 2.45,
    });

    expect(pulse.liquidation.source).toBe('DEMO');
    expect(pulse.liquidation.longUsd).toBe(8_450_000);
    expect(pulse.liquidation.shortUsd).toBe(19_800_000);
    expect(pulse.liquidation.longSharePct).toBeCloseTo(29.9, 1);
    expect(pulse.liquidation.topEvents[0].id).toBe('liq-003');
  });

  it('не фабрикует данные: без потока и без модели статус UNAVAILABLE, баланс пуст', () => {
    const pulse = LiquidationPulse.buildAssetPulse({
      symbol: 'ETH',
      liquidations: null,
      futures: null,
      priceChange24h: 0,
    });

    expect(pulse.liquidation.source).toBe('UNAVAILABLE');
    expect(pulse.liquidation.totalUsd).toBe(0);
    expect(pulse.imbalance).toBeNull();
    expect(pulse.derivatives).toBeNull();
  });

  it('индикатор перекоса детерминирован и учитывает демо-входы явно', () => {
    const demo = {
      ...factualSnapshot([]),
      dataStatus: 'DEMO' as const,
      assetBreakdown: [{ symbol: 'ETH', totalUsd: 28_250_000, longUsd: 8_450_000, shortUsd: 19_800_000 }],
    };
    const input = {
      symbol: 'ETH',
      liquidations: demo as any,
      futures: futures() as any,
      priceChange24h: 2.45,
    };

    const first = LiquidationPulse.buildAssetPulse(input);
    const second = LiquidationPulse.buildAssetPulse(input);

    expect(first.imbalance).toEqual(second.imbalance);
    expect(first.imbalance!.basedOnDemo).toBe(true);
    expect(first.imbalance!.score).toBeGreaterThanOrEqual(-100);
    expect(first.imbalance!.score).toBeLessThanOrEqual(100);
    expect(
      first.imbalance!.components.liquidation +
        first.imbalance!.components.funding +
        first.imbalance!.components.openInterest +
        first.imbalance!.components.price
    ).toBeCloseTo(first.imbalance!.score, 0);
  });

  it('матчит канонический символ, пару и суффикс USDT одинаково', () => {
    const demo = {
      ...factualSnapshot([]),
      dataStatus: 'DEMO' as const,
      assetBreakdown: [{ symbol: 'ETH', totalUsd: 1_000, longUsd: 400, shortUsd: 600 }],
    };
    for (const symbol of ['ETH', 'ETHUSDT', 'eth/usdt']) {
      const pulse = LiquidationPulse.buildAssetPulse({
        symbol,
        liquidations: demo as any,
        futures: futures() as any,
        priceChange24h: 1,
      });
      expect(pulse.liquidation.totalUsd).toBe(1_000);
      expect(pulse.symbol).toBe('ETH');
    }
  });
});

describe('LiquidationHeatmapModelBuilder — расчетная карта плотности (цена × время)', () => {
  const candles = (count: number, base = 3400) =>
    Array.from({ length: count }, (_, i) => ({
      time: 1757980800 + i * 14400,
      open: base + Math.sin(i / 5) * 40,
      high: base + Math.sin(i / 5) * 40 + 30,
      low: base + Math.sin(i / 5) * 40 - 30,
      close: base + Math.sin(i / 5) * 40,
      volume: 1000 + i * 3,
    }));

  const build = (overrides: Record<string, unknown> = {}) =>
    LiquidationHeatmapModelBuilder.build({
      candles: candles(64) as any,
      referencePrice: 3450,
      openInterestUsd: 8_940_000_000,
      ...overrides,
    });

  it('строит карту с осями цены и времени из детерминированных входов', () => {
    const model = build()!;

    expect(model).not.toBeNull();
    expect(model.rows.length).toBe(28);
    expect(model.columns).toBeGreaterThan(0);
    expect(model.rows[0].values).toHaveLength(model.columns);
    expect(model.priceTicks.length).toBeGreaterThan(2);
    expect(model.timeTicks.length).toBeGreaterThan(2);
    expect(model.leverageTiers).toEqual([10, 25, 50, 100]);
  });

  it('не использует Math.random: две сборки на одинаковых входах совпадают', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('нормирует интенсивность в диапазон 0…1 и находит пик плотности', () => {
    const model = build()!;
    const all = model.rows.flatMap((row) => row.values);

    expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...all)).toBeLessThanOrEqual(1);
    expect(Math.max(...all)).toBeGreaterThan(0);
    expect(model.peakPrice).toBeGreaterThan(0);
    expect(model.peakIntensity).toBeGreaterThanOrEqual(0);
    expect(model.peakIntensity).toBeLessThanOrEqual(1);
  });

  it('маркирует провенанс входных свечей: DEMO против FACTUAL', () => {
    expect(build()!.inputSource).toBe('DEMO');
    const liveLike = build({
      candles: candles(64).map((c) => ({
        ...c,
        provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', timestamp: 0 },
      })),
    })!;
    expect(liveLike.inputSource).toBe('FACTUAL');
    expect(liveLike.methodNote).toContain('Модель');
  });

  it('честно отказывается строить карту без достаточных входных данных', () => {
    expect(build({ candles: [] })).toBeNull();
    expect(build({ candles: candles(3) as any })).toBeNull();
    expect(build({ referencePrice: 0 })).toBeNull();
  });

  it('диапазон карты перекрывает уровни самого высокого плеча', () => {
    const model = build({
      candles: candles(40, 1000).map((c) => ({ ...c, close: 1000, high: 1010, low: 990 })) as any,
      referencePrice: 1000,
    })!;
    const prices = model.rows.map((r) => r.price);
    expect(Math.min(...prices)).toBeLessThan(990);
    expect(Math.max(...prices)).toBeGreaterThan(1010);
  });
});

describe('LiquidationHeatmapModelBuilder — границы диапазона и краевые пики', () => {
  const flatCandles = (count: number, close: number) =>
    Array.from({ length: count }, (_, i) => ({
      time: 1757980800 + i * 14400,
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 1000,
    }));

  it('диапазон карты покрывает уровни всех плечевых тиров (нет слипания на краях)', () => {
    const close = 1000;
    const model = LiquidationHeatmapModelBuilder.build({
      candles: flatCandles(64, close) as any,
      referencePrice: close,
      openInterestUsd: 1_000_000_000,
    })!;

    const prices = model.rows.map((r) => r.price);
    // 10x-уровни (−10% / +10%) обязаны попадать внутрь диапазона, а не в крайние строки.
    expect(Math.min(...prices)).toBeLessThan(close * 0.9);
    expect(Math.max(...prices)).toBeGreaterThan(close * 1.1);

    // Крайние строки не должны быть ярче «содержательных» уровней:
    // при равномерных свечах максимум плотности лежит на полосах тиров, а не на границе.
    const rowTotals = model.rows.map((r) => r.values.reduce((a, b) => a + b, 0));
    const edge = Math.max(rowTotals[0], rowTotals[rowTotals.length - 1]);
    expect(edge).toBeLessThan(Math.max(...rowTotals));
  });

  it('полосы 10x, 25x, 50x, 100x различимы: каждая пара уровней даёт вклад в своей строке', () => {
    const close = 1000;
    const model = LiquidationHeatmapModelBuilder.build({
      candles: flatCandles(64, close) as any,
      referencePrice: close,
      openInterestUsd: 1_000_000_000,
    })!;

    const rowIndexFor = (price: number) => {
      const top = model.rows[0].price;
      const bottom = model.rows[model.rows.length - 1].price;
      return Math.min(
        model.rows.length - 1,
        Math.max(0, Math.floor(((top - price) / (top - bottom)) * model.rows.length))
      );
    };

    for (const leverage of [10, 25, 50, 100]) {
      const longRow = rowIndexFor(close * (1 - 1 / leverage));
      const shortRow = rowIndexFor(close * (1 + 1 / leverage));
      const longTotal = model.rows[longRow].values.reduce((a, b) => a + b, 0);
      const shortTotal = model.rows[shortRow].values.reduce((a, b) => a + b, 0);
      expect(longTotal).toBeGreaterThan(0);
      expect(shortTotal).toBeGreaterThan(0);
    }
  });
});

describe('LiquidationHeatmapModelBuilder — подписи временной оси', () => {
  const candles = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      time: 1757980800 + i * 14400,
      open: 3400,
      high: 3410,
      low: 3390,
      close: 3400 + (i % 5),
      volume: 1000 + i,
    }));

  it('первая подпись на левом краю, последняя — на правом, подписи не наезжают', () => {
    const model = LiquidationHeatmapModelBuilder.build({
      candles: candles(58) as any,
      referencePrice: 3400,
      openInterestUsd: 1_000_000_000,
    })!;

    expect(model.timeTicks.length).toBeLessThanOrEqual(7);
    expect(model.timeTicks[0].offsetPct).toBe(0);
    expect(model.timeTicks[model.timeTicks.length - 1].offsetPct).toBe(100);

    const offsets = model.timeTicks.map((t) => t.offsetPct);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i] - offsets[i - 1]).toBeGreaterThanOrEqual(8);
    }
  });
});
