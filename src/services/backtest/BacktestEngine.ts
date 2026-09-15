import { OHLCV, Timeframe } from '@/types/market';
import { IndicatorEngine } from '../indicators/IndicatorEngine';

export interface StrategyRule {
  id: string;
  name: string;
  type: 'RSI_REVERSAL' | 'EMA_CROSS' | 'BREAKOUT';
  parameters: Record<string, number>;
  stopLossPct: number; // e.g. 2.0%
  takeProfitPct: number; // e.g. 4.0%
}

export interface BacktestTrade {
  id: string;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  side: 'LONG' | 'SHORT';
  pnlUsd: number;
  pnlPct: number;
  feesPaid: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_EXIT';
}

export interface BacktestConfig {
  initialCapital?: number; // default $10,000
  positionSizeUsd?: number; // default $2,000
  takerFeePct?: number; // default 0.05% (0.0005)
  slippagePct?: number; // default 0.02% (0.0002)
}

export interface BacktestResult {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  initialCapital: number;
  endingCapital: number;
  netProfitUsd: number;
  netProfitPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number }[];
}

export class BacktestEngine {
  /**
   * Run bar-by-bar historical backtesting with zero look-ahead bias
   */
  public static runBacktest(
    candles: OHLCV[],
    strategy: StrategyRule,
    symbol = 'BTC',
    timeframe: Timeframe = '1h',
    config: BacktestConfig = {}
  ): BacktestResult {
    const initialCapital = config.initialCapital ?? 10000;
    const posSizeUsd = config.positionSizeUsd ?? 2000;
    const takerFeeRate = (config.takerFeePct ?? 0.05) / 100;
    const slippageRate = (config.slippagePct ?? 0.02) / 100;

    let currentCapital = initialCapital;
    let peakCapital = initialCapital;
    let maxDrawdownPct = 0;

    const trades: BacktestTrade[] = [];
    const equityCurve: { time: number; equity: number }[] = [
      { time: candles[0]?.time ?? 0, equity: initialCapital },
    ];

    interface ActivePosition {
      entryTime: number;
      entryPrice: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      sizeContracts: number;
      side: 'LONG' | 'SHORT';
    }

    let activePos: ActivePosition | null = null;

    // Minimum warmup period for indicators
    const warmup = 30;
    if (candles.length <= warmup) {
      return this.createEmptyResult(strategy.name, symbol, timeframe, initialCapital);
    }

    // Step bar-by-bar forward in time (Strict No-Look-Ahead)
    for (let i = warmup; i < candles.length; i++) {
      const currentCandle = candles[i];
      const prevCandles = candles.slice(0, i); // Strictly historical, excludes currentCandle future

      // 1. Manage Active Position Exits
      if (activePos) {
        let exitPrice: number | null = null;
        let exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_EXIT' | null = null;

        // Check if Stop Loss or Take Profit hit during current bar
        if (activePos.side === 'LONG') {
          if (currentCandle.low <= activePos.stopLossPrice) {
            exitPrice = activePos.stopLossPrice * (1 - slippageRate);
            exitReason = 'STOP_LOSS';
          } else if (currentCandle.high >= activePos.takeProfitPrice) {
            exitPrice = activePos.takeProfitPrice * (1 - slippageRate);
            exitReason = 'TAKE_PROFIT';
          }
        }

        if (exitPrice && exitReason) {
          const grossPnl = (exitPrice - activePos.entryPrice) * activePos.sizeContracts;
          const entryFee = activePos.entryPrice * activePos.sizeContracts * takerFeeRate;
          const exitFee = exitPrice * activePos.sizeContracts * takerFeeRate;
          const totalFees = entryFee + exitFee;
          const netPnl = grossPnl - totalFees;
          const pnlPct = (netPnl / (activePos.entryPrice * activePos.sizeContracts)) * 100;

          currentCapital += netPnl;
          if (currentCapital > peakCapital) {
            peakCapital = currentCapital;
          }
          const drawdown = ((peakCapital - currentCapital) / peakCapital) * 100;
          if (drawdown > maxDrawdownPct) {
            maxDrawdownPct = drawdown;
          }

          trades.push({
            id: `trade-${trades.length + 1}`,
            entryTime: activePos.entryTime,
            entryPrice: Number(activePos.entryPrice.toFixed(2)),
            exitTime: currentCandle.time,
            exitPrice: Number(exitPrice.toFixed(2)),
            side: activePos.side,
            pnlUsd: Number(netPnl.toFixed(2)),
            pnlPct: Number(pnlPct.toFixed(2)),
            feesPaid: Number(totalFees.toFixed(2)),
            exitReason,
          });

          equityCurve.push({ time: currentCandle.time, equity: Number(currentCapital.toFixed(2)) });
          activePos = null;
        }
      }

      // 2. Evaluate Entry Signals if No Active Position
      if (!activePos) {
        const isEntrySignal = this.evaluateEntry(prevCandles, strategy);

        if (isEntrySignal) {
          // Enter position at current bar close with slippage
          const entryPrice = currentCandle.close * (1 + slippageRate);
          const sizeContracts = posSizeUsd / entryPrice;
          const stopLossPrice = entryPrice * (1 - strategy.stopLossPct / 100);
          const takeProfitPrice = entryPrice * (1 + strategy.takeProfitPct / 100);

          activePos = {
            entryTime: currentCandle.time,
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            sizeContracts,
            side: 'LONG',
          };
        }
      }
    }

    // Performance Metrics
    const winningTrades = trades.filter((t) => t.pnlUsd > 0);
    const losingTrades = trades.filter((t) => t.pnlUsd <= 0);

    const grossProfit = winningTrades.reduce((acc, t) => acc + t.pnlUsd, 0);
    const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + t.pnlUsd, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 1;

    const winRatePct =
      trades.length > 0 ? Number(((winningTrades.length / trades.length) * 100).toFixed(1)) : 0;
    const netProfitUsd = Number((currentCapital - initialCapital).toFixed(2));
    const netProfitPct = Number(((netProfitUsd / initialCapital) * 100).toFixed(2));

    // Sharpe Ratio calculation (returns standard deviation)
    const returns = trades.map((t) => t.pnlPct);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance =
      returns.length > 1
        ? returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? Number(((avgReturn / stdDev) * Math.sqrt(365)).toFixed(2)) : 0;

    return {
      strategyName: strategy.name,
      symbol,
      timeframe,
      initialCapital,
      endingCapital: Number(currentCapital.toFixed(2)),
      netProfitUsd,
      netProfitPct,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRatePct,
      profitFactor,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      sharpeRatio,
      trades,
      equityCurve,
    };
  }

