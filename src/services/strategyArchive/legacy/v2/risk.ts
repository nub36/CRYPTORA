/**
 * `rMultiple` and `pnlPct` from svechnoy-suslik-v2 `src/strategy/risk.ts` @ 4839074 (sha256 f9fafc22…), verbatim.
 * `buildRiskPlan` (account sizing / ATR stop policy — position sizing and quote risk) is deliberately NOT ported:
 * the archive is R-only and CRYPTORA never sizes positions. ARCHIVE-ONLY.
 */

import type { Direction } from './coreTypes';

/**
 * R multiple of an exit. Positive = profit in units of initial risk.
 * Direction-aware and fee-adjusted by the caller.
 */
export function rMultiple(
  direction: Direction,
  entry: number,
  exit: number,
  riskPerUnit: number,
): number {
  if (!(riskPerUnit > 0)) return 0;
  const move = direction === 'LONG' ? exit - entry : entry - exit;
  return move / riskPerUnit;
}

export function pnlPct(direction: Direction, entry: number, exit: number): number {
  if (entry <= 0) return 0;
  const move = direction === 'LONG' ? exit - entry : entry - exit;
  return (move / entry) * 100;
}
