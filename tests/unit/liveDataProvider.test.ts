import { describe, it, expect, vi } from 'vitest';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';
import { KuCoinSpotAdapter } from '@/services/data/adapters/KuCoinSpotAdapter';
import { CoinGeckoAdapter } from '@/services/data/adapters/CoinGeckoAdapter';
import { AdapterNetworkError } from '@/services/data/adapters/errors';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

const SAMPLE_BINANCE_TICKER = {
  symbol: 'BTCUSDT',
  priceChange: '1200.00',
  priceChangePercent: '2.00',
  weightedAvgPrice: '64000.00',
  prevClosePrice: '63800.00',
  lastPrice: '65000.00',
  lastQty: '0.1',
  bidPrice: '65000.00',
  askPrice: '65001.00',
  openPrice: '63800.00',
  highPrice: '65500.00',
  lowPrice: '63500.00',
  volume: '10000.00',
  quoteVolume: '650000000.00',
  openTime: 1726358400000,
  closeTime: 1726444800000,
  count: 50000,
};

const SAMPLE_KUCOIN_STATS = {
  time: 1726444800000,
  symbol: 'BTC-USDT',
  buy: '64999.0',
  sell: '65001.0',
  changeRate: '0.0195',
  changePrice: '1150.0',
  high: '65400.0',
  low: '63500.0',
  vol: '980.0',
  volValue: '637000000.0',
  last: '64950.0',
  averagePrice: '64100.0',
};

const SAMPLE_BINANCE_KLINES = [
  [1726358400000, '63800.00', '65500.00', '63500.00', '65000.00', '1000.0', 1726361999999, '64000000.0', 1000, '500.0', '32000000.0', '0'],
];

const SAMPLE_KUCOIN_CANDLES = [
  ['1726358400', '63800.0', '64950.0', '65400.0', '63500.0', '980.0', '63000000.0'],
];

/** Generate a bulk ticker array where each canonical symbol maps to the sample ticker. */
function mockBulkTickers(): any[] {
  return CANONICAL_ASSETS.map((a) => ({
    ...SAMPLE_BINANCE_TICKER,
    symbol: a.binanceSymbol,
  }));
}

