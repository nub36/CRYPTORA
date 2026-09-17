/**
 * V3.0 — HTF LIQUIDATION TRAP — pure strategy core.
 *
 * Ported from svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18
 *   research/v30_htf_trap.ts  sha256 a821757ff0319a100a8a9087da1bdd137abb1df0785493d644ad4d87f05dc4cd
 *   research/v30_validate.ts  sha256 b6d582eca49dd5a1e8a09c5c1c899b45548329776cdd29f2abc1827a6704a28b
 * Pre-registration commit 6c2bf9e · TRAIN 5674e65 · freeze 21feabe · VALIDATION 3278087.
 *
 * DO NOT EDIT the rules. This file reproduces the ACTUAL research runner,
 * including its documented divergence from the spec (overlapping positions —
 * see `V30_DISCREPANCIES` in definition.ts). Fixing that here would falsify the
 * historical record; a corrected variant must be a NEW definition.
 *
 * Constants below are the frozen, pre-registered candidate (never swept).
 */

import type { ArchiveCandle, ArchiveDirection, ArchiveTimeframe } from '../../types';
import { closedHtfCandles, findSwingsV2 } from '../../shared/primitives';

export const V30_CONSTANTS = Object.freeze({
  MIN_BODY_RATIO: 0.35,
  MIN_RVOL: 1.25,            // strict `>`; deliberately different from V2.x's 1.2
  CORRIDOR_ATR_FRAC: 0.10,
  CORRIDOR_EXPIRY_BARS: 3,
  STOP_BUFFER_ATR: 0.15,
  TIMEOUT_BARS: 50,
  MAKER_BPS: 2,
  TAKER_BPS: 5,
  STRESS_MAKER_BPS: 5,
  STRESS_TAKER_BPS: 5,
  EXEC_TF: '1h' as ArchiveTimeframe,
  STRUCT_TF: '4h' as ArchiveTimeframe,
  /** research runner: `for (let i = 60; ...)` */
  WARMUP_BARS: 60,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

export type V30ExitReason =
  | 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT';

export interface TrapLevels {
  swingHigh: number | null;
  swingLow: number | null;
}

/**
 * Most recent CONFIRMED 4H swing high/low as of `asOfCloseTime`.
 * Two causality filters: only 4H bars closed by the 1H bar's close time, and
 * within those a pivot counts only from `confirmedIndex` onward.
 */
export function confirmedLevels(
  htf4h: readonly ArchiveCandle[], asOfCloseTime: number, strength: number,
): TrapLevels {
  const usable = closedHtfCandles(htf4h, V30_CONSTANTS.STRUCT_TF, asOfCloseTime);
  if (usable.length < strength * 2 + 2) return { swingHigh: null, swingLow: null };
  const swings = findSwingsV2(usable, strength);
  const lastIdx = usable.length - 1;
  let swingHigh: number | null = null;
  let swingLow: number | null = null;
  for (const s of swings) {
    if (s.confirmedIndex > lastIdx) continue;   // right-bars not yet printed
    if (s.kind === 'HIGH') swingHigh = s.price;
    else swingLow = s.price;
  }
  return { swingHigh, swingLow };
}

export interface TrapSignal {
  direction: ArchiveDirection;
  level: number;
  sweepExtreme: number;
  bodyRatio: number;
  rvol: number;
}

export function bodyRatio(c: ArchiveCandle): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0;
  return Math.abs(c.close - c.open) / range;
}

/** SHORT: pierces a 4H swing HIGH and closes back below. LONG: mirror. Same bar. */
export function detectTrap(
  c: ArchiveCandle, levels: TrapLevels, rvol: number | null,
): TrapSignal | null {
  const br = bodyRatio(c);
  if (br < V30_CONSTANTS.MIN_BODY_RATIO) return null;
  if (rvol === null || !(rvol > V30_CONSTANTS.MIN_RVOL)) return null;

  if (levels.swingHigh !== null
    && c.high > levels.swingHigh && c.close < levels.swingHigh) {
    return { direction: 'SHORT', level: levels.swingHigh, sweepExtreme: c.high, bodyRatio: br, rvol };
  }
  if (levels.swingLow !== null
    && c.low < levels.swingLow && c.close > levels.swingLow) {
    return { direction: 'LONG', level: levels.swingLow, sweepExtreme: c.low, bodyRatio: br, rvol };
  }
  return null;
}

/** Per-leg fee in R, charged on that leg's own notional. No rebate. */
export function legFeeR(price: number, weight: number, bps: number, risk: number): number {
  if (!(risk > 0)) return 0;
  return (bps / 10000) * price * weight / risk;
}

export interface V30TradeResult {
  exit: V30ExitReason;
  grossR: number;
  feeR: (makerBps: number, takerBps: number) => number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
}

/**
 * Manage one filled position. Intrabar rules (pre-registered):
 *   R1 stop checked BEFORE targets on every bar;
 *   R2 TP1 books before TP2 when both land on one bar;
 *   R3 breakeven arms only on bars strictly AFTER the TP1 bar;
 *   R4 the stop never moves backwards;
 *   R5 timeout counts the entry bar as bar 1.
 */
export function manageTrade(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V30TradeResult | null {
  const { TIMEOUT_BARS } = V30_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  const stop = stop0;
  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [];
  legs.push({ price: entry, weight: 1, taker: false });   // maker entry

  const finish = (exit: V30ExitReason, exitPrice: number, weight: number, i: number): V30TradeResult => {
    legs.push({ price: exitPrice, weight, taker: true });
    const gross = realised + weight * rOf(exitPrice);
    return {
      exit, grossR: gross, barsHeld: i + 1, hitTp1, hitTp2: exit === 'TP2',
      feeR: (mk, tk) => legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? tk : mk, risk), 0),
    };
  };

  for (let i = 0; i < bars.length && i < TIMEOUT_BARS; i++) {
    const c = bars[i]!;
    const beArmed = hitTp1 && tp1Bar >= 0 && i > tp1Bar;   // R3
    const stopNow = beArmed ? entry : stop;                 // R4: BE is never worse than stop0

    const hitStop = long ? c.low <= stopNow : c.high >= stopNow;
    const hitT1 = !hitTp1 && (long ? c.high >= tp1 : c.low <= tp1);
    const hitT2 = long ? c.high >= tp2 : c.low <= tp2;

    // R1: stop first, always.
    if (hitStop) {
      if (!hitTp1) return finish('SL', stopNow, 1, i);
      return finish(beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', stopNow, 0.5, i);
    }

    if (hitT1) {
      hitTp1 = true; tp1Bar = i;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      // R2: TP1 books first, then TP2 may close the remainder on the same bar.
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
  return null;   // unresolved at the dataset boundary
}

export interface V30Pending {
  dir: ArchiveDirection;
  zoneLow: number;
  zoneHigh: number;
  stop: number;
  tp1: number;
  tp2: number;
  setupIndex: number;
}

export type CorridorStep =
  | { kind: 'WAIT' }
  | { kind: 'CANCELLED' }
  | { kind: 'EXPIRED' }
  | { kind: 'REJECTED_GEOMETRY' }
  | { kind: 'FILLED'; fill: number; risk: number };

/**
 * Advance a pending corridor on bar `c` (which must be at index setupIndex+1
 * or later — the runner never calls this on the reclaim bar itself).
 * Fill at the WORSE edge; ambiguous fill+stop → CANCELLED.
 */
export function corridorStep(p: V30Pending, c: ArchiveCandle, barIndex: number): CorridorStep {
  const long = p.dir === 'LONG';
  const waited = barIndex - p.setupIndex;
  const touches = long ? c.low <= p.zoneHigh : c.high >= p.zoneLow;
  const hitStop = long ? c.low <= p.stop : c.high >= p.stop;

  if (touches && hitStop) return { kind: 'CANCELLED' };
  if (touches) {
    const fill = long ? Math.min(c.open, p.zoneHigh) : Math.max(c.open, p.zoneLow);
    const risk = Math.abs(fill - p.stop);
    const geomOk = risk > 0
      && (long ? p.stop < fill : p.stop > fill)
      && (long ? p.tp1 > fill && p.tp2 > p.tp1 : p.tp1 < fill && p.tp2 < p.tp1);
    if (!geomOk) return { kind: 'REJECTED_GEOMETRY' };
    return { kind: 'FILLED', fill, risk };
  }
  if (hitStop) return { kind: 'CANCELLED' };
  if (waited >= V30_CONSTANTS.CORRIDOR_EXPIRY_BARS) return { kind: 'EXPIRED' };
  return { kind: 'WAIT' };
}

/** Build the pending corridor from a detected trap on closed 1H bar `c`. */
export function buildPending(
  sig: TrapSignal, c: ArchiveCandle, levels: { swingHigh: number; swingLow: number },
  atr: number, setupIndex: number,
): V30Pending {
  const long = sig.direction === 'LONG';
  const half = V30_CONSTANTS.CORRIDOR_ATR_FRAC * atr;
  const eq = (levels.swingHigh + levels.swingLow) / 2;   // 4H equilibrium
  const stop = long
    ? sig.sweepExtreme - V30_CONSTANTS.STOP_BUFFER_ATR * atr
    : sig.sweepExtreme + V30_CONSTANTS.STOP_BUFFER_ATR * atr;
  const tp2 = long ? levels.swingHigh : levels.swingLow;  // opposing swing
  return {
    dir: sig.direction,
    zoneLow: c.close - half, zoneHigh: c.close + half,
    stop, tp1: eq, tp2, setupIndex,
  };
}
