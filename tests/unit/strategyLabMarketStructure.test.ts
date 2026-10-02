import { describe, expect, it } from 'vitest';
import type {
  LabCandle,
  MarketStructureIndicatorDefinition,
} from '@/services/strategyLab/types';
import { evaluateMarketStructure } from '@/services/strategyLab/marketStructure';
import { compileResearchDraft } from '@/services/strategyLab/draft/compile';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
import { mapMarketStructureProjection } from '@/services/strategyLab/labChartProjection';
import { PriceSegmentsPrimitive } from '@/components/common/chart/PriceSegmentsPrimitive';

const START = 1_730_000_000;

function candle(index: number, open: number, high: number, low: number, close: number): LabCandle {
  const time = START + index * 60;
  return { time, closeTime: time + 59, open, high, low, close, volume: 1_000 + index };
}

function structure(overrides: Partial<MarketStructureIndicatorDefinition> = {}): MarketStructureIndicatorDefinition {
  return {
    id: 'market-structure-main',
    type: 'MARKET_STRUCTURE',
    name: 'Market Structure',
    leftBars: 1,
    rightBars: 1,
    visible: true,
    ...overrides,
  };
}

/** A complete directional path: first BOS, CHoCH, continuation BOS, then CHoCH/BOS. */
function structureCandles(): LabCandle[] {
  return [
    candle(0, 95, 100, 90, 95),
    candle(1, 105, 110, 95, 105), // high swing → confirms 2
    candle(2, 100, 105, 92, 100),
    candle(3, 111, 112, 100, 111), // BULLISH_BOS high 1; low 2 confirms
    candle(4, 91, 100, 90, 91), // BEARISH_CHOCH low 2; high 3 confirms
    candle(5, 100, 105, 93, 100), // low 4 confirms
    candle(6, 89, 102, 88, 89), // BEARISH_BOS low 4; high 5 confirms
    candle(7, 106, 108, 100, 106), // BULLISH_CHOCH high 5
    candle(8, 102, 104, 101, 102), // high 7 confirms
    candle(9, 109, 110, 105, 109), // BULLISH_BOS high 7
  ];
}

function kinds(candles: LabCandle[], def = structure()): string[] {
  return evaluateMarketStructure(candles, [def]).marketStructureEvents.map((event) => event.kind);
}

