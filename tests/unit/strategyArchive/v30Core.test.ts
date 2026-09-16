import { describe, it, expect } from 'vitest';
import {
  V30_CONSTANTS, bodyRatio, confirmedLevels, corridorStep, detectTrap, legFeeR, manageTrade,
} from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import type { ArchiveCandle } from '@/services/strategyArchive';

const H = 3_600_000;
const bar = (i: number, o: number, h: number, l: number, c: number, v = 1000, span = H): ArchiveCandle => ({
  openTime: i * span, open: o, high: h, low: l, close: c, volume: v, closeTime: i * span + span - 1, isClosed: true,
});

describe('V3.0 frozen constants (pre-registered, never swept)', () => {
  it('match the source artifact constants block', () => {
    expect(V30_CONSTANTS.MIN_BODY_RATIO).toBe(0.35);
    expect(V30_CONSTANTS.MIN_RVOL).toBe(1.25);
    expect(V30_CONSTANTS.CORRIDOR_ATR_FRAC).toBe(0.1);
    expect(V30_CONSTANTS.CORRIDOR_EXPIRY_BARS).toBe(3);
    expect(V30_CONSTANTS.STOP_BUFFER_ATR).toBe(0.15);
    expect(V30_CONSTANTS.TIMEOUT_BARS).toBe(50);
    expect(V30_CONSTANTS.MAKER_BPS).toBe(2);
    expect(V30_CONSTANTS.TAKER_BPS).toBe(5);
    expect(V30_CONSTANTS.EXEC_TF).toBe('1h');
    expect(V30_CONSTANTS.STRUCT_TF).toBe('4h');
  });
});

describe('HTF closed-candle alignment and pivot confirmation', () => {
  // 4h candles: build a clear swing high at index 5 (strength 3 → confirmed at index 8)
  const h4: ArchiveCandle[] = [];
  const highs = [10, 11, 12, 13, 14, 20, 13, 12, 11, 10, 9];
  for (let i = 0; i < highs.length; i++) h4.push(bar(i, 10, highs[i]!, 5, 10, 1, 4 * H));

  it('a pivot is not usable before its confirmation bar has CLOSED', () => {
    // as-of close of 4h bar index 7 → usable bars 0..7 → confirmedIndex 8 not yet present
    const asOf7 = 7 * 4 * H + 4 * H - 1;
    expect(confirmedLevels(h4, asOf7, 3).swingHigh).toBeNull();
    // 1h bar closing at the same instant as 4h bar 8 (closeTime = open+4H−1): the 4h bar is
    // NOT yet visible (research gate: openTime + span <= asOfCloseTime is false by 1 ms)
    const asOf8 = 8 * 4 * H + 4 * H - 1;
    expect(confirmedLevels(h4, asOf8, 3).swingHigh).toBeNull();
    // the NEXT 1h bar (closing one hour later) sees bar 8 → pivot confirmed
    const asOfNext = 8 * 4 * H + 4 * H + H - 1;
    expect(confirmedLevels(h4, asOfNext, 3).swingHigh).toBe(20);
  });

  it('a forming 4h candle (closeTime after the 1h bar close) is excluded', () => {
    // 1h bar closing in the middle of 4h bar 8: 4h bar 8 must NOT be visible
    const asOfMid8 = 8 * 4 * H + H - 1;
    expect(confirmedLevels(h4, asOfMid8, 3).swingHigh).toBeNull();
  });

  it('a candle flagged isClosed=false is never consulted', () => {
    const h4Open = h4.map((c, i) => (i === 8 ? { ...c, isClosed: false } : c));
    const asOf8 = 8 * 4 * H + 4 * H - 1;
    expect(confirmedLevels(h4Open, asOf8, 3).swingHigh).toBeNull();
  });
});

describe('trap detection', () => {
  const levels = { swingHigh: 110, swingLow: 90 };
  it('SHORT: pierce above 4h high and close back below, body ≥ 0.35, RVOL > 1.25', () => {
    const c = bar(0, 108, 112, 106, 107);   // body 1 / range 6 = 0.166 → rejected
    expect(detectTrap(c, levels, 2)).toBeNull();
    const c2 = bar(0, 109, 112, 106, 106.5); // body 2.5/6 = 0.416
    expect(detectTrap(c2, levels, 2)?.direction).toBe('SHORT');
    expect(detectTrap(c2, levels, 1.25)).toBeNull();  // strict >
    expect(detectTrap(c2, levels, 1.2501)?.direction).toBe('SHORT');
    expect(detectTrap(c2, levels, null)).toBeNull();
  });
  it('LONG: pierce below 4h low and close back above', () => {
    const c = bar(0, 91, 94, 88, 93.5);
    const s = detectTrap(c, levels, 3);
    expect(s?.direction).toBe('LONG');
    expect(s?.sweepExtreme).toBe(88);
    expect(s?.level).toBe(90);
  });
  it('no reclaim on the SAME bar → no trap (no multi-bar window)', () => {
    const c = bar(0, 108, 112, 107, 111);   // closes above the swept high
    expect(detectTrap(c, levels, 3)).toBeNull();
  });
  it('bodyRatio is 0 on a degenerate bar', () => {
    expect(bodyRatio(bar(0, 5, 5, 5, 5))).toBe(0);
  });
});

