import { describe, it, expect } from 'vitest';
import { appendPoint, marketCapChange24hFromAssets, parseHistory, volumeChange24h } from '@/services/analytics/aggregateHistory';

const H = 3_600_000;
const T0 = 1758100000000;

describe('aggregateHistory (24h-дельты Обзора)', () => {
  it('marketCapChange24h — точная производная из change24h активов; неполные активы пропускаются', () => {
    // cap 110 при +10% → prev 100; cap 95 при −5% → prev 100; итого 205 против 200 = +2.5%
    expect(marketCapChange24hFromAssets([{ marketCap: 110, change24h: 10 }, { marketCap: 95, change24h: -5 }])).toBe(2.5);
    expect(marketCapChange24hFromAssets([{ marketCap: 0, change24h: 3 }, { marketCap: 10, change24h: -100 }])).toBeNull();
    expect(marketCapChange24hFromAssets([])).toBeNull();
  });

  it('volumeChange24h: null без базы; берётся точка, ближайшая к now−24ч в окне [24ч; 30ч]', () => {
    expect(volumeChange24h([], 100, T0)).toBeNull();
    const hist = [
      { t: T0 - 31 * H, volume24h: 50 }, // слишком старая
      { t: T0 - 26 * H, volume24h: 80 },
      { t: T0 - 24.5 * H, volume24h: 100 }, // ближайшая к −24ч
      { t: T0 - 23 * H, volume24h: 999 }, // моложе 24ч — не база
    ];
    expect(volumeChange24h(hist, 110, T0)).toBe(10);
    expect(volumeChange24h([{ t: T0 - 23 * H, volume24h: 1 }], 2, T0)).toBeNull();
  });

  it('appendPoint: шаг ≥10 мин, обрезка старше 48ч, иммутабельность; parseHistory терпим к мусору', () => {
    const base = [{ t: T0 - 49 * H, volume24h: 1 }, { t: T0 - 1 * H, volume24h: 2 }];
    const next = appendPoint(base, { t: T0, volume24h: 3 });
    expect(next.map((p) => p.volume24h)).toEqual([2, 3]);
    expect(base.length).toBe(2);
    expect(appendPoint(next, { t: T0 + 60_000, volume24h: 4 })).toEqual(next);
    expect(parseHistory('garbage')).toEqual([]);
    expect(parseHistory(JSON.stringify([{ t: 1, volume24h: 2 }, { nope: true }]))).toEqual([{ t: 1, volume24h: 2 }]);
  });
});
