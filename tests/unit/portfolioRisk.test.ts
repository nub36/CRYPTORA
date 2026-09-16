import { describe, it, expect } from 'vitest';
import { PortfolioRiskEngine, PortfolioAssetAllocation } from '@/services/portfolio/PortfolioRiskEngine';

describe('PortfolioRiskEngine Unit Tests (VaR & Stress Testing)', () => {
  const samplePortfolio: PortfolioAssetAllocation[] = [
    { symbol: 'BTC', amountUsd: 50000 }, // 50%
    { symbol: 'ETH', amountUsd: 25000 }, // 25%
    { symbol: 'SOL', amountUsd: 15000 }, // 15%
    { symbol: 'USDT', amountUsd: 10000 }, // 10% cash/stable
  ];

  it('calculates portfolio total value, weights, and weighted beta accurately', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);

    expect(report.totalValueUsd).toBe(100000);
    expect(report.allocations.length).toBe(4);

    const btcAlloc = report.allocations.find((a) => a.symbol === 'BTC');
    expect(btcAlloc?.weightPct).toBe(50);
    expect(btcAlloc?.beta).toBe(1.0);

    // Weighted beta: 0.50*1.0 + 0.25*1.18 + 0.15*1.64 + 0.10*0.0 = 0.50 + 0.295 + 0.246 = 1.04
    expect(report.portfolioBeta).toBeCloseTo(1.04, 1);
  });

  it('calculates Herfindahl-Hirschman Index (HHI) concentration metric', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);
    // HHI = 50^2 + 25^2 + 15^2 + 10^2 = 2500 + 625 + 225 + 100 = 3450 (High concentration in BTC)
    expect(report.hhiConcentrationIndex).toBe(3450);
    expect(report.concentrationRating).toBe('HIGH_CONCENTRATION');

    // Diversified portfolio
    const diversified: PortfolioAssetAllocation[] = [
      { symbol: 'BTC', amountUsd: 20000 },
      { symbol: 'ETH', amountUsd: 20000 },
      { symbol: 'SOL', amountUsd: 20000 },
      { symbol: 'BNB', amountUsd: 20000 },
      { symbol: 'USDT', amountUsd: 20000 },
    ];
    const divReport = PortfolioRiskEngine.calculateRiskReport(diversified);
    // HHI = 5 * 20^2 = 2000 (Moderate concentration)
    expect(divReport.hhiConcentrationIndex).toBe(2000);
    expect(divReport.concentrationRating).toBe('MODERATE_CONCENTRATION');
  });

  it('computes 1-day parametric Value at Risk (VaR 95% and 99%)', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);

    expect(report.dailyVaR95Usd).toBeGreaterThan(0);
    expect(report.dailyVaR99Usd).toBeGreaterThan(report.dailyVaR95Usd); // 99% VaR is always larger than 95% VaR
    expect(report.annualizedVolatilityPct).toBeGreaterThan(20);
  });

  it('simulates historical stress testing crashes and altseason expansions', () => {
    const report = PortfolioRiskEngine.calculateRiskReport(samplePortfolio);
    expect(report.stressTestResults.length).toBe(4);

    const ftxCrash = report.stressTestResults.find((s) => s.id === 'ftx-cascade');
    expect(ftxCrash).toBeDefined();
    expect(ftxCrash?.simulatedPnlUsd).toBeLessThan(0);
    expect(ftxCrash?.survivingValueUsd).toBeLessThan(100000);

    const altseason = report.stressTestResults.find((s) => s.id === 'altseason-expansion');
    expect(altseason).toBeDefined();
    expect(altseason?.simulatedPnlUsd).toBeGreaterThan(0);
  });

  it('safely handles empty or zero allocation inputs', () => {
    const emptyReport = PortfolioRiskEngine.calculateRiskReport([]);
    expect(emptyReport.totalValueUsd).toBe(0);
    expect(emptyReport.allocations.length).toBe(0);
  });
});
