import { describe, expect, it, vi } from 'vitest';
import type {
  LabCandle,
  LabOrderBlock,
  OrderBlockIndicatorDefinition,
} from '@/services/strategyLab/types';
import { compileResearchDraft } from '@/services/strategyLab/draft/compile';
import { evaluateOrderBlocks } from '@/services/strategyLab/orderBlocks';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
import { mapOrderBlockZones } from '@/services/strategyLab/labChartProjection';
import { PriceZonesPrimitive } from '@/components/common/chart/PriceZonesPrimitive';

const T = 1_700_000_000;

function candle(index: number, open: number, high: number, low: number, close: number): LabCandle {
  const time = T + index * 60;
  return { time, closeTime: time + 59, open, high, low, close, volume: 1 };
}

const ob = (overrides: Partial<OrderBlockIndicatorDefinition> = {}): OrderBlockIndicatorDefinition => ({
  id: 'order-block-main',
  type: 'ORDER_BLOCK',
  name: 'Order Block',
  lookback: 5,
  displacementMultiplier: 1,
  atrIndicatorId: 'atr-ob',
  visible: true,
  ...overrides,
});

function evaluate(candles: LabCandle[], definition = ob(), atr: Array<number | null> = candles.map(() => 1)) {
  return evaluateOrderBlocks(candles, [definition], { [definition.atrIndicatorId]: atr });
}

