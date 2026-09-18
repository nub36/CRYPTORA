import { describe, it, expect } from 'vitest';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';

/**
 * New tests for indicator series, correlation, and edge cases.
 */

describe('RSI series calculation', () => {
  it('returns empty array for insufficient data', () => {
    const prices = [100, 101, 102, 103, 104];
    const rsi = IndicatorEngine.calculateRSI(prices, 14);
    expect(rsi).toEqual([]);
  });

  it('returns values between 0 and 100 for sufficient data', () => {
    // Generate 30 alternating up/down prices
    const prices = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? i : -i) * 0.5);
    const rsi = IndicatorEngine.calculateRSI(prices, 14);
    expect(rsi.length).toBeGreaterThan(0);
    for (const v of rsi) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('monotonically rising prices → RSI near 100', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const rsi = IndicatorEngine.calculateRSI(prices, 14);
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).toBeGreaterThan(90);
  });

  it('monotonically falling prices → RSI near 0', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
    const rsi = IndicatorEngine.calculateRSI(prices, 14);
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).toBeLessThan(10);
  });

  it('empty prices → empty result', () => {
    expect(IndicatorEngine.calculateRSI([], 14)).toEqual([]);
  });

  it('period = 0 → empty result', () => {
    expect(IndicatorEngine.calculateRSI([1, 2, 3], 0)).toEqual([]);
  });
});

describe('MACD series calculation', () => {
  it('returns empty array for insufficient data (< slowPeriod + signalPeriod)', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const macd = IndicatorEngine.calculateMACD(prices, 12, 26, 9);
    expect(macd).toEqual([]); // need 26+9=35
  });

  it('returns valid MACD/signal/hist for sufficient data', () => {
    const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.3) * 10);
    const macd = IndicatorEngine.calculateMACD(prices, 12, 26, 9);
    expect(macd.length).toBeGreaterThan(0);
    for (const m of macd) {
      expect(typeof m.macd).toBe('number');
      expect(typeof m.signal).toBe('number');
      expect(typeof m.hist).toBe('number');
      // hist = macd - signal
      expect(Math.abs(m.hist - (m.macd - m.signal))).toBeLessThan(0.001);
    }
  });

  it('histogram = macd - signal', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i * 0.2) * 5);
    const macd = IndicatorEngine.calculateMACD(prices);
    for (const m of macd) {
      expect(m.hist).toBeCloseTo(m.macd - m.signal, 3);
    }
  });

  it('all zeros → hist should be 0', () => {
    const prices = new Array(50).fill(0);
    const macd = IndicatorEngine.calculateMACD(prices);
    // All zeros means no variance, EMA is 0
    for (const m of macd) {
      expect(m.macd).toBe(0);
      expect(m.signal).toBe(0);
      expect(m.hist).toBe(0);
    }
  });
});

describe('Correlation calculation', () => {
  it('returns null for insufficient data (< 2 observations)', () => {
    expect(IndicatorEngine.calculateCorrelation([1], [2])).toBeNull();
    expect(IndicatorEngine.calculateCorrelation([], [])).toBeNull();
  });

  it('perfect positive correlation → 1.0', () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [0.01, 0.02, -0.01, 0.03, -0.02];
    const corr = IndicatorEngine.calculateCorrelation(a, b);
    expect(corr).toBeCloseTo(1.0, 2);
  });

  it('perfect negative correlation → -1.0', () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [-0.01, -0.02, 0.01, -0.03, 0.02];
    const corr = IndicatorEngine.calculateCorrelation(a, b);
    expect(corr).toBeCloseTo(-1.0, 2);
  });

  it('uncorrelated returns → near 0', () => {
    // Alternating pattern → no linear relationship
    const a = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
    const b = [1, 1, -1, -1, 1, 1, -1, -1, 1, 1];
    const corr = IndicatorEngine.calculateCorrelation(a, b);
    expect(Math.abs(corr!)).toBeLessThan(0.3);
  });

  it('constant returns → null (zero variance)', () => {
    const a = [0.01, 0.01, 0.01, 0.01, 0.01];
    const b = [0.02, 0.03, 0.04, 0.05, 0.06];
    const corr = IndicatorEngine.calculateCorrelation(a, b);
    expect(corr).toBeNull();
  });
});

describe('Beta calculation', () => {
  it('returns null for insufficient data (< 5 observations)', () => {
    expect(IndicatorEngine.calculateBeta([1, 2, 3, 4], [1, 2, 3, 4])).toBeNull();
  });

  it('beta of 1.0 for identical returns', () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02, 0.01, -0.03, 0.02];
    const beta = IndicatorEngine.calculateBeta(returns, returns);
    expect(beta).toBeCloseTo(1.0, 2);
  });

  it('beta of 2.0 for asset that moves 2x benchmark', () => {
    const benchmark = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.02, -0.02];
    const asset = benchmark.map((r) => r * 2);
    const beta = IndicatorEngine.calculateBeta(asset, benchmark);
    expect(beta).toBeCloseTo(2.0, 2);
  });

  it('zero benchmark variance → null', () => {
    const benchmark = [0, 0, 0, 0, 0, 0, 0, 0];
    const asset = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.02, -0.02];
    const beta = IndicatorEngine.calculateBeta(asset, benchmark);
    expect(beta).toBeNull();
  });
});

describe('Returns calculation', () => {
  it('returns n-1 elements for n prices', () => {
    const prices = [100, 102, 98, 105];
    const returns = IndicatorEngine.calculateReturns(prices);
    expect(returns.length).toBe(3);
  });

  it('calculates simple returns correctly', () => {
    const prices = [100, 110, 99];
    const returns = IndicatorEngine.calculateReturns(prices);
    expect(returns[0]).toBeCloseTo(0.10, 4); // (110-100)/100
    expect(returns[1]).toBeCloseTo(-0.1, 3); // (99-110)/110
  });

  it('handles zero price gracefully', () => {
    const prices = [0, 100, 200];
    const returns = IndicatorEngine.calculateReturns(prices);
    // First return skipped (division by zero), second = (200-100)/100 = 1.0
    expect(returns).toEqual([1]);
  });

  it('empty prices → empty returns', () => {
    expect(IndicatorEngine.calculateReturns([])).toEqual([]);
    expect(IndicatorEngine.calculateReturns([100])).toEqual([]);
  });
});
