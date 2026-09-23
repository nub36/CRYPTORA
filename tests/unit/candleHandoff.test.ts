import { describe, expect, it } from 'vitest';
import type { OHLCV } from '@/types/market';
import type { KlineTick } from '@/types/realtime';
import { detectCandleGap, klineTimeSeconds, mergeCandleHistory, mergeKlineIntoCandles, timeframeIntervalSeconds } from '@/services/realtime/candleHandoff';

const T = 1_780_000_000;
const candle = (time: number, close = 100): OHLCV => ({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 10 });
const tick = (openTimeSeconds: number, overrides: Partial<KlineTick> = {}): KlineTick => ({
  symbol: 'BTC', interval: '15m', openTime: openTimeSeconds * 1000, closeTime: (openTimeSeconds + 899) * 1000,
  open: 100, high: 103, low: 99, close: 102, volume: 12, isClosed: false, timestamp: openTimeSeconds * 1000 + 5_000,
  provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', timestamp: openTimeSeconds * 1000 + 5_000 },
  ...overrides,
});

describe('REST→WebSocket candle handoff', () => {
  it('uses the same UTC-second interval contract across supported chart timeframes', () => {
    expect(timeframeIntervalSeconds('15m')).toBe(900);
    expect(timeframeIntervalSeconds('1D')).toBe(86_400);
    expect(timeframeIntervalSeconds('1W')).toBe(604_800);
  });
  it('normalizes WS milliseconds to UTC seconds and replaces the current REST candle T', () => {
    const result = mergeKlineIntoCandles([candle(T, 101)], tick(T), 'BTC', '15m');
    expect(klineTimeSeconds(T * 1000)).toBe(T);
    expect(klineTimeSeconds(T)).toBeNull(); // already-seconds input is rejected, not divided a second time.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ time: T, close: 102, volume: 12 });
  });

  it('appends T+interval as the next real candle without inventing bars', () => {
    const result = mergeKlineIntoCandles([candle(T)], tick(T + 900), 'BTC', '15m');
    expect(result.map((row) => row.time)).toEqual([T, T + 900]);
  });

  it('detects missing intervals and does not fill them synthetically', () => {
    const incoming = tick(T + 2_700);
    const gap = detectCandleGap(T, incoming.openTime, 900);
    expect(gap).toMatchObject({ missingIntervals: 2, expectedNextOpenTime: T + 900 });
    const result = mergeKlineIntoCandles([candle(T)], incoming, 'BTC', '15m');
    expect(result.map((row) => row.time)).toEqual([T, T + 2_700]);
  });

  it('ignores symbol/interval mismatches and out-of-order ticks', () => {
    expect(mergeKlineIntoCandles([candle(T)], tick(T, { symbol: 'ETH' }), 'BTC', '15m')).toHaveLength(1);
    expect(mergeKlineIntoCandles([candle(T)], tick(T, { interval: '1h' }), 'BTC', '15m')).toHaveLength(1);
    expect(mergeKlineIntoCandles([candle(T + 900)], tick(T), 'BTC', '15m')).toEqual([candle(T + 900)]);
  });

  it('merges recovered REST history by UTC open time, preferring recovered corrections', () => {
    const result = mergeCandleHistory([candle(T, 100), candle(T + 900, 102)], [candle(T + 900, 103), candle(T + 1_800, 104)]);
    expect(result).toEqual([candle(T, 100), candle(T + 900, 103), candle(T + 1_800, 104)]);
  });
});
