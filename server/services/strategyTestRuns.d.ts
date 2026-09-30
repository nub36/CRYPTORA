/** Декларации для strategyTestRuns.js — тесты импортируют модуль типизированно. */

export type StrategyTestRunStatus = 'ACTIVE' | 'COMPLETED';

export interface StrategyTestRun {
  id: string;
  strategyId: string;
  strategyVersion: string | null;
  startedAt: string | Date;
  endedAt: string | Date | null;
  status: StrategyTestRunStatus;
  createdBy: string | null;
  createdAt: string | Date | null;
  /** Число сигналов-членов (COUNT по signals.test_run_id, не по created_at). */
  signalCount: number;
}

export const TEST_RUN_STATUSES: readonly StrategyTestRunStatus[];

export function isTestRunIdShape(id: unknown): boolean;
export function assertKnownStrategyId(strategyId: string): void;
export function listStrategyTestRuns(p: { strategyId: string }): Promise<StrategyTestRun[]>;
export function getActiveStrategyTestRun(
  strategyId: string,
  opts?: { client?: { query: Function } }
): Promise<StrategyTestRun | null>;
export function startStrategyTestRun(p: {
  strategyId: string;
  actorUserId?: string | null;
}): Promise<{ run: StrategyTestRun; previousRunId: string | null }>;
