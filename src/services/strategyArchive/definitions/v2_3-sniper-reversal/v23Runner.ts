/**
 * V2.3 historical runner — `main()` of scripts/real-data/v23-train.ts @ 2ee06d1 over the verbatim
 * `legacy/v2/research/v23Replay.ts` (6-arm ablation A / S-base / S-tgt / S-cor / S-full / S-noguard).
 * Variant = one arm. TRAIN only. Headline FUT_7 (2 maker / 5 taker); stress SPOT 5/5. ARCHIVE-ONLY.
 */

import type { ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { replayV23, V23_ARMS } from '../../legacy/v2/research/v23Replay';
import { FEE_ENVS } from '../../legacy/v2/research/v22Engine';
import { runReplayArm } from '../../legacy/v2/research/replayArmRunner';

export const V23_ARM_IDS = Object.freeze(Object.keys(V23_ARMS));
export const V23_HEADLINE_ENV = FEE_ENVS.find((e) => e.label === 'FUT_7')!;
export const V23_STRESS_ENV = FEE_ENVS.find((e) => e.label === 'SPOT')!;

export function runV23Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.3 was only ever run on TRAIN (REJECTED_ON_TRAIN)');
  const gates = V23_ARMS[variantId ?? ''];
  if (!gates) throw new Error(`V2.3: unknown arm ${variantId}; source arms: ${V23_ARM_IDS.join(', ')}`);
  return runReplayArm({
    input, slice, armLabel: variantId!, headline: V23_HEADLINE_ENV, stress: V23_STRESS_ENV,
    tagFields: ['setupKind', 'poolKind', 'tp2Source', 'htfAlignment'],
    replay: (a) => replayV23({ ...a, gates }),
  });
}
