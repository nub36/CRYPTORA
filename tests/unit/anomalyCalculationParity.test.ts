import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnomalyEngine } from '@/services/realtime/AnomalyEngine';
import { AnomalyCalculationCore } from '../../shared/radar/anomalyCalculationCore.js';
import type { TickerTick } from '@/types/realtime';

function tick(index: number, { price = 100, volume = 100, high = 101, low = 99 } = {}): TickerTick {
  return {
    symbol: 'BTC',
    price,
    priceChangePercent24h: 0,
    high24h: high,
    low24h: low,
    volume24h: volume,
    quoteVolume24h: volume * price,
    timestamp: Date.UTC(2026, 8, 26, 10, 0, index),
    provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', timestamp: Date.UTC(2026, 8, 26, 10, 0, index) },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('frozen shared Radar anomaly calculation parity', () => {
  it('preserves the legacy browser adapter output exactly and provides a golden regression vector for server execution', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 26, 10, 5, 0));
    const browserAdapter = new AnomalyEngine({ cooldownMs: 0 });
    const sharedServerCore = new AnomalyCalculationCore({ cooldownMs: 0 });

    for (let index = 0; index < 5; index += 1) {
      expect(browserAdapter.processTick(tick(index))).toEqual(sharedServerCore.processTick(tick(index)));
    }

    const input = tick(6, { price: 105, volume: 1_000, high: 110, low: 100 });
    const browserEvents = browserAdapter.processTick(input);
    const serverEvents = sharedServerCore.processTick(input);

    expect(serverEvents).toEqual(browserEvents);
    expect(serverEvents).toHaveLength(3);
    expect(serverEvents.map((event) => ({ type: event.type, severity: event.severity, metricValue: event.metricValue }))).toEqual([
      { type: 'VOLUME_SPIKE', severity: 'HIGH', metricValue: 'Z-Score: +450.00σ' },
      { type: 'PRICE_MOVE', severity: 'HIGH', metricValue: '+5.00%' },
      { type: 'VOLATILITY_EXPANSION', severity: 'HIGH', metricValue: '4.8x avg range' },
    ]);
    expect(serverEvents.every((event) => event.timestamp === '2026-09-26T10:05:00.000Z' && event.isDemo === false)).toBe(true);
  });
});
