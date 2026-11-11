/**
 * Свечи для графика в Android-приложении.
 *
 * Почему это отдельный сервис, а не запрос биржи прямо с телефона:
 *   • приложение показывает ровно то, что сервер получил и проверил; на телефоне
 *     нет ни адресов биржи, ни возможности «дорисовать» бар;
 *   • публичный эндпоинт ограничен по символу, таймфрейму и числу свечей, чтобы
 *     один клиент не мог превратить backend в прокси к бирже;
 *   • ответ кэшируется на короткое время: несколько телефонов не создают
 *     лавину запросов к Binance, а данные остаются свежими (TTL 15 с);
 *   • ошибка источника НЕ превращается в пустой массив: пустая серия означала
 *     бы «рынок пуст», а это ложь. Клиент получает код ошибки и честный текст.
 *
 * Торговой логики здесь нет: только публичные OHLCV. Уровни, TP/SL/BE и
 * события lifecycle приложение по-прежнему берёт из сигналов сервера.
 */
import { MARKET_DATA_SOURCE } from '@v34/core';
import type { OHLCV } from '@v34/core';
import { INTERVAL_MS, MarketDataError, type CandleProvider, type MarketInterval } from './market';

/** Сколько свечей отдаём по умолчанию (≈5 суток 1H — читаемый график). */
export const CANDLE_LIMIT_DEFAULT = 120;
export const CANDLE_LIMIT_MIN = 20;
/** Потолок: 300 баров 1H ≈ 12.5 суток; больше телефону не нужно. */
export const CANDLE_LIMIT_MAX = 300;
export const CANDLE_CACHE_TTL_MS = 15_000;
export const CANDLE_CACHE_MAX_ENTRIES = 64;

export const CANDLE_INTERVALS: readonly MarketInterval[] = Object.freeze(['1h', '4h']);

export interface Candle {
  /** Начало бара, секунды Unix (как у Binance). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Бар уже закрыт на момент ответа. Незакрытый бар — «живой» и помечен. */
  closed: boolean;
}

export interface CandleSource {
  id: string;
  exchange: string;
  isFallback: boolean;
}

export interface CandleSeries {
  exchangeSymbol: string;
  interval: MarketInterval;
  limit: number;
  candles: Candle[];
  source: CandleSource | null;
}

export type CandleErrorCode =
  | 'HTTP' | 'TIMEOUT' | 'NETWORK' | 'BAD_JSON' | 'BAD_ROW' | 'EMPTY' | 'ORDER' | 'UNAVAILABLE';

/**
 * Ошибка получения свечей. Наружу уходит код и короткий текст: клиент должен
 * понимать «биржа не ответила», а не получать стек или URL.
 */
export class CandleSourceError extends Error {
  readonly code: CandleErrorCode;
  constructor(code: CandleErrorCode, message: string) {
    super(message);
    this.name = 'CandleSourceError';
    this.code = code;
  }
}

interface CacheEntry {
  fetchedAtMs: number;
  rows: OHLCV[];
  source: CandleSource | null;
}

export interface CandleServiceOptions {
  /** TTL кэша, мс. 0 — кэш выключен (используется в тестах). */
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class CandleService {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();

  constructor(private readonly provider: CandleProvider, opts: CandleServiceOptions = {}) {
    this.ttlMs = opts.ttlMs ?? CANDLE_CACHE_TTL_MS;
    this.maxEntries = Math.max(1, opts.maxEntries ?? CANDLE_CACHE_MAX_ENTRIES);
    this.now = opts.now ?? Date.now;
  }

  async get(symbol: string, interval: MarketInterval, limit: number): Promise<CandleSeries> {
    const exchangeSymbol = symbol.trim().toUpperCase();
    const key = `${exchangeSymbol}|${interval}|${limit}`;
    const nowMs = this.now();

    const cached = this.cache.get(key);
    if (cached && this.ttlMs > 0 && nowMs - cached.fetchedAtMs < this.ttlMs) {
      return buildSeries(exchangeSymbol, interval, limit, cached, nowMs);
    }

    // Одинаковые параллельные запросы (лента + график) не дублируют биржу.
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.fetch(exchangeSymbol, interval, limit).finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, pending);
    }

    let entry: CacheEntry;
    try {
      entry = await pending;
    } catch (e) {
      throw toSourceError(e);
    }
    // Время закрытия бара считается на момент ответа, а не на момент начала
    // запроса: бар мог закрыться, пока шёл HTTP-вызов.
    const at = this.now();
    if (this.ttlMs > 0) this.store(key, entry, at);
    return buildSeries(exchangeSymbol, interval, limit, entry, at);
  }

  private async fetch(
    symbol: string, interval: MarketInterval, limit: number,
  ): Promise<CacheEntry> {
    const rows = await this.provider.getKlines(symbol, interval, limit);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new MarketDataError({ code: 'EMPTY', message: `биржа не отдала свечи ${symbol} ${interval}` });
    }
    // Провайдер обязан отдавать возрастающее время; проверяем ещё раз, потому
    // что порядок — часть контракта графика, а не деталь реализации.
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i]!.time > rows[i - 1]!.time)) {
        throw new MarketDataError({ code: 'ORDER', message: `свечи ${symbol} ${interval} не упорядочены` });
      }
    }
    const source: CandleSource = rows[0]?.provenance
      ? { id: MARKET_DATA_SOURCE.id, exchange: rows[0].provenance.exchange, isFallback: rows[0].provenance.isFallback }
      : { id: MARKET_DATA_SOURCE.id, exchange: MARKET_DATA_SOURCE.exchange, isFallback: false };
    // fetchedAtMs выставляет store() в момент ответа; здесь важен только ряд.
    return { fetchedAtMs: 0, rows: [...rows], source };
  }

  private store(key: string, entry: CacheEntry, nowMs: number): void {
    this.cache.delete(key);
    while (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    this.cache.set(key, { ...entry, fetchedAtMs: nowMs });
  }
}

function buildSeries(
  exchangeSymbol: string,
  interval: MarketInterval,
  limit: number,
  entry: CacheEntry,
  nowMs: number,
): CandleSeries {
  const span = INTERVAL_MS[interval];
  const candles: Candle[] = entry.rows.slice(-limit).map((row) => ({
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    // Бар закрыт, если время его закрытия уже прошло (как в ohlcvToArchive).
    closed: row.time * 1000 + span - 1 < nowMs,
  }));
  return { exchangeSymbol, interval, limit, candles, source: entry.source };
}

function toSourceError(e: unknown): CandleSourceError {
  if (e instanceof CandleSourceError) return e;
  if (e instanceof MarketDataError) return new CandleSourceError(e.code, e.detail.message);
  return new CandleSourceError('UNAVAILABLE', e instanceof Error ? e.message : String(e));
}
