/** Декларации для signalRepository.js (миграции 007 + 009). */

/**
 * Домен статуса — тот же, что у ядра (`SetupStatus`) и у CHECK-ограничения 009.
 *
 * A) состояние сетапа: ACTIVE (ожидает входа) → FILLED (в позиции).
 * B) исход: TARGET_REACHED | INVALIDATED | CLOSED (сделка была) либо
 *    EXPIRED | CANCELLED | UNRESOLVED (сделки не было / исход не определить).
 */
export type SignalStatus =
  | 'ACTIVE'
  | 'FILLED'
  | 'TARGET_REACHED'
  | 'INVALIDATED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'UNRESOLVED';

export type TerminalSignalStatus = Exclude<SignalStatus, 'ACTIVE' | 'FILLED'>;

export type SignalEntryType = 'LIMIT_CORRIDOR' | 'MARKET_NEXT_OPEN';

export interface SignalRow {
  id: string;
  strategyId: string;
  strategyVersion: string | null;
  engineSetupId: string | null;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  /** openTime закрытого бара сетапа (`setupOpenTime` ядра). */
  signalCandleTs: string | Date;
  entryType: SignalEntryType | null;
  validForBars: number | null;
  exitRule: string | null;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  /** Полная лестница целей TP1..TPn (канонический источник; tp1/tp2 производны). */
  targets: number[] | null;
  status: SignalStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
  fillPrice: number | null;
  filledAt: string | Date | null;
  /** Эффективный стоп после исполнения (V2.8 сдвигает уровни на дельту). */
  fillStop: number | null;
  fillTargets: number[] | null;
  closedAt: string | Date | null;
  closePrice: number | null;
  closeReason: string | null;
  resultR: number | null;
  netResultR: number | null;
  pnlResultPct: number | null;
  barsHeld: number | null;
  metadata: Record<string, unknown> | null;
  hash: string;
  previousHash: string;
  outcomeHash: string | null;
  /** 1 = hash-форма 007, 2 = форма 009 (issuance-only + отдельный outcome_hash). */
  chainVersion: number;
}

export interface NewSignal {
  strategyId: string;
  strategyVersion?: string | null;
  engineSetupId?: string | null;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  signalCandleTs: Date | string | number;
  entryType?: SignalEntryType | null;
  validForBars?: number | null;
  exitRule?: string | null;
  entryMin?: number | null;
  entryMax?: number | null;
  stopLoss?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  targets?: number[] | null;
  status?: SignalStatus;
  createdAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export interface SignalFill {
  price: number;
  at?: string | Date | null;
  barOpenTime?: number;
  stop?: number | null;
  targets?: number[] | null;
}

export interface SignalOutcome {
  status: TerminalSignalStatus;
  closedAt?: string | Date | null;
  barOpenTime?: number;
  exitReason?: string | null;
  exitPrice?: number | null;
  resultR?: number | null;
  netResultR?: number | null;
  pnlResultPct?: number | null;
  barsHeld?: number | null;
}

export interface SignalFilters {
  strategyId?: string;
  status?: string;
  /** Набор состояний (например OPEN_SIGNAL_STATUSES для вкладки «Открытые»). */
  statuses?: readonly string[];
  symbol?: string;
  direction?: string;
}

export const SIGNAL_CHAIN_LOCK_KEY: number;
export const GENESIS: string;
export const CHAIN_VERSION: number;
export const SIGNAL_STATUSES: readonly SignalStatus[];
export const OPEN_SIGNAL_STATUSES: readonly SignalStatus[];
export const CLOSED_SIGNAL_STATUSES: readonly TerminalSignalStatus[];
export const TRADE_CLOSED_STATUSES: readonly TerminalSignalStatus[];
export const NO_TRADE_STATUSES: readonly TerminalSignalStatus[];
export const MAX_SIGNALS_LIMIT: number;
export const DEFAULT_SIGNALS_LIMIT: number;
export const MAX_SIGNALS_OFFSET: number;
export const MAX_OPEN_SIGNALS_FOR_SYNC: number;

export function computeSignalHash(payload: Record<string, unknown>, prevHash: string): string;
export function computeOutcomeHash(payload: Record<string, unknown>): string;
export function outcomePayload(row: Record<string, unknown>): Record<string, unknown>;
export function resolveLevels(p?: {
  targets?: number[] | null;
  tp1?: number | null;
  tp2?: number | null;
}): { tp1: number | null; tp2: number | null; targets: number[] | null };

export function insertSignal(signal: NewSignal): Promise<{ inserted: boolean; signal: SignalRow | null }>;
export function listSignals(p?: SignalFilters & { limit?: number; offset?: number }): Promise<SignalRow[]>;
export function countSignals(filters?: SignalFilters): Promise<number>;
/** Незакрытые сигналы (ACTIVE + FILLED) — рабочий набор синхронизации исходов. */
export function listOpenSignals(strategyId?: string, limit?: number): Promise<SignalRow[]>;
/** Незакрытые сетапы: ACTIVE (ждёт входа) + FILLED (в позиции). */
export function countActiveSignals(strategyId?: string): Promise<number>;
export function closeSignal(
  id: string,
  status: TerminalSignalStatus,
  opts?: {
    closePrice?: number | null;
    closeReason?: string | null;
    closedAt?: Date | string | null;
    resultR?: number | null;
    netResultR?: number | null;
    pnlResultPct?: number | null;
    barsHeld?: number | null;
    fill?: SignalFill | null;
  }
): Promise<SignalRow | null>;
export function markSignalFilled(id: string, fill: SignalFill): Promise<SignalRow | null>;
/** Переносит fill/outcome, которые frozen-ядро уже посчитало, в строку сигнала. */
export function syncSignalLifecycle(p: {
  strategyId: string;
  symbol: string;
  timeframe: string;
  signalCandleTs: Date | string | number;
  fill?: SignalFill | null;
  outcome?: SignalOutcome | null;
}): Promise<{ found: boolean; changed: boolean; reason: string | null; signal: SignalRow | null }>;
export function verifyChain(): Promise<{ rows: number; breaks: number }>;
