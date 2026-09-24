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
  /** ВСЕ серии, которые стратегия реально использует (исполнение + контекст). */
  timeframes: string[];
  /**
   * Таймфрейм ИСПОЛНЕНИЯ: бар, на котором стратегия принимает решение и
   * публикует сетап. У всех трёх продуктовых стратегий это '1h' — значение
   * приходит с сервера из каталога и сверено с `EXEC_TIMEFRAME` ядра.
   * Показывать `timeframes[0]` или «15m» как активную характеристику нельзя:
   * 15m — параметр исторического исследования V2.8, а не LIVE-исполнения.
   */
  execTimeframe: string;
  /** Старшие серии контекста (структура/зоны), отдельно от исполнения. */
  contextTimeframes: string[];
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

/**
 * Домен состояний сигнала (миграция 009 = `SetupStatus` ядра).
 *
 * Разделение сознательное и повторяет ядро:
 *  • состояние сетапа:  ACTIVE (ожидает входа) → FILLED (в позиции);
 *  • исход со сделкой:  TARGET_REACHED | INVALIDATED | CLOSED;
 *  • исход без сделки:  EXPIRED | CANCELLED | UNRESOLVED.
 * Список приходит и в ответе API (`statuses`) — UI не должен выдумывать свой.
 */
export type SignalStatus =
  | 'ACTIVE'
  | 'FILLED'
  | 'TARGET_REACHED'
  | 'INVALIDATED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'UNRESOLVED';

/** Состояния, которые считаются открытыми (тот же смысл, что у ledger.getActiveSetups()). */
export const OPEN_SIGNAL_STATUSES: readonly SignalStatus[] = ['ACTIVE', 'FILLED'];

/** Состояния, у которых есть результат сделки в R. */
export const TRADE_CLOSED_SIGNAL_STATUSES: readonly SignalStatus[] = [
  'TARGET_REACHED',
  'INVALIDATED',
  'CLOSED',
];

/** Способ входа, который использует ядро (ReplayEntryType). */
export type SignalEntryType = 'LIMIT_CORRIDOR' | 'MARKET_NEXT_OPEN';

export interface SignalDto {
  id: string;
  strategyId: string;
  /** Версия стратегии на момент публикации (например '3.0'). */
  strategyVersion: string | null;
  /** Идентификатор сетапа в ядре — связь со journal'ом аудита. */
  engineSetupId: string | null;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  /** openTime закрытого бара сетапа (setupOpenTime ядра) — ключ дедупликации. */
  signalCandleTs: string;
  entryType: SignalEntryType | null;
  /** Срок действия лимитного коридора в барах (null = без ограничения). */
  validForBars: number | null;
  /** Правило выхода стратегии человеческим языком. */
  exitRule: string | null;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  /**
   * Полная лестница целей TP1..TPn, посчитанная стратегией. `tp1`/`tp2` —
   * первые два её элемента (сохранены для совместимости). Уровни берутся
   * ТОЛЬКО отсюда: досчитывать цели на клиенте запрещено.
   */
  targets: number[] | null;
  tp1: number | null;
  tp2: number | null;
  status: SignalStatus;
  createdAt: string;
  updatedAt: string;
  // ── Исполнение (факт входа, посчитанный ядром по закрытым свечам) ──
  fillPrice: number | null;
  filledAt: string | null;
  /** Эффективный стоп после исполнения (V2.8 сдвигает уровни на дельту входа). */
  fillStop: number | null;
  /** Эффективные цели после исполнения. */
  fillTargets: number[] | null;
  // ── Исход ──
  closedAt: string | null;
  closePrice: number | null;
  closeReason: string | null;
  /** Gross R исхода (без комиссий), посчитанный ядром. Формула не клиентская. */
  resultR: number | null;
  /** Net R по модели комиссий 2/5 bps. */
  netResultR: number | null;
  pnlResultPct: number | null;
  barsHeld: number | null;
  metadata: {
    engineVersion?: string | null;
    riskRewardRatio?: number | null;
    confirmingFactors?: string[];
    invalidationFactors?: string[];
    latencyBars?: number | null;
    publishedAt?: string | null;
  } | null;
  // ── Целостность ──
  hash: string;
  previousHash: string;
  /** Хэш изменяемой части (исполнение + исход). Публикация при этом неизменяема. */
  outcomeHash: string | null;
  /** 1 = строка формы миграции 007, 2 = форма 009. */
  chainVersion: number;
}

/** Конверт `GET /api/signals`: лента ограничена, порядок и фильтры явны. */
export interface SignalsPageDto {
  signals: SignalDto[];
  /** Сколько строк в этой странице. */
  count: number;
  /** Сколько всего строк под фильтром — для честной пагинации. */
  total: number;
  limit: number;
  offset: number;
  maxLimit: number;
  ordering: 'created_at_desc';
  appliedFilters: {
    strategyId: string | null;
    status: SignalStatus | null;
    open: boolean | null;
    symbol: string | null;
    direction: 'LONG' | 'SHORT' | null;
  };
  statuses: SignalStatus[];
  openStatuses: SignalStatus[];
  source: 'server';
}

/**
 * Состояние серверного монитора открытых сигналов (`GET /api/signals/monitor`).
 *
 * Нужен UI, чтобы отличить «сигналы отслеживаются» от «монитор не работает»
 * и «рыночные данные недоступны». Эндпоинт только читает.
 */
