/**
 * V2.8 — ZERO-FEE SNIPER + TRAILING (PURE ALPHA EXIT COMPARISON) — pure exit logic (immutable).
 *
 * Ported from svechnoy-suslik-v2 `research/v28_gross_only.ts` @ 54243a7 (TRAIN, sha bb237f47…) and
 * `research/v28_validate.ts` @ 1d4d575 (VALIDATION, sha 6e267907…); candidate frozen at 852167c BEFORE validation.
 * Exit arms: SMC (frozen `trackOutcome`, gross recovered by adding back the 0.1 % lump fee), Trail (V2.5 trailing),
 * RR15…RR40 (V2.7 fixed targets). Entries/stops/N+1 come from the frozen V2 engine `4839074`.
 *
 * ⚠️ FEES ARE ZERO EVERYWHERE. Every V2.8 figure is GROSS R. These numbers are NOT comparable with
 * V3.x net@2/5 bps figures without an explicit warning. RESEARCH VERDICT: V2_8_VALIDATED_FOR_RESEARCH (gross only,
 * PASS by a single trade: ex-top-1 % VALIDATION = −0.0143). CRYPTORA does not execute trades.
 */

export { simulateFixedRr } from '../v2_7-rr-optimization/v27Core';
export { simulateTrailing } from '../../shared/legacyResearch/v25Trailing';

/** The frozen lump fee that `trackOutcome` subtracts; removed to recover gross for the SMC arm. */
export const FROZEN_FEE_PCT = 0.1;
/** Horizon for the fixed-RR arms, matching V2.7. */
export const RR_MAX_BARS = 50;

export const ARM_ORDER = ['SMC', 'Trail', 'RR15', 'RR20', 'RR25', 'RR30', 'RR40'] as const;
export type V28Arm = (typeof ARM_ORDER)[number];
export const VALIDATION_ARMS = ['SMC', 'Trail'] as const;
export const RR_MULTS: Readonly<Record<string, number>> = Object.freeze({ RR15: 1.5, RR20: 2.0, RR25: 2.5, RR30: 3.0, RR40: 4.0 });

export const V28_CONSTANTS = Object.freeze({
  FROZEN_FEE_PCT, RR_MAX_BARS,
  MAKER_BPS: 0, TAKER_BPS: 0,          // zero-fee by design
  SCOPE: ['15m', '30m', '1h', '4h'] as const,
  WINDOW_MARGIN: 60,
  CANDIDATE_ARM: 'Trail' as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

/** grossR = storedR + (0.1/100) * entry / risk — identity verified by the source across 1.69M trades. */
export function recoverGrossFromFrozenTracker(storedR: number, entryPrice: number, risk: number): number {
  return storedR + (FROZEN_FEE_PCT / 100) * entryPrice / risk;
}
