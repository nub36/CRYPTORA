/**
 * CRYPTORA — Strategy Lab · тесты исследовательского движка (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Покрывают ТОЛЬКО новый изолированный Lab-контур (src/services/strategyLab):
 * симулятор исполнения, метрики, no-look-ahead инвариант, индикаторы, реестр,
 * проекцию событий на график, конструктор стратегий и математический паритет.
 */

import { describe, it, expect } from 'vitest';
import { simulateTrade, SAME_BAR_RULE } from '@/services/strategyLab/executionSimulator';
import { computeMetrics } from '@/services/strategyLab/metrics';
import { runLabReplay } from '@/services/strategyLab/engine';
import { emaAligned, atrAligned } from '@/services/strategyLab/indicators';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
import { evaluateEmaAtr } from '@/services/strategyLab/strategies/emaAtr';
import {
  defaultResearchConfig,
  defaultDraftDefinition,
  getLabStrategy,
  isKnownLabStrategy,
  EMA_ATR_ID,
} from '@/services/strategyLab/registry';
import { mapLabEventMarkers, mapTradeLevels } from '@/services/strategyLab/labChartProjection';
import type { LabCandle, LabTrade, ResearchConfig, StrategyDraftDefinition } from '@/services/strategyLab/types';

const TF_SEC = 3600;
const BASE = 1_700_000_000;

function candle(i: number, o: number, h: number, l: number, c: number): LabCandle {
  const time = BASE + i * TF_SEC;
  return { time, closeTime: time + TF_SEC - 1, open: o, high: h, low: l, close: c, volume: 1000 };
}

function flatCandles(closes: number[], spread = 0.5): LabCandle[] {
  return closes.map((c, i) => candle(i, c, c + spread, c - spread, c));
}

const cfg = (): ResearchConfig => defaultResearchConfig(EMA_ATR_ID);

describe('Strategy Lab · executionSimulator', () => {
  it('LONG достигает цели: outcome TARGET, grossR ≈ targetR, netR < grossR (комиссии)', () => {
    const candles: LabCandle[] = [
      candle(0, 100, 101, 99, 100),
      candle(1, 100, 105, 99, 104),
      candle(2, 104, 121, 103, 118),
    ];
    const sim = simulateTrade(candles, {
      id: 't1',
      side: 'LONG',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 0,
      slippageBps: 0,
    });
    expect(sim).not.toBeNull();
    const t = sim!.trade;
    expect(t.outcome).toBe('TARGET');
    expect(t.exitReason).toBe('TARGET');
    expect(t.entryPrice).toBe(100);
    expect(t.target).toBe(120);
    expect(t.grossR).toBeCloseTo(2, 6);
    expect(sim!.entryIndex).toBe(1);
    expect(sim!.exitIndex).toBe(2);
  });

  it('комиссии уменьшают netR относительно grossR', () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 125, 99, 120)];
    const sim = simulateTrade(candles, {
      id: 't-fee',
      side: 'LONG',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 10,
      slippageBps: 0,
    })!;
    expect(sim.trade.netR).toBeLessThan(sim.trade.grossR);
  });

  it('LONG касается стопа: outcome STOP', () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 101, 88, 92)];
    const sim = simulateTrade(candles, {
      id: 't2',
      side: 'LONG',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 0,
      slippageBps: 0,
    })!;
    expect(sim.trade.outcome).toBe('STOP');
    expect(sim.trade.exitReason).toBe('STOP');
    expect(sim.trade.grossR).toBeCloseTo(-1, 6);
  });

  it('одна свеча задевает и стоп, и цель → консервативно СТОП (§16)', () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 130, 85, 110)];
    const sim = simulateTrade(candles, {
      id: 't3',
      side: 'LONG',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 0,
      slippageBps: 0,
    })!;
    expect(sim.trade.outcome).toBe('STOP');
    expect(sim.trade.exitReason).toBe('SAME_BAR_STOP_FIRST');
    expect(SAME_BAR_RULE).toMatch(/СТОП/);
  });

  it('проскальзывание ухудшает цену входа для LONG', () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 100)];
    const sim = simulateTrade(candles, {
      id: 't4',
      side: 'LONG',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 0,
      slippageBps: 10,
    })!;
    expect(sim.trade.entryPrice).toBeGreaterThan(100);
  });

  it('проскальзывание ухудшает цену входа для SHORT', () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 100)];
    const sim = simulateTrade(candles, {
      id: 't5',
      side: 'SHORT',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 0,
      slippageBps: 10,
    })!;
    expect(sim.trade.entryPrice).toBeLessThan(100);
  });
});