describe('LiveMarketDataProvider Unit Tests (Multi-Exchange & Fallback)', () => {
  it('identifies as non-demo provider (isDemo: false)', () => {
    const provider = new LiveMarketDataProvider();
    expect(provider.isDemo).toBe(false);
  });

  it('fetches spot asset list primarily from Binance when available', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue(mockBulkTickers());
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue(SAMPLE_BINANCE_TICKER as any);

    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock });
    const assets = await provider.getAssets();

    expect(assets.length).toBe(25);
    const btc = assets.find((a) => a.symbol === 'BTC');
    expect(btc).toBeDefined();
    expect(btc?.price).toBe(65000);
    expect(btc?.isDemo).toBe(false);
    expect(btc?.provenance?.exchange).toBe('binance');
    expect(btc?.provenance?.isFallback).toBe(false);
  });

  it('includes the full ACTIVE Binance Spot USDT universe (exchangeInfo) beyond canonical metadata', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue([
      ...mockBulkTickers(),
      { ...SAMPLE_BINANCE_TICKER, symbol: 'PEPEUSDT', lastPrice: '0.00001', quoteVolume: '9000000.00' } as any,
      { ...SAMPLE_BINANCE_TICKER, symbol: 'TESTUSDC' } as any,
    ]);
    const candleHistoryService = { getAll: vi.fn().mockResolvedValue(new Map()) } as any;
    const active = new Set([...CANONICAL_ASSETS.map((a) => a.symbol), 'PEPE']);
    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock, candleHistoryService, activeSpotSymbols: async () => active,
    });

    const assets = await provider.getAssets();
    expect(assets).toHaveLength(CANONICAL_ASSETS.length + 1);
    const pepe = assets.find((entry) => entry.symbol === 'PEPE');
    expect(pepe).toMatchObject({
      name: 'PEPE', category: 'other', price: 0.00001, isDemo: false,
      marketCap: 0, circulatingSupply: 0,
      provenance: { exchange: 'binance', market: 'spot', symbol: 'PEPEUSDT' },
    });
    expect(assets.some((entry) => entry.symbol === 'TEST')).toBe(false);
    expect(await provider.getAssets('other')).toEqual([pepe]);
  });

  it('loads a direct Spot snapshot for a provider-listed symbol without canonical metadata', async () => {
    const binanceMock = new BinanceSpotAdapter();
    const fetchTicker = vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue({
      ...SAMPLE_BINANCE_TICKER, symbol: 'PEPEUSDT', lastPrice: '0.00001', quoteVolume: '9000000.00',
    } as any);
    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock });

    const snapshot = await provider.getAssetSnapshot('PEPE');
    expect(fetchTicker).toHaveBeenCalledWith('PEPEUSDT');
    expect(snapshot).toMatchObject({
      symbol: 'PEPE', name: 'PEPE', category: 'other', price: 0.00001,
      marketCap: 0, circulatingSupply: 0, description: '', indicators: null,
      pairs: [{ exchange: 'Binance', pair: 'PEPE/USDT' }],
    });
  });

  it('gracefully falls back to KuCoin when Binance request fails', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockRejectedValue(new AdapterNetworkError('binance'));
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockRejectedValue(new AdapterNetworkError('binance'));

    const kucoinMock = new KuCoinSpotAdapter();
    vi.spyOn(kucoinMock, 'fetch24hrStats').mockResolvedValue(SAMPLE_KUCOIN_STATS as any);

    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
    });

    const assets = await provider.getAssets();
    expect(assets.length).toBe(25);

    const btc = assets.find((a) => a.symbol === 'BTC');
    expect(btc).toBeDefined();
    expect(btc?.price).toBe(64950);
    expect(btc?.provenance?.exchange).toBe('kucoin');
    expect(btc?.provenance?.isFallback).toBe(true);
  });

  it('throws an explicit error when both Binance and KuCoin gateways fail without faking demo numbers', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockRejectedValue(new AdapterNetworkError('binance'));
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockRejectedValue(new AdapterNetworkError('binance'));

    const kucoinMock = new KuCoinSpotAdapter();
    vi.spyOn(kucoinMock, 'fetch24hrStats').mockRejectedValue(new AdapterNetworkError('kucoin'));

    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
    });

    await expect(provider.getAssets()).rejects.toThrow(
      /Live market data unavailable from both Binance and KuCoin gateways/i
    );
  });

  it('fetches candles with Binance primary and KuCoin fallback', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchKlines').mockResolvedValue(SAMPLE_BINANCE_KLINES as any);

    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock });
    const candles = await provider.getCandles('BTC', '1h');

    expect(candles.length).toBe(1);
    expect(candles[0].close).toBe(65000);
    expect(candles[0].provenance?.exchange).toBe('binance');
    expect(candles[0].provenance?.isFallback).toBe(false);

    // Now test fallback
    vi.spyOn(binanceMock, 'fetchKlines').mockRejectedValue(new AdapterNetworkError('binance'));
    const kucoinMock = new KuCoinSpotAdapter();
    vi.spyOn(kucoinMock, 'fetchCandles').mockResolvedValue(SAMPLE_KUCOIN_CANDLES as any);

    const fallbackProvider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
      cacheTtlMs: 0,
    });

    const fallbackCandles = await fallbackProvider.getCandles('BTC', '1h');
    expect(fallbackCandles.length).toBe(1);
    expect(fallbackCandles[0].close).toBe(64950);
    expect(fallbackCandles[0].provenance?.exchange).toBe('kucoin');
    expect(fallbackCandles[0].provenance?.isFallback).toBe(true);
  });

  it('bypasses the candle TTL cache when reconnect/gap recovery explicitly requests fresh history', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchKlines')
      .mockResolvedValueOnce(SAMPLE_BINANCE_KLINES as any)
      .mockResolvedValueOnce([[1726362000000, '65000.00', '66000.00', '64900.00', '65500.00', '1200.0', 1726365599999, '78000000.0', 1200, '600.0', '39000000.0', '0']] as any);
    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock, cacheTtlMs: 60_000 });

    const first = await provider.getCandles('BTC', '1h');
    const cached = await provider.getCandles('BTC', '1h');
    expect(binanceMock.fetchKlines).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(first);

    const refreshed = await provider.getCandles('BTC', '1h', 500, { forceRefresh: true });
    expect(binanceMock.fetchKlines).toHaveBeenCalledTimes(2);
    expect(refreshed[0].time).toBe(1726362000);
    expect(refreshed[0].close).toBe(65500);
  });

  it('KuCoin fallback: запрашивает явное окно и обрезает глубину до запрошенного limit', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchKlines').mockRejectedValue(new AdapterNetworkError('binance'));

    const kucoinMock = new KuCoinSpotAdapter();
    const windows: Array<{ startAtMs?: number; endAtMs?: number } | undefined> = [];
    // KuCoin отдаёт новейшие первыми: 5 баров, из них последний — формирующийся.
    const rows = [4, 3, 2, 1, 0].map((i) => [
      String(1_726_358_400 + i * 3600), '63800.0', '64950.0', '65400.0', '63500.0', '980.0', '63000000.0',
    ]);
    vi.spyOn(kucoinMock, 'fetchCandles').mockImplementation(async (_s: string, _t?: string, w?: any) => {
      windows.push(w);
      return rows as any;
    });

    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
      cacheTtlMs: 0,
    });
    const candles = await provider.getCandles('BTC', '1h', 3);

    expect(candles.length).toBe(3);
    // Обрезаем слева: остаются три самых свежих бара в хронологическом порядке.
    expect(candles[0].time).toBe(1_726_358_400 + 2 * 3600);
    expect(candles[2].time).toBe(1_726_358_400 + 4 * 3600);
    expect(candles.every((c) => c.provenance?.exchange === 'kucoin')).toBe(true);

    // Окно запроса = limit + 2 бара «с запасом» на формирующийся бар.
    expect(windows).toHaveLength(1);
    expect(windows[0]!.endAtMs! - windows[0]!.startAtMs!).toBe((3 + 2) * 3_600_000);
  });

  it('aggregates live market overview over active spot assets', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue(mockBulkTickers());
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue(SAMPLE_BINANCE_TICKER as any);

    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock });
    const overview = await provider.getMarketOverview();

    expect(overview.isDemo).toBe(false);
    expect(overview.totalVolume24h).toBeGreaterThan(0);
    expect(overview.totalMarketCap).toBeGreaterThan(0);
  });

  it('filters live assets by category', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue(mockBulkTickers());
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue(SAMPLE_BINANCE_TICKER as any);

    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock });
    const defiAssets = await provider.getAssets('defi');

    expect(defiAssets.length).toBeGreaterThan(0);
    for (const a of defiAssets) {
      expect(a.category).toBe('defi');
    }
  });

  it('filters live assets in screener query', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue(mockBulkTickers());
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue(SAMPLE_BINANCE_TICKER as any);

    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock });
    const screenerResults = await provider.getScreenerResults({ query: 'BTC' });

    expect(screenerResults.length).toBe(1);
    expect(screenerResults[0].symbol).toBe('BTC');
  });

  it('provides live liquidation data and manages subsystem states', async () => {
    // P22: Fully mocked — ZERO real network calls. Network-isolated unit test.
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchAll24hrTickers').mockResolvedValue(mockBulkTickers());
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue(SAMPLE_BINANCE_TICKER as any);

    const futuresAdapterMock = {
      fetchPremiumIndexes: vi.fn().mockRejectedValue(new AdapterNetworkError('binance')),
      fetch24hrTickers: vi.fn().mockRejectedValue(new AdapterNetworkError('binance')),
      fetchOpenInterestHist: vi.fn().mockRejectedValue(new AdapterNetworkError('binance')),
    } as any;

    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      futuresAdapter: futuresAdapterMock,
      // Radar is server-authoritative; this unit remains network-isolated.
      radarEventsFetcher: async () => [],
    });

    // LIVE-FIRST: без фактического источника деривативов — честная ошибка, а не демо-датасет.
    await expect(provider.getFuturesList()).rejects.toThrow(AdapterNetworkError);

    // Честная контрактная проверка: без фактических событий потока live-провайдер
    // обязан вернуть нулевые агрегаты, а не оценочные «заглушки» (RULES §1).
    const liquidations = await provider.getLiquidations();
    expect(liquidations.isDemo).toBe(false);
    expect(liquidations.total24h).toBe(0);
    expect(liquidations.largestEvent).toBeNull();
    expect(liquidations.assetBreakdown).toEqual([]);
    expect(['AWAITING_STREAM', 'UNAVAILABLE']).toContain(liquidations.dataStatus);

    // Без фактических аномалий радар пуст — демо-события за фактические не выдаются.
    const radar = await provider.getRadarEvents();
    expect(radar).toEqual([]);
  });

  /**
   * RUNE (инцидент 2026-09-25): BTC и RUNE обязаны иметь РАЗНЫЕ записи кэша
   * свечей и разные запросы к бирже. Общая запись означала бы, что один
   * инструмент получает свечи другого (в проде заголовок показывал RUNE, а
   * шкала — BTC).
   */
  it('RUNE: отдельный запрос RUNEUSDT и отдельная запись кэша (не свечи BTC)', async () => {
    const binanceMock = new BinanceSpotAdapter();
    const requested: string[] = [];
    vi.spyOn(binanceMock, 'fetchKlines').mockImplementation(async (rawSymbol: string) => {
      requested.push(rawSymbol);
      const close = rawSymbol === 'RUNEUSDT' ? 0.64 : 65_000;
      return [[1726358400000, String(close), String(close), String(close), String(close), '1000',
        1726361999999, '64000000', 1000, '500', '32000000', '0']] as any;
    });

    const provider = new LiveMarketDataProvider({ binanceAdapter: binanceMock, cacheTtlMs: 60_000 });

    const btc = await provider.getCandles('BTC', '1h');
    const rune = await provider.getCandles('RUNE', '1h');

    expect(requested).toEqual(['BTCUSDT', 'RUNEUSDT']);
    expect(btc[0].close).toBe(65_000);
    expect(rune[0].close).toBe(0.64);
    expect(rune[0].provenance?.exchange).toBe('binance');

    // Повторный BTC обслуживается из своей записи кэша: RUNE её не вытеснил.
    const btcAgain = await provider.getCandles('BTC', '1h');
    expect(requested).toEqual(['BTCUSDT', 'RUNEUSDT']);
    expect(btcAgain[0].close).toBe(65_000);

    // И наоборот: RUNE не подменился свечами BTC.
    const runeAgain = await provider.getCandles('RUNE', '1h');
    expect(runeAgain[0].close).toBe(0.64);
  });

  it('отказ Binance по RUNE: KuCoin-резерв запрашивает ТОТ ЖЕ инструмент (RUNE-USDT)', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchKlines').mockRejectedValue(new AdapterNetworkError('binance'));
    const kucoinMock = new KuCoinSpotAdapter();
    const kucoinCalls: Array<{ symbol: string; type?: string }> = [];
    vi.spyOn(kucoinMock, 'fetchCandles').mockImplementation(async (symbol: string, type?: string) => {
      kucoinCalls.push({ symbol, type });
      return SAMPLE_KUCOIN_CANDLES as any;
    });

    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
      cacheTtlMs: 0,
    });

    const rune = await provider.getCandles('RUNE', '1h');
    // Резерв — тот же инструмент на другой бирже, а не «какой-нибудь другой символ».
    expect(kucoinCalls).toEqual([{ symbol: 'RUNE-USDT', type: '1hour' }]);
    expect(rune[0].provenance?.exchange).toBe('kucoin');
    expect(rune[0].provenance?.isFallback).toBe(true);
    expect(rune[0].close).toBe(64950);
  });

  it('оба источника молчат по RUNE — честная ошибка, свечей BTC нет', async () => {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetchKlines').mockImplementation(async (rawSymbol: string) =>
      rawSymbol === 'BTCUSDT' ? (SAMPLE_BINANCE_KLINES as any) : Promise.reject(new AdapterNetworkError('binance'))
    );
    const kucoinMock = new KuCoinSpotAdapter();
    vi.spyOn(kucoinMock, 'fetchCandles').mockRejectedValue(new AdapterNetworkError('kucoin'));

    const provider = new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
      cacheTtlMs: 0,
    });

    // BTC уже загружен — это не повод отдать его для RUNE.
    const btc = await provider.getCandles('BTC', '1h');
    expect(btc[0].close).toBe(65000);

    await expect(provider.getCandles('RUNE', '1h')).rejects.toThrow(
      /Candle data unavailable from live exchanges for RUNE/i
    );
  });
});

