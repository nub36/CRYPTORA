/**
 * CRYPTORA — P0 look-ahead guard at the ENGINE level.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ohlcvAdapter` learned to compute `isClosed` from a `nowMs` argument, and
 * `LiveSignalEngine` filters candles with `.filter(c => c.isClosed)`. But the
 * `nowMs` parameter is OPTIONAL and defaults to "assume closed", so if the
 * engine ever stops passing it the whole look-ahead fix silently becomes dead
 * code while every adapter unit test still passes.
 *
 * That is exactly what happened on both branches before this integration: the
 * adapter had the fix, the engine never passed nowMs, and forming candles were
 * still evaluated as final.
 *
 * These tests pin the wiring down. The real adapter is used (wrapped, not
 * replaced), so the assertions run against production code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { OHLCV } from '@/types/market';

const calls: Array<{ tf: unknown; nowMs: unknown }> = [];

vi.mock('@/services/signals/live/ohlcvAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/signals/live/ohlcvAdapter')>();
  return {
    ...actual,
    ohlcvToArchive: (c: OHLCV, tf: never, nowMs?: number) => {
      calls.push({ tf, nowMs });
      return actual.ohlcvToArchive(c, tf, nowMs);
    },
  };
});

const { LiveSignalEngine } = await import('@/services/signals/live/LiveSignalEngine');
const { SignalsAuditLedger } = await import('@/services/signals/SignalsAuditLedger');

const HOUR_SEC = 3600;

/** Candles aligned to real hour boundaries, the last one still forming. */
function candlesEndingWithFormingBar(count: number, basePrice: number): OHLCV[] {
  const out: OHLCV[] = [];
  const currentHourStart = Math.floor(Date.now() / 1000 / HOUR_SEC) * HOUR_SEC;
  const start = currentHourStart - (count - 1) * HOUR_SEC;
  let price = basePrice;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const change = price * (0.001 + Math.sin(i * 0.7) * 0.005);
    const close = open + change;
    const high = Math.max(open, close) + Math.abs(change) * 0.5;
    const low = Math.min(open, close) - Math.abs(change) * 0.5;
    out.push({
      time: start + i * HOUR_SEC,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + i * 10,
    });
    price = close;
  }
  return out;
}

function mockProvider(h1: OHLCV[], h4: OHLCV[]): MarketDataProvider {
  return {
    isDemo: false,
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockImplementation((_s: string, tf: string) =>
      Promise.resolve(tf === '1h' ? h1 : h4)
    ),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockResolvedValue({ total24h: 0, dataStatus: 'UNAVAILABLE' }),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getMarketOverview: vi.fn().mockResolvedValue({}),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;
}

describe('LiveSignalEngine — look-ahead wiring', () => {
  beforeEach(() => {
    calls.length = 0;
    LiveSignalEngine.resetInstance();
    SignalsAuditLedger['instance'] = null;
  });

  it('passes the current instant to ohlcvToArchive (fix stays live)', { timeout: 20000 }, async () => {
    const h1 = candlesEndingWithFormingBar(100, 65000);
    const h4 = candlesEndingWithFormingBar(60, 65000);
    const engine = LiveSignalEngine.getInstance({ provider: mockProvider(h1, h4) })!;

    const before = Date.now();
    engine.start();
    await new Promise((r) => setTimeout(r, 6500)); // initial scan fires at +5s
    const after = Date.now();
    engine.stop();

    expect(calls.length).toBeGreaterThan(0);

    // Every conversion must carry a nowMs; without it the adapter falls back to
    // isClosed=true and the look-ahead guard is inert.
    const missing = calls.filter((c) => typeof c.nowMs !== 'number');
    expect(missing, 'ohlcvToArchive was called without nowMs — look-ahead fix is dead').toEqual([]);

    // And it must be "now", not some stale constant.
    for (const c of calls) {
      const t = c.nowMs as number;
      expect(t).toBeGreaterThanOrEqual(before - 1000);
      expect(t).toBeLessThanOrEqual(after + 1000);
    }
  });

  it('never evaluates the still-forming candle', { timeout: 20000 }, async () => {
    const h1 = candlesEndingWithFormingBar(100, 65000);
    const h4 = candlesEndingWithFormingBar(60, 65000);
    const formingOpenTimeMs = h1[h1.length - 1].time * 1000;

    const engine = LiveSignalEngine.getInstance({
      provider: mockProvider(h1, h4),
      strategies: ['V3.0', 'V3.3', 'V2.8'],
    })!;

    engine.start();
    await new Promise((r) => setTimeout(r, 6500));
    engine.stop();

    // Signal ids embed the evaluated bar's openTime, so this proves the engine
    // never fired on the incomplete candle regardless of geometry.
    const ids = SignalsAuditLedger.getInstance()
      .getSetups()
      .map((s) => s.id);
    for (const id of ids) {
      expect(id, `signal ${id} was generated from the forming candle`).not.toContain(
        String(formingOpenTimeMs)
      );
    }
  });
});
