/**
 * CRYPTORA — Клиент API стратегий и сигналов.
 *
 * Источник истины — PostgreSQL через серверный API. localStorage здесь не
 * используется ни для чтения, ни для записи: состояние переключателя должно
 * переживать F5 и рестарт VPS, а это даёт только БД.
 *
 * Все запросы — относительные URL (same-origin), с credentials для сессии.
 */

export type StrategyStatus = 'OFF' | 'ON' | 'ERROR';

export interface StrategyStateDto {
  strategyId: string;
  version: string;
  name: string;
  nameRu: string;
  timeframes: string[];
  badge: string;
  enabled: boolean;
  status: StrategyStatus;
  scanIntervalSeconds: number;
  symbols: string[] | null;
  lastScanAt: string | null;
  lastSignalAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  activeSignalCount: number;
}

export interface SignalDto {
  id: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  signalCandleTs: string;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  status: 'ACTIVE' | 'INVALIDATED' | 'TARGET_REACHED' | 'EXPIRED';
  createdAt: string;
  closedAt: string | null;
  closePrice: number | null;
  closeReason: string | null;
  metadata: {
    riskRewardRatio?: number | null;
    confirmingFactors?: string[];
    invalidationFactors?: string[];
  } | null;
  hash: string;
  previousHash: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new ApiError(b?.message ?? b?.error ?? `HTTP ${res.status}`, res.status, b?.error);
  }
  return body as T;
}

/** Состояние трёх продуктовых стратегий. Публичный endpoint. */
export async function fetchStrategies(): Promise<StrategyStateDto[]> {
  const res = await request<{ strategies: StrategyStateDto[]; source: string }>('/api/strategies');
  return res.strategies;
}

/**
 * Переключить стратегию. Только для администратора: сервер проверяет
 * requireAdmin, роль из AuthContext защитой не является.
 */
export async function setStrategyEnabled(
  strategyId: string,
  enabled: boolean
): Promise<{ strategyId: string; enabled: boolean }> {
  return request(`/api/admin/strategies/${encodeURIComponent(strategyId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export interface SignalFilters {
  strategy?: string;
  status?: string;
  symbol?: string;
  limit?: number;
}

/** Сигналы серверного движка. */
export async function fetchSignals(filters: SignalFilters = {}): Promise<SignalDto[]> {
  const params = new URLSearchParams();
  if (filters.strategy) params.set('strategy', filters.strategy);
  if (filters.status) params.set('status', filters.status);
  if (filters.symbol) params.set('symbol', filters.symbol);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  const res = await request<{ signals: SignalDto[]; count: number }>(
    `/api/signals${qs ? `?${qs}` : ''}`
  );
  return res.signals;
}
