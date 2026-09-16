export interface PortfolioAssetAllocation {
  symbol: string;
  amountUsd: number;
}

export interface StressScenario {
  id: string;
  name: string;
  historicalPeriod: string;
  description: string;
  simulatedPnlUsd: number;
  simulatedPnlPct: number;
  survivingValueUsd: number;
}

export interface PortfolioRiskReport {
  totalValueUsd: number;
  allocations: {
    symbol: string;
    amountUsd: number;
    weightPct: number;
    beta: number;
  }[];
  portfolioBeta: number;
  annualizedVolatilityPct: number;
  dailyVaR95Usd: number;
  dailyVaR95Pct: number;
  dailyVaR99Usd: number;
  hhiConcentrationIndex: number;
  concentrationRating: 'WELL_DIVERSIFIED' | 'MODERATE_CONCENTRATION' | 'HIGH_CONCENTRATION';
  stressTestResults: StressScenario[];
}

export class PortfolioRiskEngine {
  // Asset beta reference relative to BTC
  private static readonly ASSET_BETAS: Record<string, number> = {
    BTC: 1.0,
    ETH: 1.18,
    SOL: 1.64,
    NEAR: 1.52,
    BNB: 0.85,
    XRP: 1.1,
    ADA: 1.25,
    DOGE: 1.75,
    AVAX: 1.55,
    SUI: 1.7,
    USDT: 0.0,
    USDC: 0.0,
  };

  // Approximate annualized volatilities
  private static readonly ASSET_VOLATILITY: Record<string, number> = {
    BTC: 0.52, // 52%
    ETH: 0.65, // 65%
    SOL: 0.85, // 85%
    NEAR: 0.95, // 95%
    BNB: 0.48, // 48%
    USDT: 0.01, // 1%
    USDC: 0.01, // 1%
  };