describe('corridor fill semantics (entry N+1, worse edge, ambiguity against the trade)', () => {
  const p = { dir: 'LONG' as const, zoneLow: 99, zoneHigh: 101, stop: 95, tp1: 105, tp2: 110, setupIndex: 10 };
  it('fills at the worse edge: min(open, zoneHigh) for LONG', () => {
    const s = corridorStep(p, bar(11, 100.5, 102, 99.5, 101), 11);
    expect(s).toEqual({ kind: 'FILLED', fill: 100.5, risk: 5.5 });
    const s2 = corridorStep(p, bar(11, 103, 104, 100.8, 102), 11);
    expect(s2).toEqual({ kind: 'FILLED', fill: 101, risk: 6 });
  });
  it('a bar that both touches the zone and breaches the stop → CANCELLED', () => {
    expect(corridorStep(p, bar(11, 100, 101, 94, 96), 11)).toEqual({ kind: 'CANCELLED' });
  });
  it('stop breached before a fill → CANCELLED; no touch for 3 bars → EXPIRED', () => {
    expect(corridorStep(p, bar(11, 103, 104, 94.9, 103), 11)).toEqual({ kind: 'CANCELLED' });
    expect(corridorStep(p, bar(12, 103, 104, 102, 103), 12)).toEqual({ kind: 'WAIT' });
    expect(corridorStep(p, bar(13, 103, 104, 102, 103), 13)).toEqual({ kind: 'EXPIRED' });
  });
  it('geometry violation → REJECTED_GEOMETRY', () => {
    const bad = { ...p, tp1: 100 };   // TP1 not above fill
    expect(corridorStep(bad, bar(11, 100.5, 102, 99.5, 101), 11)).toEqual({ kind: 'REJECTED_GEOMETRY' });
  });
});

describe('trade management R1–R5 and per-leg fees 2/5 bps', () => {
  const E = 100, S = 95, TP1 = 105, TP2 = 110;   // LONG, R = 5
  it('R1: a bar touching both stop and TP books the STOP', () => {
    const r = manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 106, 94, 100)]);
    expect(r?.exit).toBe('SL');
    expect(r?.grossR).toBe(-1);
  });
  it('R2: TP1 then TP2 on the same bar → TP2 with 0.5·1R + 0.5·2R = 1.5R', () => {
    const r = manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 111, 99, 110)]);
    expect(r?.exit).toBe('TP2');
    expect(r?.grossR).toBeCloseTo(1.5, 12);
  });
  it('R3: breakeven is NOT armed on the TP1 bar, only strictly after', () => {
    // bar 0 hits TP1 and then dips to entry — no BE yet, stop still 95 → trade continues
    const r = manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 105.5, 99.5, 100), bar(1, 100, 101, 99.9, 100)]);
    expect(r?.exit).toBe('TP1_THEN_BE');
    expect(r?.barsHeld).toBe(2);
    expect(r?.grossR).toBeCloseTo(0.5, 12);   // 0.5·1R + 0.5·0R
  });
  it('TP1 then stop hit before BE arms (same bar as TP1 dips to stop) → SL first by R1', () => {
    const r = manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 105.5, 94.5, 100)]);
    expect(r?.exit).toBe('SL');
  });
  it('R5: timeout counts the entry bar as bar 1 → closes on bar index 49', () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100, 101, 99, 100.5));
    const r = manageTrade('LONG', E, S, TP1, TP2, bars);
    expect(r?.exit).toBe('TIMEOUT');
    expect(r?.barsHeld).toBe(50);
    expect(r?.grossR).toBeCloseTo(0.1, 12);
  });
  it('unresolved when the series ends first', () => {
    expect(manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 101, 99, 100)])).toBeNull();
  });
  it('fees: maker entry 2 bps + taker 5 bps per closing leg, on each leg\'s own notional, in R', () => {
    const r = manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 111, 99, 110)])!;
    const expected = legFeeR(100, 1, 2, 5) + legFeeR(105, 0.5, 5, 5) + legFeeR(110, 0.5, 5, 5);
    expect(r.feeR(2, 5)).toBeCloseTo(expected, 12);
    expect(r.feeR(0, 0)).toBe(0);
    // stress 5/5 is strictly larger
    expect(r.feeR(5, 5)).toBeGreaterThan(r.feeR(2, 5));
    // three legs on a partial exit, two legs on a plain SL
    const sl = manageTrade('LONG', E, S, TP1, TP2, [bar(0, 100, 101, 94, 96)])!;
    expect(sl.feeR(2, 5)).toBeCloseTo(legFeeR(100, 1, 2, 5) + legFeeR(95, 1, 5, 5), 12);
  });
  it('SHORT mirror: sweep high trap with TP below', () => {
    const r = manageTrade('SHORT', 100, 105, 95, 90, [bar(0, 100, 100.5, 89, 90)]);
    expect(r?.exit).toBe('TP2');
    expect(r?.grossR).toBeCloseTo(1.5, 12);
  });
});
