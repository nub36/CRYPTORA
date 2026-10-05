/** Декларации для server/services/health/healthService.js. */

import type { HealthThresholds } from './healthThresholds.js';
import type { CycleSnapshot, HealthTelemetryRegistry } from './telemetry.js';

export type HealthStatus = 'ok' | 'degraded' | 'error';
export type CycleStatus = 'ok' | 'starting' | 'stale' | 'error';
export type DatabaseErrorCode = 'TIMEOUT' | 'UNAVAILABLE' | null;

export interface DatabaseHealth {
  status: 'ok' | 'error';
  latencyMs: number | null;
  /** Категория, НЕ сообщение драйвера: оно содержит хост/порт/имя базы. */
  errorCode: DatabaseErrorCode;
}

export function checkDatabaseHealth(deps?: {
  pool?: unknown;
  timeoutMs?: number;
  now?: () => number;
}): Promise<DatabaseHealth>;

export type HealthReportBodyMarketData = {
  status: FreshnessLike;
  lastSuccessfulUpdate: string | null;
  ageSeconds: number | null;
  staleThresholdSeconds: number;
  feeds: Record<string, Record<string, unknown>>;
};
type FreshnessLike = 'ok' | 'stale' | 'error' | 'unobserved';

export function classifyCycle(
  snapshot: Partial<CycleSnapshot> | null | undefined,
  limits: { stale: number; error: number; maxConsecutiveFailures?: number },
  nowMs: number,
  processStartedAtMs: number,
  graceSeconds: number,
): Record<string, unknown> & { status: CycleStatus; ageSeconds: number | null; reason: string | null };

export function buildMarketDataSection(
  observations: Record<string, unknown>,
  thresholds: HealthThresholds,
  nowMs: number,
): Record<string, unknown>;

export interface HealthReport {
  httpStatus: number;
  body: {
    status: HealthStatus;
    timestamp: string;
    uptimeSeconds: number;
    version: string;
    environment: string;
    database: DatabaseHealth & { slowThresholdMs: number };
    marketData: HealthReportBodyMarketData;
    signalMonitor: Record<string, unknown>;
    radarMonitor: Record<string, unknown>;
    strategyScheduler: Record<string, unknown>;
    thresholds: Record<string, number>;
  };
}

export function buildHealthReport(deps?: {
  telemetry?: HealthTelemetryRegistry;
  thresholds?: HealthThresholds;
  now?: () => number;
  checkDatabase?: (opts?: { timeoutMs?: number; now?: () => number }) => Promise<Partial<DatabaseHealth>>;
}): Promise<HealthReport>;

export function buildReadinessReport(deps?: {
  telemetry?: HealthTelemetryRegistry;
  thresholds?: HealthThresholds;
  now?: () => number;
  requiredCycles?: readonly string[];
  checkDatabase?: (opts?: { timeoutMs?: number; now?: () => number }) => Promise<Partial<DatabaseHealth>>;
}): Promise<{
  httpStatus: number;
  body: {
    status: 'ready' | 'not_ready';
    timestamp: string;
    database: DatabaseHealth;
    subsystems: Record<string, { initialized: boolean; lastCycleAt: string | null }>;
  };
}>;
