/** Декларации для server/services/health/healthThresholds.js. */

export interface HealthThresholds {
  databaseTimeoutMs: number;
  databaseSlowMs: number;
  marketDataStaleSeconds: number;
  marketDataErrorSeconds: number;
  candleSourceLagSeconds: number;
  tickerSourceLagSeconds: number;
  derivativesSourceLagSeconds: number;
  signalMonitorStaleSeconds: number;
  signalMonitorErrorSeconds: number;
  signalMonitorMaxConsecutiveFailures: number;
  radarMonitorStaleSeconds: number;
  radarMonitorErrorSeconds: number;
  strategySchedulerStaleSeconds: number;
  strategySchedulerErrorSeconds: number;
  alertCooldownSeconds: number;
  alertMinConsecutiveObservations: number;
  startupGraceSeconds: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: Readonly<HealthThresholds>;
export const HEALTH_ENV_KEYS: Readonly<Record<keyof HealthThresholds, string>>;

/** Чистый разбор окружения: некорректное значение игнорируется с логом. */
export function resolveHealthThresholds(
  env?: Record<string, string | undefined>,
  log?: (entry: Record<string, unknown>) => void,
): HealthThresholds;

export function getHealthThresholds(): HealthThresholds;
export function __setHealthThresholdsForTests(value: Partial<HealthThresholds> | null): void;
