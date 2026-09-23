/**
 * Authoritative exchange universe: Binance Spot + USD-M Futures exchangeInfo.
 * Historical/dead ticker records must never enter the universe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterActiveSpotUsdt,
  filterActiveUsdmFutures,
  isSpotTradingAllowed,
  UniverseCache,
  __resetUniverseCachesForTests,
} from '../../server/services/exchangeUniverse.js';
import { requestMarketData } from '../../server/services/marketDataGateway.js';
import { buildMetadataMap, AssetMetadataCache } from '../../server/services/assetMetadata.js';
import {
  futuresBaseToSpot,
  getFuturesUniverse,
  getSpotUniverse,
  resetExchangeUniverseForTests,
} from '@/services/data/registry/exchangeUniverse';

afterEach(() => {
  __resetUniverseCachesForTests();
  resetExchangeUniverseForTests();
  vi.restoreAllMocks();
});

const spot = (symbol: string, base: string, quote: string, extra: Record<string, unknown> = {}) => ({
  symbol, baseAsset: base, quoteAsset: quote, status: 'TRADING', isSpotTradingAllowed: true, permissions: [], ...extra,
});

/** Dead/historical records that production's bulk ticker still returns. */
const DEAD = ['VEN', 'XRPBULL', 'XRPBEAR', 'XLMUP', 'XLMDOWN', 'XTZUP', 'XTZDOWN', 'YFIUP', 'YFIDOWN', 'BCC', 'BCHABC'];

function syntheticSpotExchangeInfo(activeCount: number) {
  const active = Array.from({ length: activeCount }, (_, i) => spot(`C${i}USDT`, `C${i}`, 'USDT'));
  return {
    symbols: [
      spot('BTCUSDT', 'BTC', 'USDT'),
      spot('LTCUSDT', 'LTC', 'USDT'),
      spot('PEPEUSDT', 'PEPE', 'USDT'),
      spot('USDCUSDT', 'USDC', 'USDT'),
      ...active,
      ...DEAD.map((b) => spot(`${b}USDT`, b, 'USDT', { status: 'BREAK' })),
      spot('ETHBTC', 'ETH', 'BTC'), // wrong quote
      spot('BTCUSDC', 'BTC', 'USDC'), // wrong quote
      spot('HALTUSDT', 'HALT', 'USDT', { status: 'HALT' }),
      spot('MARGINUSDT', 'MARGIN', 'USDT', { isSpotTradingAllowed: false, permissions: ['MARGIN'] }),
    ],
  };
}

describe('Spot exchangeInfo filtering', () => {
  it('keeps only quoteAsset=USDT & status=TRADING & spot allowed', () => {
    const list = filterActiveSpotUsdt(syntheticSpotExchangeInfo(3));
    expect(list.map((s) => s.symbol).sort()).toEqual(['BTC', 'C0', 'C1', 'C2', 'LTC', 'PEPE', 'USDC']);
    expect(list.find((s) => s.symbol === 'PEPE')).toEqual({ symbol: 'PEPE', exchangeSymbol: 'PEPEUSDT', baseAsset: 'PEPE' });
  });

  it('excludes historical/dead symbols (VEN, XRPBULL, BCC, BCHABC, *UP/*DOWN…)', () => {
    const bases = new Set(filterActiveSpotUsdt(syntheticSpotExchangeInfo(0)).map((s) => s.symbol));
    for (const dead of DEAD) expect(bases.has(dead), dead).toBe(false);
    expect(bases.has('HALT')).toBe(false);
    expect(bases.has('MARGIN')).toBe(false);
  });

  it('count is never hardcoded — follows exchangeInfo exactly (500, 736, …)', () => {
    for (const n of [0, 496, 732]) {
      expect(filterActiveSpotUsdt(syntheticSpotExchangeInfo(n))).toHaveLength(n + 4);
    }
  });

  it('understands every Binance permission shape', () => {
    expect(isSpotTradingAllowed({ isSpotTradingAllowed: true })).toBe(true);
    expect(isSpotTradingAllowed({ isSpotTradingAllowed: false, permissions: ['SPOT'] })).toBe(false);
    expect(isSpotTradingAllowed({ permissions: ['SPOT', 'MARGIN'] })).toBe(true);
    expect(isSpotTradingAllowed({ permissionSets: [['MARGIN'], ['SPOT']] })).toBe(true);
    expect(isSpotTradingAllowed({ permissionSets: [['MARGIN']] })).toBe(false);
    expect(isSpotTradingAllowed({})).toBe(false);
  });
});

