import { describe, it, expect } from 'vitest';
import { CorrelationEngine } from '@/services/analytics/CorrelationEngine';
import { OnChainService } from '@/services/analytics/OnChainService';
import { JournalService } from '@/services/journal/JournalService';

describe('CorrelationEngine Unit Tests', () => {
  it('computes exact Pearson correlation coefficient', () => {
    const seriesA = [10, 20, 30, 40, 50];
    const seriesB = [20, 40, 60, 80, 100];
    const rPositive = CorrelationEngine.calculatePearsonCorrelation(seriesA, seriesB);
    expect(rPositive).toBe(1.0);

    const seriesC = [50, 40, 30, 20, 10];
    const rNegative = CorrelationEngine.calculatePearsonCorrelation(seriesA, seriesC);
    expect(rNegative).toBe(-1.0);
  });

  it('computes Beta relative to benchmark correctly', () => {
    // Asset moves 2x compared to benchmark
    const bench = [1, 2, 3, 4, 5];
    const asset = [2, 4, 6, 8, 10];
    const beta = CorrelationEngine.calculateBeta(asset, bench);
    expect(beta).toBe(2.0);
  });

  it('provides precomputed macro correlation matrix and beta rankings', () => {
    const { assets, matrix } = CorrelationEngine.getMacroCorrelationMatrix();
    expect(assets.length).toBeGreaterThan(5);
    expect(matrix.BTC.BTC).toBe(1.0);
    expect(matrix.BTC.ETH).toBeGreaterThan(0.7);

    const rankings = CorrelationEngine.getBetaRankings();
    expect(rankings.length).toBeGreaterThan(0);
    expect(rankings[0].symbol).toBe('SOL');
    expect(rankings[0].classification).toBe('HIGH_BETA');
  });
});

describe('OnChainService Unit Tests', () => {
  it('retrieves on-chain valuation metrics and exchange flows', () => {
    const metrics = OnChainService.getMacroMetrics();
    expect(metrics.length).toBeGreaterThan(4);

    const mvrv = metrics.find((m) => m.id === 'btc-mvrv');
    expect(mvrv).toBeDefined();
    expect(mvrv?.numericValue).toBeGreaterThan(0);

    const flows = OnChainService.getExchangeFlows();
    expect(flows.length).toBeGreaterThan(0);
    expect(flows[0].exchange).toBe('Binance');
    expect(flows[0].netflowBtc).toBeLessThan(0); // net outflow
  });
});

describe('JournalService Unit Tests (Trade Journal / Manual Reflection Log)', () => {
  it('manages journal entries and calculates transparent discipline and performance stats', () => {
    const journal = JournalService.getInstance();
    const initialEntries = journal.getEntries();
    expect(initialEntries.length).toBeGreaterThan(0);

    const summary = journal.getSummary();
    expect(summary.totalTrades).toBe(initialEntries.length);
    expect(summary.winRatePct).toBeGreaterThan(0);
    expect(summary.avgDisciplineScore).toBeGreaterThanOrEqual(1);
    expect(summary.avgDisciplineScore).toBeLessThanOrEqual(5);

    // Add entry
    const newEntry = journal.addEntry({
      date: new Date().toISOString(),
      symbol: 'AVAX',
      direction: 'LONG',
      entryPrice: 28.5,
      exitPrice: 31.0,
      positionSizeUsd: 1000,
      pnlUsd: 87.72,
      pnlPct: 8.77,
      setupReason: 'Пробой нисходящего клина',
      reflection: 'Соблюден риск-менеджмент',
      disciplineScore: 5,
      tags: ['Wedge Breakout', 'Discipline'],
    });

    expect(newEntry.id).toBeDefined();
    expect(journal.getEntries().length).toBe(initialEntries.length + 1);

    // Clean up
    const deleted = journal.deleteEntry(newEntry.id);
    expect(deleted).toBe(true);
    expect(journal.getEntries().length).toBe(initialEntries.length);
  });
});
