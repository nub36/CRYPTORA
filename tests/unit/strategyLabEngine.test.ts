/**
 * CRYPTORA — Strategy Lab · тесты исследовательского движка (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Покрывают ТОЛЬКО новый изолированный Lab-контур (src/services/strategyLab):
 * симулятор исполнения, метрики, no-look-ahead инвариант, индикаторы, реестр,
 * проекцию событий на график. Ничего из production не импортируется.
 */

import { describe, it, expect } from 'vitest';
import { simulateTrade, SAME_BAR_RULE } from '@/services/strategyLab/executionSimulator';
import { computeMetrics } from '@/services/strategyLab/metrics';
import { runLabReplay } from '@/services/strategyLab/engine';
import { emaAligned, atrAligned } from '@/services/strategyLab/indicators';
import {
  defaultResearchConfig,
  getLabStrategy,
  isKnownLabStrategy,
  EMA_ATR_ID,
} from '@/services/strategyLab/registry';
import { mapLabEventMarkers, mapTradeLevels } from '@/services/strategyLab/labChartProjection';
import type { LabCandle, LabTrade, ResearchConfig } from '@/services/strategyLab/types';

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
    // Вход по open бара 1 = 100; стоп-дистанция 10 → стоп 90, цель (2R) 120.
    const candles: LabCandle[] = [
      candle(0, 100, 101, 99, 100), // сигнал-бар (не используется симулятором напрямую)
      candle(1, 100, 105, 99, 104), // вход по open=100
      candle(2, 104, 121, 103, 118), // high 121 ≥ цель 120 → TARGET
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
    // Бар 1: low 85 ≤ стоп 90 И high 130 ≥ цель 120.
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
      slippageBps: 50,
    })!;
    expect(sim.trade.entryPrice).toBeGreaterThan(100);
  });

  it('нет следующего бара для входа → null (отказ NO_ENTRY_BAR у вызывающего)', () => {
    const candles = [candle(0, 100, 101, 99, 100)];
    const sim = simulateTrade(candles, {
      id: 't5',
      side: 'LONG',
      signalTime: candles[0].time,
      signalIndex: 0,
      stopDistance: 10,
      targetR: 2,
      feeBps: 0,
      slippageBps: 0,
    });
    expect(sim).toBeNull();
  });
});

describe('Strategy Lab · computeMetrics', () => {
  function mkTrade(netR: number, grossR = netR, outcome: LabTrade['outcome'] = 'EXIT'): LabTrade {
    return {
      id: `x${netR}`,
      side: 'LONG',
      signalTime: 0,
      entryTime: 0,
      entryPrice: 1,
      stop: 0.9,
      target: 1.2,
      exitTime: 0,
      exitPrice: 1.1,
      outcome,
      exitReason: outcome,
      grossR,
      netR,
      barsHeld: 1,
    };
  }

  it('считает счётчики, win rate, expectancy, profit factor и просадку', () => {
    const trades = [mkTrade(2), mkTrade(-1), mkTrade(1), mkTrade(-1)];
    const m = computeMetrics(trades, 6, 2); // 6 кандидатов, 2 отказа → 4 принято
    expect(m.totalCandidates).toBe(6);
    expect(m.rejected).toBe(2);
    expect(m.accepted).toBe(4);
    expect(m.trades).toBe(4);
    expect(m.profitable).toBe(2);
    expect(m.losing).toBe(2);
    expect(m.breakEven).toBe(0);
    expect(m.winRate).toBeCloseTo(0.5, 6);
    // Средний netR = (2-1+1-1)/4 = 0.25
    expect(m.averageNetR).toBeCloseTo(0.25, 6);
    expect(m.expectancy).toBeCloseTo(0.25, 6);
    // Profit factor = (2+1) / (1+1) = 1.5
    expect(m.profitFactor).toBeCloseTo(1.5, 6);
    expect(m.maxDrawdownR).toBeGreaterThanOrEqual(0);
  });

  it('без сделок метрики нулевые/непосчитанные (null), без выдумок', () => {
    const m = computeMetrics([], 0, 0);
    expect(m.trades).toBe(0);
    expect(m.winRate).toBeNull();
    expect(m.averageNetR).toBeNull();
    expect(m.expectancy).toBeNull();
    expect(m.profitFactor).toBeNull();
    expect(m.maxDrawdownR).toBeNull();
  });
});

