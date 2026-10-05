/** Декларации для server/services/health/healthAlerts.js. */

import type { HealthThresholds } from './healthThresholds.js';

export type HealthAlertCode =
  | 'DATABASE_DOWN'
  | 'MARKET_DATA_STALE'
  | 'SIGNAL_MONITOR_STALE'
  | 'RADAR_MONITOR_STALE'
  | 'STRATEGY_SCHEDULER_STALE';

export const HEALTH_ALERT_CODES: readonly HealthAlertCode[];

export interface HealthProblem {
  code: HealthAlertCode;
  detail: string;
  ageSeconds: number | null;
}

export function formatAge(seconds: number | null | undefined): string;
export function detectHealthProblems(report: { body?: Record<string, any> } | Record<string, any>): HealthProblem[];
export function formatAlertText(problem: HealthProblem): string;
export function formatRecoveryText(code: string, downForSeconds?: number | null): string;

export declare class HealthAlerter {
  constructor(options?: {
    now?: () => number;
    send?: (text: string, code: string) => unknown;
    thresholds?: Partial<HealthThresholds>;
    log?: (entry: Record<string, unknown>) => void;
  });
  evaluate(report: unknown): Promise<{ sent: string[]; suppressed: string[]; recovered: string[] }>;
  deliver(text: string, code: string): Promise<boolean>;
}

export function listHealthAlertRecipients(): Promise<Array<string | number>>;
export function dispatchHealthTelegram(text: string, code: string): Promise<{ ok: boolean }>;
export function getHealthAlerter(): HealthAlerter;
export function resetHealthAlerter(): void;