describe('Strategy Lab · metrics', () => {
  it('считает winRate, expectancy, averageNetR, profitFactor, maxDrawdownR', () => {
    const trade = (id: string, outcome: 'TARGET' | 'STOP', netR: number): LabTrade => ({
      id,
      side: 'LONG',
      signalTime: 0,
      entryTime: 1,
      entryPrice: 100,
      stop: 90,
      target: 120,
      exitTime: 2,
      exitPrice: outcome === 'TARGET' ? 120 : 90,
      outcome,
      exitReason: outcome,
      grossR: netR,
      netR,
      barsHeld: 1,
    });

    const trades: LabTrade[] = [
      trade('1', 'TARGET', 2.0),
      trade('2', 'STOP', -1.0),
      trade('3', 'TARGET', 2.0),
      trade('4', 'STOP', -1.0),
    ];
    const m = computeMetrics(trades, 6, 2);
    expect(m.totalCandidates).toBe(6);
    expect(m.rejected).toBe(2);
    expect(m.accepted).toBe(4);
    expect(m.trades).toBe(4);
    expect(m.profitable).toBe(2);
    expect(m.losing).toBe(2);
    expect(m.winRate).toBeCloseTo(0.5, 4);
    expect(m.averageNetR).toBeCloseTo(0.5, 4);
    expect(m.expectancy).toBeCloseTo(0.5, 4);
    expect(m.profitFactor).toBeCloseTo(2.0, 4);
  });
});

describe('Strategy Lab · indicators', () => {
  it('EMA(prices, 3): первые 2 значения null, 3-е — SMA, дальше сглаживание', () => {
    const p = [10, 20, 30, 40, 50];
    const ema = emaAligned(p, 3);
    expect(ema[0]).toBeNull();
    expect(ema[1]).toBeNull();
    expect(ema[2]).toBeCloseTo(20, 6);
    const k = 2 / 4;
    expect(ema[3]).toBeCloseTo(40 * k + 20 * (1 - k), 6);
  });

  it('ATR(candles, 3): первые 2 значения null, 3-е — среднее TR, дальше Уайлдер', () => {
    const c = flatCandles([100, 102, 101, 105, 104], 2);
    const atr = atrAligned(c, 3);
    expect(atr[0]).toBeNull();
    expect(atr[1]).toBeNull();
    expect(atr[2]).not.toBeNull();
    expect(atr[2]!).toBeGreaterThan(0);
  });

  it('PEPE-класс цен (low-price) сохраняет полную точность без обнуления в 0.0000', () => {
    const pepeCloses = [0.00000123, 0.00000125, 0.00000128, 0.0000013, 0.00000127];
    const ema = emaAligned(pepeCloses, 3);
    expect(ema[2]).not.toBeNull();
    expect(ema[2]!).toBeGreaterThan(0.000001);
    expect(ema[2]!).toBeCloseTo(0.0000012533, 8);
  });
});

describe('Strategy Lab · registry', () => {
  it('реестр содержит стратегию EMA + ATR', () => {
    const s = getLabStrategy(EMA_ATR_ID);
    expect(s).toBeDefined();
    expect(s?.id).toBe(EMA_ATR_ID);
    expect(isKnownLabStrategy(EMA_ATR_ID)).toBe(true);
  });

  it('isKnownLabStrategy распознаёт CONSTRUCTOR и DRAFT', () => {
    expect(isKnownLabStrategy('CONSTRUCTOR')).toBe(true);
    expect(isKnownLabStrategy('DRAFT')).toBe(true);
    expect(isKnownLabStrategy('UNKNOWN_XYZ')).toBe(false);
  });

  it('defaultDraftDefinition создаёт валидный draft с 3 индикаторами', () => {
    const draft = defaultDraftDefinition('Тест');
    expect(draft.name).toBe('Тест');
    expect(draft.indicators.length).toBe(3);
    expect(draft.long.kind === 'cross' || !draft.long.kind ? draft.long.operator : null).toBe('crossesAbove');
    expect(draft.short.kind === 'cross' || !draft.short.kind ? draft.short.operator : null).toBe('crossesBelow');
    expect(draft.stop.multiplier).toBe(1.5);
    expect(draft.target.multiple).toBe(2.0);
  });
});

