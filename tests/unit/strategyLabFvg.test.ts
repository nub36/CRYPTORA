/**
 * CRYPTORA — Strategy Lab · Fair Value Gap V1 (RESEARCH ONLY) unit coverage.
 *
 * Covers detection strictness, metadata/deterministic IDs, the full lifecycle
 * (ACTIVE → PARTIALLY_FILLED → FILLED), inside/retest semantics, per-candle
 * ordering, discontinuous full fill, DSL compilation, visibility invariance,
 * chart projection, the 105,120-candle adversarial performance guard and the
 * MANDATORY optimized-versus-naive-reference bar-for-bar equivalence.
 */
import { describe, expect, it } from 'vitest';
import type {
  FvgIndicatorDefinition,
  LabCandle,
  LabFairValueGap,
} from '@/services/strategyLab/types';
import { evaluateFairValueGaps, fvgConfirmationKey } from '@/services/strategyLab/fairValueGaps';
import type { FairValueGapEvaluation } from '@/services/strategyLab/fairValueGaps';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
import { runLabReplay } from '@/services/strategyLab/engine';
import { compileResearchDraft } from '@/services/strategyLab/draft/compile';
import { indicatorIdentifier } from '@/services/strategyLab/draft/identifiers';
import { mapFvgZones, mapOrderBlockZones } from '@/services/strategyLab/labChartProjection';

const T = 1_700_000_000;

function candle(index: number, open: number, high: number, low: number, close: number): LabCandle {
  const time = T + index * 60;
  return { time, closeTime: time + 59, open, high, low, close, volume: 1 };
}

const FVG: FvgIndicatorDefinition = { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true };
const BULL_KEY = fvgConfirmationKey('fvg-main', 'BULLISH');
const BEAR_KEY = fvgConfirmationKey('fvg-main', 'BEARISH');

function evaluate(candles: LabCandle[]): FairValueGapEvaluation {
  return evaluateFairValueGaps(candles, [FVG]);
}

/** A-B-C bullish gap: A.high=100, C.low=102 → zone [100, 102] confirmed at 2. */
function bullishBase(): LabCandle[] {
  return [
    candle(0, 99, 100, 98, 99), // A
    candle(1, 100, 101, 99, 100), // B — never defines bounds
    candle(2, 103, 105, 102, 104), // C
  ];
}

