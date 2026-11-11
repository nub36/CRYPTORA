/**
 * Контракт API продукта V3.4 (совпадает с server/src/presentation.ts и api.ts).
 *
 * Принцип: клиент НИЧЕГО не досчитывает. Отсутствующий уровень — null, и
 * подставлять вместо него другую цену запрещено. Все уровни, статусы и времена
 * событий приходят с сервера.
 */

export interface SignalTarget {
  level: number;
  price: number;
}

export interface SignalProgress {
  tp1Hit: boolean;
  tp1HitAt: string | null;
  tp2Hit: boolean;
  tp2HitAt: string | null;
  /** Стоп переведён в безубыток и ДЕЙСТВУЕТ (позиция открыта). */
  breakevenArmed: boolean;
  breakevenArmedAt: string | null;
  /** Безубыток БЫЛ — в том числе у закрытой сделки (это история, не уровень). */
  breakevenOccurred: boolean;
  breakevenOccurredAt: string | null;
  stopHit: boolean;
  stopHitAt: string | null;
  /** Действующий стоп: null, если сервер не может его доказать. */
  currentStop: number | null;
  currentStopBasis: 'BE_AT_ENTRY' | null;
}

export interface SignalOutcomeView {
  status: string;
  exitReason: string | null;
  exitPrice: number | null;
  resultR: number | null;
  netResultR: number | null;
  pnlResultPct: number | null;
  barsHeld: number | null;
}

export type SignalEventType =
  | 'NEW_SIGNAL' | 'FILL' | 'TP1' | 'TP2' | 'BREAKEVEN' | 'STOP_LOSS' | 'CLOSED' | 'CANCELLED';

export interface SignalEventView {
  type: SignalEventType;
  occurredAt: string | null;
}

export type SignalDirection = 'LONG' | 'SHORT';

export type SignalStatus =
  | 'ACTIVE' | 'FILLED' | 'TARGET_REACHED' | 'INVALIDATED'
  | 'CLOSED' | 'EXPIRED' | 'CANCELLED' | 'UNRESOLVED';

export interface SignalView {
  id: string;
  strategy: { id: string; version: string; name: string };
  symbol: string;
  exchangeSymbol: string;
  direction: SignalDirection;
  timeframe: string;
  setupAt: string;
  publishedAt: string;
  entryZone: { low: number; high: number } | null;
  entry: { price: number; at: string } | null;
  /** null = серверного стопа нет. НЕ равно цене входа. */
  initialStopLoss: number | null;
  targets: SignalTarget[];
  status: SignalStatus;
  statusAt: string | null;
  closedAt: string | null;
  outcome: SignalOutcomeView | null;
  progress: SignalProgress;
  events: SignalEventView[];
  dataSource: { exchange: string; isFallback: boolean } | null;
  stale: boolean;
  staleReason: string | null;
  asOf: string;
}

/** Свеча с сервера. Время — секунды Unix (начало бара). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Бар закрыт на момент ответа сервера. */
  closed: boolean;
}

/** Ответ GET /api/v1/candles. */
export interface CandlesResponse {
  symbol: string;
  exchangeSymbol: string;
  interval: '1h' | '4h';
  limit: number;
  count: number;
  candles: Candle[];
  source: { id: string; exchange: string; isFallback: boolean } | null;
  asOf: string;
  stale: boolean;
  staleReason: string | null;
}

/** Витринная пара из канонической конфигурации V3.4 (её задаёт сервер). */
export interface PairInfo {
  symbol: string;
  exchangeSymbol: string;
}

export interface SignalsListResponse {
  items: SignalView[];
  count: number;
  total: number;
  limit: number;
  nextCursor: string | null;
  asOf: string;
  stale: boolean;
  staleReason: string | null;
}

export interface MetaStrategyInfo {
  id: string;
  version: string;
  name: string;
  nameRu: string;
  liveVariant: string;
  badge: string;
  badgeLabel: string;
  researchNote: string;
  exitRule: string;
  qualityGates: { entryZoneAtrPad: number; tp1MinR: number; tp2MinR: number };
  entryZoneHalfWidthAtr: number;
  timeframes: { exec: string; context: string };
  warmupBars: number;
  candleLimits: { '1h': number; '4h': number };
  defaultScanIntervalSeconds: number;
  description: {
    short: string;
    entry: string;
    stop: string;
    targets: string;
    riskNote: string;
    limitations: string[];
  };
}

export interface MetaSymbolStatus {
  symbol: string;
  lastScanAt: string | null;
  lastSuccessAt: string | null;
  lastBarOpenTime: string | null;
  closedBars: { '1h': number; '4h': number };
  gaps1h: number;
  dataError: string | null;
  source: { exchange: string; isFallback: boolean } | null;
  notes: string[];
}

/** Ответ GET /api/v1/meta — форма 1:1 с server/src/api.ts. */
export interface MetaResponse {
  apiVersion: string;
  serverVersion: string;
  minAppVersion: string;
  serverTime: string;
  strategy: MetaStrategyInfo;
  universe: {
    symbols: string[];
    defaultSymbols: string[];
    quote: string;
    /** Пары для витрины: имя и биржевой символ — из конфигурации сервера. */
    pairs?: PairInfo[];
  };
  /** Ограничения эндпоинта свечей — тоже сообщает сервер. */
  candles?: {
    endpoint: string;
    intervals: string[];
    defaultLimit: number;
    minLimit: number;
    maxLimit: number;
    source: string;
    note: string;
  };
  marketData: {
    id: string;
    exchange: string;
    venue: string;
    baseUrl: string;
    readOnly: boolean;
    apiKeysRequired: boolean;
    orderPlacement: boolean;
    feeVenueAssumed: string;
    requestTimeoutMs: number;
  };
  engine: {
    scanIntervalMs: number;
    scanStaleAfterMs: number;
    maxBarAgeMs: number;
    dataStatus: 'fresh' | 'stale' | 'error' | 'unknown';
    staleReason: string | null;
    lastScanAt: string | null;
    lastSuccessfulScanAt: string | null;
    lastScan: {
      startedAt: string | null;
      finishedAt: string | null;
      status: string;
      symbolsTotal: number;
      symbolsOk: number;
      signalsNew: number;
      error: string | null;
    } | null;
    perSymbol: MetaSymbolStatus[];
  };
  push: {
    enabled: boolean;
    configured: boolean;
    missing: string[];
    reason: string | null;
    devices?: { enabled: number; total: number };
  };
  statuses: { all: string[]; open: string[]; closed: string[] };
  disclaimer: string;
}

export type DeviceRegistrationResponse = {
  ok: boolean;
  registered: boolean;
  pushConfigured: boolean;
  note: string | null;
};
