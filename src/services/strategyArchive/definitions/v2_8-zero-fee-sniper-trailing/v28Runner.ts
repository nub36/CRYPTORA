/**
 * V2.8 historical runner. Exit arms are pure and ported (SMC gross recovery, V2.5 Trail, V2.7 fixed RR); the
 * ENTRY population and the SMC arm's frozen `trackOutcome` come from the frozen V2 engine 4839074, ported in C6
 * as an isolated legacy dependency. Until wired in, this runner refuses to run instead of inventing entries.
 */

import type { ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { ARM_ORDER, VALIDATION_ARMS } from './v28Core';

export function runV28Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  const arms: readonly string[] = slice === 'validation' ? VALIDATION_ARMS : ARM_ORDER;
  if (variantId !== undefined && !arms.includes(variantId)) {
    throw new Error(`V2.8: arm ${variantId} was not run on slice ${slice} by the source (validation ran only SMC anchor + Trail candidate)`);
  }
  throw new Error(
    `V2.8 ${input.symbol}: REPRODUCTION_NOT_WIRED — entries and the SMC arm require the frozen V2 engine 4839074 (legacy archive port, C6). Refusing to fabricate entries.`,
  );
}
