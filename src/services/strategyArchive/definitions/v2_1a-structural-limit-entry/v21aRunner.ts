/**
 * V2.1a historical runner — `main()` of scripts/real-data/limit-entry-train.ts @ 4b25bbb over the verbatim
 * `legacy/v2/research/limitEntryReplay.ts` (models B RETEST / C FVG / D OB∩FVG). Model A = the frozen market-at-OPEN-N+1
 * baseline (windowed-replay) — NOT re-implemented here; its figures are SOURCE_REPORTED (model-a-fidelity.json).
 *
 * Scope: ALL 42 frozen splits (1m/5m/15m/30m/1h/4h/1d × 6 symbols), TRAIN only. Source fee semantics: gross = stored R
 * + 0.1 % lump / risk; net at the frozen 0.1 % lump (Spot round trip) plus a 2/5/10/20 bps round-trip sensitivity.
 * The archive's per-leg columns (SPOT 5/5 headline ≈ 0.1 % round trip; FUT_7 2/5 stress) are DERIVED context and are
 * NOT byte-equal to the source's lump figure (D-V21A-003); reproduction compares GROSS figures and counts.
 * ARCHIVE-ONLY — CRYPTORA does not execute trades.
 */

import type { ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { replayLimitEntry, type ModelId } from '../../legacy/v2/research/limitEntryReplay';
import { FEE_ENVS } from '../../legacy/v2/research/v22Engine';
import { runReplayArm } from '../../legacy/v2/research/replayArmRunner';

export const V21A_MODELS: readonly ModelId[] = Object.freeze(['B', 'C', 'D']);
/** All 42 series of the frozen splits.json — the source iterated every one. */
export const V21A_SCOPE: readonly ArchiveTimeframe[] = Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
export const V21A_SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT']);
export const V21A_HEADLINE_ENV = FEE_ENVS.find((e) => e.label === 'SPOT')!;   // 5/5 per leg ≈ the source's Spot 0.1 % round trip (D-V21A-003)
export const V21A_STRESS_ENV = FEE_ENVS.find((e) => e.label === 'FUT_7')!;

export function runV21aSeries(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.1a was only ever run on TRAIN (REJECTED_ON_TRAIN, superseded)');
  if (variantId === 'A') throw new Error('V2.1a model A is the frozen windowed-replay baseline — SOURCE_REPORTED only, not rerun by this runner');
  const model = variantId as ModelId | undefined;
  if (!model || !V21A_MODELS.includes(model)) throw new Error(`V2.1a: unknown model ${variantId}; source models: A (baseline), ${V21A_MODELS.join(', ')}`);
  return runReplayArm({
    input, slice, armLabel: model, headline: V21A_HEADLINE_ENV, stress: V21A_STRESS_ENV, scope: V21A_SCOPE,
    tagFields: ['setupKind', 'barsWaited', 'referencePrice'],
    // V2.1 semantics: MISSED (TP1 reached before fill) is a distinct outcome in the source funnel.
    terminalMap: (t) => t === 'EXPIRED' ? 'expired' : t === 'CANCELLED' || t === 'MISSED' ? 'cancelled' : t === 'FILLED' ? 'filled' : 'rejected',
    replay: (a) => {
      const r = replayLimitEntry({ ...a, model });
      // LimitTrade names its reason `cancelReason`; the shared reducer expects `reason`.
      return { ...r, trades: r.trades.map((t) => ({ ...t, reason: t.cancelReason ?? '' })) };
    },
  });
}
