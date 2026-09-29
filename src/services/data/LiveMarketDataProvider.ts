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
  TechnicalIndicators,
  MarketType,
} from '@/types/market';
import { MarketDataProvider, type CandleRequestOptions, type FuturesOrderBookOptions } from './MarketDataProvider';
import type { OrderBookSnapshot } from '@/types/realtime';
import {
  getCanonicalAssets,
  getAssetBySymbol,
} from './registry/assetRegistry';
import { BinanceSpotAdapter } from './adapters/BinanceSpotAdapter';
import { KuCoinSpotAdapter } from './adapters/KuCoinSpotAdapter';
import {
  normalizeBinanceTicker,
  normalizeUnregisteredBinanceTicker,
  normalizeKuCoinStats,
  normalizeBinanceKlines,
  normalizeKuCoinCandles,
  normalizeFuturesDepth,
} from './adapters/normalization';
import { fetchServerRadarEvents } from '../radar/serverRadarClient';
import { BinanceFuturesAdapter } from './adapters/BinanceFuturesAdapter';
import { AdapterNetworkError, UnsupportedMarketSymbolError } from './adapters/errors';
import { AlternativeMeAdapter, type FearGreedReading } from './adapters/AlternativeMeAdapter';
import { AGGREGATE_HISTORY_KEY, appendPoint, marketCapChange24hFromAssets, parseHistory, volumeChange24h } from '../analytics/aggregateHistory';
import { LiquidationPipeline } from '../liquidations/LiquidationPipeline';
import { DerivativesEngine } from '../derivatives/DerivativesEngine';
import { IndicatorEngine, type CompleteIndicatorsResult } from '../indicators/IndicatorEngine';
import { CoinGeckoAdapter } from './adapters/CoinGeckoAdapter';
import { CandleHistoryService } from './CandleHistoryService';
import { extractBinanceSpread } from './adapters/normalization';
import {
  getActiveSpotBaseSet,
  getFuturesUniverse,
  getFuturesContractsByBase,
  type FuturesUniverse,
} from './registry/exchangeUniverse';
import { resolveFuturesContractSymbol } from './registry/futuresSymbols';
import {
  fetchFuturesSnapshot,
  type FuturesSnapshot,
  type FuturesSnapshotCoverage,
} from './futuresSnapshotClient';
import type { CanonicalAsset } from './registry/assetRegistry';

/** Длительность одной свечи — нужна, чтобы запросить у резервной биржи явное окно. */
const TIMEFRAME_MS: Partial<Record<Timeframe, number>> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '1D': 24 * 3_600_000,
  '1W': 7 * 24 * 3_600_000,
};

export interface LiveMarketDataProviderConfig {
  binanceAdapter?: BinanceSpotAdapter;
  kucoinAdapter?: KuCoinSpotAdapter;
  futuresAdapter?: BinanceFuturesAdapter;
  fearGreedAdapter?: AlternativeMeAdapter;
  coingeckoAdapter?: CoinGeckoAdapter;
  cacheTtlMs?: number;
  /** Test seam; production defaults to same-origin persisted server Radar API. */
  radarEventsFetcher?: (symbol?: string) => Promise<RadarEvent[]>;
  candleHistoryService?: CandleHistoryService;
  /**
   * Authoritative active Spot USDT bases (Binance exchangeInfo via server).
   * null = unknown → historical ticker records are NOT trusted; only the
   * canonical catalog is listed (degraded mode).
   */
  activeSpotSymbols?: () => Promise<Set<string> | null>;
  /** Active USD-M USDT perpetuals (exchangeInfo via server); null = unknown. */
  futuresUniverse?: () => Promise<FuturesUniverse | null>;
  /** Aggregated server snapshot `/api/market/derivatives/futures` (test seam). */
  futuresSnapshotFetcher?: () => Promise<FuturesSnapshot>;
  /** Futures base ticker → exchange contract symbol (test seam). */
  futuresContracts?: () => Promise<Map<string, string> | null>;
}

