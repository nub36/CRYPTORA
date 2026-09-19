/**
 * CRYPTORA — Загрузка свечей для серверного движка.
 *
 * Требования, которые здесь закрыты:
 *  • только ПУБЛИЧНЫЕ эндпоинты. Никаких торговых ключей, приватных методов и
 *    исполнения ордеров.
 *  • кэш с TTL по (symbol, timeframe) — движок не должен каждые 60 секунд
 *    тянуть сотни одинаковых наборов свечей.
 *  • дедупликация in-flight: одновременные запросы одного и того же набора
 *    сводятся к одному HTTP-запросу.
 *  • честная ошибка: если эндпоинт недоступен, исключение пробрасывается
 *    наверх. Тихой подмены реальных данных статикой нет.
 */

const BINANCE_BASE = 'https://api.binance.com/api/v3/klines';

/** Таймаут одного запроса. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * TTL кэша по таймфрейму. Меньше периода свечи: бессмысленно держать кэш
 * дольше, чем появляется новый закрытый бар.
 */
export const CACHE_TTL_MS = {
  '15m': 60_000,
  '30m': 60_000,
  '1h': 60_000,
  '4h': 60_000,
};

export const DEFAULT_CACHE_TTL_MS = 60_000;

/** Сколько свечей тянуть: стратегиям нужен warmup, но не вся история. */
export const CANDLE_LIMIT = { '15m': 400, '30m': 300, '1h': 300, '4h': 200 };
export const DEFAULT_CANDLE_LIMIT = 300;

export class MarketDataFetcher {
  /**
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetchFn] — инъекция для тестов
   * @param {number} [opts.nowMs] — инъекция времени для тестов
   */
  constructor({ fetchFn, nowMs } = {}) {
    this.fetchFn = fetchFn ?? ((...a) => globalThis.fetch(...a));
    this.nowFn = nowMs ?? (() => Date.now());
    /** @type {Map<string, {at: number, candles: Array}>} */
    this.cache = new Map();
    /** @type {Map<string, Promise<Array>>} */
    this.inFlight = new Map();
    this.requestCount = 0;
  }

  key(symbol, timeframe) {
    return `${symbol}|${timeframe}`;
  }

  /** Счётчик реальных HTTP-запросов — для теста «нет веера дублей». */
  get stats() {
    return {
      httpRequests: this.requestCount,
      cacheEntries: this.cache.size,
      inFlight: this.inFlight.size,
    };
  }

  clearCache() {
    this.cache.clear();
  }

  /**
   * Закрытые свечи. Формирующаяся свеча возвращается эндпоинтом, но
   * помечается `isClosed = false` уже на стороне адаптера (ohlcvToArchive),
   * поэтому здесь ничего не отбрасывается и не «дорисовывается».
   *
   * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number,closeTime:number}>>}
   */
  async getCandles(symbol, timeframe, { limit } = {}) {
    const key = this.key(symbol, timeframe);
    const now = this.nowFn();
    const ttl = CACHE_TTL_MS[timeframe] ?? DEFAULT_CACHE_TTL_MS;

    const hit = this.cache.get(key);
    if (hit && now - hit.at < ttl) return hit.candles;

    // Дедупликация одновременных запросов одного набора.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.fetchCandles(symbol, timeframe, limit ?? CANDLE_LIMIT[timeframe] ?? DEFAULT_CANDLE_LIMIT)
      .then((candles) => {
        this.cache.set(key, { at: this.nowFn(), candles });
        this.inFlight.delete(key);
        return candles;
      })
      .catch((e) => {
        this.inFlight.delete(key);
        throw e;
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  async fetchCandles(symbol, timeframe, limit) {
    const url = `${BINANCE_BASE}?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(timeframe)}&limit=${limit}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.requestCount++;
    try {
      const res = await this.fetchFn(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Binance klines HTTP ${res.status} for ${symbol} ${timeframe}`);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error(`Unexpected klines payload for ${symbol} ${timeframe}`);

      // [openTime, open, high, low, close, volume, closeTime, ...]
      return raw.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000), // секунды — как в OHLCV фронтенда
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
      }));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Провайдер в форме, которую ожидает LiveSignalEngine.
   * Движку нужны только getCandles; остальное он не вызывает, но интерфейс
   * MarketDataProvider требует присутствия полей.
   */
  asProvider() {
    const self = this;
    const unavailable = async () => {
      throw new Error('Not available in server strategy engine context');
    };
    return {
      isDemo: false,
      getCandles: (symbol, timeframe) => self.getCandles(symbol, timeframe),
      getAssets: unavailable,
      getAssetDetail: unavailable,
      getFuturesList: unavailable,
      getLiquidations: unavailable,
      getRadarEvents: unavailable,
      getMarketOverview: unavailable,
      getScreenerResults: unavailable,
    };
  }
}

let singleton = null;

/** @returns {MarketDataFetcher} */
export function getMarketDataFetcher() {
  if (!singleton) singleton = new MarketDataFetcher();
  return singleton;
}

export function resetMarketDataFetcher() {
  singleton = null;
}
