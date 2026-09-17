/**
 * V3.0 historical runner — reproduces the control flow of
 * research/v30_htf_trap.ts (TRAIN) and research/v30_validate.ts (VALIDATION)
 * exactly, including:
 *
 *   • warm-up: first 60 1H bars are skipped;
 *   • slice bounds by 1H openTime (`< fromMs` skip, `> toMs` break);
 *   • VALIDATION only: outcome bars clipped at `testFromMs` (TEST never read);
 *   • OVERLAPPING POSITIONS: after a fill, `manageTrade` walks the bars AHEAD
 *     and the scan continues from the fill bar with `pend = null`, so a new trap
 *     can be detected while the previous simulated trade is still in flight.
 *     The research code declared `let busy = false` and never set it.
 *     This is preserved deliberately (spec/research discrepancy D-V30-001).
 */

import type {
  ArchiveCandle, ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName,
} from '../../types';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { atrAt, rvolAt } from '../../shared/primitives';
import {
  V30_CONSTANTS, buildPending, confirmedLevels, corridorStep, detectTrap, manageTrade,
  type V30Pending,
} from './v30Core';

export interface V30RunOutput {
  trades: ArchiveTrade[];
  funnel: FunnelCounts;
  maxCandleOpenTimeRead: number;
}

export function runV30Series(input: ArchiveSeriesInput, slice: SliceName): V30RunOutput {
  const { EXEC_TF, STRUCT_TF, TIMEOUT_BARS, WARMUP_BARS, MAKER_BPS, TAKER_BPS,
    STRESS_MAKER_BPS, STRESS_TAKER_BPS } = V30_CONSTANTS;
  const strength = FROZEN_ENGINE.swingLookback;
  const atrPeriod = FROZEN_ENGINE.atrPeriod;
  const volPeriod = FROZEN_ENGINE.volumePeriod;

  const h1All = input.bySeries[EXEC_TF] ?? [];
  const h4All = input.bySeries[STRUCT_TF] ?? [];
  const h1: readonly ArchiveCandle[] = h1All.filter((c) => c.isClosed);
  const h4: readonly ArchiveCandle[] = h4All.filter((c) => c.isClosed);

  const fromMs = slice === 'train' ? input.split.trainFromMs : input.split.validFromMs;
  const toMs = slice === 'train' ? input.split.trainToMs : input.split.validToMs;

  // TEST clip (validation runner): outcome bars up to testFromMs − 1 only.
  const resolveLimit = slice === 'train' ? h1.length : (() => {
    let k = 0;
    while (k < h1.length && h1[k]!.openTime < input.split.testFromMs) k++;
    return k;
  })();

  const funnel: FunnelCounts = {
    signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0,
  };
  const trades: ArchiveTrade[] = [];
  let maxRead = 0;
  let pend: V30Pending | null = null;

  for (let i = WARMUP_BARS; i < h1.length; i++) {
    const c = h1[i]!;
    if (c.openTime < fromMs) continue;
    if (c.openTime > toMs) break;
    if (c.openTime > maxRead) maxRead = c.openTime;

    /* ---- advance a pending corridor (N+1 or later) ---- */
    if (pend) {
      const p = pend;
      const step = corridorStep(p, c, i);
      if (step.kind === 'CANCELLED') { funnel.cancelled++; pend = null; }
      else if (step.kind === 'EXPIRED') { funnel.expired++; pend = null; }
      else if (step.kind === 'REJECTED_GEOMETRY') { funnel.rejected++; pend = null; }
      else if (step.kind === 'FILLED') {
        const bars = h1.slice(i, Math.min(resolveLimit, i + TIMEOUT_BARS + 2));
        const r = manageTrade(p.dir, step.fill, p.stop, p.tp1, p.tp2, bars);
        if (!r) { funnel.unresolved++; pend = null; }
        else {
          const lastBar = bars[Math.min(bars.length, r.barsHeld) - 1];
          if (lastBar && lastBar.openTime > maxRead) maxRead = lastBar.openTime;
          funnel.filled++;
          trades.push({
            symbol: input.symbol,
            direction: p.dir,
            setupOpenTime: h1[p.setupIndex]!.openTime,
            fillOpenTime: c.openTime,
            entry: step.fill,
            stop: p.stop,
            exitReason: r.exit,
            barsHeld: r.barsHeld,
            grossR: r.grossR,
            feeRHeadline: r.feeR(MAKER_BPS, TAKER_BPS),
            feeRStress: r.feeR(STRESS_MAKER_BPS, STRESS_TAKER_BPS),
            stopDistancePct: (step.risk / step.fill) * 100,
          });
          pend = null;   // research semantics: scan continues on this very bar
        }
      }
      // WAIT → keep pending
    }

    /* ---- look for a new trap on this closed 1H bar ---- */
    if (pend === null) {
      const levels = confirmedLevels(h4, c.closeTime, strength);
      if (levels.swingHigh === null && levels.swingLow === null) continue;
      const rvol = rvolAt(h1.slice(0, i + 1), i, volPeriod);
      const sig = detectTrap(c, levels, rvol);
      if (!sig) continue;
      const atr = atrAt(h1.slice(0, i + 1), i, atrPeriod);
      if (atr === null || !(atr > 0)) continue;
      if (levels.swingHigh === null || levels.swingLow === null) continue;

      funnel.signals++;
      pend = buildPending(sig, c, { swingHigh: levels.swingHigh, swingLow: levels.swingLow }, atr, i);
      funnel.pendingCreated++;
    }
  }

  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}
