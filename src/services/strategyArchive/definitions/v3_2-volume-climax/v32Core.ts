/**
 * V3.2 — HTF VOLUME CLIMAX & ABSORPTION — pure strategy logic (immutable).
 *
 * Ported verbatim from svechnoy-suslik-v2 @ b46b4a0 (TRAIN result commit)
 *   research/v32_volume_climax.ts  sha256 c209b8d7ecf38940b910cc8de49608a0d8a849b75c9083f4492f691c08075bb6
 * Only imports / type names differ. DO NOT EDIT — historical semantics.
 *
 * RESEARCH VERDICT (source): V3_2_FALSIFIED_ON_TRAIN (primary union/cascade: net −0.0620, gross −0.0082,
 * n=307). The two EMA50-TP1 sensitivity variants pass F1 but falsify F3 → V3_2_EMA50_VARIANT_UNPROMOTED.
 * All four archived variants are shipped; none is cherry-picked. CRYPTORA does not execute trades.
 */

import type { ArchiveCandle, ArchiveDirection } from '../../types';

export const V32_CONSTANTS = Object.freeze({
  EXPANSION_ATR_MULT: 2.0,
  CASCADE_K_MIN: 3,
  CASCADE_K_MAX: 6,
  MIN_RVOL: 2.2,              // inclusive, as written (V3.0/V3.1 used >)
  WICK_FRAC_MIN: 0.40,
  ENGULF_BODY_MIN: 0.40,
  CLOSE_TOP_FRAC: 0.70,
  CLOSE_BOTTOM_FRAC: 0.30,
  EMA_TP1_PERIOD: 50,
  CORRIDOR_ATR_FRAC: 0.10,
  CORRIDOR_EXPIRY_BARS: 3,
  STOP_BUFFER_ATR: 0.15,
  TIMEOUT_BARS: 48,
  MAKER_BPS: 2,
  TAKER_BPS: 5,
  STRESS_MAKER_BPS: 5,
  STRESS_TAKER_BPS: 5,
  WARMUP_BARS: 60,
  EXEC_TF: '1h' as const,
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as readonly string[],
});

export type CascadeMode = 'union' | 'fast3';
export type Tp1Mode = 'cascade' | 'ema50';
export type AbsorptionKind = 'WICK' | 'ENGULF' | 'WICK+ENGULF';
export type V32ExitReason = 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT';

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

export interface Cascade {
  dir: ArchiveDirection;
  k: number;
  startIndex: number;
  origin: number;
  terminal: number;
  moveAtr: number;
}

/** `union` = LARGEST qualifying k in 6..3 (primary); `fast3` = k=3 only. Down-cascade → LONG fade. */
export function detectCascade(
  candles: readonly ArchiveCandle[], index: number, atr: number, mode: CascadeMode,
): Cascade | null {
  const { CASCADE_K_MIN, CASCADE_K_MAX, EXPANSION_ATR_MULT } = V32_CONSTANTS;
  if (!(atr > 0)) return null;
  const close = candles[index]!.close;
  const ks = mode === 'fast3' ? [CASCADE_K_MIN] : [CASCADE_K_MAX, 5, 4, CASCADE_K_MIN];

  for (const k of ks) {
    const startIndex = index - k;
    if (startIndex < 0) continue;
    const then = candles[startIndex]!.close;
    const signed = close - then;
    if (Math.abs(signed) < EXPANSION_ATR_MULT * atr) continue;

    let high = -Infinity;
    let low = Infinity;
    for (let m = startIndex; m <= index; m++) {
      const bar = candles[m]!;
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
    }
    const down = signed < 0;
    return {
      dir: down ? 'LONG' : 'SHORT',
      k, startIndex,
      origin: down ? high : low,
      terminal: down ? low : high,
      moveAtr: Math.abs(signed) / atr,
    };
  }
  return null;
}

/** Absorption at the climax bar: long rejection wick (closing with the fade) or strong engulfing reversal. */
export function absorption(
  c: ArchiveCandle, prev: ArchiveCandle | undefined, dir: ArchiveDirection,
): AbsorptionKind | null {
  const { WICK_FRAC_MIN, ENGULF_BODY_MIN, CLOSE_TOP_FRAC, CLOSE_BOTTOM_FRAC } = V32_CONSTANTS;
  const range = c.high - c.low;
  if (!(range > 0)) return null;
  const long = dir === 'LONG';

  const wick = long
    ? (Math.min(c.open, c.close) - c.low) / range
    : (c.high - Math.max(c.open, c.close)) / range;
  const wickOk = wick >= WICK_FRAC_MIN && (long ? c.close > c.open : c.close < c.open);

  let engulfOk = false;
  if (prev) {
    const body = bodyRatio(c);
    const pos = closePosition(c);
    const engulfs = long
      ? prev.close < prev.open && c.close > c.open && c.open <= prev.close && c.close >= prev.open
      : prev.close > prev.open && c.close < c.open && c.open >= prev.close && c.close <= prev.open;
    const closes = long ? pos >= CLOSE_TOP_FRAC : pos <= CLOSE_BOTTOM_FRAC;
    engulfOk = engulfs && body >= ENGULF_BODY_MIN && closes;
  }

  if (wickOk && engulfOk) return 'WICK+ENGULF';
  if (engulfOk) return 'ENGULF';
  if (wickOk) return 'WICK';
  return null;
}

export function legFeeR(price: number, weight: number, bps: number, risk: number): number {
  if (!(risk > 0)) return 0;
  return (bps / 10000) * price * weight / risk;
}

export interface V32TradeResult {
  exit: V32ExitReason;
  grossR: number;
  feeR: (makerBps: number, takerBps: number) => number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
}

/** R1..R5 frozen intrabar conventions; TIMEOUT_BARS = 48. */
export function manageTrade(
  direction: ArchiveDirection, entry: number, stop0: number,
  tp1: number, tp2: number, bars: readonly ArchiveCandle[],
): V32TradeResult | null {
  const { TIMEOUT_BARS } = V32_CONSTANTS;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [];
  legs.push({ price: entry, weight: 1, taker: false });

  const finish = (exit: V32ExitReason, exitPrice: number, weight: number, i: number): V32TradeResult => {
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
    if (i + 1 >= TIMEOUT_BARS) {
      return finish(hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', c.close, hitTp1 ? 0.5 : 1, i);
    }
  }
  return null;
}
