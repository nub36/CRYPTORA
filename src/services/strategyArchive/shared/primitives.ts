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

/* ------------------------------------------------------------------ */
/* Additional frozen primitives used by V3.1+ (same source files/hashes) */
/* ------------------------------------------------------------------ */

/**
 * EMA aligned to `values`; null until the seed bar (SMA of the first `period`).
 * Ported verbatim from src/strategy/v2/indicators.ts `emaSeries`.
 */
export function emaSeries(values: readonly number[], period: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period < 1 || n < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i] ?? 0;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (values[i] ?? 0) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export type StructureBias = 'BULLISH' | 'BEARISH' | 'RANGE';

/** Swings confirmed at or before `atIndex` (src/strategy/v2/structure.ts `knownSwings`). */
export function knownSwings(swings: readonly ArchiveSwing[], atIndex: number): ArchiveSwing[] {
  return swings.filter((s) => s.confirmedIndex <= atIndex);
}

/** HH+HL → BULLISH, LH+LL → BEARISH, else RANGE (structure.ts `structureBias`). */
export function structureBias(swings: readonly ArchiveSwing[], atIndex: number): StructureBias {
  const known = knownSwings(swings, atIndex);
  const highs = known.filter((s) => s.kind === 'HIGH').slice(-2);
  const lows = known.filter((s) => s.kind === 'LOW').slice(-2);
  if (highs.length < 2 || lows.length < 2) return 'RANGE';
  const hh = highs[1]!.price > highs[0]!.price;
  const hl = lows[1]!.price > lows[0]!.price;
  const lh = highs[1]!.price < highs[0]!.price;
  const ll = lows[1]!.price < lows[0]!.price;
  if (hh && hl) return 'BULLISH';
  if (lh && ll) return 'BEARISH';
  return 'RANGE';
}

export interface ArchiveStructureBreak {
  type: 'BOS' | 'CHOCH';
  direction: 'LONG' | 'SHORT';
  index: number;
  time: number;
  level: number;
  levelIndex: number;
  penetrationAtr: number;
  wickPenetrationAtr: number;
  wickOnly: boolean;
}

/**
 * Structure break at `index`: CLOSE beyond the most recent swing confirmed strictly
 * BEFORE the bar. A wick through the level is returned with wickOnly=true and is NOT
 * a break. Ported verbatim from structure.ts `detectStructureBreak` (reason string dropped).
 */
