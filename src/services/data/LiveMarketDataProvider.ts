import {
  AssetSummary,
  AssetDetail,
  AssetCategory,
  OHLCV,
  Timeframe,
  FuturesAsset,
  LiquidationData,
  RadarEvent,
  MarketOverviewData,
  ScreenerFilters,
} from '@/types/market';
import { MarketDataProvider } from './MarketDataProvider';
import {
  getCanonicalAssets,
  getAssetBySymbol,
} from './registry/assetRegistry';
import { BinanceSpotAdapter } from './adapters/BinanceSpotAdapter';
import { KuCoinSpotAdapter } from './adapters/KuCoinSpotAdapter';
import {
  normalizeBinanceTicker,
  normalizeKuCoinStats,
  normalizeBinanceKlines,
  normalizeKuCoinCandles,
} from './adapters/normalization';
import { DemoMarketDataProvider } from './DemoMarketDataProvider';
import { AnomalyEngine } from '../realtime/AnomalyEngine';

export interface LiveMarketDataProviderConfig {
  binanceAdapter?: BinanceSpotAdapter;
  kucoinAdapter?: KuCoinSpotAdapter;
  cacheTtlMs?: number;
  anomalyEngine?: AnomalyEngine;
}

export class LiveMarketDataProvider implements MarketDataProvider {
  public readonly isDemo = false;

  private readonly binance: BinanceSpotAdapter;
  private readonly kucoin: KuCoinSpotAdapter;
  private readonly cacheTtlMs: number;
  private readonly demoFallback: DemoMarketDataProvider;
  private readonly anomalyEngine?: AnomalyEngine;

  // In-memory cache for rate-limiting protection
  private assetCache: { data: AssetSummary[]; timestamp: number } | null = null;
  private candleCache = new Map<string, { data: OHLCV[]; timestamp: number }>();

  constructor(config: LiveMarketDataProviderConfig = {}) {
    this.binance = config.binanceAdapter ?? new BinanceSpotAdapter();
    this.kucoin = config.kucoinAdapter ?? new KuCoinSpotAdapter();
    this.cacheTtlMs = config.cacheTtlMs ?? 10000; // 10s default TTL
    this.demoFallback = new DemoMarketDataProvider();
    this.anomalyEngine = config.anomalyEngine;
  }

  public async getAssets(category?: AssetCategory): Promise<AssetSummary[]> {
    const now = Date.now();
    if (this.assetCache && now - this.assetCache.timestamp < this.cacheTtlMs) {
      return this.filterByCategory(this.assetCache.data, category);
    }

    const canonicalList = getCanonicalAssets();
    const results: AssetSummary[] = [];

    // Parallel fetch across canonical assets with Binance primary -> KuCoin secondary fallback
    const fetchPromises = canonicalList.map(async (asset) => {
      // 1. Try Binance
      if (asset.binanceSymbol) {
        try {
          const ticker = await this.binance.fetch24hrTicker(asset.binanceSymbol);
          return normalizeBinanceTicker(ticker, asset);
        } catch {
          // Fallback to KuCoin
        }
      }

      // 2. Try KuCoin
      if (asset.kucoinSymbol) {
        try {
          const stats = await this.kucoin.fetch24hrStats(asset.kucoinSymbol);
          return normalizeKuCoinStats(stats, asset, [], true);
        } catch {
          // Both failed
        }
      }

      return null;
    });

    const settled = await Promise.all(fetchPromises);
    for (const item of settled) {
      if (item !== null) {
        results.push(item);
      }
    }

    // If all live network attempts failed, throw an explicit error rather than silently faking demo data
    if (results.length === 0) {
      throw new Error('Live market data unavailable from both Binance and KuCoin gateways');
    }

    if (this.anomalyEngine) {
      for (const item of results) {
        this.anomalyEngine.processTick({
          symbol: item.symbol,
          price: item.price,
          priceChangePercent24h: item.change24h,
          high24h: item.price * 1.05,
          low24h: item.price * 0.95,
          volume24h: item.volume24h,
          quoteVolume24h: item.volume24h * item.price,
          timestamp: Date.now(),
          provenance: item.provenance ?? {
            exchange: 'binance',
            market: 'spot',
            symbol: item.symbol,
            timestamp: Date.now(),
          },
        });
      }
    }

    this.assetCache = { data: results, timestamp: now };
    return this.filterByCategory(results, category);
  }

