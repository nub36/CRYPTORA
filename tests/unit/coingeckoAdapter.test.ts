import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoinGeckoAdapter } from '@/services/data/adapters/CoinGeckoAdapter';

// --- Mock fetch globally ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    headers: new Map(),
  } as unknown as Response);
}

describe('CoinGeckoAdapter', () => {
  let adapter: CoinGeckoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    adapter = new CoinGeckoAdapter();
  });

  describe('fetchGlobal()', () => {
    it('parses global market cap response correctly', async () => {
      mockFetch.mockReturnValueOnce(
        mockJsonResponse({
          data: {
            total_market_cap: { usd: 2450000000000 },
            market_cap_change_percentage_24h_usd: 2.45,
            active_cryptocurrencies: 12000,
            markets: 800,
            updated_at: 1700000000,
          },
        }),
      );

      const result = await adapter.fetchGlobal();
      expect(result.totalMarketCapUsd).toBe(2450000000000);
      expect(result.marketCapChange24hPct).toBe(2.45);
      expect(result.source).toBe('coingecko');
    });

    it('throws AdapterNetworkError on HTTP error', async () => {
      mockFetch.mockReturnValueOnce(mockJsonResponse({ error: 'rate limited' }, 429));
      await expect(adapter.fetchGlobal()).rejects.toThrow();
    });

    it('throws on network error', async () => {
      mockFetch.mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')));
      await expect(adapter.fetchGlobal()).rejects.toThrow();
    });

    it('caches result within TTL window', async () => {
      mockFetch.mockReturnValue(
        mockJsonResponse({
          data: {
            total_market_cap: { usd: 1000000000000 },
            market_cap_change_percentage_24h_usd: 1.0,
          },
        }),
      );

      const first = await adapter.fetchGlobal();
      const second = await adapter.fetchGlobal();
      expect(first).toEqual(second);
      // Second call should use cache, not call fetch again
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('fetchCoinMeta()', () => {
    it('parses ATH/ATL from coin response', async () => {
      mockFetch.mockReturnValueOnce(
        mockJsonResponse({
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          market_data: {
            ath: { usd: 73750.07 },
            ath_date: { usd: '2024-03-14T07:30:00.000Z' },
            atl: { usd: 67.81 },
            atl_date: { usd: '2013-07-06T00:00:00.000Z' },
            market_cap: { usd: 1280000000000 },
          },
          last_updated: '2026-09-17T12:00:00.000Z',
        }),
      );

      const result = await adapter.fetchCoinMeta('bitcoin');
      expect(result.athUsd).toBe(73750.07);
      expect(result.athDateUsd).toBe('2024-03-14T07:30:00.000Z');
      expect(result.atlUsd).toBe(67.81);
      expect(result.atlDateUsd).toBe('2013-07-06T00:00:00.000Z');
      expect(result.source).toBe('coingecko');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockReturnValueOnce(mockJsonResponse({ error: 'not found' }, 404));
      await expect(adapter.fetchCoinMeta('invalid-id')).rejects.toThrow();
    });

    it('handles missing market_data gracefully', async () => {
      mockFetch.mockReturnValueOnce(
        mockJsonResponse({
          id: 'test',
          symbol: 't',
          name: 'Test',
        }),
      );
      const result = await adapter.fetchCoinMeta('test');
      expect(result.athUsd).toBeNull();
      expect(result.atlUsd).toBeNull();
    });
  });

  describe('fetchCoinsMarket()', () => {
    it('parses market data for multiple coins', async () => {
      mockFetch.mockReturnValueOnce(
        mockJsonResponse([
          {
            id: 'bitcoin',
            symbol: 'btc',
            name: 'Bitcoin',
            current_price: 65000,
            market_cap: 1280000000000,
            ath: 73750,
            ath_date: '2024-03-14T07:30:00.000Z',
            atl: 67.81,
            atl_date: '2013-07-06T00:00:00.000Z',
            last_updated: '2026-09-17T12:00:00.000Z',
          },
        ]),
      );

      const result = await adapter.fetchCoinsMarket(['bitcoin']);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      const btc = result.get('bitcoin');
      expect(btc).toBeDefined();
      expect(btc!.id).toBe('bitcoin');
      expect(btc!.athUsd).toBe(73750);
    });

    it('returns empty Map on HTTP error (graceful degradation)', async () => {
      mockFetch.mockReturnValueOnce(mockJsonResponse({ error: 'bad request' }, 400));
      const result = await adapter.fetchCoinsMarket(['bitcoin']);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('returns empty Map for empty input', async () => {
      const result = await adapter.fetchCoinsMarket([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('fetchCoinMeta caches after first call', async () => {
      mockFetch.mockReturnValue(
        mockJsonResponse({
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          market_data: {
            ath: { usd: 73750 },
            ath_date: { usd: '2024-03-14T07:30:00.000Z' },
            atl: { usd: 67.81 },
            atl_date: { usd: '2013-07-06T00:00:00.000Z' },
            market_cap: { usd: 1280000000000 },
          },
          last_updated: '2026-09-17T12:00:00.000Z',
        }),
      );

      await adapter.fetchCoinMeta('bitcoin');
      await adapter.fetchCoinMeta('bitcoin');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('resetCache clears all caches', async () => {
      mockFetch.mockReturnValue(
        mockJsonResponse({
          data: {
            total_market_cap: { usd: 1000000000000 },
            market_cap_change_percentage_24h_usd: 1.0,
          },
        }),
      );

      await adapter.fetchGlobal();
      expect(mockFetch).toHaveBeenCalledOnce();

      adapter.resetCache();

      await adapter.fetchGlobal();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
