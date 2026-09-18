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
    /** Beta к BTC: computed from candle data, or null if unavailable. */
    beta: number | null;
    /** Annualized volatility: computed from candle data, or null if unavailable. */
    volatility: number | null;
  }[];
  /** Weighted portfolio beta. null if any constituent has null beta. */
  portfolioBeta: number | null;
  /** Weighted annualized volatility. null if any constituent has null volatility. */
  annualizedVolatilityPct: number | null;
  dailyVaR95Usd: number | null;
  dailyVaR95Pct: number | null;
  dailyVaR99Usd: number | null;
  hhiConcentrationIndex: number;
  concentrationRating: 'WELL_DIVERSIFIED' | 'MODERATE_CONCENTRATION' | 'HIGH_CONCENTRATION';
  stressTestResults: StressScenario[];
  /**
   * STATIC_REFERENCE betas/volatilities — from historical model assumptions.
   * Display-only; never used as silent fallback for real calculations.
   * Only populated when overrides lack some symbols.
   */
  staticReferenceUsed: boolean;
}

export interface PortfolioRiskOverrides {
  /** Real betas computed from candle data (symbol → beta). */
  betas?: Record<string, number>;
  /** Real annualized volatilities computed from candle data (symbol → vol). */
  volatilities?: Record<string, number>;
}

/**
 * STATIC_REFERENCE: historical model assumptions for beta/vol.
 * These are ONLY for display as "Справочное допущение β", never silent fallback.
 * Kept for scenario calculator and UI transparency.
 */
const STATIC_REFERENCE_BETAS: Record<string, number> = {
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

const STATIC_REFERENCE_VOLATILITY: Record<string, number> = {
  BTC: 0.52,
  ETH: 0.65,
  SOL: 0.85,
  NEAR: 0.95,
  BNB: 0.48,
  USDT: 0.01,
  USDC: 0.01,
};

export class PortfolioRiskEngine {
  /**
   * Evaluates comprehensive portfolio risk metrics, VaR, HHI, and stress tests.
   * Beta and volatility come ONLY from overrides (real candle data).
   * If overrides are missing, those values are null (UNAVAILABLE), not silently replaced.
   */
  public static calculateRiskReport(
    rawAllocations: PortfolioAssetAllocation[],
    overrides?: PortfolioRiskOverrides,
  ): PortfolioRiskReport {
    const valid = rawAllocations.filter((a) => a.amountUsd > 0);
    const totalValueUsd = valid.reduce((acc, a) => acc + a.amountUsd, 0);

    if (totalValueUsd <= 0 || valid.length === 0) {
      return this.createEmptyReport();
    }

    let staticReferenceUsed = false;

    // 1. Calculate weights; beta/vol from overrides only, null when unavailable
    const allocations = valid.map((a) => {
      const sym = a.symbol.toUpperCase();
      const weightPct = Number(((a.amountUsd / totalValueUsd) * 100).toFixed(2));

      // Stablecoins: beta=0, vol≈0 (deterministic, not a model assumption)
      if (sym === 'USDT' || sym === 'USDC' || sym === 'DAI' || sym === 'BUSD') {
        return { symbol: sym, amountUsd: a.amountUsd, weightPct, beta: 0, volatility: 0.01 };
      }
      // BTC: beta=1.0 by definition (benchmark)
      if (sym === 'BTC') {
        const vol = overrides?.volatilities?.[sym] ?? null;
        return { symbol: sym, amountUsd: a.amountUsd, weightPct, beta: 1.0, volatility: vol };
      }

      const beta = overrides?.betas?.[sym] ?? null;
      const vol = overrides?.volatilities?.[sym] ?? null;

      // If overrides missing, mark that static reference is available but not used
      if (beta === null && STATIC_REFERENCE_BETAS[sym] != null) {
        staticReferenceUsed = true;
      }

      return { symbol: sym, amountUsd: a.amountUsd, weightPct, beta, volatility: vol };
    });

    // 2. Weighted Portfolio Beta — null if any non-stable allocation has null beta
    const nonStableWithBeta = allocations.filter((a) => a.beta != null);
    const allHaveBetas = nonStableWithBeta.length === allocations.length;
    const portfolioBeta = allHaveBetas
      ? Number(
          allocations
            .reduce((acc, a) => acc + (a.weightPct / 100) * (a.beta ?? 0), 0)
            .toFixed(2),
        )
      : null;

    // 3. Herfindahl-Hirschman Index (HHI) — always computable from weights
    const hhiConcentrationIndex = Math.round(
      allocations.reduce((acc, a) => acc + Math.pow(a.weightPct, 2), 0),
    );

    let concentrationRating: 'WELL_DIVERSIFIED' | 'MODERATE_CONCENTRATION' | 'HIGH_CONCENTRATION';
    if (hhiConcentrationIndex < 1800) {
      concentrationRating = 'WELL_DIVERSIFIED';
    } else if (hhiConcentrationIndex <= 3000) {
      concentrationRating = 'MODERATE_CONCENTRATION';
    } else {
      concentrationRating = 'HIGH_CONCENTRATION';
    }

    // 4. Portfolio Annualized Volatility — null if any non-stable allocation has null vol
    const allHaveVols = allocations.every((a) => a.volatility != null);
    const weightedVol = allHaveVols
      ? allocations.reduce((acc, a) => acc + (a.weightPct / 100) * (a.volatility ?? 0), 0)
      : null;
    const annualizedVolatilityPct = weightedVol != null ? Number((weightedVol * 100).toFixed(1)) : null;

    // Daily volatility (365 days in crypto)
    const dailyVol = weightedVol != null ? weightedVol / Math.sqrt(365) : null;

    // 5. Parametric VaR — null if volatility unavailable
    const dailyVaR95Pct = dailyVol != null ? Number((1.65 * dailyVol * 100).toFixed(2)) : null;
    const dailyVaR95Usd = dailyVaR95Pct != null ? Math.round((dailyVaR95Pct / 100) * totalValueUsd) : null;
    const dailyVaR99Pct = dailyVol != null ? Number((2.33 * dailyVol * 100).toFixed(2)) : null;

    // 6. Stress Testing Scenarios — always computable (uses historical scenario shocks, not betas)
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
      dailyVaR99Usd: dailyVaR99Pct != null ? Math.round((dailyVaR99Pct / 100) * totalValueUsd) : null,
      hhiConcentrationIndex,
      concentrationRating,
      stressTestResults,
      staticReferenceUsed,
    };
  }

  /** Get static reference beta for display as "Справочное допущение β" */
  public static getStaticReferenceBeta(symbol: string): number | undefined {
    return STATIC_REFERENCE_BETAS[symbol.toUpperCase()];
  }

  /** Get static reference volatility for display as "Справочное допущение σ" */
  public static getStaticReferenceVolatility(symbol: string): number | undefined {
    return STATIC_REFERENCE_VOLATILITY[symbol.toUpperCase()];
  }

  private static createEmptyReport(): PortfolioRiskReport {
    return {
      totalValueUsd: 0,
      allocations: [],
      portfolioBeta: null,
      annualizedVolatilityPct: null,
      dailyVaR95Usd: null,
      dailyVaR95Pct: null,
      dailyVaR99Usd: null,
      hhiConcentrationIndex: 0,
      concentrationRating: 'WELL_DIVERSIFIED',
      stressTestResults: [],
      staticReferenceUsed: false,
    };
  }
}
