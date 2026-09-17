/**
 * V2.1b historical runner — `main()` of scripts/real-data/corridor-train.ts @ 374b335 over the verbatim
 * `legacy/v2/research/corridorReplay.ts` (7-arm ablation A / E / F / C / EF / EFC / FULL of the three pre-registered
 * gates + corridor entry). Scope: ALL 42 frozen splits (1m…1d × 6 symbols), TRAIN only.
 * Source fee semantics: frozen 0.1 % lump (gross recovered) + 0/2/5/10/20 bps round-trip sensitivity on mean(entry/risk).
 * The archive's 2/5 per-leg column is DERIVED context; comparison is on gross figures. ARCHIVE-ONLY.
 */

import type { ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { replayCorridor, type Gates } from '../../legacy/v2/research/corridorReplay';
import { FEE_ENVS } from '../../legacy/v2/research/v22Engine';
import { runReplayArm } from '../../legacy/v2/research/replayArmRunner';

/** scripts/real-data/corridor-train.ts `ARMS` @ 374b335 — verbatim. */
export const V21B_ARMS: Readonly<Record<string, Gates>> = Object.freeze({
  A:    { extreme: false, feeGuard: false, confluence: false, corridor: false },
  E:    { extreme: true,  feeGuard: false, confluence: false, corridor: false },
  F:    { extreme: false, feeGuard: true,  confluence: false, corridor: false },
  C:    { extreme: false, feeGuard: false, confluence: true,  corridor: false },
  EF:   { extreme: true,  feeGuard: true,  confluence: false, corridor: false },
  EFC:  { extreme: true,  feeGuard: true,  confluence: true,  corridor: false },
  FULL: { extreme: true,  feeGuard: true,  confluence: true,  corridor: true  },
});
export const V21B_ARM_IDS = Object.freeze(Object.keys(V21B_ARMS));
export const V21B_SCOPE: readonly ArchiveTimeframe[] = Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
export const V21B_SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT']);
export const V21B_HEADLINE_ENV = FEE_ENVS.find((e) => e.label === 'SPOT')!;   // 5/5 per leg ≈ Spot 0.1 % round trip (D-V21B-004)
export const V21B_STRESS_ENV = FEE_ENVS.find((e) => e.label === 'FUT_7')!;

export function runV21bSeries(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.1b was only ever run on TRAIN (CORRIDOR_ENTRY_REJECTED_ON_TRAIN)');
  const gates = V21B_ARMS[variantId ?? ''];
  if (!gates) throw new Error(`V2.1b: unknown arm ${variantId}; source arms: ${V21B_ARM_IDS.join(', ')}`);
  return runReplayArm({
    input, slice, armLabel: variantId!, headline: V21B_HEADLINE_ENV, stress: V21B_STRESS_ENV, scope: V21B_SCOPE,
    tagFields: ['setupKind', 'poolKind', 'confluenceVotes', 'barsWaited'],
    // corridor-train.ts: `poolKinds: poolKinds && name === 'FULL'` — the archived artifact carries SWING/EQUAL/CLUSTER for
    // FULL only. The label is diagnostic (never gates), so results are identical either way.
    replay: (a) => replayCorridor({ ...a, gates, poolKinds: variantId === 'FULL' }),
  });
}
