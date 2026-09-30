export type GeometryDirection = 'LONG' | 'SHORT';

export type StructuralCode =
  | 'MISSING_LEVEL'
  | 'NON_FINITE_LEVEL'
  | 'ENTRY_ZONE_INVERTED'
  | 'STOP_ON_WRONG_SIDE'
  | 'TP1_ON_WRONG_SIDE'
  | 'TP2_ON_WRONG_SIDE'
  | 'TP_ORDER_INVERTED'
  | 'NON_POSITIVE_RISK'
  | 'UNKNOWN_DIRECTION';

export type QualityCode = 'TP1_VERY_CLOSE' | 'TP2_VERY_FAR' | 'WIDE_ENTRY_ZONE';

export const STRUCTURAL_CODES: readonly StructuralCode[];
export const QUALITY_CODES: readonly QualityCode[];
export const QUALITY_THRESHOLDS: Readonly<{
  tp1CloseR: number;
  tp2FarR: number;
  wideZoneRiskFrac: number;
}>;

export interface GeometryInput {
  id?: string | null;
  symbol?: string | null;
  direction?: string | null;
  timeframe?: string | null;
  strategyVersion?: string | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
}

export interface GeometryResult {
  id: string | null;
  symbol: string | null;
  direction: GeometryDirection | null;
  timeframe: string | null;
  strategyVersion: string | null;
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  entryMid: number | null;
  /** Дистанция до TP1 в % от середины зоны входа (по ходу сделки). */
  distPctTp1: number | null;
  /** Дистанция до TP2 в % от середины зоны входа. */
  distPctTp2: number | null;
  /** Дистанция до стопа в % от середины зоны входа. */
  distPctStop: number | null;
  zoneWidth: number | null;
  zoneWidthPct: number | null;
  zoneWidthInRisk: number | null;
  riskMid: number | null;
  riskNear: number | null;
  riskFar: number | null;
  reward1Mid: number | null;
  reward2Mid: number | null;
  r1Mid: number | null;
  r2Mid: number | null;
  r1Near: number | null;
  r2Near: number | null;
  r1Far: number | null;
  r2Far: number | null;
  missingLevels: string[];
  nonFiniteLevels: string[];
  structural: StructuralCode[];
  quality: QualityCode[];
  ok: boolean;
}

export interface Summary {
  count: number;
  min: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
  mean: number | null;
}

export interface ThresholdShares {
  n: number;
  below: Array<{ threshold: number; count: number; pct: number | null }>;
  atLeastOneR: { count: number; pct: number | null };
}

export interface BatchResult {
  total: number;
  structurallyValid: number;
  structurallyBroken: number;
  r1Mid: Summary;
  r2Mid: Summary;
  r1Far: Summary;
  r2Far: Summary;
  distPctTp1: Summary;
  distPctTp2: Summary;
  distPctStop: Summary;
  r1Shares: ThresholdShares;
  r2Shares: ThresholdShares;
  anomalyCounts: Record<string, number>;
  results: GeometryResult[];
}

export interface GroupStat {
  key: string;
  total: number;
  structurallyValid: number;
  r1: Summary;
  r2: Summary;
  distPctTp1: Summary;
  distPctTp2: Summary;
  distPctStop: Summary;
  r1Shares: ThresholdShares;
  r2Shares: ThresholdShares;
}

export interface OutcomeFlags {
  tp1: boolean | null;
  tp2: boolean | null;
  sl: boolean | null;
  trade: boolean | null;
  known: boolean;
}

export interface OutcomeSummary {
  total: number;
  open: number;
  entered: number;
  noTrade: number;
  resolvedTrades: number;
  unknownReason: number;
  byReason: Record<string, number>;
  byStatus: Record<string, number>;
  tp1Hits: number;
  tp2Hits: number;
  slHits: number;
  tp1HitRatePct: number | null;
  tp2HitRatePct: number | null;
  slRatePct: number | null;
}

export function percentile(sorted: readonly number[], p: number): number | null;
export function summarize(values: readonly number[]): Summary;
export function thresholdShares(values: readonly number[], thresholds?: readonly number[]): ThresholdShares;
export function analyzeSignalGeometry(input: GeometryInput): GeometryResult;
export function analyzeSignalBatch(rows: readonly GeometryInput[]): BatchResult;
export function groupStats(
  results: readonly GeometryResult[],
  keyOf: (r: GeometryResult) => string,
): GroupStat[];
export function classifyOutcome(closeReason: string | null | undefined): OutcomeFlags;
export function summarizeOutcomes(
  rows: readonly { status?: string | null; closeReason?: string | null }[],
): OutcomeSummary;
export function priceResolution(
  price: number,
  significantDigits?: number,
): { ok: boolean; significantDigits: number | null; reason: string | null };
