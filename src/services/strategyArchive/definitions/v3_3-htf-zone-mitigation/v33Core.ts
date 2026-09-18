/**
 * V3.3 — HTF ZONE MITIGATION & LTF SQUEEZE — pure strategy logic (immutable).
 *
 * Ported verbatim from svechnoy-suslik-v2 @ a7ecd79 (TRAIN result commit)
 *   research/v33_zone_mitigation.ts  sha256 3f5b1478a1b0c240a85b28a0280d61761246091ca0ed122fab2e03113fe2b1c6
 * Only imports / type names differ. DO NOT EDIT — historical semantics.
 *
 * RESEARCH VERDICT (source): V3_3_TRAIN_ONLY — passed pre-registered TRAIN criteria (headline
 * while/protective/displacement: net +0.0267, n=6,957) but NOT validated; tail-fragile (ex-top-1 %
 * gross 0.0264 < fee 0.0511); `first` window fails F1. NOT production-ready. This is a REVERSAL
 * (mitigation) strategy — the early "Zone Continuation" wording was wrong. CRYPTORA does not execute trades.
 */

import type { ArchiveCandle, ArchiveDirection } from '../../types';
import {
  buildOrderBlock, detectDisplacement, detectStructureBreak, findFvg,
  type ArchiveSwing,
} from '../../shared/primitives';

export const V33_CONSTANTS = Object.freeze({
  MIN_RVOL: 1.25,             // inclusive, as written
  WICK_FRAC_MIN: 0.35,
  RECLAIM_BODY_MIN: 0.40,
  CLOSE_TOP_FRAC: 0.70,
  CLOSE_BOTTOM_FRAC: 0.30,
  CORRIDOR_ATR_FRAC: 0.10,
  CORRIDOR_EXPIRY_BARS: 3,
  STOP_BUFFER_ATR: 0.15,
  TIMEOUT_BARS: 48,
  MAKER_BPS: 2,
  TAKER_BPS: 5,
  STRESS_MAKER_BPS: 5,
  STRESS_TAKER_BPS: 5,
  FVG_FILL_MIN: 0.50,
  WARMUP_BARS: 60,
  EXEC_TF: '1h' as const,
  STRUCT_TF: '4h' as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

export type ZoneType = 'OB' | 'FVG';
export type WindowMode = 'while' | 'first';
export type StopMode = 'protective' | 'climax';
export type LegMode = 'displacement' | 'swing';
export type V33AbsorptionKind = 'WICK' | 'RECLAIM' | 'WICK+RECLAIM';
export type V33ExitReason = 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT';

export function bodyRatio(c: ArchiveCandle): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0;
  return Math.abs(c.close - c.open) / range;
}
export function closePosition(c: ArchiveCandle): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0;
  return (c.close - c.low) / range;
}
export function rejectionWick(c: ArchiveCandle, dir: ArchiveDirection): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0;
  return dir === 'LONG'
    ? (Math.min(c.open, c.close) - c.low) / range
    : (c.high - Math.max(c.open, c.close)) / range;
}

export interface Zone {
  id: number;
  type: ZoneType;
  dir: ArchiveDirection;
  zoneLow: number;
  zoneHigh: number;
  knownAt4h: number;
  legLow: number;
  legHigh: number;
  swingLegLow: number | null;
  swingLegHigh: number | null;
  strength: number;
  origin: string;
}

export interface SwingLevels {
  high: (number | null)[];
  low: (number | null)[];
  bullLeg: ({ legLow: number; legHigh: number } | null)[];
  bearLeg: ({ legLow: number; legHigh: number } | null)[];
}

export interface HtfZonesInput {
  h4: readonly ArchiveCandle[];
  atr4: readonly (number | null)[];
  rvol4: readonly (number | null)[];
  swings4: readonly ArchiveSwing[];
  displacementMinBodyAtr: number;
  fvgMinSizeAtr: number;
  levels: SwingLevels;
}

export function legAt(levels: SwingLevels, dir: ArchiveDirection, closedCount: number): { legLow: number; legHigh: number } | null {
  const table = dir === 'LONG' ? levels.bullLeg : levels.bearLeg;
  return table[closedCount] ?? null;
}

