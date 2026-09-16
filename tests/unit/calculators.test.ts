import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  calculatePnL,
  calculateLiquidationPrice,
  calculateFundingFee,
  calculateDca,
} from '@/utils/calculators';

describe('calculatePositionSize', () => {
  it('calculates position size accurately based on stop-loss distance and risk %', () => {
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
    const res = calculatePositionSize({
      accountBalance: 1000,
      riskPercentage: 1,
      entryPrice: 100,
      stopLossPrice: 99,
    });

    expect(res.riskAmountUsd).toBe(10);
    expect(res.positionUsd).toBe(1000);
    expect(res.recommendedLeverage).toBe(1);

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

describe('calculateLiquidationPrice', () => {
  it('calculates accurate LONG liquidation price with maintenance margin', () => {
    // 10x leverage, entry $60,000, MMR 0.5% (0.005)
    // Initial margin rate = 0.10. Liq price = 60000 * (1 - 0.10 + 0.005) = 60000 * 0.905 = $54,300
    const res = calculateLiquidationPrice({
      direction: 'LONG',
      entryPrice: 60000,
      leverage: 10,
      maintenanceMarginRate: 0.005,
    });

    expect(res.liquidationPrice).toBe(54300);
    expect(res.bankruptcyPrice).toBe(54000);
    expect(res.distancePct).toBeCloseTo(9.5, 1);
  });

  it('calculates accurate SHORT liquidation price with maintenance margin', () => {
    // 10x leverage, entry $60,000, MMR 0.5% (0.005)
    // Initial margin rate = 0.10. Liq price = 60000 * (1 + 0.10 - 0.005) = 60000 * 1.095 = $65,700
    const res = calculateLiquidationPrice({
      direction: 'SHORT',
      entryPrice: 60000,
      leverage: 10,
      maintenanceMarginRate: 0.005,
    });

    expect(res.liquidationPrice).toBe(65700);
    expect(res.bankruptcyPrice).toBe(66000);
    expect(res.distancePct).toBeCloseTo(9.5, 1);
  });
});

describe('calculateFundingFee', () => {
  it('computes cumulative funding fees and annualized APR cost', () => {
    // Position: $100,000, 8h funding rate: 0.01% (0.0001), 30 days holding (90 intervals)
    // Fee = 100,000 * 0.0001 * 90 = $900
    const res = calculateFundingFee({
      positionSizeUsd: 100000,
      fundingRate8hPct: 0.01,
      holdingDays: 30,
    });

    expect(res.totalIntervals).toBe(90);
    expect(res.totalFeeUsd).toBe(900);
    expect(res.feePercentageOfPosition).toBeCloseTo(0.9, 1);
    expect(res.annualizedCostPct).toBeCloseTo(10.95, 1);
  });
});

describe('calculateDca', () => {
  it('computes DCA average price, accumulated volume, and ROI', () => {
    // $100 periodic, 4 prices: 100, 80, 50, 100
    // Coins: 1 + 1.25 + 2 + 1 = 5.25 coins. Total invested = $400.
    // Average price = 400 / 5.25 = $76.19
    // Current value at $100 = 5.25 * 100 = $525. Net profit = +$125 (+31.25%)
    const res = calculateDca({
      periodicInvestmentUsd: 100,
      prices: [100, 80, 50, 100],
    });

    expect(res.totalInvestedUsd).toBe(400);
    expect(res.totalUnitsAcquired).toBeCloseTo(5.25, 2);
    expect(res.averageEntryPrice).toBeCloseTo(76.19, 1);
    expect(res.currentPortfolioValue).toBe(525);
    expect(res.netProfitUsd).toBe(125);
    expect(res.roiPct).toBeCloseTo(31.25, 1);
  });
});
