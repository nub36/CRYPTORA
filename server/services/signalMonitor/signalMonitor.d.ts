/**
 * Декларации для server/services/signalMonitor/signalMonitor.js.
 *
 * Серверный монитор позиций: доводит ОПУБЛИКОВАННЫЕ сигналы до терминального
 * исхода без браузера. Ведение позиции — frozen-функция ядра
 * (`trackPublishedSetup`), здесь только оркестрация, группировка и бюджеты.
 */

/** Журнал наблюдения: почему строка изменилась или почему не изменилась. */
export type MonitorResult =
  | 'UNCHANGED'
  | 'FILLED'
  | 'RESOLVED'
  | 'SKIP'
  | 'ERROR'
  | 'OUT_OF_WINDOW';

export const MONITOR_RESULTS: readonly MonitorResult[];

/** Шаг основного цикла наблюдения. */
export const MONITOR_TICK_MS: number;
/** Сколько открытых сигналов обрабатывается за тик. */
export const MAX_MONITOR_OPEN_SIGNALS: number;
/** Сколько групп (символ × таймфрейм) запрашивается за тик. */
export const MAX_MONITOR_GROUPS: number;
/** Сколько групп грузятся параллельно. */
export const MAX_GROUP_CONCURRENCY: number;
/** Верхняя граница lookback — ровно окно ядра. */
export const MAX_LOOKBACK_BARS: number;
/** Запас баров после бара сетапа. */
export const LOOKBACK_MARGIN_BARS: number;
/** Таймаут одного запроса свечей. */
export const MONITOR_REQUEST_TIMEOUT_MS: number;
/** Сколько раз повторяется неудачный запрос группы за тик. */
export const MONITOR_GROUP_RETRIES: number;
/** База backoff между ретраями внутри тика. */
export const MONITOR_RETRY_BACKOFF_MS: number;
/** Столько тиков подряд без полученных свечей = «данные устарели». */
export const MONITOR_STALE_AFTER_FAILURES: number;

/** Строка `signals` в форме mapRow() — то, что читает монитор. */
export interface MonitorSignalRow {
  id: string;
  strategyId: string;
  strategyVersion?: string | null;
  symbol: string;
  timeframe: string;
  /** 'LONG' | 'SHORT' — но монитор не сужает тип: он только переносит значение. */
  direction: string;
  signalCandleTs: string | Date;
  entryType: string | null;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  targets: number[] | null;
  exitRule?: string | null;
  validForBars?: number | null;
  status: string;
  fillPrice?: number | null;
  filledAt?: string | Date | null;
  fillStop?: number | null;
  fillTargets?: number[] | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
  previousHash?: string | null;
  hash?: string | null;
}

export interface MonitorGroup {
  symbol: string;
  timeframe: string;
  exchangeSymbol: string | null;
  rows: MonitorSignalRow[];
}

/**
 * Группировка открытых сигналов по (символ, таймфрейм) — защита от веера.
 *
 * Тип строк намеренно свободный: это форма `mapRow()` из PostgreSQL, а монитор
 * читает из неё только перечисленные поля и не сужает домены (строки приходят
 * из БД, где CHECK-ограничения, а не TypeScript, держат домен).
 */
export function groupOpenSignals(rows: readonly any[]): {
  groups: MonitorGroup[];
  total: number;
};

/** Сколько баров запросить, чтобы покрыть самый старый сетап группы. */
export function computeLookbackBars(
  rows: readonly any[],
  nowMs: number,
  tfMs: number,
  maxBars?: number,
): number;

/** Свеча в форме, которую отдаёт биржа и `MarketDataFetcher`. */
export interface RawOhlcv {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Скомпилированное ядро стратегий — только то, что использует монитор. */
export interface StrategyCoreForMonitor {
  /**
   * Frozen-функция ведения опубликованного сетапа. Тип намеренно свободный:
   * это функция из `src/`, и её сигнатура — единственный источник правды.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackPublishedSetup: (entry: any, candles: readonly any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ohlcvArrayToArchive?: (candles: any[], tf: any, nowMs?: number) => any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ohlcvToArchive?: (candle: any, tf: any, nowMs?: number) => any;
  ARCHIVE_TF_MS?: Record<string, number>;
  CANDLE_LIMIT_1H?: number;
}

export interface MonitorTickSummary {
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
}

export interface MonitorStats {
  running: boolean;
  cycles: number;
  inFlight: boolean;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastTickDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Рынок не отдал данных несколько тиков подряд. */
  stale: boolean;
  lastSummary: MonitorTickSummary | null;
  errors: Array<{ at: string; message: string }>;
}

export interface SignalMonitorOptions {
  tickMs?: number;
  now?: () => number;
  /** Инъекция для тестов: по умолчанию `listOpenSignals()` из PostgreSQL. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listOpen?: (limit: number) => Promise<readonly any[]>;
  /** Инъекция для тестов: по умолчанию `syncSignalLifecycle()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sync?: (...args: any[]) => Promise<any>;
  /** Инъекция для тестов: по умолчанию общий `MarketDataFetcher`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCandles?: (exchangeSymbol: string, timeframe: string, limit: number) => Promise<any[]>;
  /** Журнал наблюдения: по умолчанию `recordSignalMonitorCheck()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordMonitor?: (id: string, patch: any) => Promise<unknown>;
  loadCore?: () => Promise<StrategyCoreForMonitor>;
  sleep?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
}

export declare class SignalMonitor {
  constructor(opts?: SignalMonitorOptions);

  tickMs: number;
  nowFn: () => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listOpenFn: (limit: number) => Promise<readonly any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  syncFn: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCandlesFn: ((exchangeSymbol: string, timeframe: string, limit: number) => Promise<any[]>) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordMonitorFn: (id: string, patch: any) => Promise<unknown>;
  loadCoreFn: () => Promise<StrategyCoreForMonitor>;
  sleepFn: (ms: number) => Promise<void>;
  requestTimeoutMs: number;

  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  cycles: number;
  lastError: string | null;
  consecutiveFailures: number;
  lastSummary: MonitorTickSummary | null;

  isRunning(): boolean;
  readonly stats: MonitorStats;

  /** Поднимает setInterval и сразу выполняет первый тик. */
  start(): void;
  /** Снимает таймер и дожидается текущего тика. */
  stop(): Promise<void>;
  /** Один тик наблюдения. */
  tick(): Promise<MonitorTickSummary>;
  recordError(e: unknown): void;
}

/** Синглтон, которым владеет server/index.js. */
export declare function getSignalMonitor(): SignalMonitor;

/** Сбрасывает синглтон — только для тестов. */
export declare function resetSignalMonitor(): void;

/** Диагностика для `GET /api/signals/monitor`. */
export declare function signalMonitorStatus(): MonitorStats;
