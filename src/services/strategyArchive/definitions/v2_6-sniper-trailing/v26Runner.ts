/**
 * V2.6 historical runner — `main()` of scripts/real-data/v26-train.ts @ e89cf1e over the frozen V2 engine port.
 * ONE walk → four projections of the same universe:
 *   A = all entries, frozen exits · V25 = all entries, trailing exits ·
 *   V26 = sniper entries, trailing exits (the candidate) · V26-frozen-exit = sniper entries, frozen exits.
 * Fee envs: headline FUT_4 (= 2 maker / 5 taker), stress SPOT 5/5. TRAIN only. ARCHIVE-ONLY.
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { splitFor } from '../../engine/reproductionEngine';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { runSniperEntryLoop, type ResolvedSlot } from '../../legacy/v2/sniperEntryLoop';
import { V25_FEE_ENVS, feeR, simulateTrailing } from '../../shared/legacyResearch/v25Trailing';

export const V26_ARMS = ['A', 'V25', 'V26', 'V26-frozen-exit'] as const;
export type V26Arm = (typeof V26_ARMS)[number];
export const V26_SCOPE = ['15m', '30m', '1h', '4h'] as const;
export const V26_SYMBOLS: readonly string[] = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
export const FROZEN_FEE_PCT = 0.1;
/** Pre-registration §0 naive additive projection (sniper gain + trailing gain), tested against measured V26 gross. */
export const NAIVE_ADDITIVE_GROSS = 0.1057;
export const V26_HEADLINE = V25_FEE_ENVS.find((e) => e.label === 'FUT_4')!;
export const V26_STRESS = V25_FEE_ENVS.find((e) => e.label === 'SPOT')!;

export function runV26Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.6 was only ever run on TRAIN (REJECTED_ON_TRAIN)');
  const arm = (variantId ?? 'V26') as V26Arm;
  if (!V26_ARMS.includes(arm)) throw new Error(`V2.6: unknown arm ${variantId}; source arms: ${V26_ARMS.join(', ')}`);
  const sniperOnly = arm === 'V26' || arm === 'V26-frozen-exit';
  const trailing = arm === 'V25' || arm === 'V26';
  const timeoutBars = FROZEN_ENGINE.outcomeTimeoutBars;
  const trades: ArchiveTrade[] = [];
  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  let maxRead = 0;

  for (const tf of V26_SCOPE) {
    const candles = input.bySeries[tf];
    if (!candles) continue;
    const split = splitFor(input.symbol, tf);
    if (!split) throw new Error(`V2.6: no split for ${input.symbol} ${tf}`);
    const htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>> = {};
    for (const h of ['1h', '4h', '1d'] as const) if (input.bySeries[h]) htf[h] = input.bySeries[h];
    let entries = 0;

    const onSlot = ({ open, out, closed }: ResolvedSlot) => {
      entries++;
      const risk = Math.abs(open.entryPrice - open.stop);
      const push = (exit: string, barsHeld: number, grossR: number, exitPrice: number, lastOpen: number | undefined) => {
        if (lastOpen !== undefined && lastOpen > maxRead) maxRead = lastOpen;
        funnel.filled++;
        trades.push({
          symbol: input.symbol, direction: open.direction,
          setupOpenTime: open.setupCandleTime, fillOpenTime: open.entryCandleTime,
          entry: open.entryPrice, stop: open.stop, exitReason: exit, barsHeld, grossR,
          feeRHeadline: feeR(open.entryPrice, exitPrice, risk, V26_HEADLINE.makerBps, V26_HEADLINE.takerBps),
          feeRStress: feeR(open.entryPrice, exitPrice, risk, V26_STRESS.makerBps, V26_STRESS.takerBps),
          stopDistancePct: (risk / open.entryPrice) * 100,
          tags: { timeframe: tf, arm, sniper: open.sniper },
        });
      };
      if (!trailing) {
        push(out.result, out.barsHeld, out.rMultiple + (FROZEN_FEE_PCT / 100) * open.entryPrice / risk, out.exitPrice, out.exitCandleTime);
        return;
      }
      const bars = closed.slice(open.entryIndex, Math.min(closed.length, open.entryIndex + timeoutBars + 64));
      const v = simulateTrailing({ direction: open.direction, entryPrice: open.entryPrice, stopLoss: open.stop, bars });
      if (!v) { funnel.unresolved++; return; }
      push(v.reason, v.barsHeld, v.grossR, v.exitPrice, bars[v.barsHeld - 1]?.openTime);
    };

    const stats = runSniperEntryLoop({
      symbol: input.symbol, timeframe: tf, candles, htf, fromMs: split.trainFromMs, toMs: split.trainToMs,
      onSniperResolved: sniperOnly ? onSlot : () => { /* handled by onAnyResolved */ },
      ...(sniperOnly ? {} : { onAnyResolved: onSlot }),
    });
    funnel.signals += stats.actionable;
    funnel.pendingCreated += entries;
    if (stats.maxOpenTimeRead > maxRead) maxRead = stats.maxOpenTimeRead;
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}
