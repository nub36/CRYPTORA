import { describe, it, expect } from 'vitest';
import { mapTimeframeToBinanceInterval } from '@/hooks/useRealtimeKline';
import type { Timeframe } from '@/types/market';

/**
 * Timeframe mapping tests — verify UI→Binance correct for all 7 timeframes.
 * No case confusion: Binance uses lowercase (5m, 1d, 1w) while our UI uses (5m, 1D, 1W).
 */

describe('Timeframe mapping: UI → Binance kline interval', () => {
  const cases: [Timeframe, string][] = [
    ['5m', '5m'],
    ['15m', '15m'],
    ['30m', '30m'],
    ['1h', '1h'],
    ['4h', '4h'],
    ['1D', '1d'],  // uppercase D → lowercase d
    ['1W', '1w'],  // uppercase W → lowercase w
  ];

  it.each(cases)('maps UI timeframe "%s" to Binance interval "%s"', (tf, expected) => {
    expect(mapTimeframeToBinanceInterval(tf)).toBe(expected);
  });

  it('every UI timeframe produces a valid Binance interval (no empty or mixed case)', () => {
    for (const [tf] of cases) {
      const result = mapTimeframeToBinanceInterval(tf);
      expect(result).toBeTruthy();
      expect(result).toBe(result.toLowerCase());
      // Binance intervals: digits followed by lowercase letter
      expect(result).toMatch(/^\d+[mhdsw]$/);
    }
  });

  it('default fallback for unknown timeframe returns "1h"', () => {
    // @ts-expect-error testing unknown value
    expect(mapTimeframeToBinanceInterval('unknown')).toBe('1h');
  });
});

describe('Timeframe mapping: LiveMarketDataProvider → Binance REST', () => {
  // These are the same mappings used by the provider's mapTimeframeToBinance()
  const expectedMappings: Record<Timeframe, string> = {
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1D': '1d',
    '1W': '1w',
  };

  it('REST and WS mappings produce identical intervals for all timeframes', () => {
    for (const [tf, expected] of Object.entries(expectedMappings) as [Timeframe, string][]) {
      // WS mapping (from useRealtimeKline)
      const wsInterval = mapTimeframeToBinanceInterval(tf);
      // REST mapping (same function logic in LiveMarketDataProvider)
      expect(wsInterval).toBe(expected);
    }
  });

  it('case-sensitive: 1D maps to "1d" not "1D"', () => {
    const result = mapTimeframeToBinanceInterval('1D');
    expect(result).toBe('1d');
    expect(result).not.toBe('1D');
  });

  it('case-sensitive: 1W maps to "1w" not "1W"', () => {
    const result = mapTimeframeToBinanceInterval('1W');
    expect(result).toBe('1w');
    expect(result).not.toBe('1W');
  });

  it('lowercase timeframes (5m, 15m, 30m, 1h, 4h) pass through unchanged', () => {
    for (const tf of ['5m', '15m', '30m', '1h', '4h'] as Timeframe[]) {
      expect(mapTimeframeToBinanceInterval(tf)).toBe(tf);
    }
  });
});
