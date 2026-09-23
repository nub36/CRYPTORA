import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestMarketData } from '../../server/services/marketDataGateway.js';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';
import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import { KuCoinSpotAdapter } from '@/services/data/adapters/KuCoinSpotAdapter';
import { CandleHistoryService } from '@/services/data/CandleHistoryService';

afterEach(() => vi.restoreAllMocks());

describe('allowlisted same-origin market-data gateway', () => {
  it('maps validated Binance spot requests to a fixed upstream host', async () => {
    const fetchFn = vi.fn(async () => Response.json([[1, '1', '1', '1', '1', '1', 2]]));
    const result = await requestMarketData(
      '/binance/spot/api/v3/klines',
      new URLSearchParams('symbol=BTCUSDT&interval=1h&limit=25'),
      { fetchFn: fetchFn as typeof fetch },
    );

    expect(result.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=25',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }),
    );
  });

  it('does not accept arbitrary hosts, paths, query keys, duplicate fields, or unbounded limits', async () => {
    const fetchFn = vi.fn();
    const arbitraryPath = await requestMarketData('/https://attacker.invalid/proxy', new URLSearchParams(), { fetchFn: fetchFn as typeof fetch });
    const extraQuery = await requestMarketData('/kucoin/spot/api/v1/market/stats', new URLSearchParams('symbol=BTC-USDT&url=https://attacker.invalid'), { fetchFn: fetchFn as typeof fetch });
    const duplicateQuery = await requestMarketData('/kucoin/spot/api/v1/market/stats', new URLSearchParams('symbol=BTC-USDT&symbol=KAS-USDT'), { fetchFn: fetchFn as typeof fetch });
    const invalidLimit = await requestMarketData('/binance/spot/api/v3/klines', new URLSearchParams('symbol=BTCUSDT&interval=1h&limit=1000000'), { fetchFn: fetchFn as typeof fetch });

    expect(arbitraryPath.status).toBe(404);
    expect(extraQuery.status).toBe(400);
    expect(duplicateQuery.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps Spot and Futures data transports on their separate fixed Binance paths', async () => {
    const upstreams: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      upstreams.push(url);
      if (url.includes('/fapi/v1/openInterest')) return Response.json({ symbol: 'BTCUSDT', openInterest: '12', time: 1 });
      if (url.includes('/fapi/v1/premiumIndex?')) return Response.json({ symbol: 'BTCUSDT', markPrice: '100', indexPrice: '99', lastFundingRate: '0.001', nextFundingTime: 2, time: 1 });
      if (url.includes('/fapi/v1/ticker/24hr')) return Response.json({ symbol: 'BTCUSDT', priceChange: '1', priceChangePercent: '1', lastPrice: '100', volume: '1', quoteVolume: '100' });
      if (url.includes('/futures/data/openInterestHist')) return Response.json([{ symbol: 'BTCUSDT', sumOpenInterest: '12', sumOpenInterestValue: '1200', timestamp: 1 }]);
      return Response.json([]);
    }) as typeof fetch;
    const spot = new BinanceSpotAdapter({ fetchFn });
    const futures = new BinanceFuturesAdapter({ fetchFn });
    await spot.fetchAll24hrTickers();
    await spot.fetchKlines('BTCUSDT', '15m', 20);
    await futures.fetchOpenInterest('BTCUSDT');
    await futures.fetchPremiumIndex('BTCUSDT');
    await futures.fetchOpenInterestHist('BTCUSDT', 25);
    await futures.fetch24hrTicker('BTCUSDT');

    expect(upstreams).toContain('/api/market/binance/spot/api/v3/ticker/24hr');
    expect(upstreams).toContain('/api/market/binance/spot/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=20');
    expect(upstreams).toContain('/api/market/binance/futures/fapi/v1/openInterest?symbol=BTCUSDT');
    expect(upstreams).toContain('/api/market/binance/futures/fapi/v1/premiumIndex?symbol=BTCUSDT');
    expect(upstreams).toContain('/api/market/binance/futures/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25');
    expect(upstreams).toContain('/api/market/binance/futures/fapi/v1/ticker/24hr?symbol=BTCUSDT');
    expect(upstreams.every((url) => url.startsWith('/api/market/'))).toBe(true);
  });

  it('forwards exchange HTTP errors honestly and reports transport failures', async () => {
    const exchangeError = await requestMarketData(
      '/kucoin/spot/api/v1/market/stats',
      new URLSearchParams('symbol=BTC-USDT'),
      { fetchFn: (async () => Response.json({ code: '400100', msg: 'Invalid symbol' }, { status: 400 })) as typeof fetch },
    );
    const unavailable = await requestMarketData(
      '/binance/spot/api/v3/ticker/24hr',
      new URLSearchParams('symbol=BTCUSDT'),
      { fetchFn: (async () => { throw new TypeError('offline'); }) as typeof fetch },
    );

    expect(exchangeError).toMatchObject({ status: 400, body: { code: '400100', msg: 'Invalid symbol' } });
    expect(unavailable).toMatchObject({ status: 502, body: { error: 'Market-data source unavailable' } });
  });

  it('production frontend adapters and candle enrichment use only same-origin market routes', async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return url.includes('/api/v1/market/allTickers')
        ? Response.json({ code: '200000', data: { time: Date.now(), ticker: [] } })
        : Response.json([]);
    }) as typeof fetch;

    await new BinanceSpotAdapter({ fetchFn }).fetchAll24hrTickers();
    await new BinanceFuturesAdapter({ fetchFn }).fetchPremiumIndexes();
    await new KuCoinSpotAdapter({ fetchFn }).fetchAllTickers();
    await new CandleHistoryService(fetchFn).getAll();

    expect(urls.some((url) => url === '/api/market/binance/spot/api/v3/ticker/24hr')).toBe(true);
    expect(urls.some((url) => url === '/api/market/binance/futures/fapi/v1/premiumIndex')).toBe(true);
    expect(urls.some((url) => url === '/api/market/kucoin/spot/api/v1/market/allTickers')).toBe(true);
    expect(urls.some((url) => url.includes('/api/market/binance/spot/api/v3/klines?symbol=KASUSDT'))).toBe(true);
    expect(urls.every((url) => url.startsWith('/api/market/'))).toBe(true);
    expect(urls.some((url) => /https:\/\/(api|fapi)\.binance\.com|https:\/\/api\.kucoin\.com/.test(url))).toBe(false);
  });
});