function fvgDraft(sourceCode: string, visible = true) {
  return {
    name: 'FVG draft',
    apiVersion: 2 as const,
    indicators: [
      { id: 'fvg-main', type: 'FVG' as const, name: 'Fair Value Gap', visible },
      { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 1, visible: false },
    ],
    sourceCode,
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

/* ───────────────────────── Reference implementation ─────────────────────────
 * Deliberately naive O(candles × zones) active-list implementation written
 * independently from the optimized heap engine. Used ONLY by equivalence
 * tests: do not trust the optimization because the lost candidate did.
 */
function referenceEvaluate(
  candles: readonly LabCandle[],
  definitions: readonly FvgIndicatorDefinition[]
): FairValueGapEvaluation {
  const fairValueGaps: LabFairValueGap[] = [];
  const confirmationsByIndex = new Map<number, Set<string>>();
  const insideByIndex = new Map<number, Set<string>>();
  const retestsByIndex = new Map<number, Set<string>>();
  const add = (map: Map<number, Set<string>>, index: number, key: string) => {
    const keys = map.get(index) ?? new Set<string>();
    keys.add(key);
    map.set(index, keys);
  };

  for (let k = 0; k < candles.length; k += 1) {
    const bar = candles[k];
    // 1. first range overlap of earlier-confirmed, non-FILLED zones
    for (const zone of fairValueGaps) {
      if (zone.state === 'FILLED' || zone.confirmationIndex >= k || zone.firstTouchIndex !== undefined) continue;
      if (bar.low <= zone.high && bar.high >= zone.low) {
        zone.firstTouchIndex = k;
        zone.firstTouchCandleTime = bar.time;
        zone.firstTouchedAt = bar.closeTime;
        zone.state = 'PARTIALLY_FILLED';
        add(retestsByIndex, k, fvgConfirmationKey(zone.indicatorId, zone.direction));
      }
    }
    // 2. directional full fill (also the discontinuous no-overlap edge)
    for (const zone of fairValueGaps) {
      if (zone.state === 'FILLED' || zone.confirmationIndex >= k) continue;
      const filled = zone.direction === 'BULLISH' ? bar.low <= zone.low : bar.high >= zone.high;
      if (filled) {
        zone.fillIndex = k;
        zone.fillCandleTime = bar.time;
        zone.filledAt = bar.closeTime;
        zone.state = 'FILLED';
      }
    }
    // 3. inclusive close-inside for surviving zones
    for (const zone of fairValueGaps) {
      if (zone.state === 'FILLED' || zone.confirmationIndex >= k) continue;
      if (zone.low <= bar.close && bar.close <= zone.high) {
        add(insideByIndex, k, fvgConfirmationKey(zone.indicatorId, zone.direction));
      }
    }
    // 4. detection at k
    if (k >= 2) {
      for (const definition of definitions) {
        const first = candles[k - 2];
        const middle = candles[k - 1];
        let direction: 'BULLISH' | 'BEARISH' | null = null;
        let low = 0;
        let high = 0;
        if (bar.low > first.high) {
          direction = 'BULLISH';
          low = first.high;
          high = bar.low;
        } else if (bar.high < first.low) {
          direction = 'BEARISH';
          low = bar.high;
          high = first.low;
        }
        if (direction === null) continue;
        fairValueGaps.push({
          id: `fvg:${definition.id}:${direction}:${k - 2}:${k}`,
          indicatorId: definition.id,
          direction,
          firstIndex: k - 2,
          firstCandleTime: first.time,
          middleIndex: k - 1,
          middleCandleTime: middle.time,
          confirmationIndex: k,
          confirmationCandleTime: bar.time,
          knownAt: bar.closeTime,
          low,
          high,
          state: 'ACTIVE',
        });
        add(confirmationsByIndex, k, fvgConfirmationKey(definition.id, direction));
      }
    }
  }
  return { fairValueGaps, confirmationsByIndex, insideByIndex, retestsByIndex };
}

function mapToSorted(map: Map<number, Set<string>>): Array<[number, string[]]> {
  return [...map.entries()]
    .map(([index, keys]): [number, string[]] => [index, [...keys].sort()])
    .sort((a, b) => a[0] - b[0]);
}

/* ───────────────────────────── Detection ───────────────────────────── */

describe('Strategy Lab FVG V1 · detection', () => {
  it('detects a bullish three-candle gap with strict comparison and exact zone bounds', () => {
    const { fairValueGaps, confirmationsByIndex } = evaluate(bullishBase());
    expect(fairValueGaps).toHaveLength(1);
    const zone = fairValueGaps[0];
    expect(zone).toMatchObject({
      id: 'fvg:fvg-main:BULLISH:0:2',
      indicatorId: 'fvg-main',
      direction: 'BULLISH',
      firstIndex: 0,
      middleIndex: 1,
      confirmationIndex: 2,
      low: 100,
      high: 102,
      state: 'ACTIVE',
    });
    expect(zone.firstCandleTime).toBe(T);
    expect(zone.middleCandleTime).toBe(T + 60);
    expect(zone.confirmationCandleTime).toBe(T + 120);
    expect(zone.knownAt).toBe(T + 120 + 59); // closeTime(C) — not before
    expect(zone.firstTouchIndex).toBeUndefined();
    expect(zone.fillIndex).toBeUndefined();
    expect(confirmationsByIndex.get(2)?.has(BULL_KEY)).toBe(true);
  });

  it('detects a bearish gap mirrored and never from candle B', () => {
    const candles = [
      candle(0, 101, 103, 100, 102), // A: low = 100
      candle(1, 99, 100.5, 95, 96), // B overlaps everything — must not matter
      candle(2, 97, 98, 95, 96), // C: high = 98 < 100
    ];
    const { fairValueGaps } = evaluate(candles);
    expect(fairValueGaps).toHaveLength(1);
    expect(fairValueGaps[0]).toMatchObject({
      id: 'fvg:fvg-main:BEARISH:0:2',
      direction: 'BEARISH',
      low: 98,
      high: 100,
      state: 'ACTIVE',
    });
  });

  it('rejects equality: touching extremes do not create a gap', () => {
    const bullishTouch = [candle(0, 99, 100, 98, 99), candle(1, 100, 101, 99, 100), candle(2, 101, 103, 100, 102)];
    expect(evaluate(bullishTouch).fairValueGaps).toHaveLength(0); // low[C] === high[A]
    const bearishTouch = [candle(0, 101, 103, 100, 102), candle(1, 99, 100.5, 95, 96), candle(2, 97, 100, 95, 96)];
    expect(evaluate(bearishTouch).fairValueGaps).toHaveLength(0); // high[C] === low[A]
  });

  it('emits per-candle deterministic IDs for consecutive confirmations', () => {
    // Monotone gapping-up staircase: every candle from index 2 confirms a gap.
    const candles = Array.from({ length: 6 }, (_, i) => candle(i, 10 * i + 0.2, 10 * i + 1, 10 * i, 10 * i + 0.8));
    const { fairValueGaps } = evaluate(candles);
    expect(fairValueGaps.map((zone) => zone.id)).toEqual([
      'fvg:fvg-main:BULLISH:0:2',
      'fvg:fvg-main:BULLISH:1:3',
      'fvg:fvg-main:BULLISH:2:4',
      'fvg:fvg-main:BULLISH:3:5',
    ]);
  });
});

/* ───────────────────────────── Lifecycle ───────────────────────────── */

describe('Strategy Lab FVG V1 · lifecycle', () => {
  it('starts lifecycle only on C+1: the confirmation candle itself never touches or fills its zone', () => {
    // C closes exactly on its own zone.high — if the zone were eligible at C,
    // inside/retest would fire there.
    const candles = [
      candle(0, 99, 100, 98, 99),
      candle(1, 100, 101, 99, 100),
      candle(2, 103, 105, 102, 102), // close === zone.high === low[C]
    ];
    const { fairValueGaps, insideByIndex, retestsByIndex } = evaluate(candles);
    expect(fairValueGaps[0].state).toBe('ACTIVE');
    expect(insideByIndex.get(2)).toBeUndefined();
    expect(retestsByIndex.get(2)).toBeUndefined();
  });

  it('records first touch + retest on the first overlapping candle and keeps PARTIALLY_FILLED', () => {
    const candles = [
      ...bullishBase(),
      candle(3, 104, 104.5, 103, 104), // above the zone — no overlap
      candle(4, 104, 104.2, 101.5, 103), // first overlap (low 101.5 ≤ 102), no fill
      candle(5, 103, 103.5, 101.8, 102.5), // second overlap — NOT a retest
    ];
    const { fairValueGaps, retestsByIndex } = evaluate(candles);
    const zone = fairValueGaps[0];
    expect(retestsByIndex.get(3)).toBeUndefined();
    expect(retestsByIndex.get(4)?.has(BULL_KEY)).toBe(true);
    expect(retestsByIndex.get(5)).toBeUndefined();
    expect(zone.state).toBe('PARTIALLY_FILLED');
    expect(zone.firstTouchIndex).toBe(4);
    expect(zone.firstTouchCandleTime).toBe(T + 4 * 60);
    expect(zone.firstTouchedAt).toBe(T + 4 * 60 + 59);
    expect(zone.fillIndex).toBeUndefined();
  });

  it('treats an exact boundary touch as an overlap (inclusive comparison)', () => {
    const candles = [...bullishBase(), candle(3, 104, 104.5, 102, 104)]; // low === zone.high
    const { fairValueGaps, retestsByIndex } = evaluate(candles);
    expect(retestsByIndex.get(3)?.has(BULL_KEY)).toBe(true);
    expect(fairValueGaps[0].state).toBe('PARTIALLY_FILLED');
  });

  it('fills a bullish zone when low reaches zone.low and FILLED is terminal', () => {
    const candles = [
      ...bullishBase(),
      candle(3, 104, 104.5, 101.5, 103), // first touch
      candle(4, 103, 103.5, 100, 101), // low === zone.low → FILLED
      candle(5, 101, 102.5, 100.5, 101.5), // later overlap — must change nothing
    ];
    const { fairValueGaps, retestsByIndex, insideByIndex } = evaluate(candles);
    const zone = fairValueGaps[0];
    expect(zone.state).toBe('FILLED');
    expect(zone.firstTouchIndex).toBe(3); // prior touch metadata preserved
    expect(zone.fillIndex).toBe(4);
    expect(zone.fillCandleTime).toBe(T + 4 * 60);
    expect(zone.filledAt).toBe(T + 4 * 60 + 59);
    expect(retestsByIndex.get(5)).toBeUndefined();
    expect(insideByIndex.get(5)).toBeUndefined(); // FILLED is excluded from inside
  });

  it('fills a bearish zone when high reaches zone.high', () => {
    const candles = [
      candle(0, 101, 103, 100, 102), // A → zone [98, 100]
      candle(1, 99, 100.5, 95, 96),
      candle(2, 97, 98, 95, 96), // C
      candle(3, 96, 99, 95.5, 98.5), // first touch (high 99 ≥ 98), not full
      candle(4, 98, 100, 97, 99), // high === zone.high → FILLED
    ];
    const { fairValueGaps, retestsByIndex } = evaluate(candles);
    const zone = fairValueGaps[0];
    expect(zone.direction).toBe('BEARISH');
    expect(retestsByIndex.get(3)?.has(BEAR_KEY)).toBe(true);
    expect(zone).toMatchObject({ state: 'FILLED', firstTouchIndex: 3, fillIndex: 4 });
  });

  it('same-candle first touch + full fill records retest=true, FILLED and inside=false', () => {
    const candles = [
      ...bullishBase(),
      candle(3, 104, 104.5, 103, 104),
      candle(4, 103, 103.2, 99.5, 101), // overlaps AND penetrates below zone.low; close inside bounds
    ];
    const { fairValueGaps, retestsByIndex, insideByIndex } = evaluate(candles);
    const zone = fairValueGaps[0];
    expect(retestsByIndex.get(4)?.has(BULL_KEY)).toBe(true);
    expect(zone).toMatchObject({ state: 'FILLED', firstTouchIndex: 4, fillIndex: 4 });
    // close 101 lies inside [100, 102] but the zone is FILLED after this
    // candle's lifecycle — inside must be false.
    expect(insideByIndex.get(4)).toBeUndefined();
  });

  it('discontinuous full fill without range overlap fills with NO retest and NO first-touch metadata', () => {
    const candles = [
      ...bullishBase(),
      candle(3, 104, 104.5, 103, 104),
      candle(4, 99, 99.5, 98, 98.5), // gapped entirely below the zone [100, 102]
    ];
    const { fairValueGaps, retestsByIndex } = evaluate(candles);
    const zone = fairValueGaps[0];
    expect(zone.state).toBe('FILLED');
    expect(zone.fillIndex).toBe(4);
    expect(zone.firstTouchIndex).toBeUndefined();
    expect(zone.firstTouchCandleTime).toBeUndefined();
    expect(zone.firstTouchedAt).toBeUndefined();
    expect(retestsByIndex.get(4)).toBeUndefined();
  });

  it('evaluates inside by completed close, inclusively, and ignores wick-only passes', () => {
    const candles = [
      ...bullishBase(),
      candle(3, 104, 104.5, 101.5, 102), // close === zone.high → inside (inclusive)
      candle(4, 102, 103.5, 101, 103), // wick inside, close 103 outside → NOT inside
      candle(5, 103, 103.2, 100.5, 101), // close strictly inside
    ];
    const { insideByIndex } = evaluate(candles);
    expect(insideByIndex.get(3)?.has(BULL_KEY)).toBe(true);
    expect(insideByIndex.get(4)).toBeUndefined();
    expect(insideByIndex.get(5)?.has(BULL_KEY)).toBe(true);
  });

  it('inside is true when ANY eligible zone matches', () => {
    // Two bullish zones at different levels; close lands in the second only.
    const candles = [
      candle(0, 99, 100, 98, 99),
      candle(1, 100, 101, 99, 100),
      candle(2, 103, 105, 102, 104), // zone 1: [100, 102]
      candle(3, 106, 108, 100.9, 107), // B for zone 2; deep wick prevents a zone at 3
      candle(4, 107, 108, 106, 107.5), // low 106 > high[2]=105 → zone 2: [105, 106]
      candle(5, 107, 107.5, 105.2, 105.5), // close 105.5 inside zone 2 only
    ];
    const { fairValueGaps, insideByIndex } = evaluate(candles);
    expect(fairValueGaps).toHaveLength(2);
    expect(insideByIndex.get(5)?.has(BULL_KEY)).toBe(true);
  });
});

/* ───────────────────────────── DSL / compiler ───────────────────────────── */

describe('Strategy Lab FVG V1 · DSL', () => {
  it('exposes FVG_MAIN as the stable identifier of fvg-main', () => {
    expect(indicatorIdentifier('fvg-main')).toBe('FVG_MAIN');
  });

  it('compiles all six FVG predicates plus all/any/not composition', () => {
    const compiled = compileResearchDraft(fvgDraft(
      `strategy("FVG full", () => {
        LONG(all(bullishFvg(FVG_MAIN), any(insideBullishFvg(FVG_MAIN), bullishFvgRetest(FVG_MAIN)), not(bearishFvg(FVG_MAIN))));
        SHORT(any(bearishFvgRetest(FVG_MAIN), insideBearishFvg(FVG_MAIN)));
        STOP(multiply(ATR_MAIN, 1));
        TAKE_PROFIT(R(1));
      });`
    ));
    expect(compiled.ok).toBe(true);
    expect(compiled.errors).toEqual([]);
    const long = compiled.definition!.long;
    expect(long).toMatchObject({ kind: 'all' });
    const canonicalFvg = compiled.definition!.indicators.find((ind) => ind.type === 'FVG');
    // Canonical FVG shape carries no calculation parameters.
    expect(canonicalFvg).toEqual({ id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true });
  });

  it('rejects an FVG predicate aimed at a non-FVG indicator', () => {
    const compiled = compileResearchDraft(fvgDraft(
      'strategy("bad", () => { LONG(bullishFvg(ATR_MAIN)); SHORT(bearishFvg(FVG_MAIN)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });'
    ));
    expect(compiled.ok).toBe(false);
    expect(compiled.errors[0].message).toContain('ожидается FVG');
  });

  it('rejects unknown FVG-like functions and wrong arity', () => {
    const unknown = compileResearchDraft(fvgDraft(
      'strategy("bad", () => { LONG(bullishFvgCreated(FVG_MAIN)); SHORT(bearishFvg(FVG_MAIN)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });'
    ));
    expect(unknown.ok).toBe(false);

    const arity = compileResearchDraft(fvgDraft(
      'strategy("bad", () => { LONG(bullishFvg(FVG_MAIN, FVG_MAIN)); SHORT(bearishFvg(FVG_MAIN)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });'
    ));
    expect(arity.ok).toBe(false);
    expect(arity.errors[0].message).toContain('один индикатор Fair Value Gap');

    const unref = compileResearchDraft(fvgDraft(
      'strategy("bad", () => { LONG(bullishFvg(FVG_OTHER)); SHORT(bearishFvg(FVG_MAIN)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });'
    ));
    expect(unref.ok).toBe(false);
  });
});

/* ──────────────────────── Replay integration ──────────────────────── */

function creationReplayCandles(): LabCandle[] {
  const candles: LabCandle[] = [];
  for (let i = 0; i < 30; i += 1) candles.push(candle(i, 100, i === 29 ? 102.5 : 100.5, 99.5, 100));
  candles.push(candle(30, 102, 103, 101.5, 102.5)); // C: zone [100.5, 101.5]
  for (let i = 31; i < 48; i += 1) candles.push(candle(i, 102.5, 103, 102, 102.5));
  return candles;
}

describe('Strategy Lab FVG V1 · replay/engine integration', () => {
  const creationDraft = (visible = true) => fvgDraft(
    'strategy("FVG creation", () => { LONG(bullishFvg(FVG_MAIN)); SHORT(bearishFvg(FVG_MAIN)); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });',
    visible
  );

  it('enters at open(C+1) after a creation signal known only at close(C)', () => {
    const candles = creationReplayCandles();
    const compiled = compileResearchDraft(creationDraft());
    expect(compiled.ok).toBe(true);
    const evaluation = evaluateDraftStrategy(candles, compiled.definition!);

    expect(evaluation.fairValueGaps).toHaveLength(1);
    expect(evaluation.fairValueGaps[0].id).toBe('fvg:fvg-main:BULLISH:28:30');
    expect(evaluation.trades).toHaveLength(1);
    const trade = evaluation.trades[0];
    expect(trade.signalTime).toBe(candles[30].time);
    expect(trade.entryTime).toBe(candles[31].time);
    expect(trade.entryPrice).toBe(candles[31].open); // zero slippage: exact open
    const candidate = evaluation.events.find((event) => event.kind === 'CANDIDATE');
    expect(candidate?.candleTime).toBe(candles[30].time);
    expect(candidate?.knownAt).toBe(candles[30].closeTime);
  });

  it('keeps calculations identical when only visibility changes; only chart projection differs', () => {
    const candles = creationReplayCandles();
    const visibleResult = runLabReplay(
      {
        strategyDefinition: compileResearchDraft(creationDraft(true)).definition!,
        market: 'spot', symbol: 'BTCUSDT', timeframe: '1h',
        from: candles[0].time * 1000, to: candles[47].closeTime * 1000, candles,
      },
      1_750_000_000_000
    );
    const hiddenResult = runLabReplay(
      {
        strategyDefinition: compileResearchDraft(creationDraft(false)).definition!,
        market: 'spot', symbol: 'BTCUSDT', timeframe: '1h',
        from: candles[0].time * 1000, to: candles[47].closeTime * 1000, candles,
      },
      1_750_000_000_000
    );

    expect(hiddenResult.fairValueGaps).toEqual(visibleResult.fairValueGaps);
    expect(hiddenResult.events).toEqual(visibleResult.events);
    expect(hiddenResult.trades).toEqual(visibleResult.trades);
    expect(hiddenResult.rejections).toEqual(visibleResult.rejections);
    expect(hiddenResult.metrics).toEqual(visibleResult.metrics);

    expect(mapFvgZones(visibleResult)).toHaveLength(1);
    expect(mapFvgZones(hiddenResult)).toHaveLength(0);
  });
});

/* ───────────────────────────── Chart projection ───────────────────────────── */

describe('Strategy Lab FVG V1 · chart projection', () => {
  const projectionResult = (candles: LabCandle[], fairValueGaps: LabFairValueGap[], visible = true) => ({
    candles,
    fairValueGaps,
    indicators: { indicatorsList: [{ ...FVG, visible }] },
  });

  it('starts at candle A and extends ACTIVE/PARTIALLY_FILLED zones to the latest replay candle', () => {
    // low[3] === high[1] → no second gap (equality rejects); still overlaps zone 1.
    const candles = [...bullishBase(), candle(3, 104, 104.5, 101, 103), candle(4, 103, 103.5, 102.5, 103)];
    const { fairValueGaps } = evaluate(candles);
    expect(fairValueGaps[0].state).toBe('PARTIALLY_FILLED');
    const zones = mapFvgZones(projectionResult(candles, fairValueGaps));
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      id: 'fvg:fvg-main:BULLISH:0:2',
      fromTime: candles[0].time, // A.time, never knownAt
      toTime: candles[4].time,
      low: 100,
      high: 102,
      state: 'PARTIALLY_FILLED',
    });
  });

  it('ends FILLED zones at fillCandleTime', () => {
    const candles = [...bullishBase(), candle(3, 104, 104.5, 99.5, 101), candle(4, 101, 102, 100.5, 101.5)];
    const { fairValueGaps } = evaluate(candles);
    expect(fairValueGaps[0]).toMatchObject({ state: 'FILLED', fillIndex: 3 });
    const zones = mapFvgZones(projectionResult(candles, fairValueGaps));
    expect(zones[0].toTime).toBe(candles[3].time);
  });

  it('renders with a lower/subtler opacity than Order Block zones', () => {
    const alpha = (color: string): number => Number(/([\d.]+)\)\s*$/.exec(color)?.[1] ?? NaN);
    const candles = [...bullishBase(), candle(3, 104, 104.5, 103, 104)];
    const { fairValueGaps } = evaluate(candles);
    const fvgZone = mapFvgZones(projectionResult(candles, fairValueGaps))[0];

    const obResult = {
      candles,
      orderBlocks: [{
        id: 'ob:order-block-main:BULLISH:0:1', indicatorId: 'order-block-main', direction: 'BULLISH' as const,
        sourceIndex: 0, sourceCandleTime: candles[0].time, confirmationIndex: 1,
        confirmationCandleTime: candles[1].time, knownAt: candles[1].closeTime,
        low: 98, high: 100, state: 'ACTIVE' as const,
      }],
      indicators: { indicatorsList: [{ id: 'order-block-main', type: 'ORDER_BLOCK', visible: true }] },
    };
    const obZone = mapOrderBlockZones(obResult)[0];
    expect(alpha(fvgZone.fillColor)).toBeLessThan(alpha(obZone.fillColor));
    expect(alpha(fvgZone.borderColor)).toBeLessThan(alpha(obZone.borderColor));
  });
});

