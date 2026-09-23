import type { OHLCV, Timeframe } from '@/types/market';
import type { KlineTick } from '@/types/realtime';

const INTERVAL_SECONDS: Record<Timeframe, number> = {
  '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800,
};

export function timeframeIntervalSeconds(timeframe: Timeframe): number {
  return INTERVAL_SECONDS[timeframe];
}

export interface CandleGap {
  /** Number of interval slots absent between the known candle and incoming WS candle. */
  missingIntervals: number;
  expectedNextOpenTime: number;
  receivedOpenTime: number;
}

export function klineTimeSeconds(openTimeMs: number): number | null {
  // KlineTick.openTime is Binance epoch milliseconds. Reject seconds here instead of silently drawing a 1970 candle.
  if (!Number.isFinite(openTimeMs) || openTimeMs < 100_000_000_000) return null;
  return Math.floor(openTimeMs / 1000);
}

export function detectCandleGap(
  lastKnownOpenTimeSeconds: number | null | undefined,
  incomingOpenTimeMs: number,
  intervalSeconds: number,
): CandleGap | null {
  const incoming = klineTimeSeconds(incomingOpenTimeMs);
  if (!incoming || !lastKnownOpenTimeSeconds || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return null;
  const delta = incoming - lastKnownOpenTimeSeconds;
  if (delta <= intervalSeconds) return null;
  const slots = Math.floor(delta / intervalSeconds);
  if (slots <= 1) return null;
  return {
    missingIntervals: slots - 1,
    expectedNextOpenTime: lastKnownOpenTimeSeconds + intervalSeconds,
    receivedOpenTime: incoming,
  };
}

/** REST→WS handoff: replace candle T in place or append T+interval; never fabricates intermediate bars. */
export function mergeKlineIntoCandles(
  candles: readonly OHLCV[],
  tick: KlineTick,
  expectedSymbol: string,
  expectedInterval: string,
): OHLCV[] {
  const canonical = (value: string) => value.toUpperCase().replace(/USDT$/, '');
  if (
    canonical(tick.symbol) !== canonical(expectedSymbol)
    || tick.interval !== expectedInterval
    || ![tick.open, tick.high, tick.low, tick.close, tick.volume].every(Number.isFinite)
  ) return [...candles];

  const time = klineTimeSeconds(tick.openTime);
  if (time === null) return [...candles];

  const ordered = [...candles].sort((a, b) => a.time - b.time);
  const last = ordered[ordered.length - 1];
  if (last && time < last.time) return ordered;

  const next: OHLCV = {
    time,
    open: tick.open,
    high: tick.high,
    low: tick.low,
    close: tick.close,
    volume: tick.volume,
    provenance: tick.provenance,
  };
  const byTime = new Map(ordered.map((candle) => [candle.time, candle]));
  byTime.set(time, next);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function mergeCandleHistory(
  existing: readonly OHLCV[],
  recovered: readonly OHLCV[],
  maxCandles = 1000,
): OHLCV[] {
  const byTime = new Map<number, OHLCV>();
  for (const candle of existing) byTime.set(candle.time, candle);
  // REST recovery replaces stale versions for recovered timestamps.
  for (const candle of recovered) byTime.set(candle.time, candle);
  return [...byTime.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(1, Math.floor(maxCandles)));
}
