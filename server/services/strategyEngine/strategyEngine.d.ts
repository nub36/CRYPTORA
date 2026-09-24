/**
 * Декларации для server/services/strategyEngine/strategyEngine.js.
 *
 * Движок не содержит математики стратегий: он загружает скомпилированное ядро
 * из `src/` и переносит то, что ядро посчитало, в PostgreSQL.
 */

import type { SignalRow, SignalStatus, SignalEntryType } from '../signalRepository.js';
import type { MarketDataFetcher } from './marketDataFetcher.js';

/** registry id стратегии ↔ ключ стратегии внутри LiveSignalEngine. */
export declare const ENGINE_STRATEGY_KEY: Readonly<Record<string, 'V3.0' | 'V3.3' | 'V2.8'>>;

/** Таймфрейм исполнения по стратегии (из каталога; все три — '1h'). */
export declare const EXEC_TIMEFRAME: Readonly<Record<string, string>>;

/** Сколько записей ретроспективы сопоставляется с БД за один скан. */
export declare const MAX_LIFECYCLE_SYNC_PER_SCAN: number;

/**
 * Универсум скана в биржевой форме + отдельно отброшенный мусор
 * (ничего не проглатывается молча).
 */
export declare function normalizeScanSymbols(requested: unknown): {
  symbols: string[];
  invalid: string[];
};

/** Строка signals в форме, которую принимает `insertSignal()`. */
export interface SignalInsertRecord {
  strategyId: string;
  strategyVersion: string | null;
  engineSetupId: string | null;
  /** Пара в форме БД/API: 'BTC/USDT'. */
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  /** openTime закрытого бара сетапа — стабильный ключ дедупликации. */
  signalCandleTs: Date;
  entryType: SignalEntryType | null;
  validForBars: number | null;
  exitRule: string | null;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  /** ВСЯ лестница целей; tp1/tp2 выводит репозиторий. */
  targets: number[] | null;
  status: SignalStatus;
  metadata: Record<string, unknown> | null;
}

/**
 * Чистое отображение сетапа ядра (`AnalyticalSetup`) в строку signals.
 *
 * `null` — у сетапа нет валидного `setupOpenTime`, сохранять его нельзя:
 * без ключа дедупликации рестарт процесса дал бы дубли.
 *
 * `record: null` при `provenanceMismatch` — сетап посчитала другая стратегия:
 * переименовывать его под `strategyId` вызывающего запрещено.
 */
export declare function buildSignalRecord(params: {
  setup: Record<string, unknown>;
  strategyId: string;
  fallbackVersion: string;
  engineKey: string;
  execTf: string;
}): {
  setupOpenTime: number;
  record: SignalInsertRecord | null;
  provenanceMismatch?: string;
} | null;

export interface ScanLifecycleSummary {
  synced: number;
  unchanged: number;
  notFound: number;
}

export interface ScanRuntimeSummary {
  /** Таймфрейм исполнения, на котором шёл скан (из ядра). */
  execTimeframe: string;
  /** Все загруженные серии (исполнение + контекст каталога). */
  timeframes: string[];
  scanCount: number | null;
  lastScanStartedAt: string | null;
  lastScanFinishedAt: string | null;
  lastScanDurationMs: number | null;
  lastError: string | null;
  /** Сколько баров реально оценил реплей (из ReplaySummary ядра). */
  evaluatedBars: number;
  providerIsDemo: boolean;
}

export interface StrategyScanResult {
  strategyId: string;
  /** Универсум в биржевой форме, по которому шёл скан. */
  symbols: string[];
  /** Отброшенные невалидные значения из strategy_settings.symbols. */
  invalidSymbols: string[];
  symbolsScanned: number;
  evaluated: boolean;
  setupsFound: number;
  inserted: number;
  duplicates: number;
  /** Сетапы без валидного ключа дедупликации: не сохранены, но видимы. */
  skippedNoKey: number;
  /**
   * Сетапы, которые посчитала ДРУГАЯ стратегия: не сохранены и не
   * переименованы (инвариант provenance). Ненулевое значение — ЧП: оно
   * означает, что скан читал чужой ledger ядра.
   */
  provenanceMismatch: number;
  /** Σ `unpublishable` из ReplaySummary (отклонённые геометрией). */
  rejected: number;
  lifecycle: ScanLifecycleSummary;
  scan: ScanRuntimeSummary;
  /** Реальный SELECT COUNT; null при persist=false (только тесты). */
  activeSignals: number | null;
}

export interface RunStrategyScanParams {
  strategyId: string;
  /** Переопределение из strategy_settings; null — defaultSymbols каталога. */
  symbols?: string[] | null;
  fetcher?: MarketDataFetcher;
  /** false только в тестах: ничего не пишется в БД. */
  persist?: boolean;
}

/**
 * Один проход скана. Бросает:
 *  • 404 `Unknown strategy` / 501 `No live adapter`;
 *  • `NO_SCANNABLE_SYMBOLS` — в универсуме нет ни одного валидного символа;
 *  • `MARKET_DATA_UNAVAILABLE` — рыночные данные недоступны (ДО вызова ядра,
 *    чтобы «нет данных» не выглядело как «нет сетапов»).
 */
export declare function runStrategyScan(
  params: RunStrategyScanParams
): Promise<StrategyScanResult>;

/**
 * То же, но ошибка фиксируется в `strategy_settings.last_error` и возвращается
 * как `{ ok: false }`: отказ одной стратегии не роняет планировщик и бэкенд.
 */
export declare function scanStrategySafely(
  params: RunStrategyScanParams
): Promise<
  | ({ ok: true } & StrategyScanResult)
  | { ok: false; strategyId: string; error: string }
>;

export type { SignalRow };
