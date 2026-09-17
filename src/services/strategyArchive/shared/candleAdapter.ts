/**
 * Candle adapter: CRYPTORA `OHLCV` (time in SECONDS, no closeTime, no isClosed)
 * ↔ archive `ArchiveCandle` (Suslik `Candle`: ms, closeTime = openTime+span−1).
 *
 * Timestamps are UTC epoch values on both sides — no timezone conversion is
 * ever applied; a candle opening at 2022-01-01T00:00:00Z stays exactly that.
 */

import type { OHLCV, Timeframe as CryptoraTimeframe } from '@/types/market';
import { ARCHIVE_TF_MS, type ArchiveCandle, type ArchiveTimeframe } from '../types';

export type TimestampUnit = 'ms' | 's' | 'us';

/** Detect unit by magnitude (Binance archives switched to microseconds in 2025). */
export function detectTimestampUnit(t: number): TimestampUnit {
  if (t >= 1e15) return 'us';
  if (t >= 1e11) return 'ms';
  return 's';
}

export function toMs(t: number, unit: TimestampUnit = detectTimestampUnit(t)): number {
  if (unit === 'ms') return t;
  if (unit === 's') return t * 1000;
  return Math.floor(t / 1000);
}

/** CRYPTORA timeframe → archive timeframe (only the overlapping set). */
export function cryptoraTimeframeToArchive(tf: CryptoraTimeframe): ArchiveTimeframe {
  switch (tf) {
    case '5m': return '15m'; // Archive doesn't have 5m, fall back to 15m
    case '15m': return '15m';
    case '30m': return '1h'; // Archive doesn't have 30m, fall back to 1h
    case '1h': return '1h';
    case '4h': return '4h';
    case '1D': return '1d';
    case '1W': return '1w';
    default: return '1h';
  }
}

export function archiveTimeframeToCryptora(tf: ArchiveTimeframe): CryptoraTimeframe | null {
  switch (tf) {
    case '15m': return '15m';
    case '1h': return '1h';
    case '4h': return '4h';
    case '1d': return '1D';
    case '1w': return '1W';
    default: return null;
  }
}

export interface AdaptOptions {
  /**
   * The last candle of a LIVE series may still be forming. Provide `nowMs` to
   * mark candles whose canonical closeTime is in the future as `isClosed=false`.
   * Archive/monthly files: omit → every candle closed.
   */
  nowMs?: number;
  /** Force the input unit instead of auto-detecting from the first candle. */
  unit?: TimestampUnit;
}

/** Convert CRYPTORA OHLCV rows to archive candles, sorted, deduplicated by openTime. */
export function ohlcvToArchiveCandles(
  rows: readonly OHLCV[],
  tf: ArchiveTimeframe,
  opts: AdaptOptions = {},
): ArchiveCandle[] {
  const span = ARCHIVE_TF_MS[tf];
  const unit = opts.unit ?? (rows.length > 0 ? detectTimestampUnit(rows[0]!.time) : 's');
  const out: ArchiveCandle[] = [];
  for (const r of rows) {
    const openTime = toMs(r.time, unit);
    const closeTime = openTime + span - 1;
    out.push({
      openTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      closeTime,
      isClosed: opts.nowMs === undefined ? true : closeTime < opts.nowMs,
    });
  }
  out.sort((a, b) => a.openTime - b.openTime);
  const dedup: ArchiveCandle[] = [];
  for (const c of out) {
    const last = dedup[dedup.length - 1];
    if (last && last.openTime === c.openTime) dedup[dedup.length - 1] = c;
    else dedup.push(c);
  }
  return dedup;
}

/** Convert archive candles back to CRYPTORA OHLCV (seconds). */
export function archiveCandlesToOhlcv(candles: readonly ArchiveCandle[]): OHLCV[] {
  return candles.map((c) => ({
    time: Math.floor(c.openTime / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

/** Suslik binary-cache row → archive candle (used by the offline import script). */
export function rawKlineToArchiveCandle(
  row: readonly [number, number, number, number, number, number],
  tf: ArchiveTimeframe,
): ArchiveCandle {
  const openTime = toMs(row[0]);
  return {
    openTime,
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
    closeTime: openTime + ARCHIVE_TF_MS[tf] - 1,
    isClosed: true,
  };
}

/** Sanity check used by tests and the import script. */
export function validateSeries(candles: readonly ArchiveCandle[], tf: ArchiveTimeframe): {
  ok: boolean;
  duplicates: number;
  outOfOrder: number;
  gaps: number;
  invalidOhlc: number;
} {
  const span = ARCHIVE_TF_MS[tf];
  let duplicates = 0, outOfOrder = 0, gaps = 0, invalidOhlc = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (!(c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))) invalidOhlc++;
    if (i === 0) continue;
    const d = c.openTime - candles[i - 1]!.openTime;
    if (d === 0) duplicates++;
    else if (d < 0) outOfOrder++;
    else if (d !== span) gaps++;
  }
  return { ok: duplicates === 0 && outOfOrder === 0 && invalidOhlc === 0, duplicates, outOfOrder, gaps, invalidOhlc };
}
