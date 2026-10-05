/** Декларации для server/services/health/marketDataFreshness.js. */

import type { HealthThresholds } from './healthThresholds.js';

export type FreshnessStatus = 'ok' | 'stale' | 'error' | 'unobserved';

export const FRESHNESS_CLASSES: Readonly<Record<string, string>>;

export interface MarketDataFeedDescriptor {
  exchange: string;
  market: string;
  kind: string;
  class: string;
  critical: boolean;
  label?: string;
}

export const MARKET_DATA_FEEDS: Readonly<Record<string, MarketDataFeedDescriptor>>;

export function sourceLagAllowanceSeconds(
  feedClass: string,
  thresholds: HealthThresholds,
): number;

export interface FreshnessInput {
  nowMs: number;
  sourceTimestampMs?: number | null;
  receivedAtMs?: number | null;
  staleAfterSeconds: number;
  errorAfterSeconds: number;
  sourceLagAllowanceSeconds?: number;
  intervalSeconds?: number;
  lastError?: string | null;
}

export interface FreshnessVerdict {
  status: FreshnessStatus;
  ageSeconds: number | null;
  sourceAgeSeconds: number | null;
  reason: string | null;
}

export function classifyFreshness(input: FreshnessInput): FreshnessVerdict;

/** Сводный статус по КРИТИЧЕСКИМ потокам (если такие наблюдались). */
export function aggregateFreshness(
  feeds: Record<string, { observed?: boolean; critical?: boolean; status?: FreshnessStatus }> | null | undefined,
): FreshnessStatus;
