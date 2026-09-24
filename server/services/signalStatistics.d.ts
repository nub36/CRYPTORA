/**
 * Декларации для server/services/signalStatistics.js.
 *
 * Серверная статистика сигналов по СОХРАНЁННОМУ жизненному циклу. Отличия от
 * браузерной сводки принципиальны: источник — PostgreSQL, «опубликовано» и
 * «совершилась сделка» считаются раздельно, знаменатель win rate — только
 * завершённые сделки, R не пересчитывается (берётся как его посчитало ядро).
 */

export const STATISTICS_PERIODS: readonly ('all' | '24h' | '7d' | '30d' | '90d')[];

/** Граница окна периода (null = без ограничения). Чистая функция. */
export declare function periodStart(
  period: string,
  nowMs?: number,
): Date | null;

/** Строка агрегата SQL → форма отдачи. Чистая функция. */
export interface SignalAggregate {
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

export declare function mapAggregate(row: Record<string, unknown>): SignalAggregate;

export interface SignalStatistics {
  period: string;
  filters: { strategyId: string | null; symbol: string | null };
  statuses: readonly string[];
  openStatuses: readonly string[];
  tradeClosedStatuses: readonly string[];
  noTradeStatuses: readonly string[];
  closedStatuses: readonly string[];
  totals: SignalAggregate;
  byStrategy: Array<SignalAggregate & { strategyId: string }>;
  bySymbol: Array<SignalAggregate & { symbol: string }>;
  definitions: Record<string, string>;
  source: 'server';
}

export interface SignalStatisticsFilters {
  strategyId?: string;
  symbol?: string;
  period?: string;
  /** Инъекция времени (тесты). */
  nowMs?: number;
}

export declare function getSignalStatistics(
  filters?: SignalStatisticsFilters,
): Promise<SignalStatistics>;
