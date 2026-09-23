import { describe, expect, it } from 'vitest';
import { normalizeLiquidationCandles } from '@/components/market/LiquidationPriceChart';
import { mapLiquidationMarkers } from '@/services/liquidations/liquidationMarkers';
import type { LiquidationEvent, OHLCV } from '@/types/market';

const candle = (time: number, close: number | string = 100): OHLCV => ({
  time,
  open: Number(close) - 1,
  high: Number(close) + 2,
  low: Number(close) - 2,
  close: close as number,
  volume: 1,
});

const event = (overrides: Partial<LiquidationEvent> = {}): LiquidationEvent => ({
  id: 'event-1',
  timestamp: '2026-01-01T00:02:00.000Z',
  symbol: 'BTC',
  side: 'LONG',
  amountUsd: 120_000,
  price: 99,
  exchange: 'Binance Futures',
  isDemo: false,
  ...overrides,
});

describe('liquidation chart data boundary', () => {
  it('normalizes millisecond timestamps, numeric string OHLC and chronological order', () => {
    const rows = normalizeLiquidationCandles([
      candle(1_767_225_600_000, '102'),
      candle(1_767_222_000, 100),
      candle(1_767_222_000_000, '101'), // duplicate candle timestamp: newest row wins
    ]);

    expect(rows.map((row) => row.time)).toEqual([1_767_222_000, 1_767_225_600]);
    expect(rows[0].close).toBe(101);
    expect(rows.every((row) => typeof row.close === 'number')).toBe(true);
  });

  it('maps genuine events to their interval candle without requiring any events for candles', () => {
    const candles = normalizeLiquidationCandles([candle(1_767_222_000), candle(1_767_225_600)]);
    const mapped = mapLiquidationMarkers([event()], candles, 'BTC', 3600);

    expect(mapped.markers).toHaveLength(1);
    expect(mapped.markers[0]).toMatchObject({ time: 1_767_225_600, side: 'LONG', position: 'belowBar' });
    expect(mapLiquidationMarkers([], candles, 'BTC', 3600)).toMatchObject({ markers: [], matched: 0 });
    expect(candles).toHaveLength(2);
  });

  it('normalizes millisecond liquidation timestamps and ignores malformed OHLC', () => {
    const candles = normalizeLiquidationCandles([
      candle(1_767_225_600_000),
      { ...candle(1_767_225_600), high: 90, low: 110 },
    ]);
    const mapped = mapLiquidationMarkers([
      event({ timestamp: '1767225720000', symbol: 'BTCUSDT', amountUsd: 1_600_000, side: 'SHORT' }),
    ], candles, 'BTC', 3600);

    expect(candles).toHaveLength(1);
    expect(mapped.markers).toHaveLength(1);
    expect(mapped.markers[0]).toMatchObject({ side: 'SHORT', position: 'aboveBar', size: 3 });
  });
});
