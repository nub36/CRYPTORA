import { describe, it, expect } from 'vitest';
import { AiExplanationEngine } from '@/services/ai/AiExplanationEngine';

describe('AiExplanationEngine Unit Tests (Context-Grounded Analysis)', () => {
  it('generates an explanatory briefing grounded in RSI, funding, and volume spikes', () => {
    const briefing = AiExplanationEngine.generateBriefing({
      symbol: 'BTC',
      price: 64200,
      change24h: 3.4,
      fundingRate8h: 0.045, // elevated funding
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
