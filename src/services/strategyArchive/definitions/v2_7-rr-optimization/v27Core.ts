/**
 * V2.7 — TARGET RR OPTIMIZATION — pure exit logic (immutable).
 *
 * Ported verbatim from svechnoy-suslik-v2 @ 965fb15 `research/v27_rr_test.ts`
 *   sha256 65a64d2a4eb27ce85a7f3de5e8e52efb53215601806279fee38fee99675dc7fc (identical at 2d8a3dd).
 * Entries/stops/N+1 come from the frozen V2 engine `4839074` (sniper filter) — see the runner.
 *
 * RESEARCH VERDICT (source): V2_7_REJECTED_ON_TRAIN — all five fixed-RR arms are net-negative at 2/5 bps;
 * fee drag is identical (0.1555 R) across arms, disproving the "bigger target dilutes the fee" hypothesis.
 * CRYPTORA does not execute trades.
 */

import type { ArchiveCandle, ArchiveDirection } from '../../types';

export const RR_ARMS: readonly { label: string; mult: number }[] = Object.freeze([
  { label: 'RR15', mult: 1.5 },
  { label: 'RR20', mult: 2.0 },
  { label: 'RR25', mult: 2.5 },
  { label: 'RR30', mult: 3.0 },
  { label: 'RR40', mult: 4.0 },
]);
/** Task-specified horizon (frozen default is 48; the 2-bar deviation was logged by the source). */
export const MAX_BARS = 50;
export const MAKER_BPS = 2;
export const TAKER_BPS = 5;

export const V27_CONSTANTS = Object.freeze({
  MAX_BARS, MAKER_BPS, TAKER_BPS, STRESS_MAKER_BPS: 5, STRESS_TAKER_BPS: 5,
  SCOPE: ['15m', '30m', '1h', '4h'] as const,
  WINDOW_MARGIN: 60,
  STOP_BUFFER_ATR: 0.25,   // frozen `v2.stop_buffer_atr`, NOT the 0.05 of the task brief (prereg §0.1)
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

export type RrExit = 'TP' | 'SL' | 'TIMEOUT';
export interface RrResult { exit: RrExit; exitPrice: number; barsHeld: number; grossR: number }

/** Same-bar TP and SL resolves as SL (frozen `outcome.sl_priority_on_ambiguous_bar = true`). */
export function simulateFixedRr(
  direction: ArchiveDirection, entry: number, stop: number, mult: number, bars: readonly ArchiveCandle[],
): RrResult | null {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const tp = long ? entry + mult * risk : entry - mult * risk;
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  for (let i = 0; i < bars.length && i < MAX_BARS; i++) {
    const c = bars[i]!;
    const hitSl = long ? c.low <= stop : c.high >= stop;
    const hitTp = long ? c.high >= tp : c.low <= tp;
    if (hitSl) return { exit: 'SL', exitPrice: stop, barsHeld: i + 1, grossR: rOf(stop) };
    if (hitTp) return { exit: 'TP', exitPrice: tp, barsHeld: i + 1, grossR: rOf(tp) };
    if (i + 1 >= MAX_BARS) return { exit: 'TIMEOUT', exitPrice: c.close, barsHeld: i + 1, grossR: rOf(c.close) };
  }
  const last = bars[Math.min(bars.length, MAX_BARS) - 1]!;
  return { exit: 'TIMEOUT', exitPrice: last.close, barsHeld: Math.min(bars.length, MAX_BARS), grossR: rOf(last.close) };
}

/** Per-leg fee in R: maker entry, taker exit. No rebate. Independent of where the TP sits. */
export function feeR(entry: number, exit: number, risk: number, makerBps = MAKER_BPS, takerBps = TAKER_BPS): number {
  if (!(risk > 0)) return 0;
  return ((makerBps / 10000) * entry + (takerBps / 10000) * Math.abs(exit)) / risk;
}