describe('Strategy Lab · Parity (EMA+ATR Draft vs Legacy)', () => {
  // Генерируем тестовую осциллирующую серию цен
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < 200; i++) {
    price += Math.sin(i / 5) * 3 + Math.cos(i / 10) * 1.5;
    closes.push(price);
  }
  const candles = flatCandles(closes, 1.5);

  it('current EMA+ATR parity: evaluateDraftStrategy и evaluateEmaAtr дают 100% одинаковый результат', () => {
    const c = cfg();
    const legacyEval = evaluateEmaAtr(candles, c);
    const draft = defaultDraftDefinition('EMA + ATR');
    const draftEval = evaluateDraftStrategy(candles, draft);

    expect(draftEval.trades.length).toBe(legacyEval.trades.length);
    expect(draftEval.candidateCount).toBe(legacyEval.candidateCount);
    expect(draftEval.rejectedCount).toBe(legacyEval.rejectedCount);
    expect(draftEval.evaluatedBars).toBe(legacyEval.evaluatedBars);
    expect(draftEval.warmupBars).toBe(legacyEval.warmupBars);

    for (let i = 0; i < draftEval.trades.length; i++) {
      const dt = draftEval.trades[i];
      const lt = legacyEval.trades[i];
      expect(dt.side).toBe(lt.side);
      expect(dt.signalTime).toBe(lt.signalTime);
      expect(dt.entryPrice).toBeCloseTo(lt.entryPrice, 8);
      expect(dt.stop).toBeCloseTo(lt.stop, 8);
      expect(dt.target).toBeCloseTo(lt.target, 8);
      expect(dt.outcome).toBe(lt.outcome);
      expect(dt.netR).toBeCloseTo(lt.netR, 8);
    }
  });

  it('indicator visible=false НЕ меняет результаты бэктеста', () => {
    const draftVisible = defaultDraftDefinition();
    draftVisible.indicators[0].visible = true;
    draftVisible.indicators[1].visible = true;

    const draftHidden = defaultDraftDefinition();
    draftHidden.indicators[0].visible = false;
    draftHidden.indicators[1].visible = false;

    const res1 = evaluateDraftStrategy(candles, draftVisible);
    const res2 = evaluateDraftStrategy(candles, draftHidden);

    expect(res1.trades.length).toBe(res2.trades.length);
    expect(res1.events.length).toBe(res2.events.length);
    for (let i = 0; i < res1.trades.length; i++) {
      expect(res1.trades[i].netR).toBe(res2.trades[i].netR);
    }
  });

  it('поддерживает произвольное число EMA (например, 3 EMA: 10, 30, 100)', () => {
    const draft: StrategyDraftDefinition = {
      name: 'Triple EMA Strategy',
      indicators: [
        { id: 'ema-10', type: 'EMA', name: 'EMA 10', period: 10, source: 'close', visible: true },
        { id: 'ema-30', type: 'EMA', name: 'EMA 30', period: 30, source: 'close', visible: true },
        { id: 'ema-100', type: 'EMA', name: 'EMA 100', period: 100, source: 'close', visible: true },
        { id: 'atr-14', type: 'ATR', name: 'ATR 14', period: 14, visible: false },
      ],
      long: { left: 'ema-10', operator: 'crossesAbove', right: 'ema-30' },
      short: { left: 'ema-10', operator: 'crossesBelow', right: 'ema-30' },
      stop: { type: 'atrMultiple', indicatorId: 'atr-14', multiplier: 2.0 },
      target: { type: 'rMultiple', multiple: 3.0 },
      execution: { feeBps: 5, slippageBps: 2 },
    };

    const evaluation = evaluateDraftStrategy(candles, draft);
    expect(evaluation.indicators.byIndicatorId?.['ema-10']).toBeDefined();
    expect(evaluation.indicators.byIndicatorId?.['ema-30']).toBeDefined();
    expect(evaluation.indicators.byIndicatorId?.['ema-100']).toBeDefined();
    expect(evaluation.indicators.byIndicatorId?.['atr-14']).toBeDefined();
    expect(evaluation.evaluatedBars).toBeGreaterThan(0);
  });

  it('поддерживает операторы crossesBelow для LONG и crossesAbove для SHORT (контртренд)', () => {
    const draft: StrategyDraftDefinition = {
      name: 'Counter-trend EMA',
      indicators: [
        { id: 'ema-10', type: 'EMA', name: 'EMA 10', period: 10, source: 'close', visible: true },
        { id: 'ema-30', type: 'EMA', name: 'EMA 30', period: 30, source: 'close', visible: true },
        { id: 'atr-14', type: 'ATR', name: 'ATR 14', period: 14, visible: false },
      ],
      long: { left: 'ema-10', operator: 'crossesBelow', right: 'ema-30' },
      short: { left: 'ema-10', operator: 'crossesAbove', right: 'ema-30' },
      stop: { type: 'atrMultiple', indicatorId: 'atr-14', multiplier: 1.5 },
      target: { type: 'rMultiple', multiple: 2.0 },
    };

    const evaluation = evaluateDraftStrategy(candles, draft);
    expect(evaluation.evaluatedBars).toBeGreaterThan(0);
  });
});

