import { z } from 'zod';
import {
  BinanceTicker24hr,
  BinanceTicker24hrSchema,
  BinanceKlineRaw,
  BinanceKlinesResponseSchema,
} from './schemas';
import {
  AdapterNetworkError,
  AdapterTimeoutError,
  AdapterValidationError,
  AdapterRateLimitError,
  SymbolNotFoundError,
  AdapterSourceBlockedError,
} from './errors';
import { SourceHealthTracker, exchangeEndpointKey } from './sourceHealth';

export interface BinanceAdapterConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  /**
   * Circuit breaker неудачных запросов (см. sourceHealth.ts).
   * undefined — выключен (детерминированные тесты); боевой composition root
   * передаёт общий трекер, чтобы не долбить системно недоступные endpoints.
   */
  health?: SourceHealthTracker;
}

export class BinanceSpotAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly health?: SourceHealthTracker;

  constructor(config: BinanceAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.binance.com';
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.health = config.health;
  }

  private async request<T>(path: string, schema: { parse: (val: unknown) => T }): Promise<T> {
    const endpointKey = this.health ? exchangeEndpointKey(path) : '';
    if (this.health && !this.health.canAttempt(endpointKey)) {
      throw new AdapterSourceBlockedError('binance', endpointKey, this.health.retryInMs(endpointKey));
    }

    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        // Таймаут транзиентен — не учитывается circuit breaker'ом.
        throw new AdapterTimeoutError('binance');
      }
      this.health?.recordFailure('binance', endpointKey, 'network', String(err?.message ?? err));
      throw new AdapterNetworkError('binance', err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 || response.status === 418) {
      this.health?.recordFailure('binance', endpointKey, 'rate_limit', `HTTP ${response.status}`);
      throw new AdapterRateLimitError('binance', response.status);
    }

    if (response.status === 400 || response.status === 404) {
      this.health?.recordFailure('binance', endpointKey, 'invalid_symbol', `HTTP ${response.status}`);
      throw new SymbolNotFoundError('binance', path);
    }

    if (!response.ok) {
      this.health?.recordFailure('binance', endpointKey, 'http', `HTTP ${response.status}`);
      throw new AdapterNetworkError('binance', new Error(`HTTP ${response.status}: ${response.statusText}`));
    }

    this.health?.recordSuccess(endpointKey);

    let json: unknown;
    try {
      json = await response.json();
    } catch (err: any) {
      throw new AdapterValidationError('binance', 'Invalid JSON response');
    }

    try {
      return schema.parse(json);
    } catch (err: any) {
      throw new AdapterValidationError('binance', err.errors ?? err.message);
    }
  }

  public async fetch24hrTicker(binanceSymbol: string): Promise<BinanceTicker24hr> {
    const upper = binanceSymbol.toUpperCase().trim();
    return this.request(
      `/api/v3/ticker/24hr?symbol=${encodeURIComponent(upper)}`,
      BinanceTicker24hrSchema
    );
  }

  /**
   * Fetch ALL 24hr tickers in a single request.
   * Weight: 40 (vs 1 per symbol × 25 = 25 for individual calls).
   * Net: 1 request with weight 40 replaces 25 requests with total weight 25,
   * but saves 24 HTTP round-trips — significant for Overview first paint.
   */
  public async fetchAll24hrTickers(): Promise<BinanceTicker24hr[]> {
    return this.request(
      '/api/v3/ticker/24hr',
      z.array(BinanceTicker24hrSchema)
    );
  }

  public async fetchKlines(
    binanceSymbol: string,
    interval = '1h',
    limit = 100
  ): Promise<BinanceKlineRaw[]> {
    const upper = binanceSymbol.toUpperCase().trim();
    return this.request(
      `/api/v3/klines?symbol=${encodeURIComponent(upper)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
      BinanceKlinesResponseSchema
    );
  }
}
