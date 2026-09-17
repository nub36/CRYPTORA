import { describe, it, expect } from 'vitest';
import { AiExplanationEngine } from '@/services/ai/AiExplanationEngine';

describe('AiExplanationEngine Unit Tests (Context-Grounded Analysis)', () => {
  it('generates an explanatory briefing grounded in RSI, funding, and volume spikes', () => {
    const briefing = AiExplanationEngine.generateBriefing({
      symbol: 'BTC',
      price: 64200,
      change24h: 3.4,
      fundingRate8h: 0.045, // % за 8ч, повышенный
      openInterestDelta24h: 8.2, // institutional inflow
      rsi14: 72.5, // overbought
      anomalies: [
        {
          id: 'rad-1',
          symbol: 'BTC',
          type: 'VOLUME_SPIKE',
          timestamp: '2026-09-15T12:00:00Z',
          metricValue: '+3.4σ',
          observation: 'Всплеск спотового объема Z-Score +3.4σ',
          severity: 'HIGH',
          isDemo: false,
        },
      ],
    });

    expect(briefing.symbol).toBe('BTC');
    expect(briefing.headline).toContain('BTC');
    expect(briefing.explanation).toContain('64,200');
    expect(briefing.keyDrivers.length).toBeGreaterThan(0);
    expect(briefing.riskObservations.length).toBeGreaterThan(0);
    expect(briefing.disclaimer).toContain('CRYPTORA — аналитический терминал');
  });

  it('handles negative funding rate indicating short squeeze potential', () => {
    const briefing = AiExplanationEngine.generateBriefing({
      symbol: 'ETH',
      price: 3450,
      change24h: -1.2,
      fundingRate8h: -0.02,
      rsi14: 28.0,
    });

    expect(briefing.keyDrivers.some((d) => d.includes('шорт-сквиз'))).toBe(true);
    expect(briefing.keyDrivers.some((d) => d.includes('перепроданность'))).toBe(true);
  });
});

describe('AiExplanationEngine — правило docs/AI.md: ни одной цифры вне переданных фактов', () => {
  it('все числа в брифинге выводимы из входного контекста; отсутствующие факты не подставляются', () => {
    const ctx = { symbol: 'SOL', price: 158.4, change24h: -2.35, fundingRate8h: -0.0123, openInterestDelta24h: 7.4, openInterestDeltaSource: 'ESTIMATED' as const };
    const b = AiExplanationEngine.generateBriefing(ctx);
    const text = [b.headline, b.explanation, ...b.keyDrivers, ...b.riskObservations].join(' ');
    expect(text).not.toMatch(/RSI/); // rsi14 не передан — о нём ни слова
    expect(text).toContain('оценка, не фактический ряд OI');
    const allowed = new Set(['158.4', '2.35', '0.0123', '7.4', '14', '24', '8']);
    const nums = Array.from(text.matchAll(/\d+(?:[.,]\d+)?/g), (m) => m[0].replace(',', ''));
    const foreign = nums.filter((n) => !allowed.has(n) && !allowed.has(n.replace(/^0+(?=\d)/, '')));
    expect(foreign, `посторонние числа: ${foreign.join(', ')}`).toEqual([]);
  });
});
