/**
 * V3.2 historical runner — reproduces research/v32_volume_climax.ts `main()` per symbol
 * (TRAIN only). Four archived variants = cascade {union|fast3} × tp1 {cascade|ema50}.
 *
 * Preserved semantics: hard truncation to TRAIN; warm-up 60; ATR as Wilder series over the
 * truncated TRAIN prefix (identical to buildAtrContext per source note); RVOL >= 2.2 inclusive;
 * corridor N+1; ambiguity → cancelled; overlapping positions (scan continues on the fill bar).
 *
 * Funnel mapping to the source artifact: signals = cascadesWithVolume (cascade + RVOL passed);
 * cascades that failed the absorption test are reported separately in `extra.cascadesFailingAbsorption`.
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { atrSeriesV2, emaSeries, rvolAt } from '../../shared/primitives';
import { V32_CONSTANTS, absorption, detectCascade, manageTrade, type CascadeMode, type Tp1Mode } from './v32Core';

export const V32_VARIANT_IDS = ['union-cascade', 'fast3-cascade', 'union-ema50', 'fast3-ema50'] as const;
export type V32VariantId = (typeof V32_VARIANT_IDS)[number];

export function parseVariant(id: string | undefined): { cascade: CascadeMode; tp1: Tp1Mode } {
  const v = (id ?? 'union-cascade') as V32VariantId;
  if (!V32_VARIANT_IDS.includes(v)) throw new Error(`V3.2: unknown variant ${id}`);
  const [cascade, tp1] = v.split('-') as [CascadeMode, Tp1Mode];
  return { cascade, tp1 };
}

export interface V32RunOutput {
  trades: ArchiveTrade[];
  funnel: FunnelCounts;
  maxCandleOpenTimeRead: number;
  extra: { cascadesFailingAbsorption: number };
}

interface Pending {
  dir: 'LONG' | 'SHORT'; zoneLow: number; zoneHigh: number; stop: number;
  tp1: number; tp2: number; setupIndex: number; kind: string; k: number; rvol: number; moveAtr: number;
}

export function runV32Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): V32RunOutput {
  if (slice !== 'train') throw new Error('V3.2 was only ever run on TRAIN (F1 falsified) — no other slice exists');
  const { cascade: cascadeMode, tp1: tp1Mode } = parseVariant(variantId);
  const {
    MIN_RVOL, EMA_TP1_PERIOD, CORRIDOR_ATR_FRAC, CORRIDOR_EXPIRY_BARS, STOP_BUFFER_ATR, TIMEOUT_BARS,
    MAKER_BPS, TAKER_BPS, STRESS_MAKER_BPS, STRESS_TAKER_BPS, WARMUP_BARS, EXEC_TF,
  } = V32_CONSTANTS;
  const atrPeriod = FROZEN_ENGINE.atrPeriod;
  const volPeriod = FROZEN_ENGINE.volumePeriod;
  const b = input.split;
  if (!(b.trainFromMs < b.trainToMs && b.trainToMs < b.validFromMs)) {
    throw new Error(`${input.symbol}: TRAIN window is not strictly before VALIDATION — refusing`);
  }

  const all = (input.bySeries[EXEC_TF] ?? []).filter((c) => c.isClosed);
  const h1: readonly ArchiveCandle[] = all.filter((c) => c.openTime >= b.trainFromMs && c.openTime <= b.trainToMs);
  const ema50 = emaSeries(h1.map((c) => c.close), EMA_TP1_PERIOD);
  const atrAll = atrSeriesV2(h1, atrPeriod);

  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  let queues = 0;
  const trades: ArchiveTrade[] = [];
  let maxRead = 0;
  let pend: Pending | null = null;

  for (let i = WARMUP_BARS; i < h1.length; i++) {
    const c = h1[i]!;
    if (c.openTime > maxRead) maxRead = c.openTime;

    if (pend) {
      const p = pend;
      const long = p.dir === 'LONG';
      const waited = i - p.setupIndex;
      const touches = long ? c.low <= p.zoneHigh : c.high >= p.zoneLow;
      const hitStop = long ? c.low <= p.stop : c.high >= p.stop;

      if (touches && hitStop) {
        funnel.cancelled++; pend = null;
      } else if (touches) {
        const fill = long ? Math.min(c.open, p.zoneHigh) : Math.max(c.open, p.zoneLow);
        const risk = Math.abs(fill - p.stop);
        const geomOk = risk > 0
          && (long ? p.stop < fill : p.stop > fill)
          && (long ? p.tp1 > fill && p.tp2 > p.tp1 : p.tp1 < fill && p.tp2 < p.tp1);
        if (!geomOk) { funnel.rejected++; pend = null; }
        else {
          const bars = h1.slice(i, i + TIMEOUT_BARS + 2);
          const r = manageTrade(p.dir, fill, p.stop, p.tp1, p.tp2, bars);
          if (!r) { funnel.unresolved++; pend = null; }
          else {
            const lastBar = bars[Math.min(bars.length, r.barsHeld) - 1];
            if (lastBar && lastBar.openTime > maxRead) maxRead = lastBar.openTime;
            funnel.filled++;
            trades.push({
              symbol: input.symbol, direction: p.dir,
              setupOpenTime: h1[p.setupIndex]!.openTime, fillOpenTime: c.openTime,
              entry: fill, stop: p.stop, exitReason: r.exit, barsHeld: r.barsHeld, grossR: r.grossR,
              feeRHeadline: r.feeR(MAKER_BPS, TAKER_BPS), feeRStress: r.feeR(STRESS_MAKER_BPS, STRESS_TAKER_BPS),
              stopDistancePct: (risk / fill) * 100,
              tags: {
                hitTp1: r.hitTp1, hitTp2: r.hitTp2, absorption: p.kind, cascadeK: p.k, rvol: p.rvol, cascadeAtr: p.moveAtr,
                tp1R: (long ? p.tp1 - fill : fill - p.tp1) / risk, tp2R: (long ? p.tp2 - fill : fill - p.tp2) / risk,
              },
            });
            pend = null;
          }
        }
      } else if (hitStop) {
        funnel.cancelled++; pend = null;
      } else if (waited >= CORRIDOR_EXPIRY_BARS) {
        funnel.expired++; pend = null;
      }
    }

    if (pend === null) {
      const atr = atrAll[i] ?? null;
      if (atr === null || !(atr > 0)) continue;
      const cascade = detectCascade(h1, i, atr, cascadeMode);
      if (!cascade) continue;
      const rvol = rvolAt(h1, i, volPeriod);
      if (rvol === null || !(rvol >= MIN_RVOL)) continue;
      const kind = absorption(c, h1[i - 1], cascade.dir);
      if (!kind) { queues++; continue; }

      funnel.signals++;
      const long = cascade.dir === 'LONG';
      const half = CORRIDOR_ATR_FRAC * atr;
      const stop = long ? c.low - STOP_BUFFER_ATR * atr : c.high + STOP_BUFFER_ATR * atr;
      const mid = (cascade.origin + cascade.terminal) / 2;
      const tp1 = tp1Mode === 'cascade' ? mid : (ema50[i] ?? mid);
      const tp2 = cascade.origin;
      pend = {
        dir: cascade.dir, zoneLow: c.close - half, zoneHigh: c.close + half,
        stop, tp1, tp2, setupIndex: i, kind, k: cascade.k, rvol, moveAtr: cascade.moveAtr,
      };
      funnel.pendingCreated++;
    }
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead, extra: { cascadesFailingAbsorption: queues } };
}
