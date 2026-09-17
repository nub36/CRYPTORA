import { describe, it, expect } from 'vitest';
import { CorrelationEngine, buildCorrelationReport, toLogReturns } from '@/services/analytics/CorrelationEngine';
import { OnChainService, hashrateChangePct } from '@/services/analytics/OnChainService';
import { MempoolSpaceAdapter } from '@/services/data/adapters/MempoolSpaceAdapter';
import { AdapterNetworkError } from '@/services/data/adapters/errors';
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

describe('OnChainService (mempool.space, mocked fetch)', () => {
  const now = 1_800_000_000_000;
  const body: Record<string, unknown> = {
    '/api/v1/mining/hashrate/3d': {
      hashrates: [
        { timestamp: 1, avgHashrate: 600e18 },
        { timestamp: 2, avgHashrate: 630e18 },
      ],
      currentHashrate: 650e18,
      currentDifficulty: 120e12,
    },
    '/api/v1/difficulty-adjustment': { progressPercent: 40, difficultyChange: 2.345, remainingBlocks: 1200, estimatedRetargetDate: now + 8 * 86400000 },
    '/api/v1/fees/recommended': { fastestFee: 12, halfHourFee: 10, hourFee: 8, economyFee: 4, minimumFee: 1 },
    '/api/mempool': { count: 25000, vsize: 12_500_000, total_fee: 25_000_000 },
    '/api/blocks/tip/height': 915000,
  };
  const mockFetch = (failPath?: string): typeof fetch =>
    (async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      if (path === failPath) return new Response('x', { status: 503 });
      return new Response(JSON.stringify(body[path]), { status: 200 });
    }) as typeof fetch;

  it('builds report from five endpoints; hashrate Δ from 3d series', async () => {
    OnChainService.resetCache();
    const r = await OnChainService.fetchReport(new MempoolSpaceAdapter({ fetchFn: mockFetch() }), now);
    expect(r.source).toBe('mempool.space');
    expect(r.tipHeight).toBe(915000);
    const hr = r.metrics.find((m) => m.id === 'btc-hashrate')!;
    expect(hr.value).toBe('650 EH/s');
    expect(hr.change).toBe(5);
    const diff = r.metrics.find((m) => m.id === 'btc-difficulty')!;
    expect(diff.value).toBe('120.00 T');
    expect(diff.change).toBe(2.35);
    expect(r.metrics.some((m) => /MVRV|NUPL/.test(m.name))).toBe(false);
  });

  it('fails as a whole if any endpoint fails (no static fallback)', async () => {
    OnChainService.resetCache();
    await expect(OnChainService.fetchReport(new MempoolSpaceAdapter({ fetchFn: mockFetch('/api/mempool') }), now)).rejects.toBeInstanceOf(
      AdapterNetworkError,
    );
  });

  it('hashrateChangePct is null for short series', () => {
    expect(hashrateChangePct({ hashrates: [{ timestamp: 1, avgHashrate: 1 }], currentHashrate: 1, currentDifficulty: 1 })).toBeNull();
  });
});

describe('JournalService Unit Tests (Trade Journal / Manual Reflection Log)', () => {
  it('manages journal entries and calculates transparent discipline and performance stats', () => {
    const journal = JournalService.getInstance();
    const initialEntries = journal.getEntries();
    expect(initialEntries.length).toBe(0); // без выдуманных «бумажных сделок»

    const summary = journal.getSummary();
    expect(summary.totalTrades).toBe(0);
    expect(summary.winRatePct).toBe(0);

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
