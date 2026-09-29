import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFuturesMarketSnapshotStore, mapWithConcurrency, compactOpenInterestHistory } from '../../server/services/futuresMarketData.js';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import type { FuturesSnapshot } from '@/services/data/futuresSnapshotClient';

/**
 * Task §2 / §9 / §10 — the aggregated USD-M snapshot.
 *
 * Fixtures below mirror the documented Binance USDⓈ-M response shapes
 * (`/fapi/v1/ticker/24hr`, `/fapi/v1/premiumIndex`, `/fapi/v1/openInterest`,
 * `/futures/data/openInterestHist`). VERIFICATION MODE: unit fixtures — live
 * upstream verification is a separate step run by the operator.
 */

const CONTRACTS = [
  { symbol: 'BTC', exchangeSymbol: 'BTCUSDT', baseAsset: 'BTC', contractType: 'PERPETUAL' },
  { symbol: '1000PEPE', exchangeSymbol: '1000PEPEUSDT', baseAsset: '1000PEPE', contractType: 'PERPETUAL' },
  // Listed contract that the bulk ticker/premium responses do not include —
  // the exact situation that produced silent "Нет данных" rows.
  { symbol: 'GHOST', exchangeSymbol: 'GHOSTUSDT', baseAsset: 'GHOST', contractType: 'PERPETUAL' },
];

const TICKERS = [
  { symbol: 'BTCUSDT', priceChangePercent: '2.500', lastPrice: '64000.10', quoteVolume: '42000000000.00', volume: '650000.000' },
  // No quoteVolume field at all → must stay null, never 0.
  { symbol: '1000PEPEUSDT', priceChangePercent: '-3.250', lastPrice: '0.0085123', volume: '10000.0' },
];

const PREMIUMS = [
  { symbol: 'BTCUSDT', markPrice: '64010.50', indexPrice: '64000.00', lastFundingRate: '0.00010000', nextFundingTime: 1_726_444_800_000, time: 1_726_440_000_000 },
  { symbol: '1000PEPEUSDT', markPrice: '0.0085200', indexPrice: '0.0085100', lastFundingRate: '-0.00005000', nextFundingTime: 1_726_444_800_000, time: 1_726_440_000_000 },
  { symbol: 'GHOSTUSDT', markPrice: '1.2345', indexPrice: '1.2340', lastFundingRate: '0.00002000', nextFundingTime: 1_726_444_800_000, time: 1_726_440_000_000 },
];

const universeCache = {
  async get() {
    return { value: { contracts: CONTRACTS, activeUsdtContracts: CONTRACTS.length, perpetualCount: CONTRACTS.length }, at: 1_726_440_000_000, stale: false };
  },
};

function makeFetch(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    calls.push(url);
    const body = (() => {
      if (url.includes('/fapi/v1/ticker/24hr')) return overrides.tickers ?? TICKERS;
      if (url.includes('/fapi/v1/premiumIndex')) return overrides.premiums ?? PREMIUMS;
      if (url.includes('/fapi/v1/openInterest?symbol=BTCUSDT')) return { symbol: 'BTCUSDT', openInterest: '85000.000', time: 1_726_440_000_000 };
      if (url.includes('/fapi/v1/openInterest')) throw new Error('open interest unavailable');
      if (url.includes('/futures/data/openInterestHist')) {
        return [
          { symbol: 'BTCUSDT', sumOpenInterest: '80000', sumOpenInterestValue: '5000000000', timestamp: 1_726_353_600_000 },
          { symbol: 'BTCUSDT', sumOpenInterest: '84000', sumOpenInterestValue: '5300000000', timestamp: 1_726_436_400_000 },
          { symbol: 'BTCUSDT', sumOpenInterest: '85000', sumOpenInterestValue: '5400000000', timestamp: 1_726_440_000_000 },
        ];
      }
      throw new Error(`unexpected url ${url}`);
    })();
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  return { fetchFn, calls };
}

