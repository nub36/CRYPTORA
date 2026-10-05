/**
 * Декларации для server/services/signalInvariants.js.
 *
 * Инварианты публикации сигнала. Разделены на два уровня: HARD_INVARIANTS
 * проверяются на границе записи (нарушение невозможно легитимно), полный
 * набор — на границе скана, где решается, публиковать ли сетап.
 */

export type SignalInvariantCode =
  | 'DEMO_PROVIDER'
  | 'FUTURE_CANDLE'
  | 'STALE_CANDLE'
  | 'MISSING_PROVENANCE'
  | 'FILL_BEFORE_SETUP'
  | 'CLOSE_BEFORE_SETUP'
  | 'CLOSE_BEFORE_FILL'
  | 'LIFECYCLE_REGRESSION';

export const SIGNAL_INVARIANTS: Readonly<Record<SignalInvariantCode, SignalInvariantCode>>;
export const MAX_SETUP_AGE_BARS: number;
export const CLOCK_SKEW_TOLERANCE_MS: number;
export const HARD_INVARIANTS: readonly SignalInvariantCode[];

/** 0 — длительность неизвестна: проверка возраста пропускается. */
export function timeframeDurationMs(timeframe: string | null | undefined): number;

export const LIFECYCLE_RANK: Readonly<Record<string, number>>;
export function isMonotonicTransition(fromStatus: string, toStatus: string): boolean;

export interface InvariantViolation {
  code: SignalInvariantCode;
  detail: string;
}

export function validateNewSignal(
  signal: Record<string, unknown>,
  ctx?: {
    nowMs?: number;
    providerIsDemo?: boolean;
    maxSetupAgeBars?: number;
    only?: readonly SignalInvariantCode[];
  },
): { ok: boolean; violations: InvariantViolation[] };

export function validateLifecycleTimestamps(
  row: Record<string, unknown>,
): { ok: boolean; violations: InvariantViolation[] };

export function provenanceCompleteness(
  row: Record<string, unknown>,
): { complete: boolean; missing: string[] };
