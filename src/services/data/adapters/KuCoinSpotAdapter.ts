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
} from './errors';

export interface KuCoinAdapterConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class KuCoinSpotAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: KuCoinAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.kucoin.com';
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
  }

  private async request<T>(path: string, schema: { parse: (val: unknown) => T }): Promise<T> {
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
        throw new AdapterTimeoutError('kucoin');
      }
      throw new AdapterNetworkError('kucoin', err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      throw new AdapterRateLimitError('kucoin', response.status);
    }

    if (response.status === 400 || response.status === 404) {
      throw new SymbolNotFoundError('kucoin', path);
    }

    if (!response.ok) {
      throw new AdapterNetworkError('kucoin', new Error(`HTTP ${response.status}: ${response.statusText}`));
    }

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

  /**
   * KuCoin `market/candles`: не более 1500 свечей на запрос, порядок — новейшие первыми.
   *
   * Без `startAt`/`endAt` биржа отдаёт собственную страницу по умолчанию, поэтому
   * глубина ответа не гарантирована и могла оказаться меньше запрошенной LIVE-движком.
   * Явное окно (Unix seconds) делает резервный источник детерминированным.
   */
  public async fetchCandles(
    kucoinSymbol: string,
    type = '1hour',
    window?: { startAtMs?: number; endAtMs?: number }
  ): Promise<KuCoinCandleItem[]> {
    const upper = kucoinSymbol.toUpperCase().trim();
    const params = new URLSearchParams({ symbol: upper, type });
    const startAtMs = window?.startAtMs;
    const endAtMs = window?.endAtMs;
    if (typeof startAtMs === 'number' && Number.isFinite(startAtMs)) {
      params.set('startAt', String(Math.floor(startAtMs / 1000)));
    }
    if (typeof endAtMs === 'number' && Number.isFinite(endAtMs)) {
      params.set('endAt', String(Math.floor(endAtMs / 1000)));
    }
    const res = await this.request(
      `/api/v1/market/candles?${params.toString()}`,
      KuCoinCandlesResponseSchema
    );
    return res.data as KuCoinCandleItem[];
  }
}
