export interface SharedCandleProvenance {
  exchange: 'binance' | 'kucoin';
  market: 'spot' | 'futures';
  symbol: string;
  timestamp: number;
  isFallback: boolean;
}

export interface SharedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  provenance: SharedCandleProvenance;
}

export interface SharedCandleContext {
  symbol: string;
  market?: 'spot' | 'futures';
  exchange?: 'binance' | 'kucoin';
  isFallback?: boolean;
}

export function normalizeBinanceKlineRow(
  row: unknown,
  ctx: SharedCandleContext,
): { ok: true; candle: SharedCandle } | { ok: false; reason: string };

export function normalizeBinanceKlineSeries(
  rows: unknown,
  ctx: SharedCandleContext,
): { candles: SharedCandle[]; rejected: Array<{ index: number; reason: string }> };

export function validateCandleSeries(
  candles: readonly unknown[],
  options?: { requireVolume?: boolean; minCandles?: number },
): { ok: boolean; issues: string[]; count: number };