/** Every 4H zone once per symbol: OBs from displacement moves and displacement-created FVGs. */
export function buildZones(inp: HtfZonesInput): Zone[] {
  const { h4, atr4, rvol4, swings4, displacementMinBodyAtr, fvgMinSizeAtr, levels } = inp;
  const { STRUCT_TF } = V33_CONSTANTS;
  const zones: Zone[] = [];
  let id = 0;

  for (let i = 1; i < h4.length - 1; i++) {
    const atr = atr4[i] ?? null;
    if (atr === null || !(atr > 0)) continue;
    const rvol = rvol4[i] ?? null;
    const disp = detectDisplacement(h4, i, atr, rvol, displacementMinBodyAtr);
    if (!disp) continue;

    const brk = detectStructureBreak(h4, swings4, i, atr, 0);
    const origin = brk && !brk.wickOnly && brk.direction === disp.direction ? brk.type : 'SWEEP_REACTION';
    const ob = buildOrderBlock(h4, disp, origin, i, STRUCT_TF);
    if (ob) {
      let legLow = Infinity;
      let legHigh = -Infinity;
      for (let m = ob.index; m <= i; m++) {
        legLow = Math.min(legLow, h4[m]!.low);
        legHigh = Math.max(legHigh, h4[m]!.high);
      }
      const sl = legAt(levels, disp.direction, i);
      zones.push({
        id: id++, type: 'OB', dir: disp.direction, zoneLow: ob.low, zoneHigh: ob.high, knownAt4h: i,
        legLow, legHigh, swingLegLow: sl?.legLow ?? null, swingLegHigh: sl?.legHigh ?? null,
        strength: disp.strength, origin,
      });
    }

    const gap = findFvg(h4, i, atr, i + 1, STRUCT_TF, fvgMinSizeAtr);
    if (gap) {
      let legLow = Infinity;
      let legHigh = -Infinity;
      for (let m = i - 1; m <= i + 1; m++) {
        legLow = Math.min(legLow, h4[m]!.low);
        legHigh = Math.max(legHigh, h4[m]!.high);
      }
      const sl = legAt(levels, gap.direction, i + 1);
      zones.push({
        id: id++, type: 'FVG', dir: gap.direction, zoneLow: gap.bottom, zoneHigh: gap.top, knownAt4h: i + 1,
        legLow, legHigh, swingLegLow: sl?.legLow ?? null, swingLegHigh: sl?.legHigh ?? null,
        strength: disp.strength, origin: gap.direction === 'LONG' ? 'BULLISH_IMBALANCE' : 'BEARISH_IMBALANCE',
      });
    }
  }
  return zones;
}

export function intersects(c: ArchiveCandle, low: number, high: number): boolean {
  return c.low <= high && c.high >= low;
}

export function advanceFill(c: ArchiveCandle, dir: ArchiveDirection, bottom: number, top: number, current: number): number {
  const size = top - bottom;
  if (!(size > 0)) return current;
  const overlapLow = Math.max(bottom, c.low);
  const overlapHigh = Math.min(top, c.high);
  let frac = current;
  if (overlapHigh > overlapLow) frac = Math.max(frac, Math.min(1, (overlapHigh - overlapLow) / size));
  const fullyThrough = dir === 'LONG' ? c.low <= bottom : c.high >= top;
  if (fullyThrough) frac = 1;
  return frac;
}

export interface ZoneWindow {
  zone: Zone;
  startIndex: number;
  mitigationIndex: number;
  deathIndex: number;
}

/** OB: first touch mitigates, close beyond far edge kills; FVG: fill ≥ 50 % mitigates, full fill kills. */
export function trackZone(
  h1: readonly ArchiveCandle[], zone: Zone, closed4hAt: Int32Array, fvgFillMin = V33_CONSTANTS.FVG_FILL_MIN,
): ZoneWindow | null {
  const need = zone.knownAt4h + 1;
  let start = -1;
  for (let i = 0; i < h1.length; i++) {
    if (closed4hAt[i]! >= need) { start = i; break; }
  }
  if (start < 0) return null;

  let fill = 0;
  let mitigationIndex = -1;
  let deathIndex = h1.length;
  for (let i = start; i < h1.length; i++) {
    const c = h1[i]!;
    let mitigatedNow = false;
    if (zone.type === 'OB') {
      mitigatedNow = intersects(c, zone.zoneLow, zone.zoneHigh);
    } else {
      fill = advanceFill(c, zone.dir, zone.zoneLow, zone.zoneHigh, fill);
      mitigatedNow = fill >= fvgFillMin;
    }
    const invalid = zone.type === 'OB'
      ? (zone.dir === 'LONG' ? c.close < zone.zoneLow : c.close > zone.zoneHigh)
      : fill >= 1;
    if (invalid) {
      if (mitigationIndex < 0) return null;
      deathIndex = i;
      break;
    }
    if (mitigationIndex < 0 && mitigatedNow) mitigationIndex = i;
  }
  if (mitigationIndex < 0) return null;
  return { zone, startIndex: start, mitigationIndex, deathIndex };
}