  private static evaluateEntry(history: OHLCV[], strategy: StrategyRule): boolean {
    const closes = history.map((c) => c.close);
    const len = closes.length;
    if (len < 20) return false;

    if (strategy.type === 'RSI_REVERSAL') {
      const threshold = strategy.parameters.oversoldThreshold ?? 30;
      const rsiSeries = IndicatorEngine.calculateRSI(closes, 14);
      if (rsiSeries.length < 2) return false;
      const currentRsi = rsiSeries[rsiSeries.length - 1];
      const prevRsi = rsiSeries[rsiSeries.length - 2];
      // Crossing back above oversold threshold
      return prevRsi < threshold && currentRsi >= threshold;
    }

    if (strategy.type === 'EMA_CROSS') {
      const fast = strategy.parameters.fastPeriod ?? 9;
      const slow = strategy.parameters.slowPeriod ?? 21;
      const fastEma = IndicatorEngine.calculateEMA(closes, fast);
      const slowEma = IndicatorEngine.calculateEMA(closes, slow);

      if (fastEma.length < 2 || slowEma.length < 2) return false;

      const currFast = fastEma[fastEma.length - 1];
      const prevFast = fastEma[fastEma.length - 2];
      const currSlow = slowEma[slowEma.length - 1];
      const prevSlow = slowEma[slowEma.length - 2];

      return prevFast <= prevSlow && currFast > currSlow;
    }

    if (strategy.type === 'BREAKOUT') {
      const lookback = strategy.parameters.lookback ?? 20;
      if (len < lookback + 1) return false;
      const highLookback = Math.max(...history.slice(-lookback - 1, -1).map((c) => c.high));
      const lastClose = closes[len - 1];
      return lastClose > highLookback;
    }

    return false;
  }

  private static createEmptyResult(
    strategyName: string,
    symbol: string,
    timeframe: Timeframe,
    capital: number
  ): BacktestResult {
    return {
      strategyName,
      symbol,
      timeframe,
      initialCapital: capital,
      endingCapital: capital,
      netProfitUsd: 0,
      netProfitPct: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRatePct: 0,
      profitFactor: 1,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      trades: [],
      equityCurve: [{ time: 0, equity: capital }],
    };
  }
}
