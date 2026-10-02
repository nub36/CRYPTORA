import { describe, expect, it } from 'vitest';
import { confirmedFractals, rsiAligned } from '@/services/strategyLab/indicators';

describe('Strategy Lab RSI and confirmed fractals', () => {
  it('uses Wilder warmup and handles flat, gains, losses without rounding', () => {
    expect(rsiAligned([1, 1, 1, 1], 3)).toEqual([null, null, null, 50]);
    expect(rsiAligned([1, 2, 3, 4], 3)[3]).toBe(100);
    expect(rsiAligned([4, 3, 2, 1], 3)[3]).toBe(0);
    expect(rsiAligned([1, 2, 1, 2, 1], 2)[4]).toBeCloseTo(37.5, 10);
  });

  it('requires strict five-candle Williams patterns and rejects equality', () => {
    const candles = [0, 1, 2, 3, 4, 5, 6].map((time, i) => ({ time, closeTime: time + 1, high: i === 3 ? 10 : i, low: i === 3 ? -10 : 20 - i }));
    const events = confirmedFractals(candles);
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'HIGH', sourceIndex: 3, confirmationIndex: 5, sourceCandleTime: 3, knownAt: 6, price: 10 }),
      expect.objectContaining({ kind: 'LOW', sourceIndex: 3, confirmationIndex: 5, sourceCandleTime: 3, knownAt: 6, price: -10 }),
    ]));
    const equal = candles.map((c, i) => i === 4 ? { ...c, high: 10 } : c);
    expect(confirmedFractals(equal).some((e) => e.kind === 'HIGH')).toBe(false);
  });
});