describe('server futures snapshot — bulk mapping', () => {
  it('joins tickers and premium on the CONTRACT symbol and keeps raw upstream strings', async () => {
    const { fetchFn } = makeFetch();
    const store = createFuturesMarketSnapshotStore({ fetchFn: fetchFn as never, universeCache });
    const snapshot = await store.snapshot({ awaitOpenInterest: true });

    const btc = snapshot.rows.find((r: { contractSymbol: string }) => r.contractSymbol === 'BTCUSDT');
    expect(btc).toMatchObject({
      baseAsset: 'BTC',
      contractType: 'PERPETUAL',
      markPrice: '64010.50',
      lastPrice: '64000.10',
      priceChangePercent: '2.500',
      quoteVolume: '42000000000.00',
      lastFundingRate: '0.00010000',
    });

    const pepe = snapshot.rows.find((r: { contractSymbol: string }) => r.contractSymbol === '1000PEPEUSDT');
    // A multiplier contract joins on 1000PEPEUSDT — never on PEPEUSDT.
    expect(pepe?.baseAsset).toBe('1000PEPE');
    expect(pepe?.priceChangePercent).toBe('-3.250');
  });

  it('reports missing metrics as null instead of fabricating zeros', async () => {
    const { fetchFn } = makeFetch();
    const store = createFuturesMarketSnapshotStore({ fetchFn: fetchFn as never, universeCache });
    const snapshot = await store.snapshot({ awaitOpenInterest: true });

    const pepe = snapshot.rows.find((r: { contractSymbol: string }) => r.contractSymbol === '1000PEPEUSDT');
    expect(pepe?.quoteVolume).toBeNull(); // upstream omitted quoteVolume
    expect(pepe?.openInterest).toBeNull(); // per-symbol OI request failed

    const ghost = snapshot.rows.find((r: { contractSymbol: string }) => r.contractSymbol === 'GHOSTUSDT');
    // Present in exchangeInfo + premiumIndex, absent from the 24h ticker array.
    expect(ghost?.markPrice).toBe('1.2345');
    expect(ghost?.lastPrice).toBeNull();
    expect(ghost?.priceChangePercent).toBeNull();
    expect(ghost?.quoteVolume).toBeNull();
  });

  it('publishes honest coverage counters for the UI footer', async () => {
    const { fetchFn } = makeFetch();
    const store = createFuturesMarketSnapshotStore({ fetchFn: fetchFn as never, universeCache });
    const snapshot = await store.snapshot({ awaitOpenInterest: true });

    expect(snapshot.coverage).toMatchObject({
      contracts: 3,
      withPrice: 3,
      withChange24h: 2,
      withVolume: 1,
      withFunding: 3,
      withOpenInterest: 1,
      withoutTicker: 1,
      withoutPremium: 0,
    });
    expect(snapshot.activeUsdtContracts).toBe(3);
    expect(snapshot.filter).toContain('PERPETUAL');
  });

  it('uses the array-returning bulk endpoints (no N+1 ticker requests)', async () => {
    const { fetchFn, calls } = makeFetch();
    const store = createFuturesMarketSnapshotStore({ fetchFn: fetchFn as never, universeCache });
    await store.snapshot({ awaitOpenInterest: true });

    expect(calls.filter((u) => u.includes('/fapi/v1/ticker/24hr'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('/fapi/v1/premiumIndex'))).toHaveLength(1);
    // Open interest has no bulk endpoint upstream: at most one request per contract.
    expect(calls.filter((u) => u.includes('/fapi/v1/openInterest')).length).toBeLessThanOrEqual(CONTRACTS.length);
  });

  it('serves the cached bulk payload inside the TTL instead of re-hitting Binance', async () => {
    const { fetchFn, calls } = makeFetch();
    const store = createFuturesMarketSnapshotStore({ fetchFn: fetchFn as never, universeCache });
    await store.snapshot({ awaitOpenInterest: true });
    const before = calls.filter((u) => u.includes('/fapi/v1/ticker/24hr')).length;
    await store.snapshot({ awaitOpenInterest: true });
    expect(calls.filter((u) => u.includes('/fapi/v1/ticker/24hr'))).toHaveLength(before);
  });
});

describe('server futures snapshot — concurrency + compaction helpers', () => {
  it('never exceeds the configured concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (item: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return item;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('compacts an open-interest history to first/1h-ago/latest samples', () => {
    const hist = Array.from({ length: 25 }, (_, i) => ({
      sumOpenInterest: String(1000 + i),
      sumOpenInterestValue: String(50_000 + i * 10),
      timestamp: 1_726_353_600_000 + i * 3_600_000,
    }));
    const compact = compactOpenInterestHistory(hist)!;
    expect(Array.isArray(compact)).toBe(true);
    expect(compact.length).toBeLessThanOrEqual(3);
    expect(compact[compact.length - 1].timestamp).toBe(hist[hist.length - 1].timestamp);
  });

  it('returns null for an empty or invalid history', () => {
    expect(compactOpenInterestHistory([])).toBeNull();
    expect(compactOpenInterestHistory(null)).toBeNull();
  });
});

