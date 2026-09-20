import { describe, it, expect, vi } from 'vitest';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';
import { KuCoinSpotAdapter } from '@/services/data/adapters/KuCoinSpotAdapter';
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
});