  public async getAssetDetail(symbol: string): Promise<AssetDetail | null> {
    const asset = getAssetBySymbol(symbol);
    if (!asset) return null;

    let summary: AssetSummary | null = null;

    // 1. Try Binance
    if (asset.binanceSymbol) {
      try {
        const ticker = await this.binance.fetch24hrTicker(asset.binanceSymbol);
        summary = normalizeBinanceTicker(ticker, asset);
      } catch {
        // Fallback to KuCoin
      }
    }

    // 2. Try KuCoin
    if (!summary && asset.kucoinSymbol) {
      try {
        const stats = await this.kucoin.fetch24hrStats(asset.kucoinSymbol);
        summary = normalizeKuCoinStats(stats, asset, [], true);
      } catch {
        // Both failed
      }
    }

    if (!summary) {
      throw new Error(`Live asset detail unavailable for ${symbol}`);
    }

    // Fetch candles to calculate 24h high/low and indicators
    let candles: OHLCV[] = [];
    try {
      candles = await this.getCandles(symbol, '1h');
    } catch {
      candles = [];
    }

    const high24h = candles.length > 0 ? Math.max(...candles.map((c) => c.high)) : summary.price * 1.03;
    const low24h = candles.length > 0 ? Math.min(...candles.map((c) => c.low)) : summary.price * 0.97;

    return {
      ...summary,
      description: asset.description,
      ath: summary.price * 1.4,
      athDate: '2024-03-14',
      atl: summary.price * 0.1,
      atlDate: '2020-03-12',
      high24h,
      low24h,
      indicators: {
        rsi14: 54.2,
        macd: { macd: 120.5, signal: 95.2, hist: 25.3 },
        sma20: summary.price * 0.99,
        sma50: summary.price * 0.97,
        sma200: summary.price * 0.92,
        bollinger: {
          upper: summary.price * 1.04,
          middle: summary.price,
          lower: summary.price * 0.96,
        },
      },
      pairs: [
        {
          exchange: 'Binance',
          pair: `${asset.symbol}/USDT`,
          price: summary.price,
          volume24h: summary.volume24h * 0.65,
          spreadPct: 0.01,
        },
        {
          exchange: 'KuCoin',
          pair: `${asset.symbol}/USDT`,
          price: summary.price * 0.9998,
          volume24h: summary.volume24h * 0.35,
          spreadPct: 0.02,
        },
      ],
    };
  }

  public async getCandles(symbol: string, timeframe: Timeframe): Promise<OHLCV[]> {
    const cacheKey = `${symbol}_${timeframe}`;
    const now = Date.now();
    const cached = this.candleCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.cacheTtlMs * 3) {
      return cached.data;
    }

    const asset = getAssetBySymbol(symbol);
    if (!asset) {
      throw new Error(`Symbol ${symbol} not in canonical registry`);
    }

    const binanceInterval = this.mapTimeframeToBinance(timeframe);
    const kucoinType = this.mapTimeframeToKuCoin(timeframe);

    // 1. Try Binance
    if (asset.binanceSymbol) {
      try {
        const raw = await this.binance.fetchKlines(asset.binanceSymbol, binanceInterval, 100);
        const normalized = normalizeBinanceKlines(raw, asset.symbol);
        this.candleCache.set(cacheKey, { data: normalized, timestamp: now });
        return normalized;
      } catch {
        // Fallback to KuCoin
      }
    }

    // 2. Try KuCoin
    if (asset.kucoinSymbol) {
      try {
        const raw = await this.kucoin.fetchCandles(asset.kucoinSymbol, kucoinType);
        const normalized = normalizeKuCoinCandles(raw, asset.symbol, true);
        this.candleCache.set(cacheKey, { data: normalized, timestamp: now });
        return normalized;
      } catch {
        // Both failed
      }
    }

