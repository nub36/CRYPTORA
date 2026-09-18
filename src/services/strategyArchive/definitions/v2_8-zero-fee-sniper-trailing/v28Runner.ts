/**
 * V2.8 historical runner — `main()` of research/v28_gross_only.ts @ 54243a7 (TRAIN, 7 arms) and
 * research/v28_validate.ts @ 1d4d575 (VALIDATION, SMC + Trail) over the frozen V2 engine port (`legacy/v2`).
 * Variant = one exit arm; every arm sees the SAME sniper entries. FEES ARE ZERO: feeRHeadline = 0.
 * The SMC arm's gross R = frozen tracker R + 0.1 % lump fee / risk (source identity).
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTimeframe, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { splitFor } from '../../engine/reproductionEngine';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { runSniperEntryLoop } from '../../legacy/v2/sniperEntryLoop';
import { ARM_ORDER, RR_MAX_BARS, RR_MULTS, V28_CONSTANTS, VALIDATION_ARMS, recoverGrossFromFrozenTracker, simulateFixedRr, simulateTrailing } from './v28Core';

export function runV28Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): {
  trades: ArchiveTrade[]; funnel: FunnelCounts; maxCandleOpenTimeRead: number;
} {
  const arms: readonly string[] = slice === 'validation' ? VALIDATION_ARMS : ARM_ORDER;
  const arm = variantId ?? V28_CONSTANTS.CANDIDATE_ARM;
  if (!arms.includes(arm)) {
    throw new Error(`V2.8: arm ${arm} was not run on slice ${slice} by the source (validation ran only SMC anchor + Trail candidate)`);
  }
  const timeoutBars = FROZEN_ENGINE.outcomeTimeoutBars;
  const trades: ArchiveTrade[] = [];
  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  let maxRead = 0;

  for (const tf of V28_CONSTANTS.SCOPE) {
    const candles = input.bySeries[tf];
    if (!candles) continue;
    const split = splitFor(input.symbol, tf);
    if (!split) throw new Error(`V2.8: no split for ${input.symbol} ${tf}`);
    if (slice === 'validation' && !(split.validToMs < split.testFromMs)) {
      throw new Error(`TEST-SAFETY: ${input.symbol} ${tf} validTo ${split.validToMs} >= testFrom ${split.testFromMs}`);
    }
    const fromMs = slice === 'validation' ? split.validFromMs : split.trainFromMs;
    const toMs = slice === 'validation' ? split.validToMs : split.trainToMs;
    const htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>> = {};
    for (const h of ['1h', '4h', '1d'] as const) if (input.bySeries[h]) htf[h] = input.bySeries[h];

    const push = (open: { direction: 'LONG' | 'SHORT'; entryPrice: number; stop: number; setupCandleTime: number; entryCandleTime: number },
      exit: string, barsHeld: number, grossR: number, hitTarget: boolean, lastOpenTime: number | undefined) => {
      const risk = Math.abs(open.entryPrice - open.stop);
      if (lastOpenTime !== undefined && lastOpenTime > maxRead) maxRead = lastOpenTime;
      funnel.filled++;
      trades.push({
        symbol: input.symbol, direction: open.direction,
        setupOpenTime: open.setupCandleTime, fillOpenTime: open.entryCandleTime,
        entry: open.entryPrice, stop: open.stop, exitReason: exit, barsHeld, grossR,
        feeRHeadline: 0, feeRStress: null,
        stopDistancePct: (risk / open.entryPrice) * 100,
        tags: { timeframe: tf, arm, hitTarget },
      });
    };

    const stats = runSniperEntryLoop({
      symbol: input.symbol, timeframe: tf, candles, htf, fromMs, toMs,
      onSniperResolved: ({ open, out, closed }) => {
        const risk = Math.abs(open.entryPrice - open.stop);
        if (arm === 'SMC') {
          push(open, out.result, out.barsHeld, recoverGrossFromFrozenTracker(out.rMultiple, open.entryPrice, risk), out.result === 'TP', out.exitCandleTime);
          return;
        }
        if (arm === 'Trail') {
          const trailBars = closed.slice(open.entryIndex, Math.min(closed.length, open.entryIndex + timeoutBars + 64));
          const tr = simulateTrailing({ direction: open.direction, entryPrice: open.entryPrice, stopLoss: open.stop, bars: trailBars });
          if (!tr) { funnel.unresolved++; return; }
          push(open, tr.reason, tr.barsHeld, tr.grossR, tr.grossR > 0, trailBars[tr.barsHeld - 1]?.openTime);
          return;
        }
        const rrBars = closed.slice(open.entryIndex, Math.min(closed.length, open.entryIndex + RR_MAX_BARS + 2));
        const r = simulateFixedRr(open.direction, open.entryPrice, open.stop, RR_MULTS[arm]!, rrBars);
        if (!r) { funnel.unresolved++; return; }
        push(open, r.exit, r.barsHeld, r.grossR, r.exit === 'TP', rrBars[r.barsHeld - 1]?.openTime);
      },
    });
    funnel.signals += stats.actionable;
    funnel.pendingCreated += stats.sniperEntries;
    if (stats.maxOpenTimeRead > maxRead) maxRead = stats.maxOpenTimeRead;
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}
