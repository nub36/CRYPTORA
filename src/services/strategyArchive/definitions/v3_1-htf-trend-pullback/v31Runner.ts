/**
 * V3.1 historical runner — reproduces research/v31_trend_pullback.ts `main()` per
 * symbol (TRAIN only; the source never ran VALIDATION because F1 was falsified).
 *
 * Preserved semantics:
 *   • HARD TRUNCATION: 1H rows outside [trainFrom, trainTo] and 4H rows > trainTo are
 *     dropped before anything is computed;
 *   • warm-up 60 1H bars; EMA200 warm-up on 4H inside TRAIN;
 *   • closed-4H pointer: `openTime + 4h <= closeTime`;
 *   • corridor fills from N+1; ambiguous bar → cancelled; geometry reject;
 *   • two archived variants: `leg` (Amendment 1, PRIMARY) and `same-bar` (SECONDARY);
 *   • overlapping positions: exactly like V3.0 the scan continues on the fill bar with
 *     `pend = null` (D-V31-001, same discrepancy family as D-V30-001).
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { atrAt, detectStructureBreak, emaSeries, findSwingsV2, rvolAt } from '../../shared/primitives';
import {
  V31_CONSTANTS, bodyRatio, buildHtfContext, intersects, liveGaps, manageTrade,
  type PullbackSource, type V31PullbackMode,
} from './v31Core';

export interface V31RunOutput {
  trades: ArchiveTrade[];
  funnel: FunnelCounts;
  maxCandleOpenTimeRead: number;
}

interface Pending {
  dir: 'LONG' | 'SHORT'; zoneLow: number; zoneHigh: number; stop: number;
  tp1: number; tp2: number; setupIndex: number; source: PullbackSource; breakType: string;
}

export function runV31Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): V31RunOutput {
  if (slice !== 'train') throw new Error('V3.1 was only ever run on TRAIN (F1 falsified) — no other slice exists');
  const pullbackMode: V31PullbackMode = variantId === 'same-bar' ? 'same-bar' : 'leg';
  const {
    EMA_FAST, EMA_SLOW, MIN_BODY_RATIO, MIN_RVOL, CORRIDOR_ATR_FRAC, CORRIDOR_EXPIRY_BARS,
    STOP_BUFFER_ATR, TP2_FIB_EXT, TIMEOUT_BARS, MAKER_BPS, TAKER_BPS, STRESS_MAKER_BPS,
    STRESS_TAKER_BPS, WARMUP_BARS, EXEC_TF, STRUCT_TF,
  } = V31_CONSTANTS;
  const strength = FROZEN_ENGINE.swingLookback;
  const atrPeriod = FROZEN_ENGINE.atrPeriod;
  const volPeriod = FROZEN_ENGINE.volumePeriod;
  const b = input.split;
  if (!(b.trainFromMs < b.trainToMs && b.trainToMs < b.validFromMs)) {
    throw new Error(`${input.symbol}: TRAIN window is not strictly before VALIDATION — refusing`);
  }

  /* ---- HARD TRUNCATION: only TRAIN rows survive ---- */
  const execAll = (input.bySeries[EXEC_TF] ?? []).filter((c) => c.isClosed);
  const ctxAll = (input.bySeries[STRUCT_TF] ?? []).filter((c) => c.isClosed);
  const h1: readonly ArchiveCandle[] = execAll.filter((c) => c.openTime >= b.trainFromMs && c.openTime <= b.trainToMs);
  const h4: readonly ArchiveCandle[] = ctxAll.filter((c) => c.openTime <= b.trainToMs);

  const htf = buildHtfContext({
    h4,
    emaFast: emaSeries(h4.map((c) => c.close), EMA_FAST),
    emaSlow: emaSeries(h4.map((c) => c.close), EMA_SLOW),
    swings: findSwingsV2(h4, strength),
  });
  const swings1h = findSwingsV2(h1, strength);

  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  const trades: ArchiveTrade[] = [];
  let maxRead = 0;
  let pend: Pending | null = null;
  const lastTouchEq = { LONG: -1, SHORT: -1 } as Record<'LONG' | 'SHORT', number>;
  const lastTouchFvg = { LONG: -1, SHORT: -1 } as Record<'LONG' | 'SHORT', number>;
  let closed4h = 0;
  const span4h = 4 * 3_600_000;

  for (let i = WARMUP_BARS; i < h1.length; i++) {
    const c = h1[i]!;
    if (c.openTime < b.trainFromMs) continue;
    if (c.openTime > maxRead) maxRead = c.openTime;

    while (closed4h < h4.length && h4[closed4h]!.openTime + span4h <= c.closeTime) closed4h++;

    const trendHere = htf.trendByClosed[closed4h] ?? null;
    if (trendHere) {
      const long = trendHere.dir === 'LONG';
      const eq = (trendHere.legLow + trendHere.legHigh) / 2;
      if (long ? c.low <= eq : c.high >= eq) lastTouchEq[trendHere.dir] = i;
      const gaps = liveGaps(htf, closed4h, trendHere.dir);
      if (gaps.some((g) => intersects(c, g.top, g.bottom))) lastTouchFvg[trendHere.dir] = i;
    }

    /* ---- advance a pending corridor (N+1 or later) ---- */
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
              symbol: input.symbol,
              direction: p.dir,
              setupOpenTime: h1[p.setupIndex]!.openTime,
              fillOpenTime: c.openTime,
              entry: fill,
              stop: p.stop,
              exitReason: r.exit,
              barsHeld: r.barsHeld,
              grossR: r.grossR,
              feeRHeadline: r.feeR(MAKER_BPS, TAKER_BPS),
              feeRStress: r.feeR(STRESS_MAKER_BPS, STRESS_TAKER_BPS),
              stopDistancePct: (risk / fill) * 100,
              tags: {
                hitTp1: r.hitTp1, hitTp2: r.hitTp2, pullbackSource: p.source, breakType: p.breakType,
                tp1R: (long ? p.tp1 - fill : fill - p.tp1) / risk,
                tp2R: (long ? p.tp2 - fill : fill - p.tp2) / risk,
              },
            });
            pend = null;   // research semantics: scan continues on this very bar
          }
        }
      } else if (hitStop) {
        funnel.cancelled++; pend = null;
      } else if (waited >= CORRIDOR_EXPIRY_BARS) {
        funnel.expired++; pend = null;
      }
    }

    /* ---- look for a new pullback-continuation setup ---- */
    if (pend === null) {
      const trend = trendHere;
      if (!trend) continue;
      const long0 = trend.dir === 'LONG';
      if (long0 ? !(c.close > trend.legLow) : !(c.close < trend.legHigh)) continue;

      const br = bodyRatio(c);
      if (br < MIN_BODY_RATIO) continue;
      if (long0 ? !(c.close > c.open) : !(c.close < c.open)) continue;
      const rvol = rvolAt(h1, i, volPeriod);
      if (rvol === null || !(rvol > MIN_RVOL)) continue;
      const atr = atrAt(h1, i, atrPeriod);
      if (atr === null || !(atr > 0)) continue;

      const brk = detectStructureBreak(h1, swings1h, i, atr, 0);
      if (!brk || brk.wickOnly || brk.direction !== trend.dir) continue;
      if (brk.levelIndex >= i) continue;

      const anchor = brk.levelIndex;
      const eqTouch = lastTouchEq[trend.dir] > anchor ? lastTouchEq[trend.dir] : -1;
      const fvgTouch = lastTouchFvg[trend.dir] > anchor ? lastTouchFvg[trend.dir] : -1;
      if (eqTouch < 0 && fvgTouch < 0) continue;
      if (pullbackMode === 'same-bar' && eqTouch !== i && fvgTouch !== i) continue;
      const source: PullbackSource = eqTouch >= 0 && fvgTouch >= 0 ? 'EQ+FVG' : eqTouch >= 0 ? 'EQ' : 'FVG';

      let extreme = trend.dir === 'LONG' ? Infinity : -Infinity;
      for (let m = brk.levelIndex + 1; m <= i; m++) {
        const bar = h1[m]!;
        extreme = trend.dir === 'LONG' ? Math.min(extreme, bar.low) : Math.max(extreme, bar.high);
      }
      if (!Number.isFinite(extreme)) continue;

      funnel.signals++;
      const half = CORRIDOR_ATR_FRAC * atr;
      const stop = long0 ? extreme - STOP_BUFFER_ATR * atr : extreme + STOP_BUFFER_ATR * atr;
      const leg = trend.legHigh - trend.legLow;
      const tp1 = long0 ? trend.legHigh : trend.legLow;
      const tp2 = long0 ? trend.legLow + TP2_FIB_EXT * leg : trend.legHigh - TP2_FIB_EXT * leg;
      pend = {
        dir: trend.dir, zoneLow: c.close - half, zoneHigh: c.close + half,
        stop, tp1, tp2, setupIndex: i, source, breakType: brk.type,
      };
      funnel.pendingCreated++;
    }
  }

  return { trades, funnel, maxCandleOpenTimeRead: maxRead };
}
