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
import { AnomalyEngine } from '../realtime/AnomalyEngine';
import { BinanceFuturesAdapter } from './adapters/BinanceFuturesAdapter';
import { AdapterNetworkError } from './adapters/errors';
import { AlternativeMeAdapter, type FearGreedReading } from './adapters/AlternativeMeAdapter';
import { AGGREGATE_HISTORY_KEY, appendPoint, marketCapChange24hFromAssets, parseHistory, volumeChange24h } from '../analytics/aggregateHistory';
import type { BinanceFuturesOpenInterestHistItem } from './adapters/derivativesSchemas';
import { LiquidationPipeline } from '../liquidations/LiquidationPipeline';
import { DerivativesEngine } from '../derivatives/DerivativesEngine';
import { IndicatorEngine } from '../indicators/IndicatorEngine';
import { CoinGeckoAdapter } from './adapters/CoinGeckoAdapter';
import { CandleHistoryService } from './CandleHistoryService';
import { extractBinanceSpread } from './adapters/normalization';

export interface LiveMarketDataProviderConfig {
  binanceAdapter?: BinanceSpotAdapter;
  kucoinAdapter?: KuCoinSpotAdapter;
  futuresAdapter?: BinanceFuturesAdapter;
  fearGreedAdapter?: AlternativeMeAdapter;
  coingeckoAdapter?: CoinGeckoAdapter;
  cacheTtlMs?: number;
  anomalyEngine?: AnomalyEngine;
  candleHistoryService?: CandleHistoryService;
}

export class LiveMarketDataProvider implements MarketDataProvider {
  public readonly isDemo = false;

  private readonly binance: BinanceSpotAdapter;
  private readonly kucoin: KuCoinSpotAdapter;
  private readonly futuresAdapter: BinanceFuturesAdapter;
  private readonly fearGreedAdapter: AlternativeMeAdapter;
  private readonly coingeckoAdapter: CoinGeckoAdapter;
  private readonly candleHistory: CandleHistoryService;
  private fearGreedCache: { data: FearGreedReading; timestamp: number } | null = null;
  private readonly fearGreedTtlMs = 10 * 60 * 1000;
  private readonly cacheTtlMs: number;
  private readonly anomalyEngine?: AnomalyEngine;

  // In-memory cache for rate-limiting protection
  private assetCache: { data: AssetSummary[]; timestamp: number } | null = null;
  private candleCache = new Map<string, { data: OHLCV[]; timestamp: number }>();
  private futuresCache: { data: FuturesAsset[]; timestamp: number } | null = null;
  /** Исторический OI обновляется на бирже раз в 5 мин — кэшируем отдельно, чтобы не грузить 25 запросов каждые 10 с. */
  private oiHistCache: { data: Map<string, BinanceFuturesOpenInterestHistItem[]>; timestamp: number } | null = null;
  private readonly oiHistTtlMs = 5 * 60 * 1000;

  constructor(config: LiveMarketDataProviderConfig = {}) {
    this.binance = config.binanceAdapter ?? new BinanceSpotAdapter();
    this.kucoin = config.kucoinAdapter ?? new KuCoinSpotAdapter();
    this.futuresAdapter = config.futuresAdapter ?? new BinanceFuturesAdapter();
    this.fearGreedAdapter = config.fearGreedAdapter ?? new AlternativeMeAdapter();
    this.coingeckoAdapter = config.coingeckoAdapter ?? new CoinGeckoAdapter();
    this.candleHistory = config.candleHistoryService ?? CandleHistoryService.getInstance();
    this.cacheTtlMs = config.cacheTtlMs ?? 10000; // 10s default TTL
    this.anomalyEngine = config.anomalyEngine;
  }

