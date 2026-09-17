/**
 * V3.3 historical runner — reproduces research/v33_zone_mitigation.ts `main()` per symbol
 * (TRAIN only). Eight archived runs = window {while|first} × stop {protective|climax} × leg {displacement|swing}.
 * Variant id format: `<window>-<stop>-<leg>`; headline (source isPrimary) = `while-protective-displacement`.
 *
 * Preserved: hard truncation; warm-up 60 (zones whose first usable 1H bar < 60 are skipped);
 * closed-4H pointer per 1H bar; Amendment-1 tie-break (most recently created zone, OB before FVG);
 * corridor N+1; ambiguity → cancelled; overlapping positions (scan continues on the fill bar).
 */

import type { ArchiveCandle, ArchiveSeriesInput, ArchiveTrade, FunnelCounts, SliceName } from '../../types';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { atrSeriesV2, findSwingsV2, rvolAt } from '../../shared/primitives';
import {
  V33_CONSTANTS, absorption, buildZones, confirmedSwingLevels, intersects, manageTrade, trackZone,
  type LegMode, type StopMode, type V33AbsorptionKind, type WindowMode, type ZoneWindow,
} from './v33Core';

export const V33_VARIANT_IDS = [
  'while-protective-displacement', 'while-protective-swing', 'while-climax-displacement', 'while-climax-swing',
  'first-protective-displacement', 'first-protective-swing', 'first-climax-displacement', 'first-climax-swing',
] as const;
export type V33VariantId = (typeof V33_VARIANT_IDS)[number];

export function parseVariant(id: string | undefined): { window: WindowMode; stop: StopMode; leg: LegMode } {
  const v = (id ?? 'while-protective-displacement') as V33VariantId;
  if (!V33_VARIANT_IDS.includes(v)) throw new Error(`V3.3: unknown variant ${id}`);
  const [window, stop, leg] = v.split('-') as [WindowMode, StopMode, LegMode];
  return { window, stop, leg };
}

export interface V33Extra {
  zonesTotal: number; zonesMitigated: number; zonesDead: number; zonesSkippedByWarmup: number;
  skippedNoSwingLeg: number; triggersInZone: number; multiZoneBars: number; triggersWithTp1BehindClose: number;
  zonesByType: Record<string, number>;
}
export interface V33RunOutput {
  trades: ArchiveTrade[];
  funnel: FunnelCounts;
  maxCandleOpenTimeRead: number;
  extra: V33Extra;
}

interface Pending {
  dir: 'LONG' | 'SHORT'; zoneLow: number; zoneHigh: number; stop: number;
  tp1: number; tp2: number; setupIndex: number; zoneType: string; kind: V33AbsorptionKind;
}