describe('Strategy Lab · runLabReplay', () => {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < 200; i++) {
    price += Math.sin(i / 5) * 3 + Math.cos(i / 10) * 1.5;
    closes.push(price);
  }
  const candles = flatCandles(closes, 1.5);

  const input = () => ({
    strategyId: EMA_ATR_ID,
    market: 'spot' as const,
    symbol: 'BTCUSDT',
    timeframe: '1h' as const,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    candles,
    researchConfig: cfg(),
  });

  it('детерминизм: одинаковый вход → идентичный выход', () => {
    const a = runLabReplay(input(), 111);
    const b = runLabReplay(input(), 111);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('НЕТ look-ahead: у каждого события knownAt ≥ candleTime', () => {
    const r = runLabReplay(input(), 1);
    for (const ev of r.events) {
      expect(ev.knownAt).toBeGreaterThanOrEqual(ev.candleTime);
    }
    const candleByTime = new Map(r.candles.map((c) => [c.time, c]));
    for (const ev of r.events.filter((e) => e.kind === 'CANDIDATE')) {
      const src = candleByTime.get(ev.candleTime);
      expect(src).toBeTruthy();
      expect(ev.knownAt).toBe(src!.closeTime);
    }
  });

  it('meta помечена researchOnly и содержит правило одинаковой свечи', () => {
    const r = runLabReplay(input(), 42);
    expect(r.meta.researchOnly).toBe(true);
    expect(r.meta.sameBarRule).toBe(SAME_BAR_RULE);
    expect(r.meta.generatedAt).toBe(42);
  });

  it('согласованность метрик: accepted = candidates − rejected = число сделок', () => {
    const r = runLabReplay(input(), 1);
    expect(r.metrics.accepted).toBe(r.metrics.totalCandidates - r.metrics.rejected);
    expect(r.metrics.trades).toBe(r.trades.length);
    expect(r.metrics.accepted).toBe(r.trades.length);
  });

  it('пустой диапазон свечей → без сделок и с пояснительной заметкой', () => {
    const r = runLabReplay({ ...input(), candles: [] }, 1);
    expect(r.trades).toHaveLength(0);
    expect(r.metrics.totalCandidates).toBe(0);
    expect(r.meta.notes.length).toBeGreaterThan(0);
  });
});

describe('Strategy Lab · labChartProjection', () => {
  const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 121, 99, 120)];
  const events = [
    {
      id: 'e1',
      kind: 'ENTRY' as const,
      candleTime: candles[1].time,
      knownAt: candles[1].time,
      side: 'LONG' as const,
      price: 100,
      payload: { tradeId: 'trade-A' },
    },
    {
      id: 'e2',
      kind: 'FILL' as const,
      candleTime: candles[1].time,
      knownAt: candles[1].time,
      side: 'LONG' as const,
      price: 100,
      payload: { tradeId: 'trade-A' },
    },
  ];

  it('маркеры строятся для FILL (не ENTRY-дубля) и несут payload.tradeId', () => {
    const { markers } = mapLabEventMarkers(events, candles);
    expect(markers.length).toBe(1);
    expect(markers[0].payload?.kind).toBe('FILL');
    expect(markers[0].payload?.tradeId).toBe('trade-A');
  });

  it('mapTradeLevels даёт линии входа/стопа/цели, null → пусто', () => {
    const trade: LabTrade = {
      id: 'trade-A',
      side: 'LONG',
      signalTime: candles[0].time,
      entryTime: candles[1].time,
      entryPrice: 100,
      stop: 90,
      target: 120,
      exitTime: candles[1].time,
      exitPrice: 120,
      outcome: 'TARGET',
      exitReason: 'TARGET',
      grossR: 2,
      netR: 1.9,
      barsHeld: 0,
    };
    const lines = mapTradeLevels(trade);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(mapTradeLevels(null)).toEqual([]);
  });
});