function obDraft(visible = true) {
  return {
    name: 'Order Block replay',
    apiVersion: 2 as const,
    indicators: [
      { id: 'atr-stop', type: 'ATR' as const, name: 'ATR stop', period: 1, visible: false },
      { id: 'atr-ob', type: 'ATR' as const, name: 'ATR impulse', period: 1, visible: false },
      { id: 'order-block-main', type: 'ORDER_BLOCK' as const, name: 'Order Block', lookback: 5, displacementMultiplier: 1, atrIndicatorId: 'atr-ob', visible },
    ],
    sourceCode: 'strategy("Order Block replay", () => { LONG(bullishOrderBlock(ORDER_BLOCK_MAIN)); SHORT(bearishOrderBlock(ORDER_BLOCK_MAIN)); STOP(multiply(ATR_STOP, 0.1)); TAKE_PROFIT(R(1)); });',
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

function executionCandles(): LabCandle[] {
  return [
    candle(0, 100, 100, 90, 95), // bearish source
    candle(1, 95, 102, 95, 102), // bullish confirmation: body = ATR[1] = 7
    candle(2, 103, 104, 102, 103), // earliest available fill
    candle(3, 103, 104, 100, 101),
  ];
}

describe('Strategy Lab Order Block V1', () => {
  it('detects bullish and bearish zones using strict breakout and the most recent qualifying source', () => {
    const bullishCandles = [
      candle(0, 10, 11, 5, 6),
      candle(1, 13, 14, 7, 8),
      candle(2, 8, 16, 8, 15),
    ];
    const bullish = evaluate(bullishCandles);
    expect(bullish.orderBlocks).toEqual([expect.objectContaining({
      id: 'ob:order-block-main:BULLISH:1:2', direction: 'BULLISH', sourceIndex: 1,
      sourceCandleTime: bullishCandles[1].time, confirmationIndex: 2,
      confirmationCandleTime: bullishCandles[2].time, knownAt: bullishCandles[2].closeTime,
      low: 7, high: 14, state: 'ACTIVE',
    })]);

    const bearishCandles = [
      candle(0, 6, 11, 5, 10),
      candle(1, 9, 14, 8, 13),
      candle(2, 13, 13, 6, 6),
    ];
    const bearish = evaluate(bearishCandles);
    expect(bearish.orderBlocks).toEqual([expect.objectContaining({
      id: 'ob:order-block-main:BEARISH:1:2', direction: 'BEARISH', sourceIndex: 1,
      low: 8, high: 14,
    })]);
  });

  it('honours lookback limits and rejects dojis, equality breakouts, null ATR, and zero ATR', () => {
    const outsideWindow = [
      candle(0, 10, 11, 5, 6),
      candle(1, 7, 8, 7, 7),
      candle(2, 8, 9, 8, 8),
      candle(3, 8, 13, 8, 12),
    ];
    expect(evaluate(outsideWindow, ob({ lookback: 2 })).orderBlocks).toHaveLength(0);

    const dojiSource = [candle(0, 10, 11, 5, 10), candle(1, 10, 13, 10, 13)];
    expect(evaluate(dojiSource).orderBlocks).toHaveLength(0);
    const dojiConfirmation = [candle(0, 10, 11, 5, 6), candle(1, 11, 12, 11, 11)];
    expect(evaluate(dojiConfirmation).orderBlocks).toHaveLength(0);
    const equalityBreakout = [candle(0, 10, 12, 5, 6), candle(1, 6, 12, 6, 12)];
    expect(evaluate(equalityBreakout).orderBlocks).toHaveLength(0);

    const valid = [candle(0, 10, 11, 5, 6), candle(1, 6, 12, 6, 12)];
    expect(evaluate(valid, ob(), [1, 6]).orderBlocks).toHaveLength(1); // body === ATR threshold passes
    expect(evaluate(valid, ob(), [1, null]).orderBlocks).toHaveLength(0);
    expect(evaluate(valid, ob(), [1, 0]).orderBlocks).toHaveLength(0);
  });

  it('uses the explicitly referenced ATR instead of an implicit first ATR', () => {
    const candles = [candle(0, 10, 11, 5, 6), candle(1, 6, 12, 6, 12)];
    const withSmallAtr = evaluateOrderBlocks(candles, [ob({ atrIndicatorId: 'atr-small' })], {
      'atr-small': [1, 6],
      'atr-large': [1, 99],
    });
    const withLargeAtr = evaluateOrderBlocks(candles, [ob({ atrIndicatorId: 'atr-large' })], {
      'atr-small': [1, 6],
      'atr-large': [1, 99],
    });
    expect(withSmallAtr.orderBlocks).toHaveLength(1);
    expect(withLargeAtr.orderBlocks).toHaveLength(0);
  });

  it('moves ACTIVE → MITIGATED → INVALIDATED, preserves both lifecycle facts, and never mitigates at confirmation', () => {
    const candles = [
      candle(0, 10, 10, 5, 6),
      candle(1, 6, 12, 6, 12), // confirmation; does not mitigate itself
      candle(2, 12, 12, 8, 11), // first later overlap
      candle(3, 9, 9, 4, 4), // overlap plus bullish invalidation
    ];
    const result = evaluate(candles, ob(), [1, 6, 1, 1]);
    const block = result.orderBlocks[0];
    expect(block).toMatchObject({
      state: 'INVALIDATED',
      mitigationIndex: 2,
      mitigatedAt: candles[2].closeTime,
      invalidationIndex: 3,
      invalidationCandleTime: candles[3].time,
      invalidatedAt: candles[3].closeTime,
    });
    expect(block.mitigationIndex).not.toBe(block.confirmationIndex);

    const sameLaterCandle = evaluate([
      candle(0, 10, 10, 5, 6),
      candle(1, 6, 12, 6, 12),
      candle(2, 9, 9, 4, 4),
    ], ob(), [1, 6, 1]).orderBlocks[0];
    expect(sameLaterCandle).toMatchObject({ state: 'INVALIDATED', mitigationIndex: 2, invalidationIndex: 2 });
    expect(sameLaterCandle.mitigatedAt).toBe(sameLaterCandle.invalidatedAt);

    const boundaryClose = evaluate([
      candle(0, 10, 10, 5, 6), candle(1, 6, 12, 6, 12), candle(2, 8, 8, 5, 5),
    ], ob(), [1, 6, 1]).orderBlocks[0];
    expect(boundaryClose.state).toBe('MITIGATED');
    expect(boundaryClose.invalidatedAt).toBeUndefined();
  });

  it('compiles typed Order Block predicates and retains the referenced ATR dependency', () => {
    const compiled = compileResearchDraft(obDraft());
    expect(compiled.ok).toBe(true);
    expect(compiled.definition?.long).toEqual({ kind: 'orderBlock', indicatorId: 'order-block-main', operator: 'bullishOrderBlock' });
    expect(compiled.definition?.indicators.map((indicator) => indicator.id)).toEqual([
      'order-block-main', 'atr-ob', 'atr-stop',
    ]);

    const wrongType = obDraft();
    wrongType.sourceCode = wrongType.sourceCode.replace('bullishOrderBlock(ORDER_BLOCK_MAIN)', 'bullishOrderBlock(ATR_OB)');
    expect(compileResearchDraft(wrongType).ok).toBe(false);
    const badReference = obDraft();
    (badReference.indicators[2] as { atrIndicatorId: string }).atrIndicatorId = 'missing-atr';
    expect(compileResearchDraft(badReference).ok).toBe(false);
  });

  it('makes the condition true only on confirmation and fills at the next bar open', () => {
    const definition = compileResearchDraft(obDraft()).definition!;
    const candles = executionCandles();
    const result = evaluateDraftStrategy(candles, definition);
    expect(result.orderBlocks).toEqual([expect.objectContaining({ sourceIndex: 0, confirmationIndex: 1, knownAt: candles[1].closeTime })]);
    expect(result.events.find((event) => event.kind === 'CANDIDATE')).toMatchObject({ candleTime: candles[1].time, knownAt: candles[1].closeTime });
    expect(result.events.find((event) => event.kind === 'FILL')).toMatchObject({ candleTime: candles[2].time, price: candles[2].open });
    expect(result.trades[0]).toMatchObject({ signalTime: candles[1].time, entryTime: candles[2].time, entryPrice: candles[2].open });
  });

  it('keeps detection, lifecycle, and trades invariant when only chart visibility changes', () => {
    const shownDefinition = compileResearchDraft(obDraft(true)).definition!;
    const hiddenDefinition = compileResearchDraft(obDraft(false)).definition!;
    const shown = evaluateDraftStrategy(executionCandles(), shownDefinition);
    const hidden = evaluateDraftStrategy(executionCandles(), hiddenDefinition);
    expect(hidden.orderBlocks).toEqual(shown.orderBlocks);
    expect(hidden.events).toEqual(shown.events);
    expect(hidden.trades).toEqual(shown.trades);
  });

  it('projects finite zones at source time and ends active versus invalidated zones correctly', () => {
    const candles = executionCandles();
    const active: LabOrderBlock = {
      id: 'active', indicatorId: 'order-block-main', direction: 'BULLISH', sourceIndex: 0,
      sourceCandleTime: candles[0].time, confirmationIndex: 1, confirmationCandleTime: candles[1].time,
      knownAt: candles[1].closeTime, low: 90, high: 100, state: 'MITIGATED', mitigationIndex: 2, mitigatedAt: candles[2].closeTime,
    };
    const invalidated: LabOrderBlock = {
      ...active, id: 'invalidated', direction: 'BEARISH', state: 'INVALIDATED', invalidationIndex: 2,
      invalidationCandleTime: candles[2].time, invalidatedAt: candles[2].closeTime,
    };
    const zones = mapOrderBlockZones({
      candles,
      orderBlocks: [active, invalidated],
      indicators: { indicatorsList: [ob()] },
    });
    expect(zones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'active', fromTime: candles[0].time, toTime: candles[3].time, state: 'MITIGATED', fillColor: expect.stringContaining('0.085') }),
      expect.objectContaining({ id: 'invalidated', fromTime: candles[0].time, toTime: candles[2].time, state: 'INVALIDATED', fillColor: expect.stringContaining('0.055') }),
    ]));
    expect(mapOrderBlockZones({ candles, orderBlocks: [active], indicators: { indicatorsList: [{ ...ob(), visible: false }] } })).toEqual([]);
  });

  it('uses the official primitive lifecycle for generic price zones', () => {
    const requestUpdate = vi.fn();
    const primitive = new PriceZonesPrimitive([{ id: 'zone', fromTime: 1, toTime: 2, low: 1, high: 2, fillColor: 'rgba(0,0,0,.1)', borderColor: '#000' }]);
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time * 10 }) },
      series: { priceToCoordinate: (price: number) => price * 10 },
      requestUpdate,
    } as any);
    expect(primitive.paneViews()[0].zOrder?.()).toBe('bottom');
    primitive.setZones([]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    primitive.detached();
  });

  it('remains deterministic and practical on 105,120 candles with a clear active-zone collection', () => {
    const count = 105_120;
    const candles: LabCandle[] = [];
    const atr: Array<number | null> = [];
    let price = 100;
    for (let i = 0; i < count; i += 1) {
      // Periodic real confirmations plus ordinary deterministic movement. This
      // exercises a long replay without constructing an artificial all-active
      // worst case for V1's deliberately simple active-zone collection.
      const cycle = i % 500;
      const open = price;
      let close: number;
      let high: number;
      let low: number;
      if (cycle === 0) {
        close = open - 1;
        high = open;
        low = close - 0.2;
      } else if (cycle === 1) {
        close = open + 4;
        high = close;
        low = open;
      } else {
        const wave = Math.sin(i / 19) * 0.35 + Math.cos(i / 43) * 0.2;
        close = open + wave;
        high = Math.max(open, close) + 0.6;
        low = Math.min(open, close) - 0.6;
      }
      candles.push(candle(i, open, high, low, close));
      atr.push(2);
      price = close;
    }
    const started = performance.now();
    const first = evaluate(candles, ob({ displacementMultiplier: 1.5 }), atr);
    const elapsedMs = performance.now() - started;
    const second = evaluate(candles, ob({ displacementMultiplier: 1.5 }), atr);
    expect(first.orderBlocks.map((block) => block.id)).toEqual(second.orderBlocks.map((block) => block.id));
    expect(first.orderBlocks.length).toBeGreaterThan(0);
    // Broad CI-safe guard: detects an explosive regression without a micro-benchmark.
    expect(elapsedMs).toBeLessThan(15_000);
  });
});
