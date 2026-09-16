/**
 * Frozen research primitives.
 *
 * Ported from svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18
 *   src/strategy/v2/structure.ts   sha256 e04806a33d1ebc4bab24f12f5240c7320ae8e00276157833e51534152a4e662f (findSwingsV2)
 *   src/strategy/v2/indicators.ts  sha256 10594cadf615b0e048797e1db9504648794b0cbec41b62da6ec55641d1daa55c (trueRanges, atrSeriesV2, buildAtrContext.atr, buildVolumeContext.rvol)
 *   src/strategy/v2/htf.ts         sha256 b175efade6feb8069e5564502931585bf09ef371ad181813758422e774fe88f0 (closedHtfCandles)
 *   scripts/real-data/audit-fee-readonly.ts (quantileSorted)
 * These files belong to the frozen engine commit 4839074 (byte-identical at SOURCE_HEAD).
 *
 * DO NOT EDIT — immutable archive semantics. Only import paths / type names changed.
 */

import { ARCHIVE_TF_MS, type ArchiveCandle, type ArchiveTimeframe } from '../types';

export type SwingKind = 'HIGH' | 'LOW';
export interface ArchiveSwing {
  kind: SwingKind;
  index: number;
  /** The pivot is knowable only from this bar onward (index + strength). */
  confirmedIndex: number;
  time: number;
  price: number;
  label: 'FIRST' | 'HH' | 'LH' | 'HL' | 'LL';
}

/**
 * Fractal pivots. A high at i is a pivot when it is the strict maximum of
 * [i-s, i+s]. Confirmed at i+s — never before.
 */
export function findSwingsV2(candles: readonly ArchiveCandle[], strength: number): ArchiveSwing[] {
  const s = Math.max(1, Math.floor(strength));
  const raw: Omit<ArchiveSwing, 'label'>[] = [];
  for (let i = s; i < candles.length - s; i++) {
    const c = candles[i];
    if (!c) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - s; j <= i + s; j++) {
      if (j === i) continue;
      const o = candles[j];
      if (!o) continue;
      if (o.high >= c.high) isHigh = false;
      if (o.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      raw.push({ kind: 'HIGH', index: i, confirmedIndex: i + s, time: c.openTime, price: c.high });
    }
    if (isLow) {
      raw.push({ kind: 'LOW', index: i, confirmedIndex: i + s, time: c.openTime, price: c.low });
    }
  }
  raw.sort((a, b) => a.index - b.index);

  const out: ArchiveSwing[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (const r of raw) {
    let label: ArchiveSwing['label'] = 'FIRST';
    if (r.kind === 'HIGH') {
      if (lastHigh !== null) label = r.price > lastHigh ? 'HH' : 'LH';
      lastHigh = r.price;
    } else {
      if (lastLow !== null) label = r.price > lastLow ? 'HL' : 'LL';
      lastLow = r.price;
    }
    out.push({ ...r, label });
  }
  return out;
}

/** Wilder true ranges. */
export function trueRanges(candles: readonly ArchiveCandle[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (i === 0) {
      out.push(c.high - c.low);
      continue;
    }
    const pc = candles[i - 1]!.close;
    out.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  return out;
}

/** Wilder ATR: seed = SMA(TR, p), then ATR[t] = (ATR[t-1]*(p-1) + TR[t]) / p. */
export function atrSeriesV2(candles: readonly ArchiveCandle[], period: number): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period < 1 || n < period) return out;
  const tr = trueRanges(candles);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i] ?? 0;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + (tr[i] ?? 0)) / period;
    out[i] = prev;
  }
  return out;
}

/** ATR value at `index`, computed only from candles[0..index] (as buildAtrContext did). */
export function atrAt(candles: readonly ArchiveCandle[], index: number, period: number): number | null {
  const series = atrSeriesV2(candles.slice(0, index + 1), period);
  return series[index] ?? null;
}

/**
 * RVOL = volume[t] / mean(volume[t-period .. t-1]); the average EXCLUDES the
 * current bar. `null` when fewer than `period` prior bars exist or avg is 0.
 */
export function rvolAt(candles: readonly ArchiveCandle[], index: number, period = 20): number | null {
  const cur = candles[index];
  const volume = cur?.volume ?? 0;
  const start = index - period;
  if (start < 0) return null;
  const win: number[] = [];
  for (let i = start; i < index; i++) win.push(candles[i]?.volume ?? 0);
  const avg = win.reduce((s, x) => s + x, 0) / win.length;
  return avg > 0 ? volume / avg : null;
}

/**
 * Candles of `htf` that had fully closed by `asOfCloseTime`.
 * A candle with openTime T closes at T + tfMs(tf); usable only when that close
 * time is <= the evaluated bar's close time.
 */
export function closedHtfCandles(
  candles: readonly ArchiveCandle[],
  htf: ArchiveTimeframe,
  asOfCloseTime: number,
): ArchiveCandle[] {
  const span = ARCHIVE_TF_MS[htf];
  return candles.filter((c) => c.isClosed && c.openTime + span <= asOfCloseTime);
}

/** Nearest-rank quantile on a pre-sorted array (Suslik convention). */
export function quantileSorted(sorted: readonly number[], f: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))));
  return sorted[i]!;
}