export function runV33Series(input: ArchiveSeriesInput, slice: SliceName, variantId?: string): V33RunOutput {
  if (slice !== 'train') throw new Error('V3.3 was only ever run on TRAIN (TRAIN_ONLY, not validated) — no other slice exists');
  const { window: windowMode, stop: stopMode, leg: legMode } = parseVariant(variantId);
  const {
    MIN_RVOL, CORRIDOR_ATR_FRAC, CORRIDOR_EXPIRY_BARS, STOP_BUFFER_ATR, TIMEOUT_BARS, MAKER_BPS, TAKER_BPS,
    STRESS_MAKER_BPS, STRESS_TAKER_BPS, FVG_FILL_MIN, WARMUP_BARS, EXEC_TF, STRUCT_TF,
  } = V33_CONSTANTS;
  const strength = FROZEN_ENGINE.swingLookback;
  const atrPeriod = FROZEN_ENGINE.atrPeriod;
  const volPeriod = FROZEN_ENGINE.volumePeriod;
  const b = input.split;
  if (!(b.trainFromMs < b.trainToMs && b.trainToMs < b.validFromMs)) {
    throw new Error(`${input.symbol}: TRAIN window is not strictly before VALIDATION — refusing`);
  }

  const all1 = (input.bySeries[EXEC_TF] ?? []).filter((c) => c.isClosed);
  const all4 = (input.bySeries[STRUCT_TF] ?? []).filter((c) => c.isClosed);
  const h1: readonly ArchiveCandle[] = all1.filter((c) => c.openTime >= b.trainFromMs && c.openTime <= b.trainToMs);
  const h4: readonly ArchiveCandle[] = all4.filter((c) => c.openTime <= b.trainToMs);

  const atr1 = atrSeriesV2(h1, atrPeriod);
  const atr4 = atrSeriesV2(h4, atrPeriod);
  const rvol4: (number | null)[] = h4.map((_, i) => rvolAt(h4, i, volPeriod));
  const swings4 = findSwingsV2(h4, strength);
  const levels = confirmedSwingLevels(h4, swings4);

  const zones = buildZones({
    h4, atr4, rvol4, swings4,
    displacementMinBodyAtr: FROZEN_ENGINE.displacementMinBodyAtr, fvgMinSizeAtr: FROZEN_ENGINE.fvgMinSizeAtr, levels,
  });
  const extra: V33Extra = {
    zonesTotal: zones.length, zonesMitigated: 0, zonesDead: 0, zonesSkippedByWarmup: 0, skippedNoSwingLeg: 0,
    triggersInZone: 0, multiZoneBars: 0, triggersWithTp1BehindClose: 0, zonesByType: {},
  };
  for (const z of zones) extra.zonesByType[z.type] = (extra.zonesByType[z.type] ?? 0) + 1;

  const span4h = 4 * 3_600_000;
  const closed4hAt = new Int32Array(h1.length);
  {
    let k = 0;
    for (let i = 0; i < h1.length; i++) {
      while (k < h4.length && h4[k]!.openTime + span4h <= h1[i]!.closeTime) k++;
      closed4hAt[i] = k;
    }
  }

  const windows: ZoneWindow[] = [];
  for (const z of zones) {
    const w = trackZone(h1, z, closed4hAt, FVG_FILL_MIN);
    if (!w) continue;
    extra.zonesMitigated++;
    if (w.deathIndex < h1.length) extra.zonesDead++;
    windows.push(w);
  }
  const startsAt = new Map<number, ZoneWindow[]>();
  for (const w of windows) {
    if (w.startIndex < WARMUP_BARS) { extra.zonesSkippedByWarmup++; continue; }
    const list = startsAt.get(w.startIndex) ?? [];
    list.push(w);
    startsAt.set(w.startIndex, list);
  }

  const funnel: FunnelCounts = { signals: 0, pendingCreated: 0, filled: 0, expired: 0, cancelled: 0, rejected: 0, unresolved: 0 };
  const trades: ArchiveTrade[] = [];
  let maxRead = 0;
  let pend: Pending | null = null;
  let active: ZoneWindow[] = [];

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
                hitTp1: r.hitTp1, hitTp2: r.hitTp2, zoneType: p.zoneType, absorption: p.kind,
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

    const starting = startsAt.get(i);
    if (starting) active = active.concat(starting);
    if (active.length > 0) active = active.filter((w) => i < w.deathIndex);

    if (pend === null && active.length > 0) {
      const atr = atr1[i] ?? null;
      if (atr !== null && atr > 0) {
        const rvol = rvolAt(h1, i, volPeriod);
        if (rvol !== null && rvol >= MIN_RVOL) {
          const candidates: { w: ZoneWindow; kind: V33AbsorptionKind }[] = [];
          for (const w of active) {
            if (w.mitigationIndex > i) continue;
            if (windowMode === 'first' && w.mitigationIndex !== i) continue;
            const z = w.zone;
            if (!intersects(c, z.zoneLow, z.zoneHigh)) continue;
            const kind = absorption(c, z.dir);
            if (!kind) continue;
            candidates.push({ w, kind });
          }
          if (candidates.length > 0) {
            if (candidates.length > 1) extra.multiZoneBars++;
            candidates.sort((x, y) => {
              const kd = y.w.zone.knownAt4h - x.w.zone.knownAt4h;
              if (kd !== 0) return kd;
              return (x.w.zone.type === 'OB' ? 0 : 1) - (y.w.zone.type === 'OB' ? 0 : 1);
            });
            const { w, kind } = candidates[0]!;
            const z = w.zone;
            const long = z.dir === 'LONG';
            const half = CORRIDOR_ATR_FRAC * atr;
            const zoneEdge = long ? z.zoneLow : z.zoneHigh;
            const climax = long ? c.low : c.high;
            const stop = stopMode === 'protective'
              ? (long ? Math.min(climax, zoneEdge) - STOP_BUFFER_ATR * atr : Math.max(climax, zoneEdge) + STOP_BUFFER_ATR * atr)
              : (long ? climax - STOP_BUFFER_ATR * atr : climax + STOP_BUFFER_ATR * atr);
            const closed4h = closed4hAt[i]!;
            const opposing = long ? levels.high[closed4h] : levels.low[closed4h];
            if (opposing === null || opposing === undefined) continue;
            let legLow = z.legLow;
            let legHigh = z.legHigh;
            if (legMode === 'swing') {
              if (z.swingLegLow === null || z.swingLegHigh === null) { extra.skippedNoSwingLeg++; continue; }
              legLow = z.swingLegLow;
              legHigh = z.swingLegHigh;
            }
            const tp1 = (legLow + legHigh) / 2;
            extra.triggersInZone++;
            funnel.signals++;
            if (long ? !(tp1 > c.close) : !(tp1 < c.close)) extra.triggersWithTp1BehindClose++;
            pend = { dir: z.dir, zoneLow: c.close - half, zoneHigh: c.close + half, stop, tp1, tp2: opposing, setupIndex: i, zoneType: z.type, kind };
            funnel.pendingCreated++;
          }
        }
      }
    }
  }
  return { trades, funnel, maxCandleOpenTimeRead: maxRead, extra };
}
