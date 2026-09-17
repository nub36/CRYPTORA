import { describe, it, expect } from 'vitest';
import { CalendarService, buildCalendarReport } from '@/services/analytics/CalendarService';
import type { BinanceFuturesAdapter } from '@/services/data/adapters/BinanceFuturesAdapter';
import { EcosystemService, tvlChange7dFromHistory } from '@/services/analytics/EcosystemService';
import { DefiLlamaAdapter } from '@/services/data/adapters/DefiLlamaAdapter';
import { AdapterNetworkError } from '@/services/data/adapters/errors';

describe('CalendarService (Binance schedule, pure builder)', () => {
  const now = 1_800_000_000_000;
  const H = 3_600_000;
  const premium = [
    { symbol: 'BTCUSDT', nextFundingTime: now + 3 * H, lastFundingRate: '0.0001' },
    { symbol: 'ETHUSDT', nextFundingTime: now + 3 * H, lastFundingRate: '-0.0002' },
    { symbol: 'DOGEUSDT', nextFundingTime: now + 1 * H, lastFundingRate: '0.0001' }, // не отслеживается
    { symbol: 'SOLUSDT', nextFundingTime: now - H, lastFundingRate: '0.0001' }, // в прошлом
  ];
  const exchangeInfo = {
    symbols: [
      { symbol: 'BTCUSDT', pair: 'BTCUSDT', contractType: 'PERPETUAL', deliveryDate: 4133404800000, status: 'TRADING' },
      { symbol: 'BTCUSDT_261226', pair: 'BTCUSDT', contractType: 'CURRENT_QUARTER', deliveryDate: now + 90 * 24 * H, status: 'TRADING' },
      { symbol: 'ETHUSDT_261226', pair: 'ETHUSDT', contractType: 'CURRENT_QUARTER', deliveryDate: now + 90 * 24 * H, status: 'TRADING' },
      { symbol: 'OLD_250926', pair: 'BTCUSDT', contractType: 'CURRENT_QUARTER', deliveryDate: now - 24 * H, status: 'SETTLING' },
    ],
  };

  it('builds funding + expiry events from exchange schedule, sorted by time', () => {
    const r = buildCalendarReport({ premium, exchangeInfo }, now);
    expect(r.source).toBe('binance');
    expect(r.events.map((e) => e.kind)).toEqual(['FUNDING', 'EXPIRY']);
    expect(r.events[0].symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(r.events[0].detail).toContain('ETH -0.0200%');
    expect(r.events[1].symbols).toEqual(['BTCUSDT_261226', 'ETHUSDT_261226']);
  });

  it('fetchReport throws when adapter fails (no static fallback)', async () => {
    CalendarService.resetCache();
    const failing = { fetchPremiumIndexes: async () => { throw new AdapterNetworkError('binance'); }, fetchExchangeInfo: async () => exchangeInfo };
    await expect(CalendarService.fetchReport(failing as unknown as BinanceFuturesAdapter, now)).rejects.toBeInstanceOf(AdapterNetworkError);
  });
});

describe('EcosystemService (DeFiLlama, mocked fetch)', () => {
  const day = 86400;
  const now = 1_800_000_000;
  const chains = [
    { name: 'Ethereum', tvl: 60e9, tokenSymbol: 'ETH' },
    { name: 'Arbitrum', tvl: 3e9, tokenSymbol: 'ARB' },
    { name: 'Unknown Chain', tvl: 1e9, tokenSymbol: null },
    { name: 'Solana', tvl: -1 },
  ];
  const hist = Array.from({ length: 10 }, (_, i) => ({ date: now - (9 - i) * day, tvl: 50e9 + i * 1e9 }));

  const mockFetch = (fail = false): typeof fetch =>
    (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (fail) return new Response('x', { status: 500 });
      if (u.endsWith('/v2/chains')) return new Response(JSON.stringify(chains), { status: 200 });
      if (u.includes('/v2/historicalChainTvl/Ethereum')) return new Response(JSON.stringify(hist), { status: 200 });
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

  it('computes 7d change from history (base ≥7 days back) and null when history is short', () => {
    expect(tvlChange7dFromHistory(hist)).toBe(Number((((59e9 - 52e9) / 52e9) * 100).toFixed(2)));
    expect(tvlChange7dFromHistory(hist.slice(-3))).toBeNull();
    expect(tvlChange7dFromHistory([])).toBeNull();
  });

  it('builds report only from tracked chains present in source; negatives/unknown skipped', async () => {
    EcosystemService.resetCache();
    const adapter = new DefiLlamaAdapter({ fetchFn: mockFetch() });
    const r = await EcosystemService.fetchReport(adapter, now * 1000);
    expect(r.source).toBe('defillama');
    expect(r.networks.map((n) => n.id)).toEqual(['ethereum', 'arbitrum']);
    expect(r.networks[0].tvlChange7d).not.toBeNull();
    expect(r.networks[1].tvlChange7d).toBeNull();
    expect(r.overview.totalTvlUsd).toBe(63e9);
    expect(r.overview.l2TvlUsd).toBe(3e9);
    expect(r.overview.l2SharePct).toBe(4.8);
    expect(r.overview.allChainsTvlUsd).toBe(64e9);
  });

  it('throws on source failure (no static fallback)', async () => {
    EcosystemService.resetCache();
    const adapter = new DefiLlamaAdapter({ fetchFn: mockFetch(true) });
    await expect(EcosystemService.fetchReport(adapter, now * 1000)).rejects.toBeInstanceOf(AdapterNetworkError);
  });
});
