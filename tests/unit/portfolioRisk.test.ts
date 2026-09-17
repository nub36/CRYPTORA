import { describe, it, expect } from 'vitest';
import { PortfolioRiskEngine, PortfolioAssetAllocation, PortfolioRiskOverrides } from '@/services/portfolio/PortfolioRiskEngine';

describe('PortfolioRiskEngine Unit Tests (VaR & Stress Testing)', () => {
  const samplePortfolio: PortfolioAssetAllocation[] = [
    { symbol: 'BTC', amountUsd: 50000 }, // 50%
    { symbol: 'ETH', amountUsd: 25000 }, // 25%
    { symbol: 'SOL', amountUsd: 15000 }, // 15%
    { symbol: 'USDT', amountUsd: 10000 }, // 10% cash/stable
  ];

  // Simulate real overrides (as if computed from candle data)
  const realOverrides: PortfolioRiskOverrides = {
    betas: { ETH: 1.18, SOL: 1.64, NEAR: 1.52, BNB: 0.85, XRP: 1.1, ADA: 1.25, DOGE: 1.75, AVAX: 1.55, SUI: 1.7 },
    volatilities: { BTC: 0.52, ETH: 0.65, SOL: 0.85, NEAR: 0.95, BNB: 0.48 },
  };

  it('calculates portfolio total value, weights, and weighted beta accurately (with overrides)', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio, realOverrides);

    expect(report.totalValueUsd).toBe(100000);
    expect(report.allocations.length).toBe(4);

    const btcAlloc = report.allocations.find((a) => a.symbol === 'BTC');
    expect(btcAlloc?.weightPct).toBe(50);
    expect(btcAlloc?.beta).toBe(1.0);

    // Weighted beta: 0.50*1.0 + 0.25*1.18 + 0.15*1.64 + 0.10*0.0 = 0.50 + 0.295 + 0.246 = 1.04
    expect(report.portfolioBeta).toBeCloseTo(1.04, 1);
  });

  it('calculates HHI concentration metric (always computable from weights)', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);
    // HHI = 50^2 + 25^2 + 15^2 + 10^2 = 2500 + 625 + 225 + 100 = 3450
    expect(report.hhiConcentrationIndex).toBe(3450);
    expect(report.concentrationRating).toBe('HIGH_CONCENTRATION');

    const diversified: PortfolioAssetAllocation[] = [
      { symbol: 'BTC', amountUsd: 20000 },
      { symbol: 'ETH', amountUsd: 20000 },
      { symbol: 'SOL', amountUsd: 20000 },
      { symbol: 'BNB', amountUsd: 20000 },
      { symbol: 'USDT', amountUsd: 20000 },
    ];
    const divReport = PortfolioRiskEngine.calculateRiskReport(diversified);
    expect(divReport.hhiConcentrationIndex).toBe(2000);
    expect(divReport.concentrationRating).toBe('MODERATE_CONCENTRATION');
  });

  it('computes 1-day VaR ONLY with real overrides (no silent fallback)', () => {
    const withOverrides = PortfolioRiskEngine.calculateRiskReport(samplePortfolio, realOverrides);
    expect(withOverrides.dailyVaR95Usd).toBeGreaterThan(0);
    expect(withOverrides.dailyVaR99Usd!).toBeGreaterThan(withOverrides.dailyVaR95Usd!);
    expect(withOverrides.annualizedVolatilityPct!).toBeGreaterThan(20);

    // Without overrides: null (UNAVAILABLE), not a fake number
    const withoutOverrides = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);
    expect(withoutOverrides.dailyVaR95Usd).toBeNull();
    expect(withoutOverrides.dailyVaR95Pct).toBeNull();
    expect(withoutOverrides.annualizedVolatilityPct).toBeNull();
    expect(withoutOverrides.portfolioBeta).toBeNull();
    expect(withoutOverrides.staticReferenceUsed).toBe(true);
  });

  it('REGRESSION: no silent static beta fallback', () => {
    // Without overrides, ETH beta must be null, not silently 1.18 from static table
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);
    const eth = report.allocations.find((a) => a.symbol === 'ETH');
    expect(eth?.beta).toBeNull(); // NOT 1.18 from static table

    // BTC is deterministic (beta=1.0 by definition)
    const btc = report.allocations.find((a) => a.symbol === 'BTC');
    expect(btc?.beta).toBe(1.0);

    // USDT is deterministic (beta=0 for stables)
    const usdt = report.allocations.find((a) => a.symbol === 'USDT');
    expect(usdt?.beta).toBe(0);

    // staticReferenceUsed flags that reference values exist but were NOT used
    expect(report.staticReferenceUsed).toBe(true);
  });

  it('simulates historical stress testing crashes and altseason expansions (always computable)', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio, realOverrides);
    expect(report.stressTestResults.length).toBe(4);

    const ftxCrash = report.stressTestResults.find((s) => s.id === 'ftx-cascade');
    expect(ftxCrash).toBeDefined();
    expect(ftxCrash?.simulatedPnlUsd).toBeLessThan(0);
    expect(ftxCrash?.survivingValueUsd).toBeLessThan(100000);

    const altseason = report.stressTestResults.find((s) => s.id === 'altseason-expansion');
    expect(altseason).toBeDefined();
    expect(altseason?.simulatedPnlUsd).toBeGreaterThan(0);

    // Stress tests also work without overrides (uses scenario shocks, not betas)
    const noOverrides = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);
    expect(noOverrides.stressTestResults.length).toBe(4);
    expect(noOverrides.stressTestResults[0].simulatedPnlUsd).toBeLessThan(0);
  });

  it('safely handles empty or zero allocation inputs', () => {
    const emptyReport = PortfolioRiskEngine.calculateRiskReport([]);
    expect(emptyReport.totalValueUsd).toBe(0);
    expect(emptyReport.allocations.length).toBe(0);
    expect(emptyReport.portfolioBeta).toBeNull();
  });
});
