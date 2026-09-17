/**
 * V2.5 historical runner — `main()` of scripts/real-data/v25-train.ts @ 07dabbb over the frozen V2 engine port.
 * ONE chronological walk (all baseline entries, one slot governed by the frozen tracker); each resolved entry is
 * measured twice:  arm A = frozen exit (gross recovered by adding back the 0.1 % lump),  arm V25 = the V2.5
 * trailing/breakeven simulator on the SAME entry. Fee envs: headline FUT_4 (= 2 maker / 5 taker), stress SPOT 5/5.
 * TRAIN only. ARCHIVE-ONLY.
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { splitFor } from '../../engine/reproductionEngine';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { runSniperEntryLoop } from '../../legacy/v2/sniperEntryLoop';
import { V25_FEE_ENVS, feeR, simulateTrailing } from '../../shared/legacyResearch/v25Trailing';

export const V25_ARMS = ['A', 'V25'] as const;
export type V25Arm = (typeof V25_ARMS)[number];
export const V25_SCOPE = ['15m', '30m', '1h', '4h'] as const;
export const V25_SYMBOLS: readonly string[] = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
/** What the frozen tracker already subtracted (lump 0.1 % of entry notional). */
export const FROZEN_FEE_PCT = 0.1;
export const V25_HEADLINE = V25_FEE_ENVS.find((e) => e.label === 'FUT_4')!;   // 2/5 bps (label quirk, see D-V25-001)
export const V25_STRESS = V25_FEE_ENVS.find((e) => e.label === 'SPOT')!;

export function runV25Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  if (slice !== 'train') throw new Error('V2.5 was only ever run on TRAIN (validation was never executed)');
  const arm = (variantId ?? 'V25') as V25Arm;
  if (!V25_ARMS.includes(arm)) throw new Error(`V2.5: unknown arm ${variantId}; source arms: ${V25_ARMS.join(', ')}`);
  const timeoutBars = FROZEN_ENGINE.outcomeTimeoutBars;
  const trades: ArchiveTrade[] = [];
  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  let maxRead = 0;

  for (const tf of V25_SCOPE) {
    const candles = input.bySeries[tf];
    if (!candles) continue;
    const split = splitFor(input.symbol, tf);
    if (!split) throw new Error(`V2.5: no split for ${input.symbol} ${tf}`);
    const htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>> = {};
    for (const h of ['1h', '4h', '1d'] as const) if (input.bySeries[h]) htf[h] = input.bySeries[h];
    let entries = 0;

    const stats = runSniperEntryLoop({
      symbol: input.symbol, timeframe: tf, candles, htf, fromMs: split.trainFromMs, toMs: split.trainToMs,
      onSniperResolved: () => { /* V2.5 measures the WHOLE universe — see onAnyResolved */ },
      onAnyResolved: ({ open, out, closed }) => {
        entries++;
        const risk = Math.abs(open.entryPrice - open.stop);
        const push = (exit: string, barsHeld: number, grossR: number, exitPrice: number, lastOpen: number | undefined) => {
          if (lastOpen !== undefined && lastOpen > maxRead) maxRead = lastOpen;
          funnel.filled++;
          trades.push({
            symbol: input.symbol, direction: open.direction,
            setupOpenTime: open.setupCandleTime, fillOpenTime: open.entryCandleTime,
            entry: open.entryPrice, stop: open.stop, exitReason: exit, barsHeld, grossR,
            feeRHeadline: feeR(open.entryPrice, exitPrice, risk, V25_HEADLINE.makerBps, V25_HEADLINE.takerBps),
            feeRStress: feeR(open.entryPrice, exitPrice, risk, V25_STRESS.makerBps, V25_STRESS.takerBps),
            stopDistancePct: (risk / open.entryPrice) * 100,
            tags: { timeframe: tf, arm, sniper: open.sniper },
          });
        };
        if (arm === 'A') {
          push(out.result, out.barsHeld, out.rMultiple + (FROZEN_FEE_PCT / 100) * open.entryPrice / risk, out.exitPrice, out.exitCandleTime);
          return;
        }
        const bars = closed.slice(open.entryIndex, Math.min(closed.length, open.entryIndex + timeoutBars + 64));
        const v = simulateTrailing({ direction: open.direction, entryPrice: open.entryPrice, stopLoss: open.stop, bars });
        if (!v) { funnel.unresolved++; return; }
        push(v.reason, v.barsHeld, v.grossR, v.exitPrice, bars[v.barsHeld - 1]?.openTime);
      },
    });
    funnel.signals += stats.actionable;
    funnel.pendingCreated += entries;
    if (stats.maxOpenTimeRead > maxRead) maxRead = stats.maxOpenTimeRead;
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}