export function detectStructureBreak(
  candles: readonly ArchiveCandle[],
  swings: readonly ArchiveSwing[],
  index: number,
  atr: number | null,
  minPenetrationAtr: number,
): ArchiveStructureBreak | null {
  const bar = candles[index];
  if (!bar || atr === null || atr <= 0) return null;
  const known = knownSwings(swings, index - 1);
  const priorBias = structureBias(swings, index - 1);
  const lastHigh = [...known].reverse().find((s) => s.kind === 'HIGH');
  const lastLow = [...known].reverse().find((s) => s.kind === 'LOW');

  const mk = (direction: 'LONG' | 'SHORT', level: number, levelIndex: number): ArchiveStructureBreak => {
    const closeBeyond = direction === 'LONG' ? bar.close - level : level - bar.close;
    const wickBeyond = direction === 'LONG' ? bar.high - level : level - bar.low;
    const wickOnly = closeBeyond <= 0 && wickBeyond > 0;
    const continues =
      (direction === 'LONG' && priorBias === 'BULLISH') ||
      (direction === 'SHORT' && priorBias === 'BEARISH');
    return {
      type: continues ? 'BOS' : 'CHOCH',
      direction, index, time: bar.openTime, level, levelIndex,
      penetrationAtr: closeBeyond / atr,
      wickPenetrationAtr: wickBeyond / atr,
      wickOnly,
    };
  };

  if (lastHigh && bar.high > lastHigh.price) {
    const br = mk('LONG', lastHigh.price, lastHigh.index);
    if (!br.wickOnly && br.penetrationAtr >= minPenetrationAtr) return br;
    return br.wickOnly ? br : null;
  }
  if (lastLow && bar.low < lastLow.price) {
    const br = mk('SHORT', lastLow.price, lastLow.index);
    if (!br.wickOnly && br.penetrationAtr >= minPenetrationAtr) return br;
    return br.wickOnly ? br : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Frozen SMC primitives used by V3.3 (structure.ts, same hash)        */
/* ------------------------------------------------------------------ */

export interface ArchiveDisplacement {
  direction: 'LONG' | 'SHORT';
  index: number;
  time: number;
  bodyAtr: number;
  bodyRatio: number;
  closeLocation: number;
  consecutive: number;
  rvol: number;
  strength: number;
}

/** Ported verbatim from structure.ts `detectDisplacement`. */
export function detectDisplacement(
  candles: readonly ArchiveCandle[], index: number, atr: number | null, rvol: number | null, minBodyAtr: number,
): ArchiveDisplacement | null {
  const c = candles[index];
  if (!c || atr === null || atr <= 0) return null;
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range <= 0) return null;
  const bodyAtr = body / atr;
  if (bodyAtr < minBodyAtr) return null;

  const direction: 'LONG' | 'SHORT' = c.close >= c.open ? 'LONG' : 'SHORT';
  const bodyRatio = body / range;
  const closeLocation = (c.close - c.low) / range;

  let consecutive = 1;
  for (let i = index - 1; i >= 0; i--) {
    const p = candles[i];
    if (!p) break;
    const d: 'LONG' | 'SHORT' = p.close >= p.open ? 'LONG' : 'SHORT';
    if (d !== direction) break;
    consecutive++;
    if (consecutive >= 5) break;
  }

  const locScore = direction === 'LONG' ? closeLocation : 1 - closeLocation;
  const rvolScore = rvol === null ? 0.5 : Math.max(0, Math.min(1, (rvol - 0.8) / 1.2));
  const strength = Math.max(0, Math.min(1,
    Math.min(1, bodyAtr / 2) * 0.4 + bodyRatio * 0.25 + locScore * 0.2 + rvolScore * 0.15));

  return { direction, index, time: c.openTime, bodyAtr, bodyRatio, closeLocation, consecutive, rvol: rvol ?? 0, strength };
}

export type ArchiveObState = 'FRESH' | 'TOUCHED' | 'MITIGATED' | 'INVALIDATED';
export interface ArchiveOrderBlock {
  direction: 'LONG' | 'SHORT';
  high: number;
  low: number;
  index: number;
  time: number;
  knownAtIndex: number;
  state: ArchiveObState;
  stateIndex: number;
  displacementStrength: number;
  origin: 'BOS' | 'CHOCH' | 'SWEEP_REACTION';
  timeframe: ArchiveTimeframe;
}

/** Ported verbatim from structure.ts `buildOrderBlock` (last opposite candle within 5 bars before the displacement). */
export function buildOrderBlock(
  candles: readonly ArchiveCandle[], displacement: ArchiveDisplacement, origin: ArchiveOrderBlock['origin'],
  evalIndex: number, timeframe: ArchiveTimeframe,
): ArchiveOrderBlock | null {
  const want: 'LONG' | 'SHORT' = displacement.direction === 'LONG' ? 'SHORT' : 'LONG';
  let originIdx = -1;
  for (let i = displacement.index - 1; i >= Math.max(0, displacement.index - 5); i--) {
    const c = candles[i];
    if (!c) break;
    const d: 'LONG' | 'SHORT' = c.close >= c.open ? 'LONG' : 'SHORT';
    if (d === want) { originIdx = i; break; }
  }
  if (originIdx < 0) return null;
  const oc = candles[originIdx]!;
  const ob: ArchiveOrderBlock = {
    direction: displacement.direction, high: oc.high, low: oc.low, index: originIdx, time: oc.openTime,
    knownAtIndex: displacement.index, state: 'FRESH', stateIndex: displacement.index,
    displacementStrength: displacement.strength, origin, timeframe,
  };
  const mid = (ob.high + ob.low) / 2;
  for (let i = displacement.index + 1; i <= evalIndex; i++) {
    const c = candles[i];
    if (!c) break;
    const touched = c.low <= ob.high && c.high >= ob.low;
    if (touched && ob.state === 'FRESH') { ob.state = 'TOUCHED'; ob.stateIndex = i; }
    const throughMid = ob.direction === 'LONG' ? c.low <= mid : c.high >= mid;
    if (touched && throughMid && ob.state !== 'INVALIDATED') { ob.state = 'MITIGATED'; ob.stateIndex = i; }
    const invalid = ob.direction === 'LONG' ? c.close < ob.low : c.close > ob.high;
    if (invalid) { ob.state = 'INVALIDATED'; ob.stateIndex = i; break; }
  }
  return ob;
}

export interface ArchiveFvg {
  direction: 'LONG' | 'SHORT';
  top: number;
  bottom: number;
  size: number;
  sizeAtr: number;
  index: number;
  time: number;
  knownAtIndex: number;
  state: 'FRESH' | 'PARTIAL' | 'FILLED';
  filledFraction: number;
  timeframe: ArchiveTimeframe;
}

/** Ported verbatim from structure.ts `findFvg` (3-bar imbalance, known once bar i+1 closed). */
export function findFvg(
  candles: readonly ArchiveCandle[], index: number, atr: number | null, evalIndex: number,
  timeframe: ArchiveTimeframe, minSizeAtr: number,
): ArchiveFvg | null {
  const a = candles[index - 1];
  const b = candles[index];
  const c = candles[index + 1];
  if (!a || !b || !c || atr === null || atr <= 0) return null;
  if (index + 1 > evalIndex) return null;

  let direction: 'LONG' | 'SHORT';
  let top: number;
  let bottom: number;
  if (c.low > a.high) { direction = 'LONG'; bottom = a.high; top = c.low; }
  else if (c.high < a.low) { direction = 'SHORT'; bottom = c.high; top = a.low; }
  else return null;

  const size = top - bottom;
  const sizeAtr = size / atr;
  if (sizeAtr < minSizeAtr) return null;

  const fvg: ArchiveFvg = {
    direction, top, bottom, size, sizeAtr, index, time: b.openTime, knownAtIndex: index + 1,
    state: 'FRESH', filledFraction: 0, timeframe,
  };
  for (let i = index + 2; i <= evalIndex; i++) {
    const k = candles[i];
    if (!k) break;
    const overlapLow = Math.max(bottom, k.low);
    const overlapHigh = Math.min(top, k.high);
    if (overlapHigh > overlapLow) {
      const frac = (overlapHigh - overlapLow) / size;
      fvg.filledFraction = Math.max(fvg.filledFraction, Math.min(1, frac));
    }
    const fullyThrough = direction === 'LONG' ? k.low <= bottom : k.high >= top;
    if (fullyThrough) { fvg.filledFraction = 1; fvg.state = 'FILLED'; break; }
  }
  if (fvg.state !== 'FILLED') fvg.state = fvg.filledFraction > 0.05 ? 'PARTIAL' : 'FRESH';
  return fvg;
}
