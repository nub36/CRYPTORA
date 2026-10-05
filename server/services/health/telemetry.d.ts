/** Декларации для server/services/health/telemetry.js. */

/** Публичная форма снимка: времена в ISO, без сырых мс. */
export interface CycleSnapshot {
  name: string;
  startedAt: string | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastSuccessfulCycleAt: string | null;
  durationMs: number | null;
  cycles: number;
  inspected: number;
  updated: number;
  errors: number;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface CycleResult {
  ok?: boolean;
  inspected?: number;
  updated?: number;
  errors?: number;
  error?: unknown;
}

export declare class CycleTelemetry {
  constructor(name: string, now?: () => number);
  markStarted(): void;
  beginCycle(): void;
  completeCycle(result?: CycleResult): CycleSnapshot;
  snapshot(): CycleSnapshot;
}

export interface MarketDataObservation {
  feedId: string;
  exchange: string;
  market: string;
  kind: string;
  class: string;
  critical: boolean;
  observed: boolean;
  sourceTimestampMs: number | null;
  receivedAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  lastError: string | null;
  intervalSeconds: number;
  successes: number;
  failures: number;
}

export declare class HealthTelemetryRegistry {
  constructor(now?: () => number);
  processStartedAtMs: number;
  cycle(name: string): CycleTelemetry;
  recordMarketData(
    feedId: string,
    payload?: { sourceTimestampMs?: number | null; receivedAtMs?: number | null; intervalSeconds?: number },
  ): void;
  recordMarketDataFailure(feedId: string, error?: unknown): void;
  marketDataObservations(): Record<string, MarketDataObservation>;
  cycleSnapshots(): Record<string, CycleSnapshot>;
  uptimeSeconds(): number;
}

export function getHealthTelemetry(): HealthTelemetryRegistry;
export function __setHealthTelemetryForTests(registry: HealthTelemetryRegistry | null): void;

export const CYCLE_SIGNAL_MONITOR: 'signalMonitor';
export const CYCLE_RADAR_MONITOR: 'radarMonitor';
export const CYCLE_STRATEGY_SCHEDULER: 'strategyScheduler';
