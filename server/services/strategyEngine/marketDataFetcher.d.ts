/**
 * Декларации для server/services/strategyEngine/marketDataFetcher.js.
 *
 * Граница рыночных данных серверного движка: здесь продуктовые таймфреймы и
 * символы приводятся к формату Binance, здесь же живут кэш, дедупликация
 * in-flight и ограничения лимита свечей.
 */

/** Продуктовый таймфрейм (`Timeframe`/`ArchiveTimeframe`) → interval Binance. */
export declare const BINANCE_INTERVAL_BY_TIMEFRAME: Readonly<Record<string, string>>;

/** Приводит таймфрейм к interval Binance ('1D' → '1d'); неизвестный — ошибка. */
export declare function toBinanceInterval(timeframe: string): string;

/**
 * Приводит символ к биржевой форме ('BTC/USDT' | 'btc-usdt' | 'BTC' → 'BTCUSDT').
 * Мусор отклоняется: выдуманный символ биржа отклонит, а скан выглядел бы как
 * «сетапов нет» вместо «нет данных».
 */
export declare function toExchangeSymbol(symbol: string): string;

export declare const BINANCE_MAX_KLINES: number;
export declare const REQUEST_TIMEOUT_MS: number;

/** Дефолты лимита по interval — равны CANDLE_LIMIT_* ядра. */
export declare const CANDLE_LIMIT: Readonly<Record<string, number>>;
export declare const DEFAULT_CANDLE_LIMIT: number;
export declare const CACHE_TTL_MS: Readonly<Record<string, number>>;
export declare const DEFAULT_CACHE_TTL_MS: number;

/**
 * Ограничивает запрошенный лимит целым числом в [1, BINANCE_MAX_KLINES].
 * Отсутствие лимита — дефолт interval'а; нечисло — ошибка.
 */
export declare function normalizeCandleLimit(limit: unknown, interval: string): number;

/** Свеча в форме OHLCV фронтенда: `time` в секундах, `closeTime` в мс. */
export interface ServerCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

/** Провайдер в форме, которую ожидает LiveSignalEngine (только чтение свечей). */
export interface CoreMarketProvider {
  isDemo: boolean;
  getCandles(symbol: string, timeframe: string, limit?: number): Promise<ServerCandle[]>;
  getAssets: (...args: unknown[]) => Promise<never>;
  getAssetDetail: (...args: unknown[]) => Promise<never>;
  getFuturesList: (...args: unknown[]) => Promise<never>;
  getLiquidations: (...args: unknown[]) => Promise<never>;
  getRadarEvents: (...args: unknown[]) => Promise<never>;
  getMarketOverview: (...args: unknown[]) => Promise<never>;
  getScreenerResults: (...args: unknown[]) => Promise<never>;
}

export declare class MarketDataFetcher {
  constructor(opts?: {
    fetchFn?: (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>;
    /** Инъекция источника времени (TTL кэша) для тестов. */
    nowMs?: () => number;
  });

  cache: Map<string, { at: number; candles: ServerCandle[] }>;
  inFlight: Map<string, Promise<ServerCandle[]>>;
  requestCount: number;

  readonly stats: { httpRequests: number; cacheEntries: number; inFlight: number };

  key(symbol: string, timeframe: string, limit?: number): string;
  clearCache(): void;

  getCandles(
    symbol: string,
    timeframe: string,
    opts?: { limit?: number } | number
  ): Promise<ServerCandle[]>;

  /** symbol/interval/limit уже нормализованы. */
  fetchCandles(symbol: string, interval: string, limit: number): Promise<ServerCandle[]>;

  asProvider(): CoreMarketProvider;
}

export declare function getMarketDataFetcher(): MarketDataFetcher;
export declare function resetMarketDataFetcher(): void;