/* ─────────────────────── Performance + equivalence ─────────────────────── */

function equivalenceCandles(count = 4000): LabCandle[] {
  const candles: LabCandle[] = [];
  let price = 1000;
  for (let i = 0; i < count; i += 1) {
    const phase = Math.sin(i / 5) * 3 + Math.cos(i / 13) * 2 + Math.sin(i / 71) * 6;
    const jump = i % 97 === 0 && i > 0 ? (i % 194 === 0 ? 60 : -60) : 0;
    const open = price + jump;
    const close = open + phase;
    const spread = 0.5 + Math.abs(Math.sin(i / 3)) * 2;
    const high = Math.max(open, close) + spread;
    const low = Math.min(open, close) - spread;
    candles.push(candle(i, open, high, low, close));
    price = close;
  }
  return candles;
}

describe('Strategy Lab FVG V1 · performance and optimized/reference equivalence', () => {
  it('matches the naive reference bar-for-bar on a 4000-candle deterministic fixture', () => {
    const candles = equivalenceCandles();
    const optimized = evaluate(candles);
    const reference = referenceEvaluate(candles, [FVG]);

    // The fixture must actually exercise the hard paths before the comparison
    // is allowed to prove anything.
    expect(optimized.fairValueGaps.length).toBeGreaterThan(50);
    expect(optimized.fairValueGaps.some((zone) => zone.state === 'FILLED' && zone.firstTouchIndex === undefined)).toBe(true); // discontinuous fill
    expect(optimized.fairValueGaps.some((zone) => zone.firstTouchIndex !== undefined && zone.firstTouchIndex === zone.fillIndex)).toBe(true); // same-candle retest + fill
    expect(optimized.fairValueGaps.some((zone) => zone.state === 'PARTIALLY_FILLED')).toBe(true);
    expect(optimized.insideByIndex.size).toBeGreaterThan(0);

    expect(optimized.fairValueGaps).toEqual(reference.fairValueGaps);
    expect(optimized.fairValueGaps.map((zone) => zone.state)).toEqual(reference.fairValueGaps.map((zone) => zone.state));
    expect(optimized.fairValueGaps.map((zone) => zone.firstTouchIndex)).toEqual(reference.fairValueGaps.map((zone) => zone.firstTouchIndex));
    expect(optimized.fairValueGaps.map((zone) => zone.fillIndex)).toEqual(reference.fairValueGaps.map((zone) => zone.fillIndex));
    expect(mapToSorted(optimized.retestsByIndex)).toEqual(mapToSorted(reference.retestsByIndex));
    expect(mapToSorted(optimized.insideByIndex)).toEqual(mapToSorted(reference.insideByIndex));
    expect(mapToSorted(optimized.confirmationsByIndex)).toEqual(mapToSorted(reference.confirmationsByIndex));
  });

  it('matches the reference on the explicit discontinuous-fill and same-candle edge fixtures', () => {
    const edgeFixtures: LabCandle[][] = [
      [...bullishBase(), candle(3, 104, 104.5, 103, 104), candle(4, 99, 99.5, 98, 98.5)],
      [...bullishBase(), candle(3, 104, 104.5, 103, 104), candle(4, 103, 103.2, 99.5, 101)],
    ];
    for (const candles of edgeFixtures) {
      const optimized = evaluate(candles);
      const reference = referenceEvaluate(candles, [FVG]);
      expect(optimized.fairValueGaps).toEqual(reference.fairValueGaps);
      expect(mapToSorted(optimized.retestsByIndex)).toEqual(mapToSorted(reference.retestsByIndex));
      expect(mapToSorted(optimized.insideByIndex)).toEqual(mapToSorted(reference.insideByIndex));
    }
  });

  it('stays far under the 15-second guard on 105,120 candles with ~105,118 persistent adversarial zones', () => {
    // Permanent gap-up staircase: every candle confirms a new bullish zone and
    // price never returns, so a naive active-list scan degrades to
    // O(candles × zones) (~74.6 s measured) while the heap indexes stay O(1)
    // per bar outside zone creation.
    const count = 105_120;
    const candles: LabCandle[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      candles[i] = candle(i, 10 * i + 0.2, 10 * i + 1, 10 * i, 10 * i + 0.8);
    }
    const started = performance.now();
    const result = evaluate(candles);
    const elapsedMs = performance.now() - started;

    expect(result.fairValueGaps).toHaveLength(count - 2);
    expect(result.fairValueGaps.every((zone) => zone.state === 'ACTIVE')).toBe(true);
    expect(result.retestsByIndex.size).toBe(0);
    expect(result.insideByIndex.size).toBe(0);
    expect(elapsedMs).toBeLessThan(15_000);

    // Determinism: a second run yields identical output.
    const again = evaluate(candles);
    expect(again.fairValueGaps.map((zone) => zone.id)).toEqual(result.fairValueGaps.map((zone) => zone.id));
  });
});
