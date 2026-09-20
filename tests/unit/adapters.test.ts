import { describe, it, expect } from 'vitest';
import { BinanceSpotAdapter } from '@/services/data/adapters/BinanceSpotAdapter';
import { KuCoinSpotAdapter } from '@/services/data/adapters/KuCoinSpotAdapter';
import {
  normalizeBinanceTicker,
  normalizeKuCoinStats,
  normalizeBinanceKlines,
  normalizeKuCoinCandles,
  normalizeKuCoinTickerItem,
} from '@/services/data/adapters/normalization';
import {
  BinanceTicker24hrSchema,
  BinanceKlinesResponseSchema,
  KuCoinStatsResponseSchema,
  KuCoinAllTickersResponseSchema,
  KuCoinCandlesResponseSchema,
} from '@/services/data/adapters/schemas';
import {
  AdapterNetworkError,
  AdapterTimeoutError,
  AdapterValidationError,
  AdapterRateLimitError,
  SymbolNotFoundError,
} from '@/services/data/adapters/errors';
import { getAssetBySymbol } from '@/services/data/registry/assetRegistry';

const BINANCE_TICKER_FIXTURE = {
  symbol: 'BTCUSDT',
  priceChange: '1500.50',
  priceChangePercent: '2.35',
  weightedAvgPrice: '64500.20',
  prevClosePrice: '63800.00',
  lastPrice: '65300.50',
  lastQty: '0.15',
  bidPrice: '65300.00',
  askPrice: '65301.00',
  openPrice: '63800.00',
  highPrice: '65800.00',
  lowPrice: '63500.00',
  volume: '24120.55',
  quoteVolume: '1555800000.00',
  openTime: 1726358400000,
  closeTime: 1726444800000,
  count: 1450200,
};

const BINANCE_KLINES_FIXTURE = [
  [1726358400000, '63800.00', '64500.00', '63700.00', '64200.00', '1250.50', 1726361999999, '80250000.00', 45000, '650.00', '41730000.00', '0'],
  [1726362000000, '64200.00', '65100.00', '64100.00', '65000.00', '1420.80', 1726365599999, '92000000.00', 52000, '750.00', '48750000.00', '0'],
];

const KUCOIN_STATS_RESPONSE_FIXTURE = {
  code: '200000',
  data: {
    time: 1726444800000,
    symbol: 'BTC-USDT',
    buy: '65299.0',
    sell: '65301.0',
    changeRate: '0.0235',
    changePrice: '1500.0',
    high: '65800.0',
    low: '63500.0',
    vol: '2390.5',
    volValue: '1545000000.0',
    last: '65300.0',
    averagePrice: '64600.0',
  },
};

const KUCOIN_ALL_TICKERS_FIXTURE = {
  code: '200000',
  data: {
    time: 1726444800000,
    ticker: [
      {
        symbol: 'BTC-USDT',
        symbolName: 'BTC-USDT',
        buy: '65299.0',
        sell: '65301.0',
        changeRate: '0.0235',
        changePrice: '1500.0',
        high: '65800.0',
        low: '63500.0',
        vol: '2390.5',
        volValue: '1545000000.0',
        last: '65300.0',
        averagePrice: '64600.0',
      },
    ],
  },
};

const KUCOIN_CANDLES_RESPONSE_FIXTURE = {
  code: '200000',
  data: [
    ['1726362000', '64200.0', '65000.0', '65100.0', '64100.0', '1420.8', '92000000.0'],
    ['1726358400', '63800.0', '64200.0', '64500.0', '63700.0', '1250.5', '80250000.0'],
  ],
};

