import { z } from 'zod';
import {
  BinanceFuturesPremiumIndex,
  BinanceFuturesPremiumIndexSchema,
  BinanceFuturesOpenInterest,
  BinanceFuturesOpenInterestSchema,
  BinanceFuturesTicker24hr,
  BinanceFuturesTicker24hrSchema,
  BinanceFuturesOpenInterestHistSchema,
  type BinanceFuturesOpenInterestHistItem,
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
    this.baseUrl = config.baseUrl ?? 'https://fapi.binance.com';
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.fetchFn = config.fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  private async request<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

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

  public async fetch24hrTicker(symbol: string): Promise<BinanceFuturesTicker24hr> {
    return this.request(
      `/fapi/v1/ticker/24hr?symbol=${symbol.toUpperCase()}`,
      BinanceFuturesTicker24hrSchema
    );
  }
}
