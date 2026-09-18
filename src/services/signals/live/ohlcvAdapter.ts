/**
 * Adapter: OHLCV (live provider) → ArchiveCandle (strategy archive types).
 * Allows reuse of archived strategy core functions on live market data.
 */
import type { OHLCV } from '@/types/market';
import type { ArchiveCandle, ArchiveTimeframe } from '@/services/strategyArchive/types';
import { ARCHIVE_TF_MS } from '@/services/strategyArchive/types';

export function ohlcvToArchive(c: OHLCV, tf: ArchiveTimeframe): ArchiveCandle {
  const openTime = c.time * 1000; // seconds → ms
  return {
    openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    closeTime: openTime + ARCHIVE_TF_MS[tf] - 1,
    isClosed: true, // live provider returns closed candles only
  };
}

export function ohlcvArrayToArchive(candles: OHLCV[], tf: ArchiveTimeframe): ArchiveCandle[] {
  return candles.map((c) => ohlcvToArchive(c, tf));
}
