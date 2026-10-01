import { describe, expect, it } from 'vitest';
import { compileResearchDraft } from '@/services/strategyLab/draft/compile';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
import { mapFractalMarkers } from '@/services/strategyLab/labChartProjection';
import type { LabCandle, StrategyDraftDefinition } from '@/services/strategyLab/types';

const candles: LabCandle[] = Array.from({ length: 18 }, (_, i) => ({
  time: 1_000 + i * 60, closeTime: 1_059 + i * 60,
  open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i, volume: 1,
}));
// Strict low fractal at index 5; it becomes known only at index 7.
candles[5] = { ...candles[5], low: 80, high: 110 };
candles[3] = { ...candles[3], low: 90 }; candles[4] = { ...candles[4], low: 88 };
candles[6] = { ...candles[6], low: 89 }; candles[7] = { ...candles[7], low: 91 };

const definition: StrategyDraftDefinition = {
  name: 'Fractal acceptance fixture',
  indicators: [
    { id: 'fractal-main', type: 'FRACTALS', name: 'Fractals', period: 5, visible: true },
    { id: 'atr-main', type: 'ATR', period: 3, visible: false },
  ],
  long: { kind: 'fractal', left: 'fractal-main', right: 'fractal-main', indicatorId: 'fractal-main', operator: 'fractalLow' },
  short: { kind: 'fractal', left: 'fractal-main', right: 'fractal-main', indicatorId: 'fractal-main', operator: 'fractalHigh' },
  stop: { type: 'atrMultiple', indicatorId: 'atr-main', multiplier: 1 },
  target: { type: 'rMultiple', multiple: 1 },
  execution: { feeBps: 0, slippageBps: 0 },
};

describe('Strategy Lab final RSI and Fractals acceptance', () => {
  it('compiles threshold and fractal DSL through the canonical compiler', () => {
    const draft = {
      name: 'RSI draft', apiVersion: 2 as const,
      indicators: [{ id: 'rsi-main', type: 'RSI' as const, period: 14, source: 'close' as const }, { id: 'atr-main', type: 'ATR' as const, period: 3 }],
      sourceCode: 'strategy("RSI", () => { LONG(below(RSI_MAIN, 30)); SHORT(above(RSI_MAIN, 70)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });',
      execution: { feeBps: 0, slippageBps: 0 },
    };
    expect(compileResearchDraft(draft).ok).toBe(true);
    const invalid = { ...draft, sourceCode: 'strategy("bad", () => { LONG(above(ATR_MAIN, 70)); SHORT(above(ATR_MAIN, 30)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });' };
    expect(compileResearchDraft(invalid).ok).toBe(false);
  });

  it('exposes confirmed Fractal metadata and evaluates only at confirmation', () => {
    const result = evaluateDraftStrategy(candles, definition);
    const event = result.indicators.fractalEvents?.find((e) => e.kind === 'LOW' && e.sourceIndex === 5);
    expect(event).toMatchObject({ sourceIndex: 5, confirmationIndex: 7, sourceCandleTime: candles[5].time, knownAt: candles[7].closeTime });
    expect(event!.knownAt).toBeGreaterThan(event!.sourceCandleTime);
    expect(result.events.some((e) => e.candleTime === candles[5].time)).toBe(false);
  });

  it('keeps Fractal chart markers on the source candle and filters visibility', () => {
    const result = evaluateDraftStrategy(candles, definition);
    const on = mapFractalMarkers({ ...result, candles });
    expect(on.some((m) => m.time === candles[5].time && m.position === 'belowBar')).toBe(true);
    expect(on.every((m) => m.time !== candles[7].time || m.time === candles[5].time)).toBe(true);
    const off = mapFractalMarkers({ ...result, candles, indicators: { ...result.indicators, indicatorsList: result.indicators.indicatorsList?.map((i) => ({ ...i, visible: false })) } });
    expect(off).toHaveLength(0);
  });

  it('preserves trading semantics when only visibility changes', () => {
    const hidden = evaluateDraftStrategy(candles, { ...definition, indicators: definition.indicators.map((i) => ({ ...i, visible: false })) });
    const shown = evaluateDraftStrategy(candles, definition);
    expect(shown.trades).toEqual(hidden.trades);
    expect(shown.rejections).toEqual(hidden.rejections);
    expect(shown.candidateCount).toBe(hidden.candidateCount);
  });
});
