/**
 * V3.1 — HTF TREND PULLBACK & MITIGATION — pure strategy logic (immutable).
 *
 * Ported verbatim from svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18
 *   research/v31_trend_pullback.ts  sha256 1f18bb3ce45bbc94d79f48181fde7ad9550731e5c031ac0bd54662b6804a3bc7
 * Only imports / type names differ. DO NOT EDIT — historical semantics.
 *
 * RESEARCH VERDICT (source): V3_1_FALSIFIED_ON_TRAIN — net −0.1097 R/trade @2/5 bps, n=158,
 * gross already negative (−0.0838). This module exists to REPRODUCE that negative
 * result, not to improve it. CRYPTORA does not execute trades.
 */

import type { ArchiveCandle, ArchiveDirection } from '../../types';
import type { ArchiveSwing } from '../../shared/primitives';

/* ---------------- preregistered constants (NOT swept) ---------------- */

export const V31_CONSTANTS = Object.freeze({
  EMA_FAST: 50,
  EMA_SLOW: 200,
  MIN_BODY_RATIO: 0.35,
  MIN_RVOL: 1.25,              // strictly greater, as in V3.0
  CORRIDOR_ATR_FRAC: 0.10,
  /** The specification is silent; V3.0's frozen value is inherited deliberately. */
  CORRIDOR_EXPIRY_BARS: 3,
  STOP_BUFFER_ATR: 0.15,
  TP2_FIB_EXT: 1.5,
  TIMEOUT_BARS: 60,
  MAKER_BPS: 2,
  TAKER_BPS: 5,
  STRESS_MAKER_BPS: 5,
  STRESS_TAKER_BPS: 5,
  /** Bars skipped at the start of each series, inside TRAIN, before evaluation. */
  WARMUP_BARS: 60,
  EXEC_TF: '1h' as const,
  STRUCT_TF: '4h' as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

export type V31PullbackMode = 'leg' | 'same-bar';
export type PullbackSource = 'EQ' | 'FVG' | 'EQ+FVG';
export type V31ExitReason = 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT';

/** Body / full range of a candle, 0 when the range is degenerate. */
export function bodyRatio(c: ArchiveCandle): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0;
  return Math.abs(c.close - c.open) / range;
}

/* ---------------- 4H trend gate ---------------- */

export interface TrendState {
  dir: ArchiveDirection;
  legLow: number;
  legHigh: number;
}

export interface HtfGap {
  dir: ArchiveDirection;
  top: number;
  bottom: number;
  knownAt: number;
  killAt: number;
}

export interface HtfContext {
  trendByClosed: (TrendState | null)[];
  gaps: HtfGap[];
}

export interface HtfInputs {
  h4: readonly ArchiveCandle[];
  emaFast: readonly (number | null)[];
  emaSlow: readonly (number | null)[];
  swings: readonly ArchiveSwing[];
}

/**
 * `trendByClosed[k]` = what a 1H bar could know when exactly `k` 4H candles have
 * closed — uses only 4H bars with index < k and swings with confirmedIndex < k.
 */
export function buildHtfContext(inp: HtfInputs): HtfContext {
  const { h4, emaFast, emaSlow, swings } = inp;
  const { EMA_SLOW } = V31_CONSTANTS;
  const n = h4.length;
  const trendByClosed: (TrendState | null)[] = new Array(n + 1).fill(null);

  let sw = 0;
  const highs: number[] = [];
  const lowPrices: number[] = [];
  let lastHighIdx = -1;
  let lastLowIdx = -1;
  let lastHighPrice = 0;
  let lastLowPrice = 0;

  for (let k = 0; k <= n; k++) {
    const evalIdx = k - 1;
    while (sw < swings.length && swings[sw]!.confirmedIndex <= evalIdx) {
      const s = swings[sw]!;
      if (s.kind === 'HIGH') {
        highs.push(s.price);
        if (highs.length > 2) highs.shift();
        lastHighIdx = s.index;
        lastHighPrice = s.price;
      } else {
        lowPrices.push(s.price);
        if (lowPrices.length > 2) lowPrices.shift();
        lastLowIdx = s.index;
        lastLowPrice = s.price;
      }
      sw++;
    }
    if (evalIdx < EMA_SLOW - 1) continue;   // EMA200 warm-up (inside TRAIN)
    const fast = emaFast[evalIdx];
    const slow = emaSlow[evalIdx];
    if (fast === null || fast === undefined || slow === null || slow === undefined) continue;

    const bullStruct = highs.length >= 2 && lowPrices.length >= 2
      && highs[1]! > highs[0]! && lowPrices[1]! > lowPrices[0]!;
    const bearStruct = highs.length >= 2 && lowPrices.length >= 2
      && highs[1]! < highs[0]! && lowPrices[1]! < lowPrices[0]!;
    const close = h4[evalIdx]!.close;

    if (close > fast && fast > slow && bullStruct
      && lastLowIdx >= 0 && lastHighIdx > lastLowIdx && lastHighPrice > lastLowPrice) {
      trendByClosed[k] = { dir: 'LONG', legLow: lastLowPrice, legHigh: lastHighPrice };
    } else if (close < fast && fast < slow && bearStruct
      && lastHighIdx >= 0 && lastLowIdx > lastHighIdx && lastHighPrice > lastLowPrice) {
      trendByClosed[k] = { dir: 'SHORT', legLow: lastLowPrice, legHigh: lastHighPrice };
    }
  }

  // ---- FVGs: three consecutive closed 4H candles ----
  const gaps: HtfGap[] = [];
  for (let j = 1; j < n - 1; j++) {
    const a = h4[j - 1]!;
    const c = h4[j + 1]!;
    let dir: ArchiveDirection | null = null;
    let top = 0;
    let bottom = 0;
    if (c.low > a.high) { dir = 'LONG'; bottom = a.high; top = c.low; }
    else if (c.high < a.low) { dir = 'SHORT'; bottom = c.high; top = a.low; }
    if (dir === null || !(top > bottom)) continue;

    const knownAt = j + 2;
    let killAt = n + 1;
    for (let m = j + 2; m < n; m++) {
      const bar = h4[m]!;
      if (Math.max(bottom, bar.low) < Math.min(top, bar.high)) { killAt = m + 1; break; }
    }
    gaps.push({ dir, top, bottom, knownAt, killAt });
  }

  return { trendByClosed, gaps };
}

/** Gap zones live as of `closedCount`, in the given trend direction. */
export function liveGaps(ctx: HtfContext, closedCount: number, dir: ArchiveDirection): HtfGap[] {
  return ctx.gaps.filter((g) => g.dir === dir && g.knownAt <= closedCount && closedCount < g.killAt);
}

/** Does the bar's range intersect the zone? */
export function intersects(c: ArchiveCandle, top: number, bottom: number): boolean {
  return Math.max(bottom, c.low) < Math.min(top, c.high);
}

/* ---------------- fees ---------------- */

/** Per-leg fee in R, charged on that leg's own notional. No rebate. */
export function legFeeR(price: number, weight: number, bps: number, risk: number): number {
  if (!(risk > 0)) return 0;
  return (bps / 10000) * price * weight / risk;
}

/* ---------------- trade simulation ---------------- */

export interface V31TradeResult {
  exit: V31ExitReason;
  grossR: number;
  feeR: (makerBps: number, takerBps: number) => number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
}

/**
 * Manage one filled position. Intrabar rules are V3.0's frozen conventions:
 *   R1 stop checked BEFORE targets on every bar;
 *   R2 TP1 books before TP2 when both land on one bar;
 *   R3 breakeven arms only on bars strictly AFTER the TP1 bar;
 *   R4 the stop never moves backwards;
 *   R5 timeout counts the entry bar as bar 1.
 */
export function manageTrade(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V31TradeResult | null {
  const { TIMEOUT_BARS } = V31_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [];
  legs.push({ price: entry, weight: 1, taker: false });

  const finish = (exit: V31ExitReason, exitPrice: number, weight: number, i: number): V31TradeResult => {
    legs.push({ price: exitPrice, weight, taker: true });
    const gross = realised + weight * rOf(exitPrice);
    return {
      exit, grossR: gross, barsHeld: i + 1, hitTp1, hitTp2: exit === 'TP2',
      feeR: (mk, tk) => legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? tk : mk, risk), 0),
    };
  };

  for (let i = 0; i < bars.length && i < TIMEOUT_BARS; i++) {
    const c = bars[i]!;
    const beArmed = hitTp1 && tp1Bar >= 0 && i > tp1Bar;
    const stopNow = beArmed ? entry : stop0;

    const hitStop = long ? c.low <= stopNow : c.high >= stopNow;
    const hitT1 = !hitTp1 && (long ? c.high >= tp1 : c.low <= tp1);
    const hitT2 = long ? c.high >= tp2 : c.low <= tp2;

    if (hitStop) {
      if (!hitTp1) return finish('SL', stopNow, 1, i);
      return finish(beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', stopNow, 0.5, i);
    }

    if (hitT1) {
      hitTp1 = true; tp1Bar = i;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      if (hitT2) return finish('TP2', tp2, 0.5, i);
      if (i + 1 >= TIMEOUT_BARS) return finish('TP1_THEN_TIMEOUT', c.close, 0.5, i);
      continue;
    }

    if (hitTp1 && hitT2) return finish('TP2', tp2, 0.5, i);
    if (!hitTp1 && hitT2) {
      hitTp1 = true;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      return finish('TP2', tp2, 0.5, i);
    }

    if (i + 1 >= TIMEOUT_BARS) {
      return finish(hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', c.close, hitTp1 ? 0.5 : 1, i);
    }
  }
  return null;
}
