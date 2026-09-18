/**
 * P0 regression tests: ohlcvAdapter isClosed logic.
 *
 * Ensures REST candles from Binance are not incorrectly marked as closed
 * when the candle is still forming (look-ahead fix).
 */
import { describe, it, expect } from 'vitest';
import { ohlcvToArchive, ohlcvArrayToArchive } from '@/services/signals/live/ohlcvAdapter';
import type { OHLCV } from '@/types/market';

/** Make a 1H candle starting at `openTimeSec` (Unix seconds). */
function makeCandle(openTimeSec: number, price = 65000): OHLCV {
  return {
    time: openTimeSec,
    open: price,
    high: price + 100,
    low: price - 100,
    close: price + 50,
    volume: 1000,
  };
}

const HOUR_MS = 60 * 60 * 1000;
const HOUR_SEC = 3600;

describe('ohlcvAdapter — isClosed (look-ahead fix)', () => {
  it('closed historical candle => isClosed=true', () => {
    // Candle opened 2 hours ago — definitely closed
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * HOUR_SEC;
    const c = makeCandle(twoHoursAgo);
    const result = ohlcvToArchive(c, '1h', Date.now());
    expect(result.isClosed).toBe(true);
  });

  it('currently forming candle => isClosed=false', () => {
    // Candle opened at the start of the current hour — still forming
    const now = Date.now();
    const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_SEC;
    const c = makeCandle(currentHourStart);
    const result = ohlcvToArchive(c, '1h', now);
    expect(result.isClosed).toBe(false);
  });

  it('candle closing in the future => isClosed=false', () => {
    // Candle opened 30 minutes ago — still has 30 min to close
    const thirtyMinAgo = Math.floor(Date.now() / 1000) - 30 * 60;
    const c = makeCandle(thirtyMinAgo);
    const result = ohlcvToArchive(c, '1h', Date.now());
    expect(result.isClosed).toBe(false);
  });

  it('without nowMs, all candles are closed (archive/backtest mode)', () => {
    const c = makeCandle(Math.floor(Date.now() / 1000));
    const result = ohlcvToArchive(c, '1h');
    expect(result.isClosed).toBe(true);
  });

  it('4h candle: forming => isClosed=false', () => {
    // 4h candle started 1 hour ago — still 3 hours to close
    const oneHourAgo = Math.floor(Date.now() / 1000) - HOUR_SEC;
    const c = makeCandle(oneHourAgo);
    const result = ohlcvToArchive(c, '4h', Date.now());
    expect(result.isClosed).toBe(false);
  });

  it('4h candle: closed 5 hours ago => isClosed=true', () => {
    const fiveHoursAgo = Math.floor(Date.now() / 1000) - 5 * HOUR_SEC;
    const c = makeCandle(fiveHoursAgo);
    const result = ohlcvToArchive(c, '4h', Date.now());
    expect(result.isClosed).toBe(true);
  });

  it('closeTime = openTime + span - 1', () => {
    const openTimeSec = 1700000000; // fixed timestamp
    const c = makeCandle(openTimeSec);
    const result = ohlcvToArchive(c, '1h');
    expect(result.closeTime).toBe(openTimeSec * 1000 + HOUR_MS - 1);
  });

  it('ohlcvArrayToArchive: mixed closed and forming candles', () => {
    const now = Date.now();
    const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_SEC;

    const candles: OHLCV[] = [
      makeCandle(currentHourStart - 3 * HOUR_SEC), // 3h ago — closed
      makeCandle(currentHourStart - 2 * HOUR_SEC), // 2h ago — closed
      makeCandle(currentHourStart - HOUR_SEC),      // 1h ago — closed
      makeCandle(currentHourStart),                  // current — forming
    ];

    const results = ohlcvArrayToArchive(candles, '1h', now);
    expect(results[0].isClosed).toBe(true);
    expect(results[1].isClosed).toBe(true);
    expect(results[2].isClosed).toBe(true);
    expect(results[3].isClosed).toBe(false); // current candle is still forming
  });
});

describe('ohlcvAdapter — look-ahead signal prevention', () => {
  it('LiveSignalEngine filters out forming candles before evaluation', () => {
    // This test documents the contract: after ohlcvToArchive with nowMs,
    // the engine's `h1.filter(c => c.isClosed)` must exclude the forming candle.
    const now = Date.now();
    const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_SEC;

    const candles: OHLCV[] = [
      makeCandle(currentHourStart - 2 * HOUR_SEC, 64000),
      makeCandle(currentHourStart - HOUR_SEC, 64500),
      makeCandle(currentHourStart, 65000), // forming
    ];

    const archive = ohlcvArrayToArchive(candles, '1h', now);
    const closedOnly = archive.filter((c) => c.isClosed);

    expect(archive).toHaveLength(3);
    expect(closedOnly).toHaveLength(2);
    // The forming candle is excluded — strategies never see it
    expect(closedOnly.every((c) => c.openTime < currentHourStart * 1000)).toBe(true);
  });

  it('after candle closes, it becomes available for evaluation', () => {
    // Simulate: candle opened 2h ago, "now" is after its closeTime
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * HOUR_SEC;
    const c = makeCandle(twoHoursAgo);

    // At the time the candle was forming (1h after open) — closeTime = openTime + HOUR_MS - 1
    // So at openTime + HOUR_MS + 1000 it IS already closed
    const justAfterClose = ohlcvToArchive(c, '1h', twoHoursAgo * 1000 + HOUR_MS + 1000);
    expect(justAfterClose.isClosed).toBe(true);

    // After close
    const afterClose = ohlcvToArchive(c, '1h', Date.now());

    expect(afterClose.isClosed).toBe(true);
  });
});
