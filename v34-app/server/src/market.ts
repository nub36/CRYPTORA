/**
 * Рыночные данные: ТОЛЬКО публичные read-only эндпоинты Binance Spot.
 *
 * Источник определён самой стратегией (CRYPTORA: `BINANCE_SPOT_KLINES`,
 * `https://api.binance.com/api/v3/klines`) — V3.4 наследует его без изменений.
 *
 * Требования, которые закрыты здесь:
 *   • никаких ключей, подписей и приватных методов: только GET /api/v3/klines;
 *   • жёсткая валидация ответа (форма строки, OHLC, объём, монотонность,
 *     ожидаемый шаг) — «мусор» биржи не должен стать сигналом;
 *   • таймаут и один повтор на сетевых/5xx ошибках; 4xx не повторяем;
 *   • ошибка всегда формулируется кодом, а не превращается в пустой массив:
 *     пустой массив означал бы «сетапов нет» вместо «нет данных».
 */
import type { OHLCV } from '@v34/core';
import { validateKlinesRow, describeIssues } from '@v34/core';
import { MARKET_DATA_SOURCE } from '@v34/core';

export type MarketInterval = '1h' | '4h';

export interface MarketDataErrorShape {
  code: 'HTTP' | 'TIMEOUT' | 'NETWORK' | 'BAD_JSON' | 'BAD_ROW' | 'EMPTY' | 'ORDER' | 'INTERVAL';
  message: string;
  status?: number;
}

export class MarketDataError extends Error {
  readonly code: MarketDataErrorShape['code'];
  readonly detail: MarketDataErrorShape;
  constructor(detail: MarketDataErrorShape) {
    super(`${detail.code}: ${detail.message}`);
    this.name = 'MarketDataError';
    this.code = detail.code;
    this.detail = detail;
  }
}

export interface CandleProvider {
  readonly id: string;
  getKlines(symbol: string, interval: MarketInterval, limit: number): Promise<OHLCV[]>;
}

export const INTERVAL_MS: Readonly<Record<MarketInterval, number>> = Object.freeze({
  '1h': 3_600_000,
  '4h': 14_400_000,
});

export interface BinanceProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Внедряемая реализация fetch (тесты). */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class BinancePublicProvider implements CandleProvider {
  readonly id = MARKET_DATA_SOURCE.id;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(opts: BinanceProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? MARKET_DATA_SOURCE.baseUrl;
    this.timeoutMs = opts.timeoutMs ?? MARKET_DATA_SOURCE.requestTimeoutMs;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
  }

  async getKlines(symbol: string, interval: MarketInterval, limit: number): Promise<OHLCV[]> {
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) throw new MarketDataError({ code: 'HTTP', message: `недопустимый символ ${symbol}` });
    const max = MARKET_DATA_SOURCE.maxKlinesPerRequest;
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      throw new MarketDataError({ code: 'HTTP', message: `limit ${limit} вне диапазона 1..${max}` });
    }
    const url = `${this.baseUrl}${MARKET_DATA_SOURCE.klinesPath}?symbol=${encodeURIComponent(symbol)}`
      + `&interval=${interval}&limit=${limit}`;

    const rows = await this.requestWithRetry(url);
    if (!Array.isArray(rows)) throw new MarketDataError({ code: 'BAD_JSON', message: 'ответ биржи не является массивом' });
    if (rows.length === 0) throw new MarketDataError({ code: 'EMPTY', message: `биржа вернула пустую серию ${symbol} ${interval}` });

    const out: OHLCV[] = [];
    for (let i = 0; i < rows.length; i++) {
      const issues = validateKlinesRow(rows[i]);
      if (issues.length > 0) {
        throw new MarketDataError({
          code: 'BAD_ROW',
          message: `строка ${i} ${symbol} ${interval}: ${describeIssues(issues)}`,
        });
      }
      const r = rows[i] as [number, string, string, string, string, string];
      out.push({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        provenance: { exchange: 'Binance', isFallback: false },
      });
    }

    // Монотонность и шаг: серия должна быть непрерывной по времени.
    const step = INTERVAL_MS[interval];
    for (let i = 1; i < out.length; i++) {
      const dt = (out[i]!.time - out[i - 1]!.time) * 1000;
      if (dt <= 0) {
        throw new MarketDataError({ code: 'ORDER', message: `время свечей не возрастает (${symbol} ${interval}, индекс ${i})` });
      }
      if (dt !== step) {
        throw new MarketDataError({
          code: 'INTERVAL',
          message: `шаг ${dt} мс вместо ${step} мс (${symbol} ${interval}, индекс ${i})`,
        });
      }
    }
    const lastOpenMs = out[out.length - 1]!.time * 1000;
    if (lastOpenMs > this.now()) {
      throw new MarketDataError({ code: 'ORDER', message: `последняя свеча начинается в будущем (${symbol} ${interval})` });
    }
    return out;
  }

  private async requestWithRetry(url: string): Promise<unknown> {
    let lastError: MarketDataError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.request(url);
      } catch (e) {
        lastError = e instanceof MarketDataError ? e : new MarketDataError({ code: 'NETWORK', message: String(e) });
        const retriable = lastError.code === 'TIMEOUT' || lastError.code === 'NETWORK'
          || (lastError.code === 'HTTP' && (lastError.detail.status ?? 0) >= 500);
        if (!retriable || attempt === 1) break;
      }
    }
    throw lastError ?? new MarketDataError({ code: 'NETWORK', message: 'неизвестная ошибка запроса' });
  }

  private async request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'cryptora-v34-product/0.1 (+public market data)' },
      });
      if (!res.ok) {
        throw new MarketDataError({ code: 'HTTP', message: `HTTP ${res.status} от биржи`, status: res.status });
      }
      try {
        return await res.json();
      } catch (e) {
        throw new MarketDataError({ code: 'BAD_JSON', message: `невалидный JSON: ${String(e)}` });
      }
    } catch (e) {
      if (e instanceof MarketDataError) throw e;
      if (e instanceof Error && e.name === 'AbortError') {
        throw new MarketDataError({ code: 'TIMEOUT', message: `запрос не уложился в ${this.timeoutMs} мс` });
      }
      throw new MarketDataError({ code: 'NETWORK', message: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
    }
  }
}
