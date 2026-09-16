/**
 * V2.5 DYNAMIC TRAILING STOP + BREAKEVEN — research exit simulator (frozen).
 *
 * Verbatim port of svechnoy-suslik-v2 `scripts/real-data/v25-trailing.ts`
 *   sha256 fe6c307ee53273edcc155e16643bfecade61a6bf3a60296325ef8491460f50fa (identical at 1d4d575 and 2d8a3dd).
 * Used by V2.5, V2.6 and V2.8 (Trail arm). Lives outside the frozen tracker on purpose (see source header).
 * DO NOT EDIT — historical semantics. Gross R only; fees are applied by the caller.
 */

import type { ArchiveCandle, ArchiveDirection } from '../../types';

export const BREAKEVEN_R = 1.0;
export const TRAIL_DISTANCE_R = 1.0;
export const TRAIL_STEP_R = 0.25;
export const TIMEOUT_BARS = 10;

export type V25ExitReason = 'TRAIL' | 'BE' | 'SL' | 'TIMEOUT';

export interface V25Input {
  direction: ArchiveDirection;
  entryPrice: number;
  stopLoss: number;
  bars: readonly ArchiveCandle[];
}

export interface V25Outcome {
  reason: V25ExitReason;
  exitPrice: number;
  barsHeld: number;
  grossR: number;
  mfeR: number;
  mfeAtExitR: number;
  maeR: number;
  reachedBreakeven: boolean;
  finalStop: number;
}

export function simulateTrailing(input: V25Input): V25Outcome | null {
  const { direction, entryPrice, stopLoss, bars } = input;
  const risk = Math.abs(entryPrice - stopLoss);
  if (!(risk > 0) || bars.length === 0) return null;

  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entryPrice : entryPrice - p) / risk;
  const priceAtR = (r: number): number => (long ? entryPrice + r * risk : entryPrice - r * risk);

  let stop = stopLoss;
  let stopR = rOf(stopLoss);
  let peakMfe = 0;
  let lastUpdateMfe = 0;
  let armed = false;
  let maxFav = -Infinity;
  let maxAdv = Infinity;

  for (let i = 0; i < bars.length; i++) {
    const c = bars[i]!;
    const favPrice = long ? c.high : c.low;
    const advPrice = long ? c.low : c.high;
    const favR = rOf(favPrice);
    const advR = rOf(advPrice);
    if (favR > maxFav) maxFav = favR;
    if (advR < maxAdv) maxAdv = advR;

    const hitStop = long ? c.low <= stop : c.high >= stop;
    if (hitStop) {
      const reason: V25ExitReason = !armed ? 'SL' : (Math.abs(stopR) < 1e-9 ? 'BE' : 'TRAIL');
      return {
        reason, exitPrice: stop, barsHeld: i + 1, grossR: rOf(stop),
        mfeR: Math.max(0, maxFav), mfeAtExitR: Math.max(0, maxFav),
        maeR: Number.isFinite(maxAdv) ? maxAdv : 0, reachedBreakeven: armed, finalStop: stop,
      };
    }

    if (favR > peakMfe) peakMfe = favR;

    if (!armed && peakMfe >= BREAKEVEN_R) {
      armed = true;
      stop = entryPrice;
      stopR = 0;
      lastUpdateMfe = peakMfe;
      const trailR = peakMfe - TRAIL_DISTANCE_R;
      if (trailR > stopR) {
        stopR = trailR;
        stop = priceAtR(trailR);
        lastUpdateMfe = peakMfe;
      }
    } else if (armed && peakMfe - lastUpdateMfe >= TRAIL_STEP_R) {
      const trailR = peakMfe - TRAIL_DISTANCE_R;
      if (trailR > stopR) {
        stopR = trailR;
        stop = priceAtR(trailR);
      }
      lastUpdateMfe = peakMfe;
    }

    if (!armed && i + 1 >= TIMEOUT_BARS) {
      return {
        reason: 'TIMEOUT', exitPrice: c.close, barsHeld: i + 1, grossR: rOf(c.close),
        mfeR: Math.max(0, maxFav), mfeAtExitR: Math.max(0, maxFav),
        maeR: Number.isFinite(maxAdv) ? maxAdv : 0, reachedBreakeven: false, finalStop: stop,
      };
    }
  }
  return null;
}

/** Per-leg fee in R: maker on entry, taker on exit. No rebate. */
export function feeR(entryPrice: number, exitPrice: number, riskPerUnit: number, makerBps: number, takerBps: number): number {
  if (!(riskPerUnit > 0)) return 0;
  return ((makerBps / 10000) * entryPrice + (takerBps / 10000) * Math.abs(exitPrice)) / riskPerUnit;
}

export interface FeeEnv { label: string; makerBps: number; takerBps: number }
/** Headline 2/5 was labelled FUT_4 (earlier reports: FUT_7) — same arithmetic. */
export const V25_FEE_ENVS: readonly FeeEnv[] = Object.freeze([
  { label: 'GROSS', makerBps: 0, takerBps: 0 },
  { label: 'FUT_4', makerBps: 2, takerBps: 5 },
  { label: 'SPOT', makerBps: 5, takerBps: 5 },
]);