describe('Binance Adapter & DTO Validation', () => {
  it('validates authentic Binance 24hr ticker DTO schema', () => {
    const parsed = BinanceTicker24hrSchema.parse(BINANCE_TICKER_FIXTURE);
    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.lastPrice).toBe('65300.50');
    expect(parsed.quoteVolume).toBe('1555800000.00');
  });

  it('normalizes Binance ticker into CRYPTORA AssetSummary with correct provenance', () => {
    const asset = getAssetBySymbol('BTC')!;
    const summary = normalizeBinanceTicker(BINANCE_TICKER_FIXTURE, asset);

    expect(summary.symbol).toBe('BTC');
    expect(summary.name).toBe('Bitcoin');
    expect(summary.price).toBe(65300.5);
    expect(summary.change24h).toBe(2.35);
    expect(summary.volume24h).toBe(1555800000);
    expect(summary.isDemo).toBe(false);
    expect(summary.provenance).toEqual({
      exchange: 'binance',
      market: 'spot',
      symbol: 'BTCUSDT',
      timestamp: 1726444800000,
      isFallback: false,
    });
  });

  it('validates and normalizes Binance Klines', () => {
    const parsed = BinanceKlinesResponseSchema.parse(BINANCE_KLINES_FIXTURE);
    const candles = normalizeBinanceKlines(parsed, 'BTC');

    expect(candles.length).toBe(2);
    expect(candles[0].time).toBe(1726358400); // in seconds
    expect(candles[0].open).toBe(63800);
    expect(candles[0].high).toBe(64500);
    expect(candles[0].close).toBe(64200);
    expect(candles[0].volume).toBe(1250.5);
    expect(candles[0].provenance?.exchange).toBe('binance');
    expect(candles[0].provenance?.isFallback).toBe(false);
  });

  it('adapter fetches ticker using mock fetchFn and validates response', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(BINANCE_TICKER_FIXTURE), { status: 200 });

    const adapter = new BinanceSpotAdapter({ fetchFn: mockFetch as any });
    const ticker = await adapter.fetch24hrTicker('BTCUSDT');
    expect(ticker.lastPrice).toBe('65300.50');
  });

  it('adapter throws AdapterValidationError on malformed response', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ invalidField: 'wrong' }), { status: 200 });

    const adapter = new BinanceSpotAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetch24hrTicker('BTCUSDT')).rejects.toThrow(AdapterValidationError);
  });

  it('adapter throws AdapterRateLimitError on HTTP 429', async () => {
    const mockFetch = async () =>
      new Response('Rate limit exceeded', { status: 429 });

    const adapter = new BinanceSpotAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetch24hrTicker('BTCUSDT')).rejects.toThrow(AdapterRateLimitError);
  });

  it('adapter throws SymbolNotFoundError on HTTP 400 symbol invalid', async () => {
    const mockFetch = async () =>
      new Response('Invalid symbol', { status: 400 });

    const adapter = new BinanceSpotAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetch24hrTicker('INVALID_COIN')).rejects.toThrow(SymbolNotFoundError);
  });

  it('adapter throws AdapterNetworkError on network failure', async () => {
    const mockFetch = async () => {
      throw new Error('Connection refused (ECONNREFUSED)');
    };

    const adapter = new BinanceSpotAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetch24hrTicker('BTCUSDT')).rejects.toThrow(AdapterNetworkError);
  });

  it('adapter throws AdapterTimeoutError on abort timeout', async () => {
    const mockFetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const adapter = new BinanceSpotAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetch24hrTicker('BTCUSDT')).rejects.toThrow(AdapterTimeoutError);
  });
});

