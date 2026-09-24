/**
 * Декларации для server/services/signalMonitor/signalTradeManager.js.
 *
 * Адаптер «строка PostgreSQL → опубликованный сетап» для frozen-функции
 * `trackPublishedSetup`. В этом файле НЕТ формул: уровни, R, статусы и
 * причины выхода приходят из ядра и не пересчитываются.
 */

/** Стратегии, которых ведёт frozen-функция `trackPublishedSetup`. */
export const TRACKED_STRATEGY_IDS: readonly string[];

/** Строка `signals` в форме mapRow() — то, что читает адаптер. */
export interface PublishedSetupRow {
  id: string;
  engineSetupId?: string | null;
  strategyId: string;
  strategyVersion?: string | null;
  symbol: string;
  timeframe: string;
  /** 'LONG' | 'SHORT'; адаптер только переносит значение. */
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

export type PublishedSetupResult =
  | { ok: true; // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: Record<string, any> }
  | { ok: false; reason: string };

/** Строка БД → сетап в форме, которую принимает frozen-функция. */
export declare function toPublishedSetup(row: PublishedSetupRow): PublishedSetupResult;

/** Результат frozen-функции → то, что умеет писать репозиторий. */
export declare function toLifecyclePatch(result: {
  kind: string;
  fill?: unknown;
  outcome?: unknown;
  reason?: string;
}): { fill: unknown; outcome: unknown };
