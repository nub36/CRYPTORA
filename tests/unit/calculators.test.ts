import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  calculatePnL,
} from '@/utils/calculators';

describe('calculatePositionSize', () => {
  it('calculates position size accurately based on stop-loss distance and risk %', () => {
    // Balance: $10,000, Risk: 2% ($200), Entry: $65,000, Stop Loss: $63,700 ($1,300 distance = 2%)
    const res = calculatePositionSize({
      accountBalance: 10000,
      riskPercentage: 2,
      entryPrice: 65000,
      stopLossPrice: 63700,
    });

    expect(res.riskAmountUsd).toBe(200);
    expect(res.stopLossDistanceUsd).toBe(1300);
    expect(res.stopLossDistancePct).toBeCloseTo(2.0, 1);
    expect(res.positionUnits).toBeCloseTo(200 / 1300, 4);
    expect(res.positionUsd).toBeCloseTo(10000, 1);
    expect(res.recommendedLeverage).toBe(1);
  });

  it('calculates required leverage when stop loss is tight', () => {
    // Balance: $1,000, Risk: 1% ($10), Entry: $100, Stop Loss: $99 ($1 distance = 1%)
    // Position Units = 10 / 1 = 10 units -> $1,000 Notional
    // Recommended leverage = 1x
    const res = calculatePositionSize({
      accountBalance: 1000,
      riskPercentage: 1,
      entryPrice: 100,
      stopLossPrice: 99,
    });

    expect(res.riskAmountUsd).toBe(10);
    expect(res.positionUsd).toBe(1000);
    expect(res.recommendedLeverage).toBe(1);

    // If stop loss is 0.5% ($99.50)
    // Position Units = 10 / 0.5 = 20 units -> $2,000 Notional -> 2x leverage
    const resTight = calculatePositionSize({
      accountBalance: 1000,
      riskPercentage: 1,
      entryPrice: 100,
      stopLossPrice: 99.5,
    });

    expect(resTight.positionUsd).toBe(2000);
    expect(resTight.recommendedLeverage).toBe(2);
  });

  it('protects against invalid or zero inputs', () => {
    const res = calculatePositionSize({
      accountBalance: 0,
      riskPercentage: 2,
      entryPrice: 50000,
      stopLossPrice: 48000,
    });
    expect(res.positionUsd).toBe(0);
    expect(res.positionUnits).toBe(0);
  });
});

describe('calculatePnL', () => {
  it('calculates LONG profit correctly with leverage', () => {
    // Margin: $1,000, 10x leverage ($10,000 position), Entry: $50,000, Exit: $55,000 (+10% price move)
    // PnL should be +$1,000, ROE should be +100%
    const res = calculatePnL({
      direction: 'LONG',
      margin: 1000,
      leverage: 10,
      entryPrice: 50000,
      exitPrice: 55000,
    });

    expect(res.positionUsd).toBe(10000);
    expect(res.priceDeltaPct).toBeCloseTo(10, 1);
    expect(res.pnlUsd).toBeCloseTo(1000, 1);
    expect(res.roePct).toBeCloseTo(100, 1);
  });

  it('calculates SHORT profit correctly when price drops', () => {
    // Margin: $1,000, 5x leverage ($5,000 position), Entry: $100, Exit: $90 (-10% price move)
    // PnL should be +$500, ROE should be +50%
    const res = calculatePnL({
      direction: 'SHORT',
      margin: 1000,
      leverage: 5,
      entryPrice: 100,
      exitPrice: 90,
    });

    expect(res.positionUsd).toBe(5000);
    expect(res.pnlUsd).toBeCloseTo(500, 1);
    expect(res.roePct).toBeCloseTo(50, 1);
  });

  it('calculates SHORT loss correctly when price rises', () => {
    // Margin: $500, 10x leverage ($5,000 position), Entry: $100, Exit: $105 (+5% price move)
    // PnL should be -$250, ROE should be -50%
    const res = calculatePnL({
      direction: 'SHORT',
      margin: 500,
      leverage: 10,
      entryPrice: 100,
      exitPrice: 105,
    });

    expect(res.pnlUsd).toBeCloseTo(-250, 1);
    expect(res.roePct).toBeCloseTo(-50, 1);
  });
});
