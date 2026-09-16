/**
 * V2.4 historical runner — `main()` of scripts/real-data/v24-train.ts @ 8e07352 (TRAIN, 6 arms) and
 * v24-validate.ts @ c52fda7 (VALIDATION: frozen candidate S-asym + baseline anchor A ONLY, TEST-SAFETY guard)
 * over the verbatim `legacy/v2/research/v24Replay.ts`. Headline FUT_7 (2 maker / 5 taker); stress SPOT 5/5.
 * ARCHIVE-ONLY.
 */

import type { ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { replayV24, V24_ARMS } from '../../legacy/v2/research/v24Replay';
import { FEE_ENVS } from '../../legacy/v2/research/v22Engine';
import { runReplayArm } from '../../legacy/v2/research/replayArmRunner';

export const V24_ARM_IDS = Object.freeze(Object.keys(V24_ARMS));
/** v24-validate.ts default `--arms=A,S-asym`; no other arm may be run on VALIDATION. */
export const V24_VALIDATION_ARMS = Object.freeze(['A', 'S-asym']);
export const V24_HEADLINE_ENV = FEE_ENVS.find((e) => e.label === 'FUT_7')!;
export const V24_STRESS_ENV = FEE_ENVS.find((e) => e.label === 'SPOT')!;

export function runV24Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  const arm = variantId ?? 'S-asym';
  const gates = V24_ARMS[arm];
  if (!gates) throw new Error(`V2.4: unknown arm ${arm}; source arms: ${V24_ARM_IDS.join(', ')}`);
  if (slice === 'validation' && !V24_VALIDATION_ARMS.includes(arm)) {
    throw new Error(`V2.4: arm ${arm} was never run on VALIDATION by the source (only ${V24_VALIDATION_ARMS.join(', ')})`);
  }
  return runReplayArm({
    input, slice, armLabel: arm, headline: V24_HEADLINE_ENV, stress: V24_STRESS_ENV, testSafety: true,
    tagFields: ['setupKind', 'poolKind', 'tp1Basis', 'longLeg', 'htfAlignment'],
    replay: (a) => replayV24({ ...a, gates }),
  });
}
