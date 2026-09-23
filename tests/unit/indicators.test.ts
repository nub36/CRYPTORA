import { describe, it, expect } from 'vitest';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import { OHLCV } from '@/types/market';

describe('IndicatorEngine Mathematical Calculation Suite', () => {
  describe('SMA & EMA', () => {
    it('calculates Simple Moving Average (SMA) correctly', () => {
      const prices = [10, 11, 12, 13, 14, 15, 16];
      const sma3 = IndicatorEngine.calculateSMA(prices, 3);

      expect(sma3.length).toBe(5);
      expect(sma3[0]).toBeCloseTo(11, 2); // (10 + 11 + 12) / 3
      expect(sma3[1]).toBeCloseTo(12, 2); // (11 + 12 + 13) / 3
      expect(sma3[4]).toBeCloseTo(15, 2); // (14 + 15 + 16) / 3
    });

    it('calculates Exponential Moving Average (EMA) with proper weighting', () => {
      const prices = [10, 12, 14, 16, 18];
      const ema3 = IndicatorEngine.calculateEMA(prices, 3);

      expect(ema3.length).toBe(3);
      // EMA0 = SMA3 = (10+12+14)/3 = 12
      expect(ema3[0]).toBeCloseTo(12, 2);
      // k = 2 / (3 + 1) = 0.5
      // EMA1 = 16 * 0.5 + 12 * 0.5 = 14
      expect(ema3[1]).toBeCloseTo(14, 2);
      // EMA2 = 18 * 0.5 + 14 * 0.5 = 16
      expect(ema3[2]).toBeCloseTo(16, 2);
    });
  });

  describe('RSI (Wilder\'s Smoothing)', () => {
    it('calculates RSI bounded between 0 and 100', () => {
      // 20 monotonically increasing prices -> RSI should be high (> 90)
      const uptrend = Array.from({ length: 25 }, (_, i) => 100 + i * 2);
      const rsiUptrend = IndicatorEngine.calculateRSI(uptrend, 14);

      expect(rsiUptrend.length).toBeGreaterThan(0);
      const lastRsi = rsiUptrend[rsiUptrend.length - 1];
      expect(lastRsi).toBeGreaterThan(85);
      expect(lastRsi).toBeLessThanOrEqual(100);

      // Monotonically decreasing prices -> RSI should be low (< 15)
      const downtrend = Array.from({ length: 25 }, (_, i) => 200 - i * 3);
      const rsiDowntrend = IndicatorEngine.calculateRSI(downtrend, 14);
      const lastDownRsi = rsiDowntrend[rsiDowntrend.length - 1];
      expect(lastDownRsi).toBeLessThan(15);
      expect(lastDownRsi).toBeGreaterThanOrEqual(0);
      expect([...rsiUptrend, ...rsiDowntrend].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true);
    });

    it('returns a neutral bounded value for a flat series and rejects non-finite prices', () => {
      expect(IndicatorEngine.calculateRSI(Array(20).fill(100), 14).every((value) => value === 50)).toBe(true);
      expect(IndicatorEngine.calculateRSI([100, 101, Number.NaN, 103], 2)).toEqual([]);
    });
  });

  describe('MACD', () => {
    it('computes MACD line, signal line, and histogram', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 50000 + Math.sin(i / 5) * 2000);
      const macd = IndicatorEngine.calculateMACD(prices, 12, 26, 9);

      expect(macd.length).toBeGreaterThan(0);
      const latest = macd[macd.length - 1];
      expect(latest).toHaveProperty('macd');
      expect(latest).toHaveProperty('signal');
      expect(latest).toHaveProperty('hist');
      expect(latest.hist).toBeCloseTo(latest.macd - latest.signal, 2);
    });
  });

  describe('Bollinger Bands', () => {
    it('calculates Upper, Middle, Lower bands and Bandwidth %', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 100 + (i % 5));
      const bb = IndicatorEngine.calculateBollingerBands(prices, 20, 2);

      expect(bb.length).toBe(11);
      const latest = bb[bb.length - 1];
      expect(latest.upper).toBeGreaterThan(latest.middle);
      expect(latest.middle).toBeGreaterThan(latest.lower);
      expect(latest.bandwidthPct).toBeGreaterThan(0);
      expect(latest.bandwidthPct).toBeCloseTo(((latest.upper - latest.lower) / latest.middle) * 100, 1);
    });
  });

  describe('ATR & VWAP & Volume Profile', () => {
    const mockCandles: OHLCV[] = Array.from({ length: 25 }, (_, i) => {
      const base = 100 + i;
      return {
        time: 1726000000 + i * 3600,
        open: base,
        high: base + 3,
        low: base - 2,
        close: base + 1,
        volume: 1000 + i * 100,
      };
    });

    it('calculates Average True Range (ATR)', () => {
      const atr = IndicatorEngine.calculateATR(mockCandles, 14);
      expect(atr.length).toBeGreaterThan(0);
      expect(atr[0]).toBeGreaterThan(0);
    });

    it('calculates Volume-Weighted Average Price (VWAP)', () => {
      const vwap = IndicatorEngine.calculateVWAP(mockCandles);
      expect(vwap).toBeGreaterThan(100);
      expect(vwap).toBeLessThan(140);
    });

    it('generates Volume Profile with POC, VAH, and VAL', () => {
      const vp = IndicatorEngine.calculateVolumeProfile(mockCandles, 10);
      expect(vp.poc).toBeGreaterThanOrEqual(98);
      expect(vp.vah).toBeGreaterThanOrEqual(vp.val);
      expect(vp.levels.length).toBe(10);
    });

    it('computes complete indicator suite', () => {
      const complete = IndicatorEngine.computeCompleteIndicators(mockCandles);
      expect(complete.rsi14).toBeDefined();
      expect(complete.macd).toBeDefined();
      expect(complete.sma20).toBeDefined();
      expect(complete.bollinger).toBeDefined();
      expect(complete.atr14).toBeDefined();
      expect(complete.vwap).toBeDefined();
    });
  });
});
