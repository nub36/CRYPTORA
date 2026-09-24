/**
 * Декларации для server/services/strategyEngine/strategyScheduler.js.
 *
 * Расписанием владеет планировщик, а не ядро: `StrategyScheduler` перечитывает
 * `strategy_settings` КАЖДЫЙ цикл (переключение ВКЛ/ВЫКЛ действует без
 * перезапуска), держит замок «один скан на стратегию» и пишет телеметрию
 * (`last_scan_at`, `last_error`) через репозиторий настроек.
 */

/** Строка `strategy_settings` в camelCase (форма `mapRow`). */
export interface StrategySettingsRow {
  strategyId: string;
  enabled: boolean;
  scanIntervalSeconds: number | null;
  /** Явное переопределение универсума; null — общая Scan Universe. */
  symbols: string[] | null;
  lastScanAt: string | null;
  lastSignalAt: string | null;
  lastError: string | null;
}

/**
 * Какие символы сканирует стратегия: `strategy_settings.symbols` (если заданы)
 * ∩ активный Spot-universe, иначе эффективная server-side Scan Universe.
 * Бросает ошибку, если exchangeInfo недоступен: «нет данных» не должно
 * выглядеть как «нет сетапов».
 */
export declare function resolveScanSymbols(row: {
  symbols: string[] | null;
}): Promise<string[]>;

/** Шаг основного цикла; конкретный интервал берётся из strategy_settings. */
export declare const TICK_MS: number;

/** Что планировщик отдаёт наружу для диагностики. */
export interface SchedulerStats {
  running: boolean;
  cycles: number;
  /** Стратегии, скан которых выполняется прямо сейчас. */
  inFlight: string[];
  /** Последние ошибки цикла (не более 10). */
  errors: Array<{ at: string; message: string }>;
}

export interface TickResult {
  considered: number;
  /** Стратегии, скан которых ЗАПУЩЕН в этом цикле. */
  launched: string[];
  skippedDisabled: number;
  /** Не подошёл срок (интервал) или скан уже выполняется. */
  skippedNotDue: string[];
}

export interface ScanInvocation {
  strategyId: string;
  /** null — универсум из каталога/кода. */
  symbols: string[] | null;
}

export interface StrategySchedulerOptions {
  tickMs?: number;
  /** Инъекция для тестов: по умолчанию `getEnabledStrategies()` из PostgreSQL. */
  getEnabled?: () => Promise<StrategySettingsRow[]>;
  /** Инъекция для тестов: по умолчанию `scanStrategySafely()` (настоящее ядро). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scan?: (params: ScanInvocation) => Promise<any>;
  /** Инъекция для тестов: управляемые часы. */
  now?: () => number;
  /**
   * Инъекция для тестов. Без явной инъекции и без своего `scan` используется
   * `resolveScanSymbols`; со своим `scan` — null (символы из строки настроек).
   */
  resolveSymbols?: ((row: StrategySettingsRow) => Promise<string[]>) | null;
}

export declare class StrategyScheduler {
  constructor(opts?: StrategySchedulerOptions);

  tickMs: number;
  getEnabledFn: () => Promise<StrategySettingsRow[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scanFn: (params: ScanInvocation) => Promise<any>;
  nowFn: () => number;
  resolveSymbolsFn: ((row: StrategySettingsRow) => Promise<string[]>) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inFlight: Map<string, Promise<any>>;
  lastRunAt: Map<string, number>;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  cycles: number;
  errors: Array<{ at: string; message: string }>;

  isRunning(): boolean;
  /** Видно ли прямо сейчас параллельное выполнение конкретной стратегии. */
  isInFlight(strategyId: string): boolean;
  readonly stats: SchedulerStats;

  /** Поднимает setInterval и сразу выполняет первый цикл. */
  start(): void;
  /** Снимает таймер и дожидается текущих сканов (запись сигнала не обрывается). */
  stop(): Promise<void>;
  /** Один цикл. Не возвращает промисы сканов — их завершение видно в `stats.inFlight`. */
  tick(): Promise<TickResult>;
  recordError(e: unknown): void;
}

/** Синглтон, которым владеет server/index.js (и админ-статус). */
export declare function getStrategyScheduler(): StrategyScheduler;

/** Сбрасывает синглтон — только для тестов. */
export declare function resetStrategyScheduler(): void;

/** Диагностика для `GET /api/admin/strategies/status`. */
export declare function schedulerStatus(): SchedulerStats;