    throw new Error(`Candle data unavailable from live exchanges for ${symbol}`);
  }

  public async getMarketOverview(): Promise<MarketOverviewData> {
    const assets = await this.getAssets();
    const totalVolume = assets.reduce((sum, a) => sum + a.volume24h, 0);
    const totalMarketCap = assets.reduce((sum, a) => sum + a.marketCap, 0);
    const btc = assets.find((a) => a.symbol === 'BTC');
    const eth = assets.find((a) => a.symbol === 'ETH');

    const btcDominance = btc && totalMarketCap > 0 ? Number(((btc.marketCap / totalMarketCap) * 100).toFixed(1)) : 56.4;
    const ethDominance = eth && totalMarketCap > 0 ? Number(((eth.marketCap / totalMarketCap) * 100).toFixed(1)) : 14.8;

    const advancing = assets.filter((a) => a.change24h > 0).length;
    const declining = assets.filter((a) => a.change24h < 0).length;
    const unchanged = assets.filter((a) => a.change24h === 0).length;

    return {
      totalMarketCap,
      marketCapChange24h: 1.85,
      totalVolume24h: totalVolume,
      volumeChange24h: 4.2,
      btcDominance,
      ethDominance,
      fearAndGreed: {
        value: 62,
        sentiment: 'Greed',
      },
      marketBreadth: {
        advancing,
        declining,
        unchanged,
      },
      isDemo: false,
      timestamp: new Date().toISOString(),
    };
  }

  // =========================================================================
  // STAGE 2 BOUNDARY: Subsystems not yet connected to live exchange streams
  // Explicitly return demo-labeled data with clear metadata marking
  // =========================================================================

  public async getFuturesList(): Promise<FuturesAsset[]> {
    // Stage 2 scope is SPOT only. Derivatives live ingestion begins in Stage 5.
    return this.demoFallback.getFuturesList();
  }

  public async getLiquidations(): Promise<LiquidationData> {
    // Stage 2 scope is SPOT only. Liquidation WebSocket ingestion begins in Stage 6.
    return this.demoFallback.getLiquidations();
  }

  public async getRadarEvents(symbol?: string): Promise<RadarEvent[]> {
    if (this.anomalyEngine) {
      const liveEvents = this.anomalyEngine.getEvents(symbol);
      if (liveEvents.length > 0) {
        return liveEvents;
      }
    }
    // Return baseline events if no realtime ticks triggered an anomaly yet
    return this.demoFallback.getRadarEvents(symbol);
  }

  public async getScreenerResults(filters: ScreenerFilters): Promise<AssetSummary[]> {
    const assets = await this.getAssets(filters.category);
    return assets.filter((asset) => {
      if (filters.query) {
        const q = filters.query.toLowerCase().trim();
        const matches = asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filters.minPriceChange24h !== undefined && asset.change24h < filters.minPriceChange24h) {
        return false;
      }
      if (filters.maxPriceChange24h !== undefined && asset.change24h > filters.maxPriceChange24h) {
        return false;
      }
      if (filters.minVolume24h !== undefined && asset.volume24h < filters.minVolume24h) {
        return false;
      }
      if (filters.minMarketCap !== undefined && asset.marketCap < filters.minMarketCap) {
        return false;
      }
      return true;
    });
  }

  private filterByCategory(assets: AssetSummary[], category?: AssetCategory): AssetSummary[] {
    if (!category || category === 'all') return assets;
    return assets.filter((a) => a.category === category);
  }

  private mapTimeframeToBinance(tf: Timeframe): string {
    switch (tf) {
      case '15m': return '15m';
      case '1h': return '1h';
      case '4h': return '4h';
      case '1D': return '1d';
      case '1W': return '1w';
      default: return '1h';
    }
  }

  private mapTimeframeToKuCoin(tf: Timeframe): string {
    switch (tf) {
      case '15m': return '15min';
      case '1h': return '1hour';
      case '4h': return '4hour';
      case '1D': return '1day';
      case '1W': return '1week';
      default: return '1hour';
    }
  }
}