  /**
   * Evaluates comprehensive portfolio risk metrics, VaR, HHI, and stress tests
   */
  public static calculateRiskReport(rawAllocations: PortfolioAssetAllocation[]): PortfolioRiskReport {
    const valid = rawAllocations.filter((a) => a.amountUsd > 0);
    const totalValueUsd = valid.reduce((acc, a) => acc + a.amountUsd, 0);

    if (totalValueUsd <= 0 || valid.length === 0) {
      return this.createEmptyReport();
    }

    // 1. Calculate weights and individual betas
    const allocations = valid.map((a) => {
      const sym = a.symbol.toUpperCase();
      const weightPct = Number(((a.amountUsd / totalValueUsd) * 100).toFixed(2));
      const beta = this.ASSET_BETAS[sym] ?? 1.3;
      return {
        symbol: sym,
        amountUsd: a.amountUsd,
        weightPct,
        beta,
      };
    });

    // 2. Weighted Portfolio Beta
    const portfolioBeta = Number(
      allocations
        .reduce((acc, a) => acc + (a.weightPct / 100) * a.beta, 0)
        .toFixed(2)
    );

    // 3. Herfindahl-Hirschman Index (HHI)
    const hhiConcentrationIndex = Math.round(
      allocations.reduce((acc, a) => acc + Math.pow(a.weightPct, 2), 0)
    );

    let concentrationRating: 'WELL_DIVERSIFIED' | 'MODERATE_CONCENTRATION' | 'HIGH_CONCENTRATION';
    if (hhiConcentrationIndex < 1800) {
      concentrationRating = 'WELL_DIVERSIFIED';
    } else if (hhiConcentrationIndex <= 3000) {
      concentrationRating = 'MODERATE_CONCENTRATION';
    } else {
      concentrationRating = 'HIGH_CONCENTRATION';
    }

    // 4. Portfolio Annualized Volatility estimation
    // Approx weighted sum with asset correlation factor
    const weightedVol = allocations.reduce((acc, a) => {
      const vol = this.ASSET_VOLATILITY[a.symbol] ?? 0.8;
      return acc + (a.weightPct / 100) * vol;
    }, 0);
    const annualizedVolatilityPct = Number((weightedVol * 100).toFixed(1));

    // Daily volatility (assuming 365 days in crypto)
    const dailyVol = weightedVol / Math.sqrt(365);

    // 5. Parametric Value at Risk (1-Day VaR)
    // 95% confidence Z = 1.65, 99% confidence Z = 2.33
    const dailyVaR95Pct = Number((1.65 * dailyVol * 100).toFixed(2));
    const dailyVaR95Usd = Math.round((dailyVaR95Pct / 100) * totalValueUsd);
    const dailyVaR99Pct = Number((2.33 * dailyVol * 100).toFixed(2));
    const dailyVaR99Usd = Math.round((dailyVaR99Pct / 100) * totalValueUsd);

    // 6. Stress Testing Scenarios
    const stressScenariosDef = [
      {
        id: 'ftx-cascade',
        name: 'FTX / Luna Liquidity Cascade',
        historicalPeriod: 'Ноябрь 2022',
        description: 'Каскадный делевериджинг рынка: падение альткоинов на -45%, BTC на -25%, стейблкоины сохраняют привязку.',
        assetShocks: { BTC: -0.25, ETH: -0.35, DEFAULT_ALT: -0.45, STABLE: 0.0 },
      },
      {
        id: 'covid-liquidity-crunch',
        name: 'March 2020 Liquidity Crunch',
        historicalPeriod: 'Март 2020',
        description: 'Глобальный шок ликвидности: крах Bitcoin на -50%, альткоинов на -55%. Бегство в кэш.',
        assetShocks: { BTC: -0.5, ETH: -0.52, DEFAULT_ALT: -0.55, STABLE: 0.0 },
      },
      {
        id: 'hawkish-fed-shock',
        name: 'Резкое ужесточение ДКП ФРС',
        historicalPeriod: 'Макро-шок',
        description: 'Рост индекса доллара DXY, отток с крипторынка: BTC -15%, альткоины -25%.',
        assetShocks: { BTC: -0.15, ETH: -0.18, DEFAULT_ALT: -0.25, STABLE: 0.0 },
      },
      {
        id: 'altseason-expansion',
        name: 'Altseason Expansion (Эйфория)',
        historicalPeriod: 'Бычий суперцикл',
        description: 'Массированный переток капитала в альткоины: рост альтов на +80%, BTC на +20%.',
        assetShocks: { BTC: 0.2, ETH: 0.45, DEFAULT_ALT: 0.8, STABLE: 0.0 },
      },
    ];

    const stressTestResults: StressScenario[] = stressScenariosDef.map((sc) => {
      let scenarioPnl = 0;

      for (const a of allocations) {
        let shock = sc.assetShocks.DEFAULT_ALT;
        if (a.symbol === 'BTC') shock = sc.assetShocks.BTC;
        else if (a.symbol === 'ETH') shock = sc.assetShocks.ETH;
        else if (a.symbol === 'USDT' || a.symbol === 'USDC') shock = sc.assetShocks.STABLE;

        scenarioPnl += a.amountUsd * shock;
      }

      const survivingValueUsd = Math.max(0, Math.round(totalValueUsd + scenarioPnl));
      const simulatedPnlPct = Number(((scenarioPnl / totalValueUsd) * 100).toFixed(2));

      return {
        id: sc.id,
        name: sc.name,
        historicalPeriod: sc.historicalPeriod,
        description: sc.description,
        simulatedPnlUsd: Math.round(scenarioPnl),
        simulatedPnlPct,
        survivingValueUsd,
      };
    });

    return {
      totalValueUsd,
      allocations,
      portfolioBeta,
      annualizedVolatilityPct,
      dailyVaR95Usd,
      dailyVaR95Pct,
      dailyVaR99Usd,
      hhiConcentrationIndex,
      concentrationRating,
      stressTestResults,
    };
  }

  private static createEmptyReport(): PortfolioRiskReport {
    return {
      totalValueUsd: 0,
      allocations: [],
      portfolioBeta: 1.0,
      annualizedVolatilityPct: 0,
      dailyVaR95Usd: 0,
      dailyVaR95Pct: 0,
      dailyVaR99Usd: 0,
      hhiConcentrationIndex: 0,
      concentrationRating: 'WELL_DIVERSIFIED',
      stressTestResults: [],
    };
  }
}
