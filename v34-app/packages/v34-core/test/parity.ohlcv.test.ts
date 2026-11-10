/**
 * Адаптер свечей: незакрытый бар НЕ ДОЛЖЕН попадать в стратегию
 * (look-ahead). Проверяется совпадение с исходным `ohlcvAdapter.ts` и
 * поведение подготовки закрытой серии.
 */
import { describe, it, expect } from 'vitest';
import { ohlcvToArchive as ohlcvOriginal } from '@/services/signals/live/ohlcvAdapter';
import { countGaps, ohlcvToArchive, toClosedArchive, type OHLCV } from '../src/signals/ohlcv';
import type { ArchiveTimeframe } from '../src/strategy/types';

const TF_MS: Record<ArchiveTimeframe, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000, '1w': 604_800_000,
};

function candle(time: number, close = 100): OHLCV {
  return { time, open: 100, high: 101, low: 99, close, volume: 10 };
}

describe('ohlcvToArchive', () => {
  it('совпадает с исходным адаптером на всех таймфреймах и границах now', () => {
    const tf: ArchiveTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    for (const t of tf) {
      const span = TF_MS[t];
      const openSec = 1_700_000_000;
      const c = candle(openSec);
      // Проверяем границу: за 1 мс до закрытия, ровно в момент закрытия, после.
      const closeMs = openSec * 1000 + span;
      for (const now of [closeMs - 2, closeMs - 1, closeMs, closeMs + 1, undefined]) {
        expect(ohlcvToArchive(c, t, now)).toEqual(ohlcvOriginal(c as never, t, now));
      }
    }
  });

  it('незакрытый бар помечается isClosed=false и отбрасывается серией', () => {
    // Ровно момент закрытия второго бара: isClosed = closeTime < now → false.
    const now = 1_700_000_000 * 1000 + 3_600_000 - 1;
    const raw = [candle(1_700_000_000 - 3600), candle(1_700_000_000)];
    const closed = toClosedArchive(raw, '1h', now);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.isClosed).toBe(true);
  });
});

describe('toClosedArchive / countGaps', () => {
  it('сортирует по времени и убирает дубликаты (последняя версия бара побеждает)', () => {
    const raw = [candle(3000, 103), candle(1000, 101), candle(2000, 102), candle(2000, 999)];
    const out = toClosedArchive(raw, '1m', 10_000_000);
    expect(out.map((c) => c.openTime)).toEqual([1_000_000, 2_000_000, 3_000_000]);
    expect(out[1]!.close).toBe(999);
  });

  it('считает разрывы серии', () => {
    const series = toClosedArchive(
      [candle(0), candle(3600), candle(3600 * 2), candle(3600 * 5)],
      '1h',
      10_000_000_000,
    );
    expect(countGaps(series, 3_600_000)).toBe(1);
  });

  it('пустой ответ биржи не превращается в «нет сигналов»: серия пуста', () => {
    expect(toClosedArchive([], '1h', Date.now())).toEqual([]);
    expect(toClosedArchive(null, '1h', Date.now())).toEqual([]);
  });
});
