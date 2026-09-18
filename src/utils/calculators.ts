/**
 * Financial and risk calculators for CRYPTORA
 */

export interface PositionSizeInput {
  accountBalance: number;
  riskPercentage: number; // e.g. 1% or 2%
  entryPrice: number;
  stopLossPrice: number;
}

export interface PositionSizeResult {
  riskAmountUsd: number;
  stopLossDistanceUsd: number;
  stopLossDistancePct: number;
  positionUnits: number;
  positionUsd: number;
  recommendedLeverage: number;
}

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const { accountBalance, riskPercentage, entryPrice, stopLossPrice } = input;

  if (accountBalance <= 0 || riskPercentage <= 0 || entryPrice <= 0 || stopLossPrice <= 0) {
    return {
      riskAmountUsd: 0,
      stopLossDistanceUsd: 0,
      stopLossDistancePct: 0,
      positionUnits: 0,
      positionUsd: 0,
      recommendedLeverage: 1,
    };
  }

  const riskAmountUsd = accountBalance * (riskPercentage / 100);
  const stopLossDistanceUsd = Math.abs(entryPrice - stopLossPrice);

  if (stopLossDistanceUsd === 0) {
    return {
      riskAmountUsd,
      stopLossDistanceUsd: 0,
      stopLossDistancePct: 0,
      positionUnits: 0,
      positionUsd: 0,
      recommendedLeverage: 1,
    };
  }

  const stopLossDistancePct = (stopLossDistanceUsd / entryPrice) * 100;
  const positionUnits = riskAmountUsd / stopLossDistanceUsd;
  const positionUsd = positionUnits * entryPrice;
  const recommendedLeverage = Math.max(1, Math.ceil(positionUsd / accountBalance));

  return {
    riskAmountUsd,
    stopLossDistanceUsd,
    stopLossDistancePct,
    positionUnits,
    positionUsd,
    recommendedLeverage,
  };
}

export interface PnLInput {
  direction: 'LONG' | 'SHORT';
  margin: number;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
}

export interface PnLResult {
  positionUsd: number;
  pnlUsd: number;
  priceDeltaPct: number;
  roePct: number;
}

export function calculatePnL(input: PnLInput): PnLResult {
  const { direction, margin, leverage, entryPrice, exitPrice } = input;

  if (margin <= 0 || leverage <= 0 || entryPrice <= 0 || exitPrice <= 0) {
    return {
      positionUsd: 0,
      pnlUsd: 0,
      priceDeltaPct: 0,
      roePct: 0,
    };
  }

  const positionUsd = margin * leverage;
  const coinQuantity = positionUsd / entryPrice;

  let priceDeltaPct: number;
  let pnlUsd: number;

  if (direction === 'LONG') {
    priceDeltaPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    pnlUsd = coinQuantity * (exitPrice - entryPrice);
  } else {
    priceDeltaPct = ((entryPrice - exitPrice) / entryPrice) * 100;
    pnlUsd = coinQuantity * (entryPrice - exitPrice);
  }

  const roePct = (pnlUsd / margin) * 100;

  return {
    positionUsd,
    pnlUsd,
    priceDeltaPct,
    roePct,
  };
}

export interface LiquidationPriceInput {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  leverage: number;
  maintenanceMarginRate?: number; // default 0.005 (0.5%)
}

export interface LiquidationPriceResult {
  liquidationPrice: number;
  distancePct: number;
  bankruptcyPrice: number;
}

export function calculateLiquidationPrice(input: LiquidationPriceInput): LiquidationPriceResult {
  const { direction, entryPrice, leverage, maintenanceMarginRate = 0.005 } = input;

  if (entryPrice <= 0 || leverage <= 0) {
    return { liquidationPrice: 0, distancePct: 0, bankruptcyPrice: 0 };
  }

  const initialMarginRate = 1 / leverage;

  if (direction === 'LONG') {
    const bankruptcyPrice = entryPrice * (1 - initialMarginRate);
    const liquidationPrice = Math.max(0, entryPrice * (1 - initialMarginRate + maintenanceMarginRate));
    const distancePct = ((entryPrice - liquidationPrice) / entryPrice) * 100;
    return {
      liquidationPrice: Number(liquidationPrice.toFixed(2)),
      distancePct: Number(distancePct.toFixed(2)),
      bankruptcyPrice: Number(bankruptcyPrice.toFixed(2)),
    };
  } else {
    const bankruptcyPrice = entryPrice * (1 + initialMarginRate);
    const liquidationPrice = entryPrice * (1 + initialMarginRate - maintenanceMarginRate);
    const distancePct = ((liquidationPrice - entryPrice) / entryPrice) * 100;
    return {
      liquidationPrice: Number(liquidationPrice.toFixed(2)),
      distancePct: Number(distancePct.toFixed(2)),
      bankruptcyPrice: Number(bankruptcyPrice.toFixed(2)),
    };
  }
}

