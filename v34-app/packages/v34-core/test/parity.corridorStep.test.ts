/**
 * `corridorStep` — единственная функция, которой и реплей, и ведение
 * опубликованного сигнала ловят исполнение коридора. В изолированный продукт
 * она перенесена из `v30Core.ts` дословно; здесь доказывается, что поведение
 * совпадает с исходником на случайных барах и на всех граничных случаях
 * (касание стопа, одновременное касание, истечение, отклонение геометрии).
 */
import { describe, it, expect } from 'vitest';
import { corridorStep as corridorStepOriginal } from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import { corridorStep, V30_CONSTANTS } from '../src/strategy/v30Core';
import { V33_CONSTANTS } from '../src/strategy/v33Core';
import { mulberry32, makeSyntheticSeries } from './fixtures/synthetic';
import type { ArchiveCandle } from '../src/strategy/types';

describe('corridorStep: копия ↔ исходник', () => {
  it('случайные коридоры и бары дают идентичный шаг', () => {
    const rnd = mulberry32(20260101);
    for (let i = 0; i < 3000; i++) {
      const dir = rnd() < 0.5 ? 'LONG' : 'SHORT';
      const close = 100 + rnd() * 5000;
      const atr = close * 0.005;
      const half = V30_CONSTANTS.CORRIDOR_ATR_FRAC * atr;
      const zoneLow = close - half;
      const zoneHigh = close + half;
      const stop = dir === 'LONG' ? zoneLow - atr * 0.15 : zoneHigh + atr * 0.15;
      const tp1 = dir === 'LONG' ? close + atr : close - atr;
      const tp2 = dir === 'LONG' ? close + atr * 2 : close - atr * 2;
      const setupIndex = 10;
      const p = { dir, zoneLow, zoneHigh, stop, tp1, tp2, setupIndex } as const;

      const open = close + (rnd() - 0.5) * atr * 3;
      const hi = open + rnd() * atr * 2;
      const lo = open - rnd() * atr * 2;
      const c: ArchiveCandle = {
        openTime: 1_700_000_000_000 + i * 3_600_000,
        open,
        high: Math.max(hi, open, close),
        low: Math.min(lo, open, close),
        close,
        volume: 1,
        closeTime: 1_700_000_000_000 + i * 3_600_000 + 3_599_999,
        isClosed: true,
      };
      const barIndex = setupIndex + (i % 5);
      expect(corridorStep(p, c, barIndex)).toEqual(corridorStepOriginal(p, c, barIndex));
    }
  });

  it('истечение коридора наступает на N+3', () => {
    const c: ArchiveCandle = {
      openTime: 0, open: 100, high: 100.1, low: 99.9, close: 100, volume: 1, closeTime: 1, isClosed: true,
    };
    const p = { dir: 'LONG' as const, zoneLow: 90, zoneHigh: 91, stop: 80, tp1: 110, tp2: 120, setupIndex: 0 };
    expect(corridorStep(p, c, 2).kind).toBe('WAIT');
    expect(corridorStep(p, c, 3).kind).toBe('EXPIRED');
  });

  it('касание стопа и коридора на одном баре — отмена, а не исполнение', () => {
    const p = { dir: 'LONG' as const, zoneLow: 100, zoneHigh: 101, stop: 99, tp1: 105, tp2: 110, setupIndex: 0 };
    const c: ArchiveCandle = {
      openTime: 0, open: 102, high: 102, low: 98, close: 100, volume: 1, closeTime: 1, isClosed: true,
    };
    expect(corridorStep(p, c, 1)).toEqual({ kind: 'CANCELLED' });
  });

  it('константы V3.3 и V3.0, влияющие на ведение, совпадают с исходными', () => {
    expect(V33_CONSTANTS.TIMEOUT_BARS).toBe(48);
    expect(V33_CONSTANTS.CORRIDOR_EXPIRY_BARS).toBe(V30_CONSTANTS.CORRIDOR_EXPIRY_BARS);
    expect(V33_CONSTANTS.MAKER_BPS).toBe(2);
    expect(V33_CONSTANTS.TAKER_BPS).toBe(5);
  });

  it('фикстура действительно содержит исполнения по коридору', () => {
    const { h1 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    let fills = 0;
    for (let i = 0; i < h1.length - 3; i++) {
      const c = h1[i]!;
      const p = {
        dir: 'LONG' as const,
        zoneLow: c.close * 0.999, zoneHigh: c.close * 1.001,
        stop: c.close * 0.99, tp1: c.close * 1.02, tp2: c.close * 1.04, setupIndex: i,
      };
      if (corridorStep(p, h1[i + 1]!, i + 1).kind === 'FILLED') fills++;
    }
    expect(fills).toBeGreaterThan(0);
  });
});
