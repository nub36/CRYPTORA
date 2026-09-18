/**
 * Adapter: OHLCV (live provider) → ArchiveCandle (strategy archive types).
 * Allows reuse of archived strategy core functions on live market data.
 *
 * FIX P0: isClosed must reflect actual candle state, not be hardcoded true.
 * Binance REST returns the currently-forming candle — marking it closed
 * causes look-ahead: strategies evaluate incomplete data as if final.
 */
import type { OHLCV } from '@/types/market';
import type { ArchiveCandle, ArchiveTimeframe } from '@/services/strategyArchive/types';
import { ARCHIVE_TF_MS } from '@/services/strategyArchive/types';

export function ohlcvToArchive(c: OHLCV, tf: ArchiveTimeframe, nowMs?: number): ArchiveCandle {
  const openTime = c.time * 1000; // seconds → ms
  const span = ARCHIVE_TF_MS[tf];
  const closeTime = openTime + span - 1;
  return {
    openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    closeTime,
    // If nowMs provided: candle is closed only if its closeTime is in the past.
    // If nowMs omitted (e.g. archive/backtest data): assume closed.
    isClosed: nowMs === undefined ? true : closeTime < nowMs,
  };
}

export function ohlcvArrayToArchive(candles: OHLCV[], tf: ArchiveTimeframe, nowMs?: number): ArchiveCandle[] {
  return candles.map((c) => ohlcvToArchive(c, tf, nowMs));
}