export interface FundingFeeInput {
  positionSizeUsd: number;
  fundingRate8hPct: number; // e.g. 0.01 for 0.01%
  holdingDays: number;
}

export interface FundingFeeResult {
  totalIntervals: number;
  totalFeeUsd: number;
  feePercentageOfPosition: number;
  annualizedCostPct: number;
}

export function calculateFundingFee(input: FundingFeeInput): FundingFeeResult {
  const { positionSizeUsd, fundingRate8hPct, holdingDays } = input;

  if (positionSizeUsd <= 0 || holdingDays <= 0) {
    return {
      totalIntervals: 0,
      totalFeeUsd: 0,
      feePercentageOfPosition: 0,
      annualizedCostPct: 0,
    };
  }

  const intervalsPerDay = 3; // 8-hour intervals
  const totalIntervals = holdingDays * intervalsPerDay;
  const ratePerInterval = fundingRate8hPct / 100;
  const totalFeeUsd = positionSizeUsd * ratePerInterval * totalIntervals;
  const feePercentageOfPosition = (totalFeeUsd / positionSizeUsd) * 100;
  const annualizedCostPct = fundingRate8hPct * 3 * 365;

  return {
    totalIntervals,
    totalFeeUsd: Number(totalFeeUsd.toFixed(2)),
    feePercentageOfPosition: Number(feePercentageOfPosition.toFixed(2)),
    annualizedCostPct: Number(annualizedCostPct.toFixed(2)),
  };
}

export interface DcaInput {
  periodicInvestmentUsd: number;
  prices: number[];
}

export interface DcaResult {
  totalInvestedUsd: number;
  totalUnitsAcquired: number;
  averageEntryPrice: number;
  currentPortfolioValue: number;
  netProfitUsd: number;
  roiPct: number;
}

export function calculateDca(input: DcaInput): DcaResult {
  const { periodicInvestmentUsd, prices } = input;

  if (periodicInvestmentUsd <= 0 || !prices || prices.length === 0) {
    return {
      totalInvestedUsd: 0,
      totalUnitsAcquired: 0,
      averageEntryPrice: 0,
      currentPortfolioValue: 0,
      netProfitUsd: 0,
      roiPct: 0,
    };
  }

  const validPrices = prices.filter((p) => p > 0);
  if (validPrices.length === 0) {
    return {
      totalInvestedUsd: 0,
      totalUnitsAcquired: 0,
      averageEntryPrice: 0,
      currentPortfolioValue: 0,
      netProfitUsd: 0,
      roiPct: 0,
    };
  }

  const totalInvestedUsd = periodicInvestmentUsd * validPrices.length;
  let totalUnitsAcquired = 0;

  for (const price of validPrices) {
    totalUnitsAcquired += periodicInvestmentUsd / price;
  }

  const averageEntryPrice = totalInvestedUsd / totalUnitsAcquired;
  const currentPrice = validPrices[validPrices.length - 1];
  const currentPortfolioValue = totalUnitsAcquired * currentPrice;
  const netProfitUsd = currentPortfolioValue - totalInvestedUsd;
  const roiPct = (netProfitUsd / totalInvestedUsd) * 100;

  return {
    totalInvestedUsd: Number(totalInvestedUsd.toFixed(2)),
    totalUnitsAcquired: Number(totalUnitsAcquired.toFixed(6)),
    averageEntryPrice: Number(averageEntryPrice.toFixed(2)),
    currentPortfolioValue: Number(currentPortfolioValue.toFixed(2)),
    netProfitUsd: Number(netProfitUsd.toFixed(2)),
    roiPct: Number(roiPct.toFixed(2)),
  };
}