describe('USD-M Futures exchangeInfo filtering', () => {
  const fut = (symbol: string, base: string, extra: Record<string, unknown> = {}) => ({
    symbol, pair: symbol, baseAsset: base, quoteAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING',
    deliveryDate: 4133404800000, onboardDate: 1569398400000, ...extra,
  });

  it('lists every active USDT PERPETUAL (not canonical 25) and counts dated contracts separately', () => {
    const perps = Array.from({ length: 480 }, (_, i) => fut(`X${i}USDT`, `X${i}`));
    const r = filterActiveUsdmFutures({
      symbols: [
        fut('BTCUSDT', 'BTC'),
        fut('1000PEPEUSDT', '1000PEPE'),
        ...perps,
        fut('BTCUSDT_261225', 'BTC', { contractType: 'CURRENT_QUARTER' }),
        fut('ETHUSDT_261225', 'ETH', { contractType: 'NEXT_QUARTER' }),
        fut('DEADUSDT', 'DEAD', { status: 'SETTLING' }),
        fut('OLDUSDT', 'OLD', { status: 'PENDING_TRADING' }),
        fut('BTCUSDC', 'BTC', { quoteAsset: 'USDC' }),
      ],
    });
    expect(r.activeUsdtContracts).toBe(484);
    expect(r.perpetualCount).toBe(482);
    expect(r.contracts).toHaveLength(482);
    expect(r.contracts.some((c: any) => c.exchangeSymbol === 'DEADUSDT')).toBe(false);
    expect(r.contracts.some((c: any) => c.exchangeSymbol === 'BTCUSDT_261225')).toBe(false);
    expect(r.contracts.some((c: any) => c.exchangeSymbol === 'X479USDT')).toBe(true);
  });

  it('maps multiplier-prefixed perps (1000PEPE) to the Spot base for navigation', () => {
    const spotSet = new Set(['PEPE', 'BTC', 'FET', 'ARB', 'NEAR']);
    expect(futuresBaseToSpot('1000PEPE', spotSet)).toBe('PEPE');
    expect(futuresBaseToSpot('BTC', spotSet)).toBe('BTC');
    expect(futuresBaseToSpot('PERPONLY', spotSet)).toBeNull();
  });
});

