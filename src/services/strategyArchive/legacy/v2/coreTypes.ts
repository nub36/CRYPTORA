/**
 * Minimal subset of svechnoy-suslik-v2 `src/core/types.ts` @ 4839074 (sha256 2394992c…) required by the frozen
 * V2 research engine. Verbatim declarations; everything database/exchange/signal-lifecycle related is omitted.
 * ARCHIVE-ONLY — imported only from inside `strategyArchive/` (reproduction runners and the V2.8 LIVE
 * wrapper); never by BacktestEngine, workers or UI directly.
 */

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

export function tfMs(tf: Timeframe): number {
  return TF_MS[tf];
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  isClosed: boolean;
}

export type Direction = 'LONG' | 'SHORT';

/** Kept only because tracker.ts declares `trackMilestones` (unused by the archive). */
export type SignalState =
  | 'WAITING_ENTRY'
  | 'OPEN'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'STOPPED'
  | 'EXPIRED';

export interface RiskPlan {
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfits: number[];
  riskPerUnit: number;
  rrTp1: number;
  atr: number;
  positionSizeQuote: number;
  qty: number;
}