/**
 * @deprecated RC-1 fix: the browser no longer issues per-symbol open-interest
 * requests at all — the server sweeps the whole universe once per TTL
 * (`server/services/futuresMarketData.js`). The constant is kept as the
 * regression bound asserted by tests: the client must stay at ZERO per-symbol
 * OI calls, which is trivially ≤ this limit.
 */
export const FUTURES_OI_DETAIL_LIMIT = 30;

/** ISO-строка снимка → мс (для provenance OI). */
function snapshotTimeMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * TTL кэша стакана USD-M. Меньше периода опроса (5с), поэтому обычный поллинг
 * всегда получает свежую книгу, а дубли запросов (второй виджет, StrictMode,
 * быстрый возврат на страницу) обслуживаются из кэша.
 */
const FUTURES_DEPTH_TTL_MS = 4_000;

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
  private readonly radarEventsFetcher: (symbol?: string) => Promise<RadarEvent[]>;
  private readonly activeSpotSymbols: () => Promise<Set<string> | null>;
  private readonly futuresUniverse: () => Promise<FuturesUniverse | null>;
  private readonly futuresSnapshotFetcher: () => Promise<FuturesSnapshot>;
  private readonly futuresContracts: () => Promise<Map<string, string> | null>;

  // In-memory cache for rate-limiting protection
  private assetCache: { data: AssetSummary[]; timestamp: number } | null = null;
  /** Кэш стакана USD-M: ключ «контракт_глубина», TTL FUTURES_DEPTH_TTL_MS. */
  private readonly futuresDepthCache = new Map<string, { data: OrderBookSnapshot; timestamp: number }>();
  private candleCache = new Map<string, { data: OHLCV[]; timestamp: number }>();
  private futuresCache: { data: FuturesAsset[]; timestamp: number } | null = null;
  /** Покрытие метрик из последнего серверного снимка (для честного счётчика в UI). */
  private futuresCoverage: FuturesSnapshotCoverage | null = null;
  /** P11: подпись последнего набора отсутствующих активов (дедупликация warn). */
  private p11LastSignature: string | null = null;

  constructor(config: LiveMarketDataProviderConfig = {}) {
    this.binance = config.binanceAdapter ?? new BinanceSpotAdapter();
    this.kucoin = config.kucoinAdapter ?? new KuCoinSpotAdapter();
    this.futuresAdapter = config.futuresAdapter ?? new BinanceFuturesAdapter();
    this.fearGreedAdapter = config.fearGreedAdapter ?? new AlternativeMeAdapter();
    this.coingeckoAdapter = config.coingeckoAdapter ?? new CoinGeckoAdapter();
    this.candleHistory = config.candleHistoryService ?? CandleHistoryService.getInstance();
    this.cacheTtlMs = config.cacheTtlMs ?? 10000; // 10s default TTL
    this.radarEventsFetcher = config.radarEventsFetcher ?? ((symbol) => fetchServerRadarEvents({ symbol }));
    this.activeSpotSymbols = config.activeSpotSymbols ?? (() => getActiveSpotBaseSet());
    this.futuresUniverse = config.futuresUniverse ?? (() => getFuturesUniverse());
    this.futuresSnapshotFetcher = config.futuresSnapshotFetcher ?? (() => fetchFuturesSnapshot());
    this.futuresContracts = config.futuresContracts ?? (() => getFuturesContractsByBase());
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
    const [bulkResult, activeResult] = await Promise.allSettled([
      this.binance.fetchAll24hrTickers(),
      this.activeSpotSymbols(),
    ]);
    if (bulkResult.status === 'fulfilled') {
      bulkTickers = new Map(bulkResult.value.map((t) => [t.symbol.toUpperCase(), t]));
    }
    // Bulk failed — per-symbol fallback below. Active set unknown → only canonical rows.
    const activeSpot = activeResult.status === 'fulfilled' ? activeResult.value : null;

    for (const asset of canonicalList) {
      // A canonical asset that is no longer TRADING on Binance Spot is not listed
      // (its stale historical ticker would otherwise look like a live quote).
      if (activeSpot && !activeSpot.has(asset.symbol)) continue;
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

    // The canonical registry is metadata enrichment, not a whitelist. The universe
    // is Binance Spot exchangeInfo (quoteAsset=USDT, status=TRADING, spot allowed).
    // The bulk ticker endpoint also returns thousands of HISTORICAL records (VEN,
    // XRPBULL, BCC, *UP/*DOWN…), so a ticker alone never admits a symbol.
    if (bulkTickers && activeSpot) {
      const knownSymbols = new Set(canonicalList.map((asset) => asset.symbol));
      const additions = [...bulkTickers.values()]
        .map((ticker) => normalizeUnregisteredBinanceTicker(ticker))
        .filter((asset): asset is AssetSummary => asset !== null && !knownSymbols.has(asset.symbol) && activeSpot.has(asset.symbol))
        .sort((a, b) => b.volume24h - a.volume24h || a.symbol.localeCompare(b.symbol));
      additions.forEach((asset, index) => {
        asset.rank = canonicalList.length + index + 1;
        results.push(asset);
      });
    }

    if (results.length === 0) {
      throw new Error('Live market data unavailable from both Binance and KuCoin gateways');
    }

    // P11: Log missing assets for diagnostics (один warn на изменение состава —
    // без повторов на каждом цикле опроса, чтобы не засорять консоль).
    if (results.length < canonicalList.length) {
      const found = new Set(results.map((r) => r.symbol));
      const missing = canonicalList.filter((a) => !found.has(a.symbol));
      const signature = missing.map((a) => a.symbol).join(',');
      if (signature !== this.p11LastSignature) {
        console.warn(`[P11] ${missing.length} asset(s) missing from live data:`, missing.map((a) => `${a.symbol} (${a.binanceSymbol} / ${a.kucoinSymbol})`));
        this.p11LastSignature = signature;
      }
    } else {
      this.p11LastSignature = null;
    }

    // AnomalyEngine: fed exclusively by WebSocket (BinanceWebSocketClient.handleTickerPayload)
    // for real-time accuracy. REST bulk fetch (getAssets) is for building the asset list only.

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
  private enrichmentLastRun = 0;
  private static readonly ENRICHMENT_INTERVAL_MS = 60_000; // Re-enrich every 60s

  private ensureCandleEnrichment(): void {
    const now = Date.now();
    const stale = now - this.enrichmentLastRun > LiveMarketDataProvider.ENRICHMENT_INTERVAL_MS;
    if (this.enrichmentInFlight || (this.enrichmentDone && !stale)) return;
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
      this.enrichmentLastRun = Date.now();
      this.enrichmentInFlight = false;
    }).catch(() => {
      // Non-fatal: change1h/change7d stay null
      this.enrichmentInFlight = false;
    });
  }

  /**
   * Fast first-paint path for /coin/:symbol. Only exchange ticker requests are
   * awaited here; candles/indicators and CoinGecko metadata must not gate the
   * page shell or selector.
   */
  public async getAssetSnapshot(symbol: string): Promise<AssetDetail | null> {
    const asset = getAssetBySymbol(symbol);
    if (!asset) {
      const base = symbol.toUpperCase().trim();
      if (!/^[A-Z0-9]{2,20}$/.test(base)) return null;
      const ticker = await this.binance.fetch24hrTicker(`${base}USDT`);
      const summary = normalizeUnregisteredBinanceTicker(ticker);
      if (!summary || summary.symbol !== base) return null;
      const spread = extractBinanceSpread(ticker);
      return {
        ...summary,
        description: '',
        indicators: null,
        pairs: [{
          exchange: 'Binance',
          pair: `${base}/USDT`,
          price: summary.price,
          volume24h: summary.volume24h,
          spreadPct: spread ? Number((spread.spreadBps / 100).toFixed(4)) : null,
        }],
      };
    }

    const [binanceResult, kucoinResult] = await Promise.allSettled([
      asset.binanceSymbol ? this.binance.fetch24hrTicker(asset.binanceSymbol) : Promise.reject('no symbol'),
      asset.kucoinSymbol ? this.kucoin.fetch24hrStats(asset.kucoinSymbol) : Promise.reject('no symbol'),
    ]);
    const rawBinanceTicker = binanceResult.status === 'fulfilled' ? binanceResult.value : null;
    const rawKucoinStats = kucoinResult.status === 'fulfilled' ? kucoinResult.value : null;

    const summary = rawBinanceTicker
      ? normalizeBinanceTicker(rawBinanceTicker, asset)
      : rawKucoinStats
        ? normalizeKuCoinStats(rawKucoinStats, asset, [], true)
        : null;
    if (!summary) throw new Error(`Live asset ticker unavailable for ${symbol}`);

    const pairs = [];
    if (rawBinanceTicker) {
      const spread = extractBinanceSpread(rawBinanceTicker);
      pairs.push({
        exchange: 'Binance',
        pair: `${asset.symbol}/USDT`,
        price: parseFloat(rawBinanceTicker.lastPrice) || summary.price,
        volume24h: parseFloat(rawBinanceTicker.quoteVolume) || summary.volume24h,
        spreadPct: spread ? Number((spread.spreadBps / 100).toFixed(4)) : null,
      });
    }
    if (rawKucoinStats) {
      pairs.push({
        exchange: 'KuCoin',
        pair: `${asset.symbol}/USDT`,
        price: parseFloat(rawKucoinStats.last) || summary.price,
        volume24h: parseFloat(rawKucoinStats.volValue) || 0,
        spreadPct: this.computeSpreadPctFromBidAsk(rawKucoinStats.buy, rawKucoinStats.sell),
      });
    }

    return {
      ...summary,
      description: asset.description,
      high24h: summary.high24h,
      low24h: summary.low24h,
      indicators: null,
      pairs,
    };
  }

  public async getAssetDetail(symbol: string): Promise<AssetDetail | null> {
    const snapshot = await this.getAssetSnapshot(symbol);
    if (!snapshot) return null;

    // Supplementary details are fetched only for callers that explicitly need them.
    // The coin page uses getAssetSnapshot and loads its chart/indicators independently.
    let candles: OHLCV[] = [];
    try {
      candles = await this.getCandles(symbol, '1h');
    } catch {
      candles = [];
    }

    const high24h = snapshot.high24h ?? (candles.length > 0 ? Math.max(...candles.map((c) => c.high)) : undefined);
    const low24h = snapshot.low24h ?? (candles.length > 0 ? Math.min(...candles.map((c) => c.low)) : undefined);
    const indicators: TechnicalIndicators | null = candles.length >= 200
      ? this.buildTechnicalIndicators(IndicatorEngine.computeCompleteIndicators(candles))
      : null;

    let ath: number | undefined;
    let athDate: string | undefined;
    let atl: number | undefined;
    let atlDate: string | undefined;
    let totalSupply: number | null | undefined;
    let maxSupply: number | null | undefined;
    const asset = getAssetBySymbol(symbol);
    if (asset?.coingeckoId) {
      try {
        const meta = await this.coingeckoAdapter.fetchCoinMeta(asset.coingeckoId);
        ath = meta.athUsd ?? undefined;
        athDate = meta.athDateUsd ?? undefined;
        atl = meta.atlUsd ?? undefined;
        atlDate = meta.atlDateUsd ?? undefined;
        totalSupply = meta.totalSupply;
        maxSupply = meta.maxSupply;
      } catch {
        // CoinGecko unavailable — supplementary metadata remains absent.
      }
    }

    return {
      ...snapshot,
      high24h,
      low24h,
      indicators,
      ath,
      athDate,
      atl,
      atlDate,
      totalSupply: totalSupply ?? undefined,
      maxSupply: maxSupply ?? undefined,
    };
  }

  /**
   * USD-M свечи. Символ контракта резолвится по авторитетной вселенной
   * exchangeInfo (`1000PEPE` → `1000PEPEUSDT`); если контракта нет в активной
   * вселенной — честная ошибка «контракт не поддерживается», без Spot-подмены.
   */
  private async getFuturesCandles(
    symbol: string,
    timeframe: Timeframe,
    klineLimit: number,
    cacheKey: string,
    now: number,
  ): Promise<OHLCV[]> {
    const contracts = await this.futuresContracts().catch(() => null);
    const contractSymbol = resolveFuturesContractSymbol(symbol, contracts);
    if (!contractSymbol) {
      throw new UnsupportedMarketSymbolError(symbol, 'futures');
    }
    const interval = this.mapTimeframeToBinance(timeframe);
    const raw = await this.futuresAdapter.fetchKlines(contractSymbol, interval, klineLimit);
    const normalized = normalizeBinanceKlines(raw, contractSymbol, 'futures');
    if (normalized.length === 0) {
      throw new Error(`Futures candle data unavailable for ${contractSymbol} ${timeframe}`);
    }
    this.candleCache.set(cacheKey, { data: normalized, timestamp: now });
    return normalized;
  }

  /**
   * Свечи по инструменту.
   *
   * RC-6: рынок передаётся ЯВНО (`options.market`) и никогда не угадывается по
   * строке символа. `market: 'futures'` уходит только в USD-M kline-эндпоинт
   * (`/fapi/v1/klines`) — Spot-свечи того же тикера не подставляются ни при
   * каких обстоятельствах, и резерва на KuCoin у фьючерсов нет.
   */
  public async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 500,
    options: CandleRequestOptions = {},
  ): Promise<OHLCV[]> {
    // Binance /api/v3/klines принимает limit ≤ 1000 (вес 2 до 500 свечей, 5 до 1000).
    const klineLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const market: MarketType = options.market ?? 'spot';
    const cacheKey = `${market}_${symbol}_${timeframe}_${klineLimit}`;
    const now = Date.now();
    const cached = this.candleCache.get(cacheKey);
    if (!options.forceRefresh && cached && now - cached.timestamp < this.cacheTtlMs * 3) {
      return cached.data;
    }

    if (market === 'futures') {
      return this.getFuturesCandles(symbol, timeframe, klineLimit, cacheKey, now);
    }

    const asset = getAssetBySymbol(symbol);

    const binanceInterval = this.mapTimeframeToBinance(timeframe);
    const kucoinType = this.mapTimeframeToKuCoin(timeframe);

    if (!asset) {
      // Тикер вне реестра (добавлен через вселенную скана/пикер): пробуем
      // Binance-символ BASEUSDT через штатный same-origin adapter. KuCoin-резерва нет.
      // Неудача = честная ошибка символа, движок покажет её в статусе скана.
      const base = symbol.toUpperCase().trim();
      if (!/^[A-Z0-9]{2,20}$/.test(base)) {
        throw new Error(`Symbol ${symbol} not in canonical registry`);
      }
      try {
        const raw = await this.binance.fetchKlines(`${base}USDT`, binanceInterval, klineLimit);
        const normalized = normalizeBinanceKlines(raw, base);
        this.candleCache.set(cacheKey, { data: normalized, timestamp: now });
        return normalized;
      } catch {
        throw new Error(`Symbol ${symbol} not available on Binance spot`);
      }
    }

    // 1. Try Binance
    if (asset.binanceSymbol) {
      try {
        const raw = await this.binance.fetchKlines(asset.binanceSymbol, binanceInterval, klineLimit);
        const normalized = normalizeBinanceKlines(raw, asset.symbol);
        this.candleCache.set(cacheKey, { data: normalized, timestamp: now });
        return normalized;
      } catch {
        // Fallback to KuCoin
      }
    }

    // 2. Try KuCoin (резерв, когда Binance недоступен — гео-блок, 451/403, таймаут).
    if (asset.kucoinSymbol) {
      try {
        // KuCoin без окна отдаёт свою страницу по умолчанию (глубина не гарантирована) —
        // запрашиваем ровно нужный интервал: klineLimit + 2 бара на крайний формирующийся.
        const spanMs = TIMEFRAME_MS[timeframe] ?? 3_600_000;
        const raw = await this.kucoin.fetchCandles(asset.kucoinSymbol, kucoinType, {
          startAtMs: now - (klineLimit + 2) * spanMs,
          endAtMs: now,
        });
        const normalized = normalizeKuCoinCandles(raw, asset.symbol, true);
        const candles = normalized.length > klineLimit ? normalized.slice(-klineLimit) : normalized;
        if (candles.length < klineLimit) {
          // Не подставляем ничего и не «дорисовываем»: честно сообщаем о меньшей глубине
          // источника, чтобы LIVE-движок отчитался о нехватке истории, а не молчал.
          console.warn(
            `[market-data] KuCoin fallback: ${symbol} ${timeframe} — ${candles.length} свечей вместо ${klineLimit} (глубина источника)`
          );
        }
        if (candles.length > 0) {
          this.candleCache.set(cacheKey, { data: candles, timestamp: now });
          return candles;
        }
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

  /** З7: спред только из фактических bid/ask биржи; null — биржа их не отдала. */
  private computeSpreadPctFromBidAsk(bid?: string | null, ask?: string | null): number | null {
    const b = parseFloat(String(bid ?? ''));
    const a = parseFloat(String(ask ?? ''));
    if (!Number.isFinite(b) || !Number.isFinite(a) || b <= 0 || a <= 0) return null;
    const mid = (a + b) / 2;
    return Number((((a - b) / mid) * 100).toFixed(4));
  }

  /** З3: проекция полного расчёта движка на контракт TechnicalIndicators. */
  private buildTechnicalIndicators(c: CompleteIndicatorsResult): TechnicalIndicators {
    return {
      rsi14: c.rsi14,
      macd: { macd: c.macd.macd, signal: c.macd.signal, hist: c.macd.hist },
      sma20: c.sma20,
      sma50: c.sma50,
      sma200: c.sma200,
      bollinger: { upper: c.bollinger.upper, middle: c.bollinger.middle, lower: c.bollinger.lower },
    };
  }

  /**
   * Каталог USD-M perpetual.
   *
   * RC-1: раньше браузер сам делал 2 bulk-запроса + до 30 per-symbol OI-запросов
   * (и оставлял ~470 контрактов с «—»/«Нет данных»). Теперь источник истины —
   * агрегированный серверный снимок `/api/market/derivatives/futures`:
   * один запрос из браузера на цикл опроса, OI собран сервером для ВСЕЙ
   * вселенной с контролируемым параллелизмом и общим кэшем.
   *
   * Если серверный агрегат недоступен, остаётся честная деградация на прямые
   * bulk-эндпоинты (цена/фандинг/базис/объём/изменение есть, OI = null →
   * «Нет данных»), без подстановок и без demo-датасета.
   */
  public async getFuturesList(): Promise<FuturesAsset[]> {
    const now = Date.now();
    if (this.futuresCache && now - this.futuresCache.timestamp < this.cacheTtlMs) {
      return this.futuresCache.data;
    }

    let results: FuturesAsset[] = [];
    let snapshotError: unknown = null;
    try {
      results = await this.buildFuturesFromServerSnapshot();
    } catch (error) {
      snapshotError = error;
    }

    if (results.length === 0) {
      try {
        results = await this.buildFuturesFromBulkEndpoints();
      } catch (error) {
        // LIVE-FIRST: источник не ответил — честная ошибка, без подстановки демо-датасета.
        throw new AdapterNetworkError('binance', error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (results.length === 0) {
      throw new AdapterNetworkError(
        'binance',
        snapshotError instanceof Error ? snapshotError : new Error('Futures source returned no instruments'),
      );
    }

    const withLiq = this.applyFactualLiquidations(results, now);
    this.futuresCache = { data: withLiq, timestamp: now };
    return withLiq;
  }

  /** Последняя серверная статистика покрытия (для честного счётчика в UI). */
  public getFuturesCoverage(): FuturesSnapshotCoverage | null {
    return this.futuresCoverage;
  }

  private sortFuturesRows(results: FuturesAsset[], canonicalByExchange: Map<string, CanonicalAsset>): FuturesAsset[] {
    // Stable default order: canonical perps by rank first (BTC, ETH, …), then by futures volume.
    return [...results].sort((a, b) => {
      const ra = canonicalByExchange.get(a.contractSymbol ?? `${a.symbol.split('/')[0]}USDT`)?.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = canonicalByExchange.get(b.contractSymbol ?? `${b.symbol.split('/')[0]}USDT`)?.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || (b.futuresVolume24h ?? -1) - (a.futuresVolume24h ?? -1) || a.symbol.localeCompare(b.symbol);
    });
  }

  private canonicalForContract(
    canonicalByExchange: Map<string, CanonicalAsset>,
    exchangeSymbol: string,
    base: string,
  ): CanonicalAsset {
    return canonicalByExchange.get(exchangeSymbol) ?? {
      symbol: base, name: base, category: 'other', rank: Number.MAX_SAFE_INTEGER,
      binanceSymbol: exchangeSymbol, kucoinSymbol: null, coingeckoId: null, description: '', circulatingSupply: 0,
    };
  }

  /** PRIMARY: агрегированный серверный снимок (1 запрос из браузера). */
  private async buildFuturesFromServerSnapshot(): Promise<FuturesAsset[]> {
    const snapshot = await this.futuresSnapshotFetcher();
    this.futuresCoverage = snapshot.coverage;
    const canonicalList = getCanonicalAssets().filter((a) => a.binanceSymbol);
    const canonicalByExchange = new Map(canonicalList.map((a) => [a.binanceSymbol as string, a]));
    const results: FuturesAsset[] = [];

    for (const row of snapshot.rows) {
      // Без markPrice/indexPrice/фандинга контракт не может быть нормализован
      // деривативным движком — строка пропускается, а не заполняется нулями.
      if (row.markPrice === null || row.indexPrice === null || row.lastFundingRate === null) continue;
      const asset = this.canonicalForContract(canonicalByExchange, row.contractSymbol, row.baseAsset);
      results.push(DerivativesEngine.normalizeFuturesAsset(
        asset,
        {
          symbol: row.contractSymbol,
          markPrice: row.markPrice,
          indexPrice: row.indexPrice,
          lastFundingRate: row.lastFundingRate,
          nextFundingTime: row.nextFundingTime ?? 0,
          time: row.premiumTime ?? 0,
        },
        row.lastPrice !== null || row.quoteVolume !== null || row.priceChangePercent !== null
          ? {
              symbol: row.contractSymbol,
              priceChange: '',
              priceChangePercent: row.priceChangePercent ?? '',
              lastPrice: row.lastPrice ?? '',
              volume: row.baseVolume ?? '',
              quoteVolume: row.quoteVolume ?? '',
              highPrice: row.highPrice ?? null,
              lowPrice: row.lowPrice ?? null,
            }
          : undefined,
        row.openInterest !== null
          ? { symbol: row.contractSymbol, openInterest: row.openInterest, time: snapshotTimeMs(snapshot.fetchedAt) }
          : undefined,
        row.openInterestHist ?? undefined,
      ));
    }

    return this.sortFuturesRows(results, canonicalByExchange);
  }

  /** FALLBACK: прямые bulk-эндпоинты биржи; OI недоступен → null («Нет данных»). */
  private async buildFuturesFromBulkEndpoints(): Promise<FuturesAsset[]> {
    const [premiums, tickers] = await Promise.all([
      this.futuresAdapter.fetchPremiumIndexes(),
      this.futuresAdapter.fetch24hrTickers(),
    ]);

    const tickerMap = new Map(tickers.map((t) => [t.symbol.toUpperCase(), t]));
    const premiumMap = new Map(premiums.map((p) => [p.symbol.toUpperCase(), p]));
    const canonicalList = getCanonicalAssets().filter((a) => a.binanceSymbol);
    const canonicalByExchange = new Map(canonicalList.map((a) => [a.binanceSymbol as string, a]));

    // Universe = ALL active USD-M USDT perpetuals from exchangeInfo (not canonical 25).
    // Degraded fallback when exchangeInfo is unknown: canonical perps only.
    const universe = await this.futuresUniverse().catch(() => null);
    const contracts: Array<{ exchangeSymbol: string; base: string }> = universe
      ? universe.contracts.map((c) => ({ exchangeSymbol: c.exchangeSymbol, base: c.symbol }))
      : canonicalList.map((a) => ({ exchangeSymbol: a.binanceSymbol as string, base: a.symbol }));

    const results: FuturesAsset[] = [];
    let missingPremium = 0;
    for (const contract of contracts) {
      const premium = premiumMap.get(contract.exchangeSymbol);
      // RC-4: раньше такие контракты исчезали молча; теперь потеря считается.
      if (!premium) { missingPremium++; continue; }
      const asset = this.canonicalForContract(canonicalByExchange, contract.exchangeSymbol, contract.base);
      results.push(DerivativesEngine.normalizeFuturesAsset(
        asset,
        premium,
        tickerMap.get(contract.exchangeSymbol),
        undefined,
        undefined,
      ));
    }
    this.futuresCoverage = null;
    if (missingPremium > 0) {
      console.warn(`[futures] ${missingPremium} активных контрактов без premiumIndex — строки не показаны`);
    }
    return this.sortFuturesRows(results, canonicalByExchange);
  }

  /**
   * Один контракт по базовому тикеру (`1000PEPE`) или символу (`1000PEPEUSDT`).
   * null = контракта нет в активной вселенной (UI покажет «не поддерживается»,
   * без подстановки Spot-данных того же тикера).
   */
  public async getFuturesContract(baseOrContract: string): Promise<FuturesAsset | null> {
    const wanted = String(baseOrContract ?? '').toUpperCase().trim();
    if (!wanted) return null;
    const list = await this.getFuturesList();
    return list.find((f) =>
      f.contractSymbol === wanted
      || f.baseAsset === wanted
      || f.symbol.split('/')[0] === wanted
      || f.contractSymbol === `${wanted}USDT`,
    ) ?? null;
  }

  /**
   * Стакан USD-M-перпетуала (задача §4).
   *
   * Источник ровно один — `GET /fapi/v1/depth` через futures-gateway. Если
   * контракта нет в активной вселенной exchangeInfo, метод бросает
   * `UnsupportedMarketSymbolError`: спотовая книга того же тикера НЕ
   * подставляется (инвариант «никогда Spot вместо Futures»).
   *
   * Кэш — 4 секунды на пару «контракт+глубина». Стакан опрашивается раз в 5с,
   * поэтому кэш гасит повторные запросы при перемонтировании/двух виджетах
   * на странице и не даёт рейт-лимиту USD-M (вес 2 при limit<=50) расти
   * линейно от числа вкладок.
   */
  public async getFuturesOrderBook(
    baseOrContract: string,
    options: FuturesOrderBookOptions = {},
  ): Promise<OrderBookSnapshot | null> {
    const wanted = String(baseOrContract ?? '').toUpperCase().trim();
    if (!wanted) return null;
    const limit = options.limit ?? 50;
    const contracts = await this.futuresContracts().catch(() => null);
    const contractSymbol = resolveFuturesContractSymbol(wanted, contracts);
    if (!contractSymbol) {
      throw new UnsupportedMarketSymbolError(wanted, 'futures');
    }

    const cacheKey = `${contractSymbol}_${limit}`;
    const now = Date.now();
    const cached = this.futuresDepthCache.get(cacheKey);
    if (!options.forceRefresh && cached && now - cached.timestamp < FUTURES_DEPTH_TTL_MS) {
      return cached.data;
    }

    const raw = await this.futuresAdapter.fetchDepth(contractSymbol, limit, options.signal);
    const snapshot = normalizeFuturesDepth(raw, {
      contractSymbol,
      displaySymbol: contractSymbol.replace(/USDT$/, ''),
    });
    this.futuresDepthCache.set(cacheKey, { data: snapshot, timestamp: now });
    return snapshot;
  }

  public async getLiquidations(): Promise<LiquidationData> {
    return LiquidationPipeline.getInstance().getLiquidationSnapshot();
  }

  /**
   * Radar is server-authoritative. This client never derives browser-local
   * anomaly events; it reads durable monitor history so Overview and Radar see
   * the same facts even after every browser tab was closed.
   */
  public async getRadarEvents(symbol?: string): Promise<RadarEvent[]> {
    return this.radarEventsFetcher(symbol);
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