describe('server universe cache — exchangeInfo fetched at most once per TTL', () => {
  it('dedupes concurrent requests and serves from cache', async () => {
    let now = 0;
    const fetchFn = vi.fn(async () => Response.json(syntheticSpotExchangeInfo(10)));
    const cache = new UniverseCache({ url: 'x', transform: filterActiveSpotUsdt, fetchFn: fetchFn as any, now: () => now, ttlMs: 1000 });
    await Promise.all(Array.from({ length: 20 }, () => cache.get()));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = 500;
    await cache.get();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = 2000;
    await cache.get();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('serves last good universe (marked stale) on upstream failure', async () => {
    let now = 0;
    let fail = false;
    const fetchFn = vi.fn(async () => (fail ? Promise.reject(new Error('451')) : Response.json(syntheticSpotExchangeInfo(1))));
    const cache = new UniverseCache({ url: 'x', transform: filterActiveSpotUsdt, fetchFn: fetchFn as any, now: () => now, ttlMs: 10 });
    await cache.get();
    fail = true;
    now = 100;
    const r = await cache.get();
    expect(r.stale).toBe(true);
    expect(r.value).toHaveLength(5);
  });

  it('gateway exposes /universe/spot and /universe/futures as computed endpoints and rejects queries', async () => {
    const spotCache = new UniverseCache({ url: 'x', transform: filterActiveSpotUsdt, fetchFn: (async () => Response.json(syntheticSpotExchangeInfo(2))) as any });
    const futCache = new UniverseCache({
      url: 'y', transform: filterActiveUsdmFutures,
      fetchFn: (async () => Response.json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL' }] })) as any,
    });
    __resetUniverseCachesForTests({ spot: spotCache, futures: futCache });
    const s = await requestMarketData('/universe/spot', new URLSearchParams());
    expect(s.status).toBe(200);
    expect((s.body as any).count).toBe(6);
    const f = await requestMarketData('/universe/futures', new URLSearchParams());
    expect((f.body as any)).toMatchObject({ perpetualCount: 1, activeUsdtContracts: 1, count: 1 });
    expect((await requestMarketData('/universe/spot', new URLSearchParams('url=evil'))).status).toBe(400);
  });
});

describe('client universe loader', () => {
  it('ONE request for any number of callers; spot and futures are separate lists', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/spot')) return Response.json({ symbols: [{ symbol: 'LTC', exchangeSymbol: 'LTCUSDT', baseAsset: 'LTC' }] });
      return Response.json({ activeUsdtContracts: 3, perpetualCount: 2, contracts: [
        { symbol: 'BTC', exchangeSymbol: 'BTCUSDT', baseAsset: 'BTC', contractType: 'PERPETUAL' },
        { symbol: '1000PEPE', exchangeSymbol: '1000PEPEUSDT', baseAsset: '1000PEPE', contractType: 'PERPETUAL' },
      ] });
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => getSpotUniverse(fetchFn as any)));
    expect(results.every((r) => r?.count === 1)).toBe(true);
    const fu = await getFuturesUniverse(fetchFn as any);
    expect(fu).toMatchObject({ perpetualCount: 2, activeUsdtContracts: 3, count: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('asset metadata (logos) server cache', () => {
  it('pinned canonical ids win their ticker; otherwise largest market cap wins', () => {
    const map = buildMetadataMap([
      { id: 'fake-btc', symbol: 'btc', name: 'Fake', image: 'https://x/fake.png' },
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://x/btc.png' },
      { id: 'pepe', symbol: 'pepe', name: 'Pepe', image: 'https://x/pepe.png' },
      { id: 'pepe-clone', symbol: 'pepe', name: 'Clone', image: 'https://x/clone.png' },
      { id: 'bad', symbol: 'bad', name: 'Bad', image: 'http://insecure/x.png' },
    ]);
    expect(map.BTC).toEqual({ name: 'Bitcoin', logo: 'https://x/btc.png' });
    expect(map.PEPE.name).toBe('Pepe');
    expect(map.BAD).toBeUndefined();
  });

  it('bounded paged loading (sequential pages), cached, no retry storm on failure', async () => {
    let now = 0;
    const fetchFn = vi.fn(async () => Response.json([{ id: 'litecoin', symbol: 'ltc', name: 'Litecoin', image: 'https://x/ltc.png' }]));
    const cache = new AssetMetadataCache({ fetchFn: fetchFn as any, now: () => now, pages: 3, pageDelayMs: 0 });
    await Promise.all(Array.from({ length: 30 }, () => cache.get()));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await cache.get();
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const failing = vi.fn(async () => { throw new Error('429'); });
    const c2 = new AssetMetadataCache({ fetchFn: failing as any, now: () => now, pages: 3, pageDelayMs: 0 });
    await expect(c2.get()).rejects.toThrow();
    await expect(c2.get()).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
    now = 10 * 60_000;
    await expect(c2.get()).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