describe('KuCoin Adapter & DTO Validation', () => {
  it('validates authentic KuCoin 24hr stats response schema', () => {
    const parsed = KuCoinStatsResponseSchema.parse(KUCOIN_STATS_RESPONSE_FIXTURE);
    expect(parsed.code).toBe('200000');
    expect(parsed.data.symbol).toBe('BTC-USDT');
    expect(parsed.data.last).toBe('65300.0');
    expect(parsed.data.changeRate).toBe('0.0235');
  });

  it('normalizes KuCoin stats into CRYPTORA AssetSummary with fallback provenance', () => {
    const asset = getAssetBySymbol('BTC')!;
    const summary = normalizeKuCoinStats(KUCOIN_STATS_RESPONSE_FIXTURE.data, asset, [], true);

    expect(summary.symbol).toBe('BTC');
    expect(summary.price).toBe(65300);
    expect(summary.change24h).toBe(2.35); // 0.0235 * 100
    expect(summary.volume24h).toBe(1545000000);
    expect(summary.isDemo).toBe(false);
    expect(summary.provenance).toEqual({
      exchange: 'kucoin',
      market: 'spot',
      symbol: 'BTC-USDT',
      timestamp: 1726444800000,
      isFallback: true,
    });
  });

  it('validates and normalizes KuCoin allTickers response', () => {
    const parsed = KuCoinAllTickersResponseSchema.parse(KUCOIN_ALL_TICKERS_FIXTURE);
    const asset = getAssetBySymbol('BTC')!;
    const summary = normalizeKuCoinTickerItem(parsed.data.ticker[0], asset, parsed.data.time, [], true);

    expect(summary.symbol).toBe('BTC');
    expect(summary.price).toBe(65300);
    expect(summary.provenance?.exchange).toBe('kucoin');
    expect(summary.provenance?.isFallback).toBe(true);
  });

  it('validates and normalizes KuCoin candles reversing to chronological order', () => {
    const parsed = KuCoinCandlesResponseSchema.parse(KUCOIN_CANDLES_RESPONSE_FIXTURE);
    const candles = normalizeKuCoinCandles(parsed.data, 'BTC', true);

    expect(candles.length).toBe(2);
    // Chronological order: older candle (1726358400) first, newer candle (1726362000) second
    expect(candles[0].time).toBe(1726358400);
    expect(candles[1].time).toBe(1726362000);

    // KuCoin order check: index 1=open, 2=close, 3=high, 4=low
    expect(candles[0].open).toBe(63800);
    expect(candles[0].close).toBe(64200);
    expect(candles[0].high).toBe(64500);
    expect(candles[0].low).toBe(63700);
    expect(candles[0].provenance?.exchange).toBe('kucoin');
    expect(candles[0].provenance?.isFallback).toBe(true);
  });

  it('adapter fetches KuCoin stats using mock fetchFn', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify(KUCOIN_STATS_RESPONSE_FIXTURE), { status: 200 });

    const adapter = new KuCoinSpotAdapter({ fetchFn: mockFetch as any });
    const stats = await adapter.fetch24hrStats('BTC-USDT');
    expect(stats.last).toBe('65300.0');
  });

  it('adapter throws on KuCoin network error', async () => {
    const mockFetch = async () => {
      throw new Error('DNS resolution failed');
    };

    const adapter = new KuCoinSpotAdapter({ fetchFn: mockFetch as any });
    await expect(adapter.fetch24hrStats('BTC-USDT')).rejects.toThrow(AdapterNetworkError);
  });

  it('requests an explicit candle window (startAt/endAt in seconds) so fallback depth is deterministic', async () => {
    const urls: string[] = [];
    const mockFetch = async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(KUCOIN_CANDLES_RESPONSE_FIXTURE), { status: 200 });
    };

    const adapter = new KuCoinSpotAdapter({ fetchFn: mockFetch as any });
    const candles = await adapter.fetchCandles('btc-usdt', '1hour', {
      startAtMs: 1_726_000_000_000,
      endAtMs: 1_726_003_600_000,
    });
    expect(candles.length).toBe(2);
    expect(urls[0]).toContain('symbol=BTC-USDT');
    expect(urls[0]).toContain('type=1hour');
    expect(urls[0]).toContain('startAt=1726000000'); // ms → seconds
    expect(urls[0]).toContain('endAt=1726003600');

    // Без окна параметры не добавляются (обратная совместимость).
    await adapter.fetchCandles('BTC-USDT', '1hour');
    expect(urls[1]).not.toContain('startAt');
    expect(urls[1]).not.toContain('endAt');

    // Нечисловое окно игнорируется, а не превращается в NaN в запросе.
    await adapter.fetchCandles('BTC-USDT', '1hour', { startAtMs: NaN, endAtMs: Number.POSITIVE_INFINITY });
    expect(urls[2]).not.toContain('startAt');
    expect(urls[2]).not.toContain('endAt');
  });
});
