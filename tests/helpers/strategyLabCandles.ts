import type { LabCandle } from '@/services/strategyLab/types';

export const STRATEGY_LAB_FIXTURE_FROM_MS = Date.parse('2025-01-01T00:00:00.000Z');
export const STRATEGY_LAB_FIXTURE_INTERVAL_MS = 60 * 60_000;
export const STRATEGY_LAB_FIXTURE_BARS = 240;
export const STRATEGY_LAB_FIXTURE_TO_MS =
  STRATEGY_LAB_FIXTURE_FROM_MS + STRATEGY_LAB_FIXTURE_BARS * STRATEGY_LAB_FIXTURE_INTERVAL_MS;

/**
 * Fixed, oscillating OHLCV data for real Strategy Lab replay tests. The series
 * is long enough for EMA/ATR/RSI warmup and for later confirmed-fractal timing
 * coverage. It deliberately contains no clock, random, network, or filesystem
 * dependency.
 */
export function deterministicStrategyLabCandles(): LabCandle[] {
  return Array.from({ length: STRATEGY_LAB_FIXTURE_BARS }, (_, index) => {
    const trend = index * 0.025;
    const close = 100 + trend + 8 * Math.sin(index / 7) + 2 * Math.sin(index / 2.5);
    const open = close - 0.6 * Math.sin(index / 3);
    const time = Math.floor(STRATEGY_LAB_FIXTURE_FROM_MS / 1000) + index * 3600;
    return {
      time,
      closeTime: time + 3599,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1_000 + index,
    };
  });
}

export const FRACTAL_FIXTURE_BARS = 48;
export const FRACTAL_CENTER_INDEX = 30;
export const FRACTAL_CONFIRMATION_INDEX = FRACTAL_CENTER_INDEX + 2;
export const FRACTAL_FILL_INDEX = FRACTAL_CENTER_INDEX + 3;
export const FRACTAL_FIXTURE_TO_MS =
  STRATEGY_LAB_FIXTURE_FROM_MS + FRACTAL_FIXTURE_BARS * STRATEGY_LAB_FIXTURE_INTERVAL_MS;

/**
 * Purpose-built strict LOW Fractal fixture. Lows decline strictly into index 30
 * and rise strictly afterwards, so that center is the only LOW Fractal. Highs
 * rise monotonically, preventing an earlier opposite HIGH trigger. Fourteen-bar
 * ATR is fully warm before the confirmation and next-open execution bars.
 */
export function deterministicFractalCandles(): LabCandle[] {
  return Array.from({ length: FRACTAL_FIXTURE_BARS }, (_, index) => {
    const time = Math.floor(STRATEGY_LAB_FIXTURE_FROM_MS / 1000) + index * 3600;
    const open = 100 + index * 0.1;
    return {
      time,
      closeTime: time + 3599,
      open,
      high: 150 + index,
      low:
        index <= FRACTAL_CENTER_INDEX
          ? 90 - index * 0.2
          : 84 + (index - FRACTAL_CENTER_INDEX) * 0.3,
      close: open + 0.05,
      volume: 2_000 + index,
    };
  });
}
