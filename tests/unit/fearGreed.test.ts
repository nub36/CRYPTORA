import { describe, it, expect, vi } from 'vitest';
import { AlternativeMeAdapter, classifyFearGreed } from '@/services/data/adapters/AlternativeMeAdapter';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';

const ok = (value: string, ts = '1758067200') =>
  new Response(JSON.stringify({ name: 'Fear and Greed Index', data: [{ value, value_classification: 'x', timestamp: ts, time_until_update: '1' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const TICKER = {
  symbol: 'BTCUSDT', priceChange: '1', priceChangePercent: '2.00', weightedAvgPrice: '1', prevClosePrice: '1', lastPrice: '65000', lastQty: '1',
  bidPrice: '1', askPrice: '1', openPrice: '1', highPrice: '1', lowPrice: '1', volume: '1', quoteVolume: '1', openTime: 1, closeTime: 2, count: 1,
};

describe('Fear & Greed (Alternative.me)', () => {
  it('классификация по официальным порогам источника', () => {
    expect(classifyFearGreed(0)).toBe('Extreme Fear');
    expect(classifyFearGreed(24)).toBe('Extreme Fear');
    expect(classifyFearGreed(25)).toBe('Fear');
    expect(classifyFearGreed(45)).toBe('Neutral');
    expect(classifyFearGreed(56)).toBe('Greed');
    expect(classifyFearGreed(76)).toBe('Extreme Greed');
  });

  it('адаптер: URL, парсинг, timestamp в мс; HTTP/схема/диапазон → ошибка', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.alternative.me/fng/?limit=1');
      return ok('62');
    });
    const r = await new AlternativeMeAdapter({ fetchFn: fetchFn as unknown as typeof fetch }).fetchLatest();
    expect(r).toEqual({ value: 62, sentiment: 'Greed', timestamp: 1758067200000, source: 'alternative.me' });

    await expect(new AlternativeMeAdapter({ fetchFn: (async () => new Response('x', { status: 503 })) as unknown as typeof fetch }).fetchLatest()).rejects.toThrow();
    await expect(new AlternativeMeAdapter({ fetchFn: (async () => new Response('{"data":[]}', { status: 200 })) as unknown as typeof fetch }).fetchLatest()).rejects.toThrow();
    await expect(new AlternativeMeAdapter({ fetchFn: (async () => ok('150')) as unknown as typeof fetch }).fetchLatest()).rejects.toThrow();
  });

  it('LiveMarketDataProvider: индекс из источника с провенансом; при отказе — null, без подстановки; кэш 10 мин', async () => {
    const binance = new BinanceSpotAdapter();
    vi.spyOn(binance, 'fetch24hrTicker').mockResolvedValue(TICKER as any);
    const fetchFn = vi.fn(async () => ok('18'));
    const provider = new LiveMarketDataProvider({
      binanceAdapter: binance,
      fearGreedAdapter: new AlternativeMeAdapter({ fetchFn: fetchFn as unknown as typeof fetch }),
      cacheTtlMs: 0,
    });
    const ov = await provider.getMarketOverview();
    expect(ov.fearAndGreed).toEqual({ value: 18, sentiment: 'Extreme Fear', source: 'alternative.me', timestamp: 1758067200000 });
    await provider.getMarketOverview();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const down = new LiveMarketDataProvider({
      binanceAdapter: binance,
      fearGreedAdapter: new AlternativeMeAdapter({ fetchFn: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch }),
      cacheTtlMs: 0,
    });
    expect((await down.getMarketOverview()).fearAndGreed).toBeNull();
  });
});