describe('client mapping — snapshot rows → FuturesAsset', () => {
  const snapshot: FuturesSnapshot = {
    source: 'binance-usdm',
    filter: 'quoteAsset=USDT & status=TRADING & contractType=PERPETUAL',
    fetchedAt: new Date(1_726_440_000_000).toISOString(),
    universeFetchedAt: new Date(1_726_440_000_000).toISOString(),
    stale: false,
    activeUsdtContracts: 3,
    perpetualCount: 3,
    coverage: {
      contracts: 3, withPrice: 3, withChange24h: 2, withVolume: 1, withFunding: 3,
      withOpenInterest: 1, withOpenInterestDelta: 1, withoutPremium: 0, withoutTicker: 1,
      openInterestSweptAt: null, openInterestFailures: 2, openInterestRateLimited: false,
      openInterestHistSweptAt: null, openInterestHistCovered: 1, openInterestHistFailures: 0, openInterestHistRateLimited: false,
    },
    rows: [
      {
        contractSymbol: 'BTCUSDT', baseAsset: 'BTC', contractType: 'PERPETUAL',
        markPrice: '64010.50', indexPrice: '64000.00', lastFundingRate: '0.00010000',
        nextFundingTime: 1_726_444_800_000, premiumTime: 1_726_440_000_000,
        lastPrice: '64000.10', priceChangePercent: '2.500', quoteVolume: '42000000000.00', baseVolume: '650000.000',
        openInterest: '85000.000', openInterestHist: null,
      },
      {
        contractSymbol: '1000PEPEUSDT', baseAsset: '1000PEPE', contractType: 'PERPETUAL',
        markPrice: '0.0085200', indexPrice: '0.0085100', lastFundingRate: '-0.00005000',
        nextFundingTime: 1_726_444_800_000, premiumTime: 1_726_440_000_000,
        lastPrice: '0.0085123', priceChangePercent: null, quoteVolume: null, baseVolume: null,
        openInterest: null, openInterestHist: null,
      },
      {
        // No premium → cannot be normalized by the derivatives engine; the row
        // must be skipped rather than zero-filled.
        contractSymbol: 'BROKENUSDT', baseAsset: 'BROKEN', contractType: 'PERPETUAL',
        markPrice: null, indexPrice: null, lastFundingRate: null,
        nextFundingTime: null, premiumTime: null,
        lastPrice: '1.00', priceChangePercent: '1.0', quoteVolume: '10', baseVolume: '10',
        openInterest: null, openInterestHist: null,
      },
    ],
  };

  let provider: LiveMarketDataProvider;
  beforeEach(() => {
    provider = new LiveMarketDataProvider({
      cacheTtlMs: 0,
      futuresSnapshotFetcher: async () => snapshot,
    } as never);
  });

  it('maps every normalizable contract and skips rows without premium data', async () => {
    const list = await provider.getFuturesList();
    expect(list.map((f) => f.contractSymbol).sort()).toEqual(['1000PEPEUSDT', 'BTCUSDT']);
  });

  it('keeps the exchange contract symbol as the join key and base asset', async () => {
    const pepe = (await provider.getFuturesList()).find((f) => f.contractSymbol === '1000PEPEUSDT');
    expect(pepe?.baseAsset).toBe('1000PEPE');
    expect(pepe?.symbol).toBe('1000PEPE/USDT');
    expect(pepe?.provenance?.market).toBe('futures');
  });

  it('carries the futures 24h change and volume through (RC-2 / RC-3)', async () => {
    const btc = (await provider.getFuturesList()).find((f) => f.contractSymbol === 'BTCUSDT');
    expect(btc?.priceChange24h).toBeCloseTo(2.5, 6);
    expect(btc?.futuresVolume24h).toBeCloseTo(42_000_000_000, 0);
    expect(btc?.lastPrice).toBeCloseTo(64_000.1, 4);
  });

  it('propagates missing futures metrics as null, never as 0 and never from spot', async () => {
    const pepe = (await provider.getFuturesList()).find((f) => f.contractSymbol === '1000PEPEUSDT');
    expect(pepe?.priceChange24h).toBeNull();
    expect(pepe?.futuresVolume24h).toBeNull();
    expect(pepe?.openInterest).toBeNull();
    expect(pepe?.openInterestChange1h).toBeNull();
    expect(pepe?.openInterestChangeSource).toBe('UNAVAILABLE');
    // Funding still exists for this contract — a missing volume must not hide it.
    expect(pepe?.fundingRate).toBeCloseTo(-0.005, 6);
  });

  it('exposes server coverage so the UI can show an honest instrument count', async () => {
    await provider.getFuturesList();
    expect(provider.getFuturesCoverage()).toMatchObject({ contracts: 3, withVolume: 1, withoutTicker: 1 });
  });

  it('looks a contract up by base ticker or by contract symbol', async () => {
    expect((await provider.getFuturesContract('1000PEPE'))?.contractSymbol).toBe('1000PEPEUSDT');
    expect((await provider.getFuturesContract('BTCUSDT'))?.contractSymbol).toBe('BTCUSDT');
    expect(await provider.getFuturesContract('NOPE')).toBeNull();
  });
});
