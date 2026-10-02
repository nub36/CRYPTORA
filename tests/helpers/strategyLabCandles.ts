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
