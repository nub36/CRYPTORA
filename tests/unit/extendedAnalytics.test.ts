import { describe, it, expect } from 'vitest';
import { CorrelationEngine, buildCorrelationReport, toLogReturns } from '@/services/analytics/CorrelationEngine';
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

  it('buildCorrelationReport: матрица по фактическим закрытиям, диагональ 1, бета к BTC, исключение коротких рядов', () => {
    const btc = Array.from({ length: 40 }, (_, i) => 100 * Math.exp(0.01 * Math.sin(i)));
    const twice = btc.map((_v, i) => 50 * Math.exp(0.02 * Math.sin(i))); // лог-доходности ×2 → beta 2, r 1
    const inverse = btc.map((_v, i) => 10 * Math.exp(-0.01 * Math.sin(i)));
    const short = [1, 2, 3];
    const rep = buildCorrelationReport({ BTC: btc, TWO: twice, INV: inverse, SHORT: short }, { TWO: 'Two' }, 30);
    expect(rep.excluded).toEqual(['SHORT']);
    expect(rep.assets).toEqual(['BTC', 'TWO', 'INV']);
    expect(rep.windowDays).toBe(30);
    expect(rep.matrix.BTC.BTC).toBe(1);
    expect(rep.matrix.BTC.TWO).toBe(1);
    expect(rep.matrix.BTC.INV).toBe(-1);
    expect(rep.matrix.TWO.INV).toBe(rep.matrix.INV.TWO);
    const two = rep.betas.find((b) => b.symbol === 'TWO')!;
    expect(two.betaToBtc).toBe(2);
    expect(two.name).toBe('Two');
    expect(two.classification).toBe('HIGH_BETA');
    expect(rep.betas.find((b) => b.symbol === 'INV')!.classification).toBe('INVERSE');
    expect(rep.betas.some((b) => b.symbol === 'BTC')).toBe(false);
    // Детерминизм
    expect(buildCorrelationReport({ BTC: btc, TWO: twice, INV: inverse, SHORT: short }, {}, 30)).toEqual({ ...rep, betas: rep.betas.map((b) => ({ ...b, name: b.symbol })) });
  });

  it('buildCorrelationReport: без BTC бет нет; пустой вход → пустой отчёт', () => {
    const rep = buildCorrelationReport({ A: Array.from({ length: 20 }, (_, i) => Math.exp(0.01 * i * i)), B: Array.from({ length: 20 }, (_, i) => Math.exp(-0.01 * i * i)) });
    expect(rep.betas).toEqual([]);
    expect(rep.matrix.A.B).toBe(-1);
    expect(buildCorrelationReport({}).assets).toEqual([]);
    expect(toLogReturns([1, 0, 2])).toEqual([]);
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
