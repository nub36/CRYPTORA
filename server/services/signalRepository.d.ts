/** Декларации для signalRepository.js. */

export type SignalStatus = 'ACTIVE' | 'INVALIDATED' | 'TARGET_REACHED' | 'EXPIRED';

export interface SignalRow {
  id: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  signalCandleTs: string | Date;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  status: SignalStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
  closedAt: string | Date | null;
  closePrice: number | null;
  closeReason: string | null;
  metadata: Record<string, unknown> | null;
  hash: string;
  previousHash: string;
}

export interface NewSignal {
  strategyId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  signalCandleTs: Date | string;
  entryMin?: number | null;
  entryMax?: number | null;
  stopLoss?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  status?: SignalStatus;
  createdAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export const SIGNAL_CHAIN_LOCK_KEY: number;
export const GENESIS: string;

export function computeSignalHash(payload: Record<string, unknown>, prevHash: string): string;
export function insertSignal(signal: NewSignal): Promise<{ inserted: boolean; signal: SignalRow | null }>;
export function listSignals(p?: {
  strategyId?: string;
  status?: string;
  symbol?: string;
  limit?: number;
}): Promise<SignalRow[]>;
export function countActiveSignals(strategyId?: string): Promise<number>;
export function closeSignal(
  id: string,
  status: Exclude<SignalStatus, 'ACTIVE'>,
  opts?: { closePrice?: number | null; closeReason?: string | null }
): Promise<SignalRow | null>;
export function verifyChain(): Promise<{ rows: number; breaks: number }>;
