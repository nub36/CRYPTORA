/**
 * V2.7 historical runner — `main()` of research/v27_rr_test.ts @ 965fb15 over the frozen V2 engine port
 * (`legacy/v2`, isolated archive dependency). Scope 15m/30m/1h/4h pooled; each (symbol, timeframe) uses its
 * own TRAIN window from the pinned splits.json. Variant = one fixed-RR arm; every arm sees the SAME entries.
 *
 * One ArchiveTrade per resolved sniper entry for the requested arm. `tags.timeframe` preserves the pooled scope.
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { splitFor } from '../../engine/reproductionEngine';
import { runSniperEntryLoop } from '../../legacy/v2/sniperEntryLoop';
import { MAX_BARS, MAKER_BPS, RR_ARMS, TAKER_BPS, V27_CONSTANTS, feeR, simulateFixedRr } from './v27Core';

export const V27_VARIANT_IDS = RR_ARMS.map((a) => a.label);

export function runV27Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.7 was only ever run on TRAIN (REJECTED_ON_TRAIN) — no other slice exists');
  const arm = RR_ARMS.find((a) => a.label === (variantId ?? ''));
  if (!arm) throw new Error(`V2.7: unknown variant ${variantId} — the source archived no headline; pick one of ${V27_VARIANT_IDS.join(', ')}`);

  const trades: ArchiveTrade[] = [];
  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  let maxRead = 0;

  for (const tf of V27_CONSTANTS.SCOPE) {
    const candles = input.bySeries[tf];
    if (!candles) continue;
    const split = splitFor(input.symbol, tf);
    if (!split) throw new Error(`V2.7: no split for ${input.symbol} ${tf}`);
    const htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>> = {};
    for (const h of ['1h', '4h', '1d'] as const) if (input.bySeries[h]) htf[h] = input.bySeries[h];

    const stats = runSniperEntryLoop({
      symbol: input.symbol, timeframe: tf, candles, htf, fromMs: split.trainFromMs, toMs: split.trainToMs,
      onSniperResolved: ({ open, closed }) => {
        const risk = Math.abs(open.entryPrice - open.stop);
        const bars = closed.slice(open.entryIndex, Math.min(closed.length, open.entryIndex + MAX_BARS + 2));
        const r = simulateFixedRr(open.direction, open.entryPrice, open.stop, arm.mult, bars);
        if (!r) { funnel.unresolved++; return; }
        const last = bars[r.barsHeld - 1];
        if (last && last.openTime > maxRead) maxRead = last.openTime;
        funnel.filled++;
        trades.push({
          symbol: input.symbol, direction: open.direction,
          setupOpenTime: open.setupCandleTime, fillOpenTime: open.entryCandleTime,
          entry: open.entryPrice, stop: open.stop, exitReason: r.exit, barsHeld: r.barsHeld, grossR: r.grossR,
          feeRHeadline: feeR(open.entryPrice, r.exitPrice, risk, MAKER_BPS, TAKER_BPS),
          feeRStress: feeR(open.entryPrice, r.exitPrice, risk, V27_CONSTANTS.STRESS_MAKER_BPS, V27_CONSTANTS.STRESS_TAKER_BPS),
          stopDistancePct: (risk / open.entryPrice) * 100,
          tags: { timeframe: tf, arm: arm.label, hitTp: r.exit === 'TP' },
        });
      },
    });
    funnel.signals += stats.actionable;
    funnel.pendingCreated += stats.sniperEntries;
    if (stats.maxOpenTimeRead > maxRead) maxRead = stats.maxOpenTimeRead;
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}
