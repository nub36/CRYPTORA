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