  /**
   * PRIMARY: bulk ticker fetch (1 Binance request, weight 40) + cache.
   * Returns assets with price/change24h/volume/marketCap immediately.
   * change1h/change7d/sparkline are null until secondary enrichment completes.
   */
  public async getAssets(category?: AssetCategory): Promise<AssetSummary[]> {
    const now = Date.now();
    if (this.assetCache && now - this.assetCache.timestamp < this.cacheTtlMs) {
      // Trigger background enrichment if not yet done
      this.ensureCandleEnrichment();
      return this.filterByCategory(this.assetCache.data, category);
    }

    const canonicalList = getCanonicalAssets();
    const results: AssetSummary[] = [];

    // BULK: 1 request instead of 25 (Binance /api/v3/ticker/24hr, weight 40)
    let bulkTickers: Map<string, any> | null = null;
    try {
      const allTickers = await this.binance.fetchAll24hrTickers();
      bulkTickers = new Map(allTickers.map((t) => [t.symbol.toUpperCase(), t]));
    } catch {
      // Bulk failed — will try per-symbol below as degraded fallback
    }

    for (const asset of canonicalList) {
      // 1. Try bulk ticker
      if (bulkTickers && asset.binanceSymbol) {
        const ticker = bulkTickers.get(asset.binanceSymbol.toUpperCase());
        if (ticker) {
          results.push(normalizeBinanceTicker(ticker, asset));
          continue;
        }
      }

      // 2. Try individual Binance (degraded: only if bulk failed)
      if (!bulkTickers && asset.binanceSymbol) {
        try {
          const ticker = await this.binance.fetch24hrTicker(asset.binanceSymbol);
          results.push(normalizeBinanceTicker(ticker, asset));
          continue;
        } catch {
          // Fall through to KuCoin
        }
      }

      // 3. Try KuCoin fallback
      if (asset.kucoinSymbol) {
        try {
          const stats = await this.kucoin.fetch24hrStats(asset.kucoinSymbol);
          results.push(normalizeKuCoinStats(stats, asset, [], true));
          continue;
        } catch {
          // Both failed
        }
      }
    }

    if (results.length === 0) {
      throw new Error('Live market data unavailable from both Binance and KuCoin gateways');
    }

    // P11: Log missing assets for diagnostics
    if (results.length < canonicalList.length) {
      const found = new Set(results.map((r) => r.symbol));
      const missing = canonicalList.filter((a) => !found.has(a.symbol));
      console.warn(`[P11] ${missing.length} asset(s) missing from live data:`, missing.map((a) => `${a.symbol} (${a.binanceSymbol} / ${a.kucoinSymbol})`));
    }

    // Anomaly engine feed
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
          provenance: item.provenance ?? { exchange: 'binance', market: 'spot', symbol: item.symbol, timestamp: Date.now() },
        });
      }
    }

    this.assetCache = { data: results, timestamp: now };

    // SECONDARY: lazy candle enrichment (non-blocking for first paint)
    this.ensureCandleEnrichment();

    return this.filterByCategory(results, category);
  }

  /**
   * Secondary enrichment: CandleHistoryService fetches 1h+1D klines for sparkline/change1h/change7d.
   * Runs in background — doesn't block first paint. Uses shared cache (60s TTL).
   */
  private enrichmentInFlight = false;
  private enrichmentDone = false;

  private ensureCandleEnrichment(): void {
    if (this.enrichmentInFlight || this.enrichmentDone) return;
    if (!this.assetCache) return;
    this.enrichmentInFlight = true;

    this.candleHistory.getAll().then((candleDerived) => {
      if (!this.assetCache) return;
      for (const asset of this.assetCache.data) {
        const derived = candleDerived.get(asset.symbol);
        if (derived) {
          asset.change1h = derived.change1h;
          asset.change7d = derived.change7d;
          if (derived.sparkline.length > 0) {
            asset.sparkline = derived.sparkline;
          }
        }
      }
      this.enrichmentDone = true;
      this.enrichmentInFlight = false;
    }).catch(() => {
      // Non-fatal: change1h/change7d stay null
      this.enrichmentInFlight = false;
    });
  }

  public async getAssetDetail(symbol: string): Promise<AssetDetail | null> {
    const asset = getAssetBySymbol(symbol);
    if (!asset) return null;

    let summary: AssetSummary | null = null;

    // 1. Try Binance
    let rawBinanceTicker: Record<string, unknown> | null = null;
    if (asset.binanceSymbol) {
      try {
        const ticker = await this.binance.fetch24hrTicker(asset.binanceSymbol);
        rawBinanceTicker = ticker as Record<string, unknown>;
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

    // DERIVED: вычисляем индикаторы из фактических свечей через IndicatorEngine
    const indicators = candles.length >= 26
      ? IndicatorEngine.computeCompleteIndicators(candles)
      : {
          rsi14: candles.length > 0 ? IndicatorEngine.calculateRSI(candles.map((c) => c.close), 14).slice(-1)[0] ?? 50 : 50,
          macd: { macd: 0, signal: 0, hist: 0 },
          sma20: summary.price,
          sma50: summary.price,
          sma200: summary.price,
          bollinger: { upper: summary.price, middle: summary.price, lower: summary.price, bandwidthPct: 0 },
        };

    // FACTUAL: ATH/ATL + supply из CoinGecko (supplementary metadata, не заменяет биржевую цену)
    let ath: number | undefined;
    let athDate: string | undefined;
    let atl: number | undefined;
    let atlDate: string | undefined;
    let totalSupply: number | null | undefined;
    let maxSupply: number | null | undefined;
    if (asset.coingeckoId) {
      try {
        const meta = await this.coingeckoAdapter.fetchCoinMeta(asset.coingeckoId);
        if (meta.athUsd != null) ath = meta.athUsd;
        if (meta.athDateUsd != null) athDate = meta.athDateUsd;
        if (meta.atlUsd != null) atl = meta.atlUsd;
        if (meta.atlDateUsd != null) atlDate = meta.atlDateUsd;
        totalSupply = meta.totalSupply;
        maxSupply = meta.maxSupply;
      } catch {
        // CoinGecko unavailable — ATH/ATL/supply остаётся undefined → UI покажет «—»
      }
    }

    // FACTUAL: реальный спред из Binance bid/ask через extractBinanceSpread()
    let spreadPct = 0.01;
    if (rawBinanceTicker) {
      const spread = extractBinanceSpread(rawBinanceTicker as any);
      if (spread) {
        spreadPct = Number((spread.spreadBps / 100).toFixed(4));
      }
    }

    return {
      ...summary,
      description: asset.description,
      ath,
      athDate,
      atl,
      atlDate,
      high24h,
      low24h,
      totalSupply: totalSupply ?? undefined,
      maxSupply: maxSupply ?? undefined,
      indicators: {
        rsi14: Number.isFinite(indicators.rsi14) ? Number(indicators.rsi14.toFixed(2)) : 50,
        macd: indicators.macd,
        sma20: Number(indicators.sma20.toFixed(2)),
        sma50: Number(indicators.sma50.toFixed(2)),
        sma200: Number(indicators.sma200.toFixed(2)),
        bollinger: {
          upper: Number(indicators.bollinger.upper.toFixed(2)),
          middle: Number(indicators.bollinger.middle.toFixed(2)),
          lower: Number(indicators.bollinger.lower.toFixed(2)),
        },
      },
      pairs: [
        {
          exchange: 'Binance',
          pair: `${asset.symbol}/USDT`,
          price: summary.price,
          volume24h: summary.volume24h * 0.65,
          spreadPct,
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
        const raw = await this.binance.fetchKlines(asset.binanceSymbol, binanceInterval, 500);
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

  /** Индекс страха/жадности; при отказе источника — null, без подстановки. */
  private async getFearGreed(now: number): Promise<FearGreedReading | null> {
    if (this.fearGreedCache && now - this.fearGreedCache.timestamp < this.fearGreedTtlMs) return this.fearGreedCache.data;
    try {
      const data = await this.fearGreedAdapter.fetchLatest();
      this.fearGreedCache = { data, timestamp: now };
      return data;
    } catch {
      return null;
    }
  }

  /** CoinGecko global: при отказе — null, без подстановки. */
  private async getGlobalMarketCap(): Promise<{
    totalMarketCapUsd: number;
    change24hPct: number | null;
    updatedAt: number;
    btcDominancePct: number | null;
    ethDominancePct: number | null;
  } | null> {
    try {
      const g = await this.coingeckoAdapter.fetchGlobal();
      return {
        totalMarketCapUsd: g.totalMarketCapUsd,
        change24hPct: g.marketCapChange24hPct,
        updatedAt: g.updatedAt,
        btcDominancePct: g.btcDominancePct,
        ethDominancePct: g.ethDominancePct,
      };
    } catch {
      return null;
    }
  }

  public async getMarketOverview(): Promise<MarketOverviewData> {
    const [assets, fng, global] = await Promise.all([
      this.getAssets(),
      this.getFearGreed(Date.now()),
      this.getGlobalMarketCap(),
    ]);
    const totalVolume = assets.reduce((sum, a) => sum + a.volume24h, 0);
    const totalMarketCap = assets.reduce((sum, a) => sum + a.marketCap, 0);
    const btc = assets.find((a) => a.symbol === 'BTC');
    const eth = assets.find((a) => a.symbol === 'ETH');

    // Нет актива в ответе источника → доминация 0, а не «типичное» число.
    const btcDominance = btc && totalMarketCap > 0 ? Number(((btc.marketCap / totalMarketCap) * 100).toFixed(1)) : 0;
    const ethDominance = eth && totalMarketCap > 0 ? Number(((eth.marketCap / totalMarketCap) * 100).toFixed(1)) : 0;

    const now = Date.now();
    const marketCapChange24h = marketCapChange24hFromAssets(assets);
    let volumeDelta: number | null = null;
    try {
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const history = parseHistory(storage?.getItem(AGGREGATE_HISTORY_KEY));
      volumeDelta = volumeChange24h(history, totalVolume, now);
      storage?.setItem(AGGREGATE_HISTORY_KEY, JSON.stringify(appendPoint(history, { t: now, volume24h: totalVolume })));
    } catch {
      volumeDelta = null;
    }

    const advancing = assets.filter((a) => a.change24h > 0).length;
    const declining = assets.filter((a) => a.change24h < 0).length;
    const unchanged = assets.filter((a) => a.change24h === 0).length;

    return {
      totalMarketCap,
      marketCapChange24h,
      totalVolume24h: totalVolume,
      volumeChange24h: volumeDelta,
      btcDominance,
      ethDominance,
      globalMarketCapUsd: global?.totalMarketCapUsd ?? null,
      globalMarketCapChange24hPct: global?.change24hPct ?? null,
      globalMarketCapUpdatedAt: global?.updatedAt ?? null,
      globalBtcDominancePct: global?.btcDominancePct ?? null,
      globalEthDominancePct: global?.ethDominancePct ?? null,
      fearAndGreed: fng ? { value: fng.value, sentiment: fng.sentiment, source: fng.source, timestamp: fng.timestamp } : null,
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

  /**
   * Фактические ряды OI по символам. Любой отказ по символу → символ без ряда (его Δ OI останется ESTIMATED),
   * общий отказ не роняет getFuturesList.
   */
  private async fetchOpenInterestHistory(symbols: string[], now: number): Promise<Map<string, BinanceFuturesOpenInterestHistItem[]>> {
    if (this.oiHistCache && now - this.oiHistCache.timestamp < this.oiHistTtlMs) return this.oiHistCache.data;
    const map = new Map<string, BinanceFuturesOpenInterestHistItem[]>();
    const settled = await Promise.allSettled(symbols.map((sym) => this.futuresAdapter.fetchOpenInterestHist(sym, 25)));
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length >= 2) map.set(symbols[i], r.value);
    });
    if (map.size > 0) this.oiHistCache = { data: map, timestamp: now };
    return map;
  }

  /**
   * Ликвидации 24ч по инструменту: если поток фактических событий подключён — только его суммы
   * (ACTUAL, либо UNAVAILABLE с нулями, когда событий по инструменту нет). Эвристика движка остаётся
   * лишь при недоступном потоке и помечается ESTIMATED.
   */
  private applyFactualLiquidations(list: FuturesAsset[], now: number): FuturesAsset[] {
    const snapshot = LiquidationPipeline.getInstance().getLiquidationSnapshot(now);
    if (snapshot.dataStatus !== 'LIVE_STREAM' && snapshot.dataStatus !== 'AWAITING_STREAM') {
      return list.map((f) => ({ ...f, liquidationsSource: 'ESTIMATED' as const }));
    }
    const byAsset = new Map(snapshot.assetBreakdown.map((a) => [a.symbol.toUpperCase(), a]));
    return list.map((f) => {
      const bucket = byAsset.get(f.symbol.split('/')[0].toUpperCase());
      if (bucket && bucket.totalUsd > 0) {
        return { ...f, longLiquidations24h: bucket.longUsd, shortLiquidations24h: bucket.shortUsd, liquidationsSource: 'ACTUAL' as const };
      }
      return { ...f, longLiquidations24h: 0, shortLiquidations24h: 0, liquidationsSource: 'UNAVAILABLE' as const };
    });
  }

  public async getFuturesList(): Promise<FuturesAsset[]> {
    const now = Date.now();
    if (this.futuresCache && now - this.futuresCache.timestamp < this.cacheTtlMs) {
      return this.futuresCache.data;
    }

    try {
      const [premiums, tickers] = await Promise.all([
        this.futuresAdapter.fetchPremiumIndexes(),
        this.futuresAdapter.fetch24hrTickers(),
      ]);

      const tickerMap = new Map(tickers.map((t) => [t.symbol.toUpperCase(), t]));
      const canonicalList = getCanonicalAssets().filter((a) => a.binanceSymbol);
      const oiHistMap = await this.fetchOpenInterestHistory(canonicalList.map((a) => a.binanceSymbol as string), now);
      const results: FuturesAsset[] = [];

      for (const asset of canonicalList) {
        const premium = premiums.find((p) => p.symbol.toUpperCase() === asset.binanceSymbol);
        if (premium) {
          const ticker = tickerMap.get(asset.binanceSymbol as string);
          const futuresAsset = DerivativesEngine.normalizeFuturesAsset(
            asset,
            premium,
            ticker,
            undefined,
            oiHistMap.get(asset.binanceSymbol as string)
          );
          results.push(futuresAsset);
        }
      }

      if (results.length > 0) {
        const withLiq = this.applyFactualLiquidations(results, now);
        this.futuresCache = { data: withLiq, timestamp: now };
        return withLiq;
      }
    } catch (error) {
      // LIVE-FIRST: источник не ответил — честная ошибка, без подстановки демо-датасета.
      throw new AdapterNetworkError('binance', error instanceof Error ? error : new Error(String(error)));
    }
    throw new AdapterNetworkError('binance', new Error('Futures source returned no instruments'));
  }

  public async getLiquidations(): Promise<LiquidationData> {
    return LiquidationPipeline.getInstance().getLiquidationSnapshot();
  }

  public async getRadarEvents(symbol?: string): Promise<RadarEvent[]> {
    if (this.anomalyEngine) {
      const liveEvents = this.anomalyEngine.getEvents(symbol);
      if (liveEvents.length > 0) {
        return liveEvents;
      }
    }
    // Нет фактических аномалий — пустой список. Демо-события за фактические не выдаются.
    return [];
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
      case '5m': return '5m';
      case '15m': return '15m';
      case '30m': return '30m';
      case '1h': return '1h';
      case '4h': return '4h';
      case '1D': return '1d';
      case '1W': return '1w';
      default: return '1h';
    }
  }

  private mapTimeframeToKuCoin(tf: Timeframe): string {
    switch (tf) {
      case '5m': return '5min';
      case '15m': return '15min';
      case '30m': return '30min';
      case '1h': return '1hour';
      case '4h': return '4hour';
      case '1D': return '1day';
      case '1W': return '1week';
      default: return '1hour';
    }
  }
}