describe('LiveMarketDataProvider — честность detail-данных (З3/З7, v0.8.50)', () => {
  /** klines-строка Binance: [openTime, open, high, low, close, volume, closeTime, ...] */
  function klines(closes: number[]): any[] {
    return closes.map((c, i) => [
      1726358400000 + i * 3_600_000, String(c - 50), String(c + 50), String(c - 80), String(c), '1000',
      1726358400000 + (i + 1) * 3_600_000 - 1, '65000000', 1000, '50', '32000000', '0',
    ]);
  }

  function makeDetailProvider(closes: number[], tickerOverrides: Record<string, string> = {}) {
    const binanceMock = new BinanceSpotAdapter();
    vi.spyOn(binanceMock, 'fetch24hrTicker').mockResolvedValue({
      ...SAMPLE_BINANCE_TICKER,
      bidPrice: '64900.00',
      askPrice: '65100.00',
      ...tickerOverrides,
    } as any);
    vi.spyOn(binanceMock, 'fetchKlines').mockResolvedValue(klines(closes) as any);

    const kucoinMock = new KuCoinSpotAdapter();
    vi.spyOn(kucoinMock, 'fetch24hrStats').mockResolvedValue({
      ...SAMPLE_KUCOIN_STATS,
      buy: '64950.0',
      sell: '65050.0',
    } as any);
    vi.spyOn(kucoinMock, 'fetchCandles').mockRejectedValue(new AdapterNetworkError('kucoin'));

    const coingeckoMock = new CoinGeckoAdapter({
      fetchFn: (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    });

    return new LiveMarketDataProvider({
      binanceAdapter: binanceMock,
      kucoinAdapter: kucoinMock,
      coingeckoAdapter: coingeckoMock,
      candleHistoryService: { getAll: async () => new Map() } as any,
    });
  }

  it('З3: <200 фактических свечей → indicators = null (не RSI=50 / SMA=цена / Bollinger=цена)', async () => {
    const provider = makeDetailProvider(Array.from({ length: 10 }, (_, i) => 64000 + i));
    const detail = await provider.getAssetDetail('BTC');
    expect(detail).not.toBeNull();
    expect(detail!.indicators).toBeNull();
  });

  it('З3: >= 200 свечей → полный числовой набор из фактических свечей', async () => {
    const provider = makeDetailProvider(Array.from({ length: 220 }, (_, i) => 64000 + i));
    const detail = await provider.getAssetDetail('BTC');
    expect(detail).not.toBeNull();
    const ind = detail!.indicators;
    expect(ind).not.toBeNull();
    expect(Number.isFinite(ind!.rsi14)).toBe(true);
    expect(Number.isFinite(ind!.sma200)).toBe(true);
    expect(ind!.sma200).toBeGreaterThan(0);
    expect(ind!.bollinger.upper).toBeGreaterThan(ind!.bollinger.lower);
  });

  it('З7: спред пар — из фактических bid/ask обеих бирж, без выдуманных 0.01/0.02', async () => {
    const provider = makeDetailProvider(Array.from({ length: 10 }, (_, i) => 64000 + i));
    const detail = await provider.getAssetDetail('BTC');

    const binancePair = detail!.pairs.find((p) => p.exchange === 'Binance');
    expect(binancePair).toBeDefined();
    // bid 64900 / ask 65100 → спред (65100−64900)/65000 = 0.3077%
    expect(binancePair!.spreadPct).not.toBeNull();
    expect(binancePair!.spreadPct!).toBeCloseTo(0.3077, 3);

    const kucoinPair = detail!.pairs.find((p) => p.exchange === 'KuCoin');
    expect(kucoinPair).toBeDefined();
    // buy 64950 / sell 65050 → спред (65050−64950)/65000 = 0.1538%
    expect(kucoinPair!.spreadPct).not.toBeNull();
    expect(kucoinPair!.spreadPct!).toBeCloseTo(0.1538, 3);
  });

  it('З7: биржа не отдала bid/ask → spreadPct = null («—» в UI), не константа', async () => {
    const provider = makeDetailProvider(Array.from({ length: 10 }, (_, i) => 64000 + i), {
      bidPrice: '',
      askPrice: '',
    });
    const detail = await provider.getAssetDetail('BTC');
    const binancePair = detail!.pairs.find((p) => p.exchange === 'Binance');
    expect(binancePair!.spreadPct).toBeNull();
  });
});
