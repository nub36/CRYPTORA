import {
  KuCoinStats24hrData,
  KuCoinStatsResponseSchema,
  KuCoinTickerItem,
  KuCoinAllTickersResponseSchema,
  KuCoinCandleItem,
  KuCoinCandlesResponseSchema,
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

export interface KuCoinAdapterConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  /**
   * Circuit breaker неудачных запросов (см. sourceHealth.ts). Особенно важен
   * для KuCoin: его REST API не отдаёт браузерам CORS-заголовки, поэтому без
   * трекера каждый цикл опроса генерировал бы гарантированно отвалившийся запрос.
   */
  health?: SourceHealthTracker;
}

export class KuCoinSpotAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly health?: SourceHealthTracker;

  constructor(config: KuCoinAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.kucoin.com';
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.health = config.health;
  }

  private async request<T>(path: string, schema: { parse: (val: unknown) => T }): Promise<T> {
    const endpointKey = this.health ? exchangeEndpointKey(path) : '';
    if (this.health && !this.health.canAttempt(endpointKey)) {
      throw new AdapterSourceBlockedError('kucoin', endpointKey, this.health.retryInMs(endpointKey));
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
        throw new AdapterTimeoutError('kucoin');
      }
      this.health?.recordFailure('kucoin', endpointKey, 'network', String(err?.message ?? err));
      throw new AdapterNetworkError('kucoin', err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      this.health?.recordFailure('kucoin', endpointKey, 'rate_limit', `HTTP ${response.status}`);
      throw new AdapterRateLimitError('kucoin', response.status);
    }

    if (response.status === 400 || response.status === 404) {
      this.health?.recordFailure('kucoin', endpointKey, 'invalid_symbol', `HTTP ${response.status}`);
      throw new SymbolNotFoundError('kucoin', path);
    }

    if (!response.ok) {
      this.health?.recordFailure('kucoin', endpointKey, 'http', `HTTP ${response.status}`);
      throw new AdapterNetworkError('kucoin', new Error(`HTTP ${response.status}: ${response.statusText}`));
    }

    this.health?.recordSuccess(endpointKey);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new AdapterValidationError('kucoin', 'Invalid JSON response');
    }

    try {
      return schema.parse(json);
    } catch (err: any) {
      throw new AdapterValidationError('kucoin', (err as any).errors ?? (err as any).message);
    }
  }

  public async fetch24hrStats(kucoinSymbol: string): Promise<KuCoinStats24hrData> {
    const upper = kucoinSymbol.toUpperCase().trim();
    const res = await this.request(
      `/api/v1/market/stats?symbol=${encodeURIComponent(upper)}`,
      KuCoinStatsResponseSchema
    );
    return res.data;
  }

  public async fetchAllTickers(): Promise<KuCoinTickerItem[]> {
    const res = await this.request(
      '/api/v1/market/allTickers',
      KuCoinAllTickersResponseSchema
    );
    return res.data.ticker;
  }

  public async fetchCandles(
    kucoinSymbol: string,
    type = '1hour'
  ): Promise<KuCoinCandleItem[]> {
    const upper = kucoinSymbol.toUpperCase().trim();
    const res = await this.request(
      `/api/v1/market/candles?symbol=${encodeURIComponent(upper)}&type=${encodeURIComponent(type)}`,
      KuCoinCandlesResponseSchema
    );
    return res.data as KuCoinCandleItem[];
  }
}