export interface SignalMonitorStateDto {
  running: boolean;
  cycles: number;
  inFlight: boolean;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastTickDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Рынок не отдал данных несколько тиков подряд — наблюдение отложено. */
  stale: boolean;
  lastSummary: {
    openSignals: number;
    groups: number;
    candleRequests: number;
    checked: number;
    filled: number;
    resolved: number;
    unchanged: number;
    skipped: number;
    errors: number;
    outOfWindow: number;
    durationMs: number;
  } | null;
}

/**
 * Серверная статистика сигналов (`GET /api/signals/statistics`).
 *
 * КЛЮЧЕВОЕ ОТЛИЧИЕ ОТ БРАУЗЕРНОЙ СВОДКИ: источник — PostgreSQL, а не
 * localStorage одного браузера. «Опубликовано» и «совершилась сделка» —
 * разные счётчики, знаменатель win rate — только завершённые сделки.
 */
export interface SignalStatisticsAggregateDto {
  published: number;
  waitingEntry: number;
  filled: number;
  completed: number;
  cancelled: number;
  expired: number;
  unresolved: number;
  targetReached: number;
  invalidated: number;
  closed: number;
  wins: number;
  losses: number;
  /** null — знаменатель ноль: «нет данных» ≠ 0 %. */
  winRatePct: number | null;
  avgGrossR: number | null;
  avgNetR: number | null;
  grossRSum: number | null;
  netRSum: number | null;
  fillRatePct: number | null;
  completionRatePct: number | null;
}

export interface SignalStatisticsDto {
  period: 'all' | '24h' | '7d' | '30d' | '90d';
  filters: { strategyId: string | null; symbol: string | null };
  statuses: SignalStatus[];
  openStatuses: SignalStatus[];
  tradeClosedStatuses: SignalStatus[];
  noTradeStatuses: SignalStatus[];
  closedStatuses: SignalStatus[];
  totals: SignalStatisticsAggregateDto;
  byStrategy: Array<SignalStatisticsAggregateDto & { strategyId: string }>;
  bySymbol: Array<SignalStatisticsAggregateDto & { symbol: string }>;
  definitions: Record<string, string>;
  source: 'server';
}

export interface SignalStatisticsFilters {
  strategyId?: string;
  symbol?: string;
  period?: SignalStatisticsDto['period'];
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

/**
 * Состояние трёх продуктовых стратегий. Публичный endpoint.
 *
 * `init` — опционально (Signals V2 передаёт `signal` AbortController'а: смена
 * выбранного инструмента отменяет устаревший запрос, а не игнорирует его).
 */
/** Состояние серверного монитора открытых сигналов. Только чтение. */
export async function fetchSignalMonitorState(init?: RequestInit): Promise<SignalMonitorStateDto> {
  return request<SignalMonitorStateDto>('/api/signals/monitor', init);
}

/**
 * Серверная статистика по сохранённому жизненному циклу сигналов.
 *
 * Считается в SQL на сервере; клиент НЕ агрегирует ленту и не пересчитывает R.
 */
export async function fetchSignalStatistics(
  filters: SignalStatisticsFilters = {},
  init?: RequestInit
): Promise<SignalStatisticsDto> {
  const params = new URLSearchParams();
  if (filters.strategyId) params.set('strategyId', filters.strategyId);
  if (filters.symbol) params.set('symbol', filters.symbol);
  if (filters.period) params.set('period', filters.period);
  const qs = params.toString();
  return request<SignalStatisticsDto>(`/api/signals/statistics${qs ? `?${qs}` : ''}`, init);
}

export async function fetchStrategies(init?: RequestInit): Promise<StrategyStateDto[]> {
  const res = await request<{ strategies: StrategyStateDto[]; source: string }>('/api/strategies', init);
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
  status?: SignalStatus;
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  /** true = ACTIVE+FILLED, false = терминальные состояния. */
  open?: boolean;
  limit?: number;
  offset?: number;
}

function signalsQuery(filters: SignalFilters): string {
  const params = new URLSearchParams();
  if (filters.strategy) params.set('strategy', filters.strategy);
  if (filters.status) params.set('status', filters.status);
  if (filters.symbol) params.set('symbol', filters.symbol);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.open !== undefined) params.set('open', String(filters.open));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Сигналы серверного движка (только лента). */
export async function fetchSignals(filters: SignalFilters = {}, init?: RequestInit): Promise<SignalDto[]> {
  const res = await request<SignalsPageDto>(`/api/signals${signalsQuery(filters)}`, init);
  return res.signals;
}

/**
 * Лента целиком с пагинацией и доменом состояний — то, что нужно Signals UI:
 * `total` для постраничной навигации, `statuses` — вместо хардкода состояний
 * на клиенте.
 */
export async function fetchSignalsPage(
  filters: SignalFilters = {},
  init?: RequestInit
): Promise<SignalsPageDto> {
  return request<SignalsPageDto>(`/api/signals${signalsQuery(filters)}`, init);
}

/**
 * Отличить отмену запроса (AbortController) от настоящей ошибки источника.
 * Отменённый ответ НЕЛЬЗЯ показывать пользователю как ошибку: его просто не
 * существует — гонку выиграл более поздний запрос (см. useServerSignals).
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: string }).name === 'AbortError' ||
      (error as { code?: number }).code === 20 /* DOMException.ABORT_ERR */)
  );
}
