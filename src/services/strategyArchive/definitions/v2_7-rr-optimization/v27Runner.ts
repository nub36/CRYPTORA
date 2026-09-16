/**
 * V2.7 historical runner. The exit arms (`simulateFixedRr`) are pure and ported; the ENTRY population
 * (sniper reversals from the frozen V2 engine 4839074, one position slot governed by the frozen tracker,
 * four timeframes with HTF context) is supplied by the isolated legacy engine port (C6).
 *
 * Until that port is wired in, this runner refuses to run instead of inventing entries.
 */

import type { ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { RR_ARMS } from './v27Core';

export const V27_VARIANT_IDS = RR_ARMS.map((a) => a.label);

export interface LegacyEntryProvider {
  /** Produces the frozen-engine sniper entries for one symbol × scope timeframes inside a slice. */
  entries(input: ArchiveSeriesInput, slice: SliceName): never;
}

export function runV27Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.7 was only ever run on TRAIN (REJECTED_ON_TRAIN) — no other slice exists');
  if (variantId !== undefined && !V27_VARIANT_IDS.includes(variantId)) throw new Error(`V2.7: unknown variant ${variantId}`);
  throw new Error(
    `V2.7 ${input.symbol}: REPRODUCTION_NOT_WIRED — entries require the frozen V2 engine 4839074 (legacy archive port, C6). Refusing to fabricate entries.`,
  );
}