function marketStructureDraft(long: string, short = 'bearishBOS(MARKET_STRUCTURE_MAIN)') {
  return {
    name: 'Market Structure draft',
    apiVersion: 2 as const,
    indicators: [
      { id: 'atr-main', type: 'ATR' as const, name: 'ATR', period: 1, visible: false },
      { id: 'market-structure-main', type: 'MARKET_STRUCTURE' as const, name: 'Market Structure', leftBars: 1, rightBars: 1, visible: true },
    ],
    sourceCode: `strategy("Market Structure draft", () => { LONG(${long}); SHORT(${short}); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });`,
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

describe('Strategy Lab Market Structure V1', () => {
  it('detects strict confirmed Swing High/Low metadata, timing, and deterministic IDs', () => {
    const candles = structureCandles();
    const result = evaluateMarketStructure(candles, [structure()]);
    const high = result.marketStructureEvents.find((event) => event.kind === 'SWING_HIGH')!;
    const low = result.marketStructureEvents.find((event) => event.kind === 'SWING_LOW')!;
    expect(high).toMatchObject({
      id: 'ms:market-structure-main:SWING_HIGH:1:2',
      indicatorId: 'market-structure-main',
      sourceIndex: 1,
      sourceCandleTime: candles[1].time,
      confirmationIndex: 2,
      confirmationCandleTime: candles[2].time,
      knownAt: candles[2].closeTime,
      price: candles[1].high,
    });
    expect(low).toMatchObject({
      id: 'ms:market-structure-main:SWING_LOW:2:3',
      sourceIndex: 2,
      confirmationIndex: 3,
      knownAt: candles[3].closeTime,
      price: candles[2].low,
    });
    expect(evaluateMarketStructure(candles, [structure()]).marketStructureEvents).toEqual(result.marketStructureEvents);
  });

  it('rejects equality on either side, obeys asymmetric bars, and has no boundary pivots', () => {
    const equalityRight = [candle(0, 9, 10, 5, 9), candle(1, 10, 12, 6, 10), candle(2, 10, 12, 7, 10)];
    const equalityLeft = [candle(0, 9, 12, 5, 9), candle(1, 10, 12, 6, 10), candle(2, 10, 10, 7, 10)];
    expect(kinds(equalityRight)).not.toContain('SWING_HIGH');
    expect(kinds(equalityLeft)).not.toContain('SWING_HIGH');
    const equalLowRight = [candle(0, 9, 12, 8, 9), candle(1, 8, 11, 5, 8), candle(2, 9, 10, 5, 9)];
    const equalLowLeft = [candle(0, 9, 12, 5, 9), candle(1, 8, 11, 5, 8), candle(2, 9, 10, 7, 9)];
    expect(kinds(equalLowRight)).not.toContain('SWING_LOW');
    expect(kinds(equalLowLeft)).not.toContain('SWING_LOW');

    const asymmetric = [
      candle(0, 8, 8, 5, 7), candle(1, 9, 9, 6, 8), candle(2, 12, 12, 7, 10), candle(3, 10, 10, 8, 9),
    ];
    const events = evaluateMarketStructure(asymmetric, [structure({ leftBars: 2, rightBars: 1 })]).marketStructureEvents;
    expect(events).toContainEqual(expect.objectContaining({ kind: 'SWING_HIGH', sourceIndex: 2, confirmationIndex: 3 }));
    expect(evaluateMarketStructure(asymmetric.slice(0, 3), [structure({ leftBars: 2, rightBars: 1 })]).marketStructureEvents).toEqual([]);
    expect(evaluateMarketStructure(asymmetric, [structure({ leftBars: 3, rightBars: 1 })]).marketStructureEvents).toEqual([]);
  });

  it('starts neutral, classifies first breaks as BOS, continues BOS, and changes direction only via CHoCH', () => {
    const candles = structureCandles();
    const result = evaluateMarketStructure(candles, [structure()]);
    const breaks = result.marketStructureEvents.filter((event) => 'breakIndex' in event);
    expect(breaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'BULLISH_BOS', breakIndex: 3, previousState: 'NEUTRAL', newState: 'BULLISH' }),
      expect.objectContaining({ kind: 'BEARISH_CHOCH', breakIndex: 4, previousState: 'BULLISH', newState: 'BEARISH' }),
      expect.objectContaining({ kind: 'BEARISH_BOS', breakIndex: 6, previousState: 'BEARISH', newState: 'BEARISH' }),
      expect.objectContaining({ kind: 'BULLISH_CHOCH', breakIndex: 7, previousState: 'BEARISH', newState: 'BULLISH' }),
      expect.objectContaining({ kind: 'BULLISH_BOS', breakIndex: 9, previousState: 'BULLISH', newState: 'BULLISH' }),
    ]));
    expect(breaks[0]).toMatchObject({
      knownAt: candles[3].closeTime,
      breakClose: candles[3].close,
      level: candles[1].high,
      brokenSwingId: 'ms:market-structure-main:SWING_HIGH:1:2',
      brokenSwingKind: 'SWING_HIGH',
      brokenSwingSourceIndex: 1,
      brokenSwingSourceCandleTime: candles[1].time,
    });
  });

  it('classifies a first bearish break and a bearish continuation BOS without an assumed trend', () => {
    const candles = [
      candle(0, 105, 110, 100, 105),
      candle(1, 95, 105, 90, 95), // low 90 confirms on 2
      candle(2, 97, 100, 95, 97),
      candle(3, 89, 98, 88, 89), // first BEARISH_BOS
      candle(4, 90, 96, 85, 90), // fresh low confirms on 5
      candle(5, 91, 95, 88, 91),
      candle(6, 84, 94, 80, 84), // BEARISH_BOS continuation
    ];
    const breaks = evaluateMarketStructure(candles, [structure()]).marketStructureEvents.filter((event) => 'breakIndex' in event);
    expect(breaks).toEqual([
      expect.objectContaining({ kind: 'BEARISH_BOS', breakIndex: 3, previousState: 'NEUTRAL', newState: 'BEARISH', level: 90 }),
      expect.objectContaining({ kind: 'BEARISH_BOS', breakIndex: 6, previousState: 'BEARISH', newState: 'BEARISH', level: 85 }),
    ]);
  });

  it('does not create breaks for wicks/equality, never repeats consumed levels, and requires a fresh same-side Swing', () => {
    const candles = [
      candle(0, 95, 100, 90, 95),
      candle(1, 105, 110, 95, 105),
      candle(2, 100, 105, 92, 100), // high confirms
      candle(3, 100, 115, 95, 110), // wick reaches 115; close equals level → no BOS
      candle(4, 111, 112, 105, 111), // first strict close break
      candle(5, 115, 116, 110, 115), // still beyond; no duplicate
      candle(6, 116, 117, 111, 116),
    ];
    const breaks = evaluateMarketStructure(candles, [structure()]).marketStructureEvents.filter((event) => 'breakIndex' in event);
    expect(breaks).toEqual([
      expect.objectContaining({ kind: 'BULLISH_BOS', breakIndex: 4, level: 110 }),
      expect.objectContaining({ kind: 'BULLISH_BOS', breakIndex: 6, level: 115 }),
    ]);
    expect(breaks[0]!.brokenSwingId).not.toBe(breaks[1]!.brokenSwingId);
  });

  it('supersedes same-side levels without fallback and retains the opposite active level through a transition', () => {
    const replacement = [
      candle(0, 95, 100, 90, 95),
      candle(1, 105, 110, 95, 105), // high 110 confirms 2
      candle(2, 100, 105, 92, 100),
      candle(3, 105, 120, 100, 105), // higher high source confirms 4
      candle(4, 100, 110, 95, 100),
      candle(5, 115, 118, 110, 115), // > old 110 but < current 120: no break
      candle(6, 121, 122, 115, 121), // breaks current high 120
    ];
    const breakEvents = evaluateMarketStructure(replacement, [structure()]).marketStructureEvents.filter((event) => 'breakIndex' in event);
    expect(breakEvents).toEqual([expect.objectContaining({ kind: 'BULLISH_BOS', breakIndex: 6, level: 120 })]);

    const oppositeSurvives = structureCandles();
    const events = evaluateMarketStructure(oppositeSurvives, [structure()]).marketStructureEvents.filter((event) => 'breakIndex' in event);
    expect(events.find((event) => event.kind === 'BEARISH_CHOCH')).toMatchObject({ level: oppositeSurvives[2].low });
    expect(events.find((event) => event.kind === 'BULLISH_CHOCH')).toMatchObject({ level: oppositeSurvives[5].high });
  });

  it('locks break-first/register-after ordering: a confirmation is a swing event now but its first eligible break is later', () => {
    const candles = [
      candle(0, 95, 100, 90, 95),
      candle(1, 105, 110, 95, 105),
      candle(2, 100, 105, 92, 100), // high confirms on 2
      candle(3, 111, 112, 100, 111), // earliest legal high break
    ];
    const result = evaluateMarketStructure(candles, [structure()]);
    const swings = result.marketStructureEvents.filter((event) => event.kind === 'SWING_HIGH');
    const breaks = result.marketStructureEvents.filter((event) => 'breakIndex' in event);
    expect(swings).toContainEqual(expect.objectContaining({ sourceIndex: 1, confirmationIndex: 2 }));
    expect(breaks.some((event) => event.breakIndex === 2)).toBe(false);
    expect(breaks).toContainEqual(expect.objectContaining({ kind: 'BULLISH_BOS', breakIndex: 3 }));
    // A valid OHLC confirmation candle for a Swing High must have high[k] below
    // the source high, so close[k] cannot exceed that source high. The frozen
    // ordering is still explicitly enforced by the confirmationIndex < k gate.
  });

  it('compiles the six typed predicates, preserves recursive composition, dependencies, defaults, and bounds', () => {
    const valid = compileResearchDraft(marketStructureDraft('all(bullishCHoCH(MARKET_STRUCTURE_MAIN), not(bearishBOS(MARKET_STRUCTURE_MAIN)))'));
    expect(valid.ok).toBe(true);
    expect(valid.definition?.long).toMatchObject({ kind: 'all' });
    expect(valid.definition?.indicators.map((indicator) => indicator.id)).toEqual(['market-structure-main', 'atr-main']);
    expect(valid.definition?.indicators[0]).toMatchObject({ leftBars: 1, rightBars: 1, visible: true });

    const wrongType = marketStructureDraft('bullishBOS(ATR_MAIN)');
    expect(compileResearchDraft(wrongType).ok).toBe(false);
    const wrongArity = marketStructureDraft('bullishBOS(MARKET_STRUCTURE_MAIN, ATR_MAIN)');
    expect(compileResearchDraft(wrongArity).ok).toBe(false);
    const badBounds = marketStructureDraft('bullishBOS(MARKET_STRUCTURE_MAIN)');
    (badBounds.indicators[1] as { leftBars: number }).leftBars = 0;
    expect(compileResearchDraft(badBounds).ok).toBe(false);
  });

  it('makes Swing and BOS predicates true only at their known close and fills on the following open', () => {
    const candles = structureCandles();
    const swingDefinition = compileResearchDraft(marketStructureDraft('swingHigh(MARKET_STRUCTURE_MAIN)')).definition!;
    const swingResult = evaluateDraftStrategy(candles, swingDefinition);
    const swingCandidate = swingResult.events.find((event) => event.kind === 'CANDIDATE' && event.side === 'LONG')!;
    expect(swingCandidate).toMatchObject({ candleTime: candles[2].time, knownAt: candles[2].closeTime });
    expect(swingResult.trades.find((trade) => trade.side === 'LONG')).toMatchObject({ entryTime: candles[3].time, entryPrice: candles[3].open });

    const bosDefinition = compileResearchDraft(marketStructureDraft('bullishBOS(MARKET_STRUCTURE_MAIN)')).definition!;
    const bosResult = evaluateDraftStrategy(candles, bosDefinition);
    const candidate = bosResult.events.find((event) => event.kind === 'CANDIDATE' && event.candleTime === candles[3].time)!;
    const fill = bosResult.events.find((event) => event.kind === 'FILL' && event.candleTime === candles[4].time)!;
    expect(candidate.knownAt).toBe(candles[3].closeTime);
    expect(fill.price).toBe(candles[4].open);
    expect(bosResult.events.some((event) => (event.kind === 'ENTRY' || event.kind === 'FILL') && event.candleTime === candles[3].time)).toBe(false);
  });

  it('projects source swing markers and finite BOS/CHoCH segments only when visible', () => {
    const candles = structureCandles();
    const evaluation = evaluateMarketStructure(candles, [structure()]);
    const shown = mapMarketStructureProjection({
      candles,
      marketStructureEvents: evaluation.marketStructureEvents,
      indicators: { indicatorsList: [structure()] },
    });
    expect(shown.markers).toContainEqual(expect.objectContaining({ time: candles[1].time, text: 'SH' }));
    const choch = evaluation.marketStructureEvents.find((event) => 'breakIndex' in event && event.kind === 'BULLISH_CHOCH');
    if (!choch || !('breakIndex' in choch)) throw new Error('Expected BULLISH_CHOCH');
    expect(shown.markers).toContainEqual(expect.objectContaining({ time: choch.breakCandleTime, text: 'CHoCH' }));
    expect(shown.priceSegments).toContainEqual(expect.objectContaining({
      fromTime: choch.brokenSwingSourceCandleTime,
      toTime: choch.breakCandleTime,
      price: choch.level,
      style: 'dashed',
    }));
    const hidden = mapMarketStructureProjection({
      candles,
      marketStructureEvents: evaluation.marketStructureEvents,
      indicators: { indicatorsList: [structure({ visible: false })] },
    });
    expect(hidden).toEqual({ markers: [], priceSegments: [] });
  });

  it('uses the generic finite price-segment primitive lifecycle without Market Structure chart coupling', () => {
    const primitive = new PriceSegmentsPrimitive([{ id: 'level', fromTime: 1, toTime: 2, price: 10, color: '#0ff', style: 'dashed', lineWidth: 2 }]);
    let updateCalls = 0;
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time * 10 }) },
      series: { priceToCoordinate: (price: number) => price * 5 },
      requestUpdate: () => { updateCalls += 1; },
    } as any);
    expect(primitive.paneViews()[0]!.zOrder?.()).toBe('bottom');
    primitive.setSegments([]);
    expect(updateCalls).toBe(1);
    primitive.detached();
  });

  it('is unchanged through a settled index when only future candles mutate', () => {
    const original = structureCandles();
    const changed = original.map((entry) => ({ ...entry }));
    changed[8] = { ...changed[8], high: 1_000, low: 999, open: 999.5, close: 999.5 };
    changed[9] = { ...changed[9], high: 1_001, low: 998, open: 999, close: 1_000 };
    const before = evaluateMarketStructure(original, [structure()]).marketStructureEvents
      .filter((event) => ('breakIndex' in event ? event.breakIndex : event.confirmationIndex) <= 6);
    const after = evaluateMarketStructure(changed, [structure()]).marketStructureEvents
      .filter((event) => ('breakIndex' in event ? event.breakIndex : event.confirmationIndex) <= 6);
    expect(after).toEqual(before);
  });

  it('remains deterministic over 105,120 candles without historical pivot scans', () => {
    const candles = Array.from({ length: 105_120 }, (_, index) => {
      const base = 100 + Math.sin(index / 4) * 8 + Math.cos(index / 19) * 3;
      return candle(index, base - 0.2, base + 1, base - 1, base + Math.sin(index / 3) * 0.15);
    });
    const started = performance.now();
    const first = evaluateMarketStructure(candles, [structure({ leftBars: 2, rightBars: 2 })]);
    const second = evaluateMarketStructure(candles, [structure({ leftBars: 2, rightBars: 2 })]);
    const elapsed = performance.now() - started;
    expect(first.marketStructureEvents).toEqual(second.marketStructureEvents);
    expect(first.marketStructureEvents.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(15_000);
  });
});
