/**
 * HTTP-клиент нового backend'а V3.4.
 *
 * Требования:
 *   • никаких вычислений стратегии на телефоне — только запросы и проверка
 *     формы ответа;
 *   • таймаут и отмена, чтобы экран не «висел вечно»;
 *   • ошибки типизированы (network / timeout / http / parse), чтобы UI мог
 *     показать именно то, что произошло;
 *   • устаревшие данные не маскируются: `stale` и `staleReason` передаются как
 *     есть.
 */
import type {
  Candle, CandlesResponse, DeviceRegistrationResponse, MetaResponse, SignalView, SignalsListResponse,
} from './types';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'config';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export interface ListParams {
  limit?: number;
  status?: string[];
  direction?: 'LONG' | 'SHORT';
  symbol?: string;
  cursor?: string | null;
}

export interface CandleParams {
  symbol: string;
  interval?: '1h' | '4h';
  limit?: number;
}

export interface ApiClient {
  readonly baseUrl: string;
  getSignals(params?: ListParams): Promise<SignalsListResponse>;
  getSignal(id: string): Promise<SignalView>;
  getMeta(): Promise<MetaResponse>;
  getCandles(params: CandleParams): Promise<CandlesResponse>;
  registerDevice(token: string, platform?: 'android' | 'ios'): Promise<DeviceRegistrationResponse>;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Минимальная проверка формы: приложение не должно падать на мусорном ответе. */
function assertSignalsList(value: unknown): SignalsListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new ApiError('parse', 'ответ сервера не похож на список сигналов');
  }
  return value as unknown as SignalsListResponse;
}

/**
 * Свечи проверяются по форме, но НЕ пересчитываются: график рисует то, что
 * прислал сервер. Нечисловой/перевёрнутый бар — это ошибка ответа, а не повод
 * «поправить» его на телефоне.
 */
function assertCandles(value: unknown): CandlesResponse {
  if (!isRecord(value) || !Array.isArray(value.candles)) {
    throw new ApiError('parse', 'ответ сервера не содержит свечи');
  }
  const candles = value.candles as unknown[];
  for (const raw of candles) {
    if (!isRecord(raw)) throw new ApiError('parse', 'свеча в ответе сервера имеет неверную форму');
    const { time, open, high, low, close, volume } = raw as Record<string, unknown>;
    if (![time, open, high, low, close, volume].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new ApiError('parse', 'свеча в ответе сервера содержит нечисловые значения');
    }
    if ((high as number) < (low as number)) {
      throw new ApiError('parse', 'свеча в ответе сервера имеет high < low');
    }
  }
  return { ...(value as unknown as CandlesResponse), candles: candles as Candle[] };
}

function assertSignal(value: unknown): SignalView {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.direction !== 'string') {
    throw new ApiError('parse', 'ответ сервера не похож на сигнал');
  }
  return value as unknown as SignalView;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = trimBase(options.baseUrl ?? '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    // Без корректного адреса приложение обязано честно сказать, что не
    // настроено, а не показывать пустой список.
    throw new ApiError('config', `некорректный адрес backend: «${options.baseUrl}»`);
  }
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;

  async function request<T>(path: string, init?: RequestInit, parse?: (v: unknown) => T): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ApiError('timeout', 'сервер не ответил вовремя');
      }
      throw new ApiError('network', 'нет связи с сервером сигналов');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { message?: string };
        detail = body?.message ?? '';
      } catch {
        detail = '';
      }
      throw new ApiError('http', detail || `сервер вернул HTTP ${response.status}`, response.status);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ApiError('parse', 'сервер вернул не JSON');
    }
    return parse ? parse(json) : (json as T);
  }

  return {
    baseUrl,
    async getSignals(params: ListParams = {}): Promise<SignalsListResponse> {
      const qs = new URLSearchParams();
      qs.set('limit', String(params.limit ?? 50));
      if (params.status && params.status.length > 0) qs.set('status', params.status.join(','));
      if (params.direction) qs.set('direction', params.direction);
      if (params.symbol) qs.set('symbol', params.symbol);
      if (params.cursor) qs.set('cursor', params.cursor);
      return request(`/api/v1/signals?${qs.toString()}`, undefined, assertSignalsList);
    },
    async getSignal(id: string): Promise<SignalView> {
      const body = await request<{ signal: unknown }>(`/api/v1/signals/${encodeURIComponent(id)}`);
      if (!isRecord(body) || !('signal' in body)) throw new ApiError('parse', 'ответ сервера не содержит сигнал');
      return assertSignal(body.signal);
    },
    async getMeta(): Promise<MetaResponse> {
      return request<MetaResponse>('/api/v1/meta', undefined, (v) => {
        if (!isRecord(v) || !isRecord(v.strategy)) throw new ApiError('parse', 'ответ сервера не содержит описание стратегии');
        return v as unknown as MetaResponse;
      });
    },
    async getCandles(params: CandleParams): Promise<CandlesResponse> {
      const qs = new URLSearchParams();
      qs.set('symbol', params.symbol);
      qs.set('interval', params.interval ?? '1h');
      if (params.limit !== undefined) qs.set('limit', String(params.limit));
      return request(`/api/v1/candles?${qs.toString()}`, undefined, assertCandles);
    },
    async registerDevice(token: string, platform: 'android' | 'ios' = 'android'): Promise<DeviceRegistrationResponse> {
      return request<DeviceRegistrationResponse>('/api/v1/devices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, platform }),
      });
    },
  };
}