describe('Strategy Lab · indicators', () => {
  it('emaAligned: прогрев = null, длина совпадает, константа даёт константу', () => {
    const prices = new Array(30).fill(50);
    const ema = emaAligned(prices, 10);
    expect(ema).toHaveLength(30);
    expect(ema[8]).toBeNull();
    expect(ema[9]).not.toBeNull();
    expect(ema[29]).toBeCloseTo(50, 6);
  });

  it('atrAligned: прогрев = null, затем положительный', () => {
    const candles = flatCandles(new Array(30).fill(0).map((_, i) => 100 + (i % 3)), 2);
    const atr = atrAligned(candles, 14);
    expect(atr).toHaveLength(30);
    expect(atr[12]).toBeNull();
    expect(atr[13]).not.toBeNull();
    const last = atr[29];
    expect(last).not.toBeNull();
    expect(last as number).toBeGreaterThan(0);
  });
});

describe('Strategy Lab · registry', () => {
  it('defaultResearchConfig соответствует дефолтам полей', () => {
    const c = defaultResearchConfig(EMA_ATR_ID);
    expect(c.indicators.emaFast).toBe(20);
    expect(c.indicators.emaSlow).toBe(50);
    expect(c.indicators.atrPeriod).toBe(14);
    expect(c.strategy.stopAtrMult).toBe(1.5);
    expect(c.strategy.targetR).toBe(2.0);
    expect(c.execution.feeBps).toBe(5);
    expect(c.execution.slippageBps).toBe(2);
  });

  it('getLabStrategy/isKnownLabStrategy', () => {
    expect(getLabStrategy(EMA_ATR_ID)?.id).toBe(EMA_ATR_ID);
    expect(getLabStrategy('NOPE')).toBeUndefined();
    expect(isKnownLabStrategy(EMA_ATR_ID)).toBe(true);
    expect(isKnownLabStrategy('NOPE')).toBe(false);
  });
});

describe('Strategy Lab · engine (runLabReplay)', () => {
  // Осциллирующая серия гарантирует пересечения EMA (кандидатов > 0).
  function oscillating(n: number): LabCandle[] {
    const out: LabCandle[] = [];
    for (let i = 0; i < n; i++) {
      const c = 100 + 12 * Math.sin(i / 2.2);
      out.push(candle(i, c, c + 3, c - 3, c));
    }
    return out;
  }

  const input = () => ({
    strategyId: EMA_ATR_ID,
    market: 'spot' as const,
    symbol: 'BTCUSDT',
    timeframe: '1h' as const,
    from: BASE * 1000,
    to: (BASE + 80 * TF_SEC) * 1000,
    candles: oscillating(80),
    researchConfig: { ...cfg(), indicators: { emaFast: 3, emaSlow: 8, atrPeriod: 5 } },
  });

  it('детерминизм: одинаковый вход → идентичный выход', () => {
    const a = runLabReplay(input(), 111);
    const b = runLabReplay(input(), 111);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('генерирует кандидатов и сделки на осциллирующей серии', () => {
    const r = runLabReplay(input(), 1);
    expect(r.metrics.totalCandidates).toBeGreaterThan(0);
    expect(r.trades.length).toBeGreaterThan(0);
  });

  it('НЕТ look-ahead: у каждого события knownAt ≥ candleTime', () => {
    const r = runLabReplay(input(), 1);
    for (const ev of r.events) {
      expect(ev.knownAt).toBeGreaterThanOrEqual(ev.candleTime);
    }
    // CANDIDATE становится известен только после закрытия своего бара.
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

  it('маркеры строятся только для ENTRY/STOP/TP1 и несут payload.tradeId', () => {
    const { markers } = mapLabEventMarkers(events, candles);
    expect(markers.length).toBe(1); // FILL не даёт маркер
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
