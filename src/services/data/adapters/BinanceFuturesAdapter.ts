import { z } from 'zod';
import {
  BinanceFuturesPremiumIndex,
  BinanceFuturesPremiumIndexSchema,
  BinanceFuturesExchangeInfoSchema,
  type BinanceFuturesExchangeInfo,
  BinanceFuturesOpenInterest,
  BinanceFuturesOpenInterestSchema,
  BinanceFuturesTicker24hr,
  BinanceFuturesTicker24hrSchema,
  BinanceFuturesOpenInterestHistSchema,
  type BinanceFuturesOpenInterestHistItem,
  BinanceFuturesKlinesResponseSchema,
  type BinanceFuturesKlineRaw,
  BinanceFuturesDepthSchema,
  type BinanceFuturesDepth,
} from './derivativesSchemas';
import {
  AdapterNetworkError,
  AdapterTimeoutError,
  AdapterValidationError,
  AdapterRateLimitError,
} from './errors';

export interface BinanceFuturesAdapterConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BinanceFuturesAdapter {
  public readonly exchange = 'binance' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: BinanceFuturesAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? '/api/market/binance/futures';
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.fetchFn = config.fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  private async request<T>(endpoint: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    /*
     * Внешняя отмена (смена символа/таймфрейма, размонтирование страницы)
     * складывается с таймаутом: устаревший запрос стакана прекращается сразу,
     * а не «догоняет» UI через секунду и не перезаписывает свежий снапшот.
     */
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status === 429 || response.status === 418) {
        throw new AdapterRateLimitError('binance', 429);
      }

      if (!response.ok) {
        throw new AdapterNetworkError(
          'binance',
          new Error(`HTTP ${response.status}: ${response.statusText}`)
        );
      }

      const json = await response.json();
      const parsed = schema.safeParse(json);

      if (!parsed.success) {
        throw new AdapterValidationError('binance', {
          endpoint,
          error: parsed.error.message,
          json,
        });
      }

      return parsed.data;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AdapterTimeoutError('binance');
      }
      if (
        err instanceof AdapterNetworkError ||
        err instanceof AdapterRateLimitError ||
        err instanceof AdapterValidationError ||
        err instanceof AdapterTimeoutError
      ) {
        throw err;
      }
      throw new AdapterNetworkError('binance', err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchExchangeInfo(): Promise<BinanceFuturesExchangeInfo> {
    return this.request('/fapi/v1/exchangeInfo', BinanceFuturesExchangeInfoSchema);
  }

  public async fetchPremiumIndexes(): Promise<BinanceFuturesPremiumIndex[]> {
    return this.request(
      '/fapi/v1/premiumIndex',
      z.array(BinanceFuturesPremiumIndexSchema)
    );
  }

  public async fetchPremiumIndex(symbol: string): Promise<BinanceFuturesPremiumIndex> {
    return this.request(
      `/fapi/v1/premiumIndex?symbol=${symbol.toUpperCase()}`,
      BinanceFuturesPremiumIndexSchema
    );
  }

  public async fetchOpenInterest(symbol: string): Promise<BinanceFuturesOpenInterest> {
    return this.request(
      `/fapi/v1/openInterest?symbol=${symbol.toUpperCase()}`,
      BinanceFuturesOpenInterestSchema
    );
  }

  /**
   * Исторический OI (агрегированный по бирже) с шагом 1h. limit=25 покрывает Δ1ч и Δ24ч.
   * Endpoint публичный, но не под /fapi — отдельный путь /futures/data.
   */
  public async fetchOpenInterestHist(symbol: string, limit = 25): Promise<BinanceFuturesOpenInterestHistItem[]> {
    return this.request(
      `/futures/data/openInterestHist?symbol=${symbol.toUpperCase()}&period=1h&limit=${limit}`,
      BinanceFuturesOpenInterestHistSchema
    );
  }

  public async fetch24hrTickers(): Promise<BinanceFuturesTicker24hr[]> {
    return this.request(
      '/fapi/v1/ticker/24hr',
      z.array(BinanceFuturesTicker24hrSchema)
    );
  }

  /**
   * USD-M klines (`/fapi/v1/klines`).
   *
   * This is the ONLY candle source a Futures chart may use. It is deliberately
   * a separate method on a separate adapter with a separate gateway route, so
   * a Futures terminal cannot fall back to Spot candles of the same ticker
   * (root cause RC-6). `symbol` is the CONTRACT symbol (`1000PEPEUSDT`), not a
   * base ticker.
   */
  public async fetchKlines(
    contractSymbol: string,
    interval = '1h',
    limit = 500,
  ): Promise<BinanceFuturesKlineRaw[]> {
    const upper = contractSymbol.toUpperCase().trim();
    // Bounded to the gateway's allowlisted `limit` range (1…1000).
    const bounded = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.request(
      `/fapi/v1/klines?symbol=${encodeURIComponent(upper)}&interval=${encodeURIComponent(interval)}&limit=${bounded}`,
      BinanceFuturesKlinesResponseSchema,
    );
  }

  /**
   * Стакан USD-M (`GET /fapi/v1/depth`) — задача §4.
   *
   * Это ЕДИНСТВЕННЫЙ источник стакана для /futures/:symbol. Спотовый
   * `/api/v3/depth` здесь недоступен физически: адаптер ходит только в
   * gateway-префикс `/api/market/binance/futures`, который проксируется
   * на `fapi.binance.com`.
   *
   * `symbol` — символ КОНТРАКТА (`1000PEPEUSDT`), не базовый тикер.
   * `limit` округляется вниз до ближайшего разрешённого биржей значения
   * (5/10/20/50/100/500/1000); 50 уровней стоят вес 2 — столько же, сколько 5.
   */
  public async fetchDepth(
    contractSymbol: string,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<BinanceFuturesDepth> {
    const upper = contractSymbol.toUpperCase().trim();
    const allowed = [5, 10, 20, 50, 100, 500, 1000];
    const bounded = allowed.includes(limit)
      ? limit
      : allowed.reduce((best, value) => (value <= limit && value > best ? value : best), 5);
    return this.request(
      `/fapi/v1/depth?symbol=${encodeURIComponent(upper)}&limit=${bounded}`,
      BinanceFuturesDepthSchema,
      signal,
    );
  }

  public async fetch24hrTicker(symbol: string): Promise<BinanceFuturesTicker24hr> {
    return this.request(
      `/fapi/v1/ticker/24hr?symbol=${symbol.toUpperCase()}`,
      BinanceFuturesTicker24hrSchema
    );
  }
}