export function absorption(c: ArchiveCandle, dir: ArchiveDirection): V33AbsorptionKind | null {
  const { WICK_FRAC_MIN, RECLAIM_BODY_MIN, CLOSE_TOP_FRAC, CLOSE_BOTTOM_FRAC } = V33_CONSTANTS;
  const range = c.high - c.low;
  if (!(range > 0)) return null;
  const wickOk = rejectionWick(c, dir) >= WICK_FRAC_MIN;
  const reclaimOk = bodyRatio(c) >= RECLAIM_BODY_MIN
    && (dir === 'LONG' ? closePosition(c) >= CLOSE_TOP_FRAC : closePosition(c) <= CLOSE_BOTTOM_FRAC);
  if (wickOk && reclaimOk) return 'WICK+RECLAIM';
  if (reclaimOk) return 'RECLAIM';
  if (wickOk) return 'WICK';
  return null;
}

export function legFeeR(price: number, weight: number, bps: number, risk: number): number {
  if (!(risk > 0)) return 0;
  return (bps / 10000) * price * weight / risk;
}

export interface V33TradeResult {
  exit: V33ExitReason;
  grossR: number;
  feeR: (makerBps: number, takerBps: number) => number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
}

export function manageTrade(
  direction: ArchiveDirection, entry: number, stop0: number, tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V33TradeResult | null {
  const { TIMEOUT_BARS } = V33_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [];
  legs.push({ price: entry, weight: 1, taker: false });

  const finish = (exit: V33ExitReason, exitPrice: number, weight: number, i: number): V33TradeResult => {
    legs.push({ price: exitPrice, weight, taker: true });
    const gross = realised + weight * rOf(exitPrice);
    return {
      exit, grossR: gross, barsHeld: i + 1, hitTp1, hitTp2: exit === 'TP2',
      feeR: (mk, tk) => legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? tk : mk, risk), 0),
    };
  };

  for (let i = 0; i < bars.length && i < TIMEOUT_BARS; i++) {
    const c = bars[i]!;
    const beArmed = hitTp1 && tp1Bar >= 0 && i > tp1Bar;
    const stopNow = beArmed ? entry : stop0;
    const hitStop = long ? c.low <= stopNow : c.high >= stopNow;
    const hitT1 = !hitTp1 && (long ? c.high >= tp1 : c.low <= tp1);
    const hitT2 = long ? c.high >= tp2 : c.low <= tp2;

    if (hitStop) {
      if (!hitTp1) return finish('SL', stopNow, 1, i);
      return finish(beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', stopNow, 0.5, i);
    }
    if (hitT1) {
      hitTp1 = true; tp1Bar = i;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      if (hitT2) return finish('TP2', tp2, 0.5, i);
      if (i + 1 >= TIMEOUT_BARS) return finish('TP1_THEN_TIMEOUT', c.close, 0.5, i);
      continue;
    }
    if (hitTp1 && hitT2) return finish('TP2', tp2, 0.5, i);
    if (!hitTp1 && hitT2) {
      hitTp1 = true;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      return finish('TP2', tp2, 0.5, i);
    }
    if (i + 1 >= TIMEOUT_BARS) return finish(hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', c.close, hitTp1 ? 0.5 : 1, i);
  }
  return null;
}

/** Last confirmed 4H swing high/low + Amendment-1 ordered legs, per number of CLOSED 4H bars. */
export function confirmedSwingLevels(h4: readonly ArchiveCandle[], swings: readonly ArchiveSwing[]): SwingLevels {
  const n = h4.length;
  const high: (number | null)[] = new Array(n + 1).fill(null);
  const low: (number | null)[] = new Array(n + 1).fill(null);
  const bullLeg: ({ legLow: number; legHigh: number } | null)[] = new Array(n + 1).fill(null);
  const bearLeg: ({ legLow: number; legHigh: number } | null)[] = new Array(n + 1).fill(null);
  let sw = 0;
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  type Swing = { kind: 'HIGH' | 'LOW'; price: number };
  const recent: Swing[] = [];
  for (let k = 0; k <= n; k++) {
    const evalIdx = k - 1;
    while (sw < swings.length && swings[sw]!.confirmedIndex <= evalIdx) {
      const s = swings[sw]!;
      if (s.kind === 'HIGH') lastHigh = s.price;
      else lastLow = s.price;
      recent.push({ kind: s.kind, price: s.price });
      if (recent.length > 2) recent.shift();
      sw++;
    }
    high[k] = lastHigh;
    low[k] = lastLow;
    const older: Swing | undefined = recent[recent.length - 2];
    const newer: Swing | undefined = recent[recent.length - 1];
    bullLeg[k] = older && newer && older.kind === 'LOW' && newer.kind === 'HIGH' ? { legLow: older.price, legHigh: newer.price } : null;
    bearLeg[k] = older && newer && older.kind === 'HIGH' && newer.kind === 'LOW' ? { legLow: newer.price, legHigh: older.price } : null;
  }
  return { high, low, bullLeg, bearLeg };
}
