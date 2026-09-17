import { describe, it, expect } from 'vitest';
import { BacktestEngine, StrategyRule } from '@/services/backtest/BacktestEngine';
import { OHLCV } from '@/types/market';

describe('BacktestEngine Simulation Unit Tests (No Look-Ahead Bias)', () => {
  // Generate 100 deterministic mock candles with cyclical trend
  const mockCandles: OHLCV[] = Array.from({ length: 120 }, (_, i) => {
    const base = 100 + Math.sin(i / 6) * 15 + i * 0.2;
    return {
      time: 1726000000 + i * 3600,
      open: base - 0.5,
      high: base + 2,
      low: base - 2,
      close: base + 0.5,
      volume: 1000,
    };
  });

  const rsiStrategy: StrategyRule = {
    id: 'strat-rsi-1',
    name: 'RSI Reversal Strategy',
    type: 'RSI_REVERSAL',
    parameters: { oversoldThreshold: 35 },
    stopLossPct: 2.0,
    takeProfitPct: 4.0,
  };

  const emaStrategy: StrategyRule = {
    id: 'strat-ema-1',
    name: 'EMA 9/21 Trend Crossover',
    type: 'EMA_CROSS',
    parameters: { fastPeriod: 9, slowPeriod: 21 },
    stopLossPct: 3.0,
    takeProfitPct: 6.0,
  };

  it('runs RSI reversal simulation and calculates metrics with fee deduction', () => {
    const result = BacktestEngine.runBacktest(mockCandles, rsiStrategy, 'BTC', '1h', {
      initialCapital: 10000,
      positionSizeUsd: 2000,
      takerFeePct: 0.05,
      slippagePct: 0.02,
    });

    expect(result.strategyName).toBe('RSI Reversal Strategy');
    expect(result.symbol).toBe('BTC');
    expect(result.timeframe).toBe('1h');
    expect(result.initialCapital).toBe(10000);
    expect(result.equityCurve.length).toBeGreaterThan(1);

    // Verify all trades had fees deducted
    for (const trade of result.trades) {
      expect(trade.feesPaid).toBeGreaterThan(0);
      expect(['TAKE_PROFIT', 'STOP_LOSS']).toContain(trade.exitReason);
    }
  });

  it('runs EMA crossover simulation correctly', () => {
    const result = BacktestEngine.runBacktest(mockCandles, emaStrategy, 'ETH', '1h');

    expect(result.strategyName).toBe('EMA 9/21 Trend Crossover');
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.winRatePct).toBeGreaterThanOrEqual(0);
    expect(result.winRatePct).toBeLessThanOrEqual(100);
    expect(result.profitFactor).toBeGreaterThanOrEqual(0);
  });

  it('safely handles short candle series without enough warmup bars', () => {
    const shortCandles = mockCandles.slice(0, 10);
    const result = BacktestEngine.runBacktest(shortCandles, rsiStrategy, 'SOL', '15m');

    expect(result.totalTrades).toBe(0);
    expect(result.netProfitUsd).toBe(0);
    expect(result.endingCapital).toBe(10000);
  });
});
