/**
 * V2.2 historical runner — `main()` of scripts/real-data/v22-train.ts @ 5ce58db over the verbatim
 * `legacy/v2/research/v22Replay.ts` (7-arm ablation A / Ahtf / T / R / TR / TRG / FULL, Amendment 1 scope).
 * Variant = one arm. TRAIN only. Headline fee env per Amendment 1 = FUT_7 (2 maker / 5 taker); stress = SPOT 5/5.
 * ARCHIVE-ONLY — CRYPTORA does not execute trades.
 */

import type { ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { replayV22, V22_ARMS } from '../../legacy/v2/research/v22Replay';
import { FEE_ENVS } from '../../legacy/v2/research/v22Engine';
import { runReplayArm } from '../../legacy/v2/research/replayArmRunner';

export const V22_ARM_IDS = Object.freeze(Object.keys(V22_ARMS));
export const V22_HEADLINE_ENV = FEE_ENVS.find((e) => e.label === 'FUT_7')!;
export const V22_STRESS_ENV = FEE_ENVS.find((e) => e.label === 'SPOT')!;

export function runV22Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.2 was only ever run on TRAIN (REJECTED_ON_TRAIN)');
  const gates = V22_ARMS[variantId ?? ''];
  if (!gates) throw new Error(`V2.2: unknown arm ${variantId}; source arms: ${V22_ARM_IDS.join(', ')}`);
  return runReplayArm({
    input, slice, armLabel: variantId!, headline: V22_HEADLINE_ENV, stress: V22_STRESS_ENV,
    tagFields: ['setupKind', 'tp1Basis', 'htfAlignment'],
    replay: (a) => replayV22({ ...a, gates }),
  });
}
