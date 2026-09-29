import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestMarketData } from '../../server/services/marketDataGateway.js';
import { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import { normalizeFuturesDepth } from '@/services/data/adapters/normalization';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { UnsupportedMarketSymbolError } from '@/services/data/adapters/errors';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';

/**
 * СТАКАН ФЬЮЧЕРСА (задача §4).
 *
 * Требование задачи буквально: «Добавить реальный orderbook для фьючерсов
 * через USD-M источник (/fapi/v1/depth или эквивалент через gateway), НЕ
 * /api/v3/depth». Ниже проверяется весь путь целиком — маршрут gateway,
 * адаптер, нормализация и провайдер — потому что подмена спотовой книги
 * может произойти на любом из этих уровней.
 */

afterEach(() => {
  vi.restoreAllMocks();
  resetExchangeUniverseForTests();
});

describe('gateway route for USD-M depth', () => {
  it('proxies /binance/futures/fapi/v1/depth to fapi.binance.com and never to the spot host', async () => {
    const fetchFn = vi.fn(async () => Response.json({ lastUpdateId: 7, E: 1, T: 2, bids: [], asks: [] }));
    const result = await requestMarketData(
      '/binance/futures/fapi/v1/depth',
      new URLSearchParams('symbol=MEWUSDT&limit=50'),
      { fetchFn: fetchFn as typeof fetch },
    );

    expect(result.status).toBe(200);
    const [url] = (fetchFn.mock.calls as unknown as Array<[string]>)[0];
    expect(url).toBe('https://fapi.binance.com/fapi/v1/depth?symbol=MEWUSDT&limit=50');
    expect(String(url)).not.toContain('api.binance.com/api/v3/depth');
  });

  it('rejects a depth limit outside the exchange grid instead of forwarding it', async () => {
    const fetchFn = vi.fn();
    const bad = await requestMarketData(
      '/binance/futures/fapi/v1/depth',
      new URLSearchParams('symbol=MEWUSDT&limit=37'),
      { fetchFn: fetchFn as typeof fetch },
    );
    const noSymbol = await requestMarketData(
      '/binance/futures/fapi/v1/depth',
      new URLSearchParams('limit=50'),
      { fetchFn: fetchFn as typeof fetch },
    );

    expect(bad.status).toBe(400);
    expect(noSymbol.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is not reachable through a spot depth path (no /api/v3/depth in the allowlist)', async () => {
    const fetchFn = vi.fn();
    const spotDepth = await requestMarketData('/binance/spot/api/v3/depth', new URLSearchParams('symbol=MEWUSDT'), {
      fetchFn: fetchFn as typeof fetch,
    });
    expect(spotDepth.status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('BinanceFuturesAdapter.fetchDepth', () => {
  it('requests the USD-M depth endpoint with a contract symbol and an allowed limit', async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ lastUpdateId: 1, bids: [['0.000478', '10']], asks: [['0.000479', '12']] });
    }) as typeof fetch;

    const adapter = new BinanceFuturesAdapter({ fetchFn });
    await adapter.fetchDepth('1000PEPEUSDT', 50);
    // Недопустимая глубина округляется вниз до сетки биржи, а не отправляется как есть.
    await adapter.fetchDepth('1000PEPEUSDT', 37);

    expect(urls[0]).toBe('/api/market/binance/futures/fapi/v1/depth?symbol=1000PEPEUSDT&limit=50');
    expect(urls[1]).toBe('/api/market/binance/futures/fapi/v1/depth?symbol=1000PEPEUSDT&limit=20');
    expect(urls.every((url) => url.includes('/binance/futures/'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/v3/depth'))).toBe(false);
  });

  it('propagates an external abort so a stale order-book request is cancelled', async () => {
    const controller = new AbortController();
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as typeof fetch;

    const adapter = new BinanceFuturesAdapter({ fetchFn });
    const pending = adapter.fetchDepth('MEWUSDT', 50, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/Таймаут|aborted/i);
  });
});

describe('normalizeFuturesDepth', () => {
  it('maps bids/asks, drops empty levels and marks the snapshot as futures', () => {
    const snapshot = normalizeFuturesDepth(
      {
        lastUpdateId: 42,
        E: 1_726_000_000_000,
        T: 1_726_000_000_500,
        bids: [['0.000470', '100'], ['0.000478', '250'], ['0.000475', '0']],
        asks: [['0.000482', '300'], ['0.000479', '150'], ['0.000480', 'nan']],
      },
      { contractSymbol: '1000PEPEUSDT', displaySymbol: '1000PEPE' },
    );

    expect(snapshot.provenance.market).toBe('futures');
    expect(snapshot.provenance.symbol).toBe('1000PEPEUSDT');
    expect(snapshot.provenance.isFallback).toBe(false);
    // T (matching engine) выигрывает у E и у локальных часов.
    expect(snapshot.timestamp).toBe(1_726_000_000_500);
    // Нулевой и нечисловой уровни отброшены.
    expect(snapshot.bids).toEqual([[0.000478, 250], [0.00047, 100]]);
    expect(snapshot.asks).toEqual([[0.000479, 150], [0.000482, 300]]);
    // Спред положительный: best ask > best bid.
    expect(snapshot.asks[0][0] - snapshot.bids[0][0]).toBeGreaterThan(0);
  });

  it('falls back to local time only when the exchange sent no timestamp', () => {
    const snapshot = normalizeFuturesDepth(
      { lastUpdateId: 1, bids: [['1', '1']], asks: [['2', '1']] },
      { contractSymbol: 'BTCUSDT', displaySymbol: 'BTC' },
    );
    expect(snapshot.timestamp).toBeGreaterThan(1_700_000_000_000);
  });
});

describe('LiveMarketDataProvider.getFuturesOrderBook', () => {
  const universeFetch = (contracts: Array<{ symbol: string; exchangeSymbol: string }>) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/universe/futures')) {
        return Response.json({
          activeUsdtContracts: contracts.length,
          perpetualCount: contracts.length,
          contracts: contracts.map((c) => ({ ...c, baseAsset: c.symbol, contractType: 'PERPETUAL' })),
          fetchedAt: new Date().toISOString(),
          stale: false,
        });
      }
      return Response.json({});
    });

  it('resolves the contract symbol and returns a futures-tagged snapshot', async () => {
    vi.stubGlobal('fetch', universeFetch([{ symbol: '1000PEPE', exchangeSymbol: '1000PEPEUSDT' }]));
    const fetchDepth = vi.fn(async () => ({
      lastUpdateId: 5,
      bids: [['0.011', '4']] as [string, string][],
      asks: [['0.012', '6']] as [string, string][],
    }));
    const provider = new LiveMarketDataProvider({ futuresAdapter: { fetchDepth } as never });

    const snapshot = await provider.getFuturesOrderBook('1000PEPE');
    expect(fetchDepth).toHaveBeenCalledWith('1000PEPEUSDT', 50, undefined);
    expect(snapshot?.provenance.market).toBe('futures');
    expect(snapshot?.symbol).toBe('1000PEPE');

    // Второй вызов в пределах TTL обслуживается кэшем — вес rate-limit не растёт.
    await provider.getFuturesOrderBook('1000PEPE');
    expect(fetchDepth).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('never falls back to a spot book for a contract outside the USD-M universe', async () => {
    vi.stubGlobal('fetch', universeFetch([{ symbol: 'BTC', exchangeSymbol: 'BTCUSDT' }]));
    const fetchDepth = vi.fn();
    const provider = new LiveMarketDataProvider({ futuresAdapter: { fetchDepth } as never });

    await expect(provider.getFuturesOrderBook('GHOST')).rejects.toBeInstanceOf(UnsupportedMarketSymbolError);
    expect(fetchDepth).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
