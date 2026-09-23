import { describe, expect, it } from 'vitest';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import type { OHLCV } from '@/types/market';

/**
 * P0 regression: `calculateVolumeProfile` used to spin forever on gapped volume
 * distributions, which froze the Chrome renderer thread when a timeframe switch
 * recomputed indicators on the newly fetched candles.
 *
 * The value-area loop compared `upVol >= downVol` using 0 for an exhausted side.
 * Once `upIdx` passed the last bucket, an EMPTY bucket below the POC made the
 * comparison `0 >= 0`, so the loop kept incrementing the exhausted `upIdx`
 * while `downIdx >= 0` remained true — an unbounded synchronous loop.
 *
 * Every test here is wall-clock bounded: a re-introduced hang fails the suite
 * (or trips the runner timeout) instead of silently passing.
 */

/**
 * Builds candles whose typical prices produce:
 *   bucket 23 (top)  -> the POC, small volume
 *   bucket 22        -> EMPTY (the price gap that triggered the hang)
 *   buckets 0..21    -> the bulk of the volume, unreachable past the gap
 */
function gappedCandles(): OHLCV[] {
  const rows: OHLCV[] = [];
  let time = 1_700_000_000;
  const push = (price: number, volume: number) => {
    time += 900;
    rows.push({ time, open: price, high: price, low: price, close: price, volume });
  };
  // Establishes the full 1..100 range => bucketSize = 99/24 = 4.125.
  rows.push({ time, open: 50, high: 100, low: 1, close: 50, volume: 0 });
  for (let i = 0; i < 2; i += 1) push(98, 5); // bucket 23 => POC (volume 10)
  for (let i = 0; i <= 21; i += 1) push(1 + 4.125 * i + 2, 5); // buckets 0..21
  return rows; // bucket 22 intentionally left empty
}

describe('IndicatorEngine.calculateVolumeProfile — termination (P0 renderer hang)', () => {
  it('terminates on a gapped distribution where the POC sits above an empty bucket', () => {
    const started = Date.now();
    const profile = IndicatorEngine.calculateVolumeProfile(gappedCandles());

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(Number.isFinite(profile.poc)).toBe(true);
    expect(Number.isFinite(profile.vah)).toBe(true);
    expect(Number.isFinite(profile.val)).toBe(true);
    expect(profile.val).toBeLessThanOrEqual(profile.vah);
    expect(profile.levels).toHaveLength(24);
  });

  it('terminates for every possible POC position with an adjacent empty bucket', () => {
    const started = Date.now();
    // Sweep the gap across the whole range: each iteration is a distribution that
    // could strand one cursor. All of them must terminate.
    for (let gap = 1; gap < 23; gap += 1) {
      const rows: OHLCV[] = [];
      let time = 1_700_000_000;
      rows.push({ time, open: 50, high: 100, low: 1, close: 50, volume: 0 });
      for (let bucket = 0; bucket < 24; bucket += 1) {
        if (bucket === gap) continue; // leave this bucket empty
        time += 900;
        const price = 1 + 4.125 * bucket + 2;
        rows.push({ time, open: price, high: price, low: price, close: price, volume: bucket === 23 ? 50 : 1 });
      }
      const profile = IndicatorEngine.calculateVolumeProfile(rows);
      expect(profile.levels).toHaveLength(24);
      expect(profile.val).toBeLessThanOrEqual(profile.vah);
    }
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('terminates when only a single bucket carries volume', () => {
    const started = Date.now();
    const rows: OHLCV[] = [
      { time: 1_700_000_000, open: 50, high: 100, low: 1, close: 50, volume: 0 },
      { time: 1_700_000_900, open: 98, high: 98, low: 98, close: 98, volume: 25 },
    ];
    const profile = IndicatorEngine.calculateVolumeProfile(rows);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(profile.val).toBeLessThanOrEqual(profile.vah);
  });

  it('still computes a correct value area on a normal distribution', () => {
    const rows: OHLCV[] = [];
    let time = 1_700_000_000;
    rows.push({ time, open: 50, high: 100, low: 1, close: 50, volume: 0 });
    // Volume concentrated in the middle buckets.
    for (let bucket = 0; bucket < 24; bucket += 1) {
      time += 900;
      const price = 1 + 4.125 * bucket + 2;
      const volume = 100 - Math.abs(12 - bucket) * 8;
      rows.push({ time, open: price, high: price, low: price, close: price, volume: Math.max(1, volume) });
    }
    const profile = IndicatorEngine.calculateVolumeProfile(rows);
    expect(profile.val).toBeLessThan(profile.poc);
    expect(profile.vah).toBeGreaterThan(profile.poc);
    // The value area must cover at least 70% of traded volume.
    const total = profile.levels.reduce((sum, level) => sum + level.volume, 0);
    const inside = profile.levels
      .filter((level) => level.price >= profile.val && level.price <= profile.vah)
      .reduce((sum, level) => sum + level.volume, 0);
    expect(inside / total).toBeGreaterThanOrEqual(0.7);
  });

  it('computeCompleteIndicators stays bounded on gapped candles', () => {
    const started = Date.now();
    const result = IndicatorEngine.computeCompleteIndicators(gappedCandles());
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.volumeProfile).toBeDefined();
  });
});
