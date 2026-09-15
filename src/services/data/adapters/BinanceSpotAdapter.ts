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
} from './errors';

export interface BinanceAdapterConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BinanceSpotAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: BinanceAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.binance.com';
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
        throw new AdapterTimeoutError('binance');
      }
      throw new AdapterNetworkError('binance', err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 || response.status === 418) {
      throw new AdapterRateLimitError('binance', response.status);
    }

    if (response.status === 400 || response.status === 404) {
      throw new SymbolNotFoundError('binance', path);
    }

    if (!response.ok) {
      throw new AdapterNetworkError('binance', new Error(`HTTP ${response.status}: ${response.statusText}`));
    }

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
