/**
 * Фильтр качества целей V3.4: копия ↔ исходник, на случайных (но
 * детерминированных) входах.
 *
 * Проверяется не «похожесть», а полное совпадение результата: причина отказа,
 * канонический вход, риск, R1/R2 и пороги. Плюс инварианты, которые обязаны
 * выполняться в любом случае (границы включительные, цель никогда не
 * сдвигается, при отказе стоп не переносится).
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalEntryReference as canonicalOriginal,
  evaluateTargetQuality as evaluateOriginal,
  expandEntryZone as expandOriginal,
  V34_ENTRY_ZONE_ATR_PAD as PAD_ORIGINAL,
  V34_TP1_MIN_R as TP1_ORIGINAL,
  V34_TP2_MIN_R as TP2_ORIGINAL,
} from '@/services/signals/live/targetQuality';
import {
  atrFromV33Corridor as atrOriginal,
  v34CorridorHook as hookOriginal,
} from '@/services/signals/live/replays/v34LiveReplay';
import {
  canonicalEntryReference,
  evaluateTargetQuality,
  expandEntryZone,
  V34_ENTRY_ZONE_ATR_PAD,
  V34_TP1_MIN_R,
  V34_TP2_MIN_R,
} from '../src/signals/targetQuality';
import { atrFromV33Corridor, v34CorridorHook } from '../src/signals/v34LiveReplay';
import { mulberry32 } from './fixtures/synthetic';

describe('пороги и отступ V3.4 перенесены без изменений', () => {
  it('константы совпадают с исходником', () => {
    expect(V34_TP1_MIN_R).toBe(TP1_ORIGINAL);
    expect(V34_TP2_MIN_R).toBe(TP2_ORIGINAL);
    expect(V34_ENTRY_ZONE_ATR_PAD).toBe(PAD_ORIGINAL);
    expect(V34_TP1_MIN_R).toBe(0.5);
    expect(V34_TP2_MIN_R).toBe(1);
    expect(V34_ENTRY_ZONE_ATR_PAD).toBe(0.25);
  });
});

describe('evaluateTargetQuality: 2000 случайных геометрий', () => {
  it('результат совпадает с исходником полностью', () => {
    const rnd = mulberry32(424242);
    for (let i = 0; i < 2000; i++) {
      const direction = rnd() < 0.5 ? 'LONG' : 'SHORT';
      const entry = 50 + rnd() * 50_000;
      const halfWidth = entry * (0.0005 + rnd() * 0.02);
      const entryLow = entry - halfWidth;
      const entryHigh = entry + halfWidth;
      const riskMult = 0.5 + rnd() * 3;
      const risk = entry * 0.002 * riskMult;
      const stop = direction === 'LONG' ? entryLow - risk * (0.2 + rnd()) : entryHigh + risk * (0.2 + rnd());
      const ref = canonicalOriginal(direction, entryLow, entryHigh);
      const initialRisk = Math.abs(ref - stop);
      const tp1R = rnd() * 2;
      const tp2R = tp1R + rnd() * 3;
      const tp1 = direction === 'LONG' ? ref + initialRisk * tp1R : ref - initialRisk * tp1R;
      const tp2 = direction === 'LONG' ? ref + initialRisk * tp2R : ref - initialRisk * tp2R;
      const input = { direction, entryLow, entryHigh, stop, tp1, tp2 } as const;

      expect(evaluateTargetQuality(input)).toEqual(evaluateOriginal(input));
    }
  });

  it('границы включительные: ровно 0.50 R и ровно 1.00 R принимаются', () => {
    const entryLow = 100;
    const entryHigh = 101;
    const stop = 99;
    const ref = canonicalEntryReference('LONG', entryLow, entryHigh);
    const risk = ref - stop;
    const res = evaluateTargetQuality({
      direction: 'LONG', entryLow, entryHigh, stop,
      tp1: ref + risk * 0.5, tp2: ref + risk * 1.0,
    });
    expect(res.accepted).toBe(true);
    expect(res.reason).toBeNull();
    expect(res.tp1R).toBeCloseTo(0.5, 12);
    expect(res.tp2R).toBeCloseTo(1, 12);
  });

  it('чуть ниже порога — отказ, и причина именно в цели', () => {
    const entryLow = 100;
    const entryHigh = 101;
    const stop = 99;
    const ref = canonicalEntryReference('LONG', entryLow, entryHigh);
    const risk = ref - stop;
    const res = evaluateTargetQuality({
      direction: 'LONG', entryLow, entryHigh, stop,
      tp1: ref + risk * 0.4999, tp2: ref + risk * 2,
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('TARGET_QUALITY_TP1');
  });

  it('коридор, пересекающий стоп, отклоняется кодом ENTRY_ZONE_CROSSES_STOP', () => {
    const res = evaluateTargetQuality({
      direction: 'LONG', entryLow: 98, entryHigh: 101, stop: 99, tp1: 105, tp2: 110,
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('ENTRY_ZONE_CROSSES_STOP');
  });
});

describe('расширение коридора и ATR из коридора V3.3', () => {
  it('expandEntryZone / atrFromV33Corridor совпадают с исходником', () => {
    const rnd = mulberry32(97531);
    for (let i = 0; i < 500; i++) {
      const low = 10 + rnd() * 1000;
      const high = low + rnd() * 5;
      const atr = 0.1 + rnd() * 50;
      expect(expandEntryZone(low, high, atr)).toEqual(expandOriginal(low, high, atr));
      expect(atrFromV33Corridor(low, high)).toBe(atrOriginal(low, high));
    }
  });

  it('hook V3.4 возвращает ровно тот же план, что и исходный hook', () => {
    const rnd = mulberry32(13579);
    for (let i = 0; i < 300; i++) {
      const direction = rnd() < 0.5 ? 'LONG' : 'SHORT';
      const entry = 100 + rnd() * 10_000;
      const atr = entry * (0.001 + rnd() * 0.01);
      const baseLow = entry - 0.1 * atr;
      const baseHigh = entry + 0.1 * atr;
      const stop = direction === 'LONG' ? baseLow - atr * (0.05 + rnd() * 0.5) : baseHigh + atr * (0.05 + rnd() * 0.5);
      const tp1 = direction === 'LONG' ? entry + atr * (0.2 + rnd() * 3) : entry - atr * (0.2 + rnd() * 3);
      const tp2 = direction === 'LONG' ? tp1 + atr * (0.1 + rnd() * 4) : tp1 - atr * (0.1 + rnd() * 4);
      const ctx = { direction, baseLow, baseHigh, atr, close: entry, stop, tp1, tp2 } as const;
      expect(v34CorridorHook(ctx)).toEqual(hookOriginal(ctx));
    }
  });
});
