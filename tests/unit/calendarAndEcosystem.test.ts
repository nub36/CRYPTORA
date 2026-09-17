import { describe, it, expect } from 'vitest';
import { CalendarService } from '@/services/analytics/CalendarService';
import { EcosystemService, tvlChange7dFromHistory } from '@/services/analytics/EcosystemService';
import { DefiLlamaAdapter } from '@/services/data/adapters/DefiLlamaAdapter';
import { AdapterNetworkError } from '@/services/data/adapters/errors';

describe('CalendarService Unit Tests', () => {
  it('retrieves calendar events with impact and category filtering', () => {
    const allEvents = CalendarService.getEvents();
    expect(allEvents.length).toBeGreaterThan(3);

    const highImpact = CalendarService.getEvents(undefined, 'HIGH');
    expect(highImpact.length).toBeGreaterThan(0);
    expect(highImpact.every((e) => e.impact === 'HIGH')).toBe(true);

    const macroEvents = CalendarService.getEvents('MACRO_ECONOMICS');
    expect(macroEvents.length).toBeGreaterThan(0);
    expect(macroEvents.every((e) => e.category === 'MACRO_ECONOMICS')).toBe(true);
  });

  it('retrieves next major event for terminal headline banner', () => {
    const next = CalendarService.getNextMajorEvent();
    expect(next).toBeDefined();
    expect(next?.impact).toBe('HIGH');
    expect(next?.title).toContain('FOMC');
  });
});

describe('EcosystemService (DeFiLlama, mocked fetch)', () => {
  const day = 86400;
  const now = 1_800_000_000;
  const chains = [
    { name: 'Ethereum', tvl: 60e9, tokenSymbol: 'ETH' },
    { name: 'Arbitrum', tvl: 3e9, tokenSymbol: 'ARB' },
    { name: 'Unknown Chain', tvl: 1e9, tokenSymbol: null },
    { name: 'Solana', tvl: -1 },
  ];
  const hist = Array.from({ length: 10 }, (_, i) => ({ date: now - (9 - i) * day, tvl: 50e9 + i * 1e9 }));

  const mockFetch = (fail = false): typeof fetch =>
    (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (fail) return new Response('x', { status: 500 });
      if (u.endsWith('/v2/chains')) return new Response(JSON.stringify(chains), { status: 200 });
      if (u.includes('/v2/historicalChainTvl/Ethereum')) return new Response(JSON.stringify(hist), { status: 200 });
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

  it('computes 7d change from history (base ≥7 days back) and null when history is short', () => {
    expect(tvlChange7dFromHistory(hist)).toBe(Number((((59e9 - 52e9) / 52e9) * 100).toFixed(2)));
    expect(tvlChange7dFromHistory(hist.slice(-3))).toBeNull();
    expect(tvlChange7dFromHistory([])).toBeNull();
  });

  it('builds report only from tracked chains present in source; negatives/unknown skipped', async () => {
    EcosystemService.resetCache();
    const adapter = new DefiLlamaAdapter({ fetchFn: mockFetch() });
    const r = await EcosystemService.fetchReport(adapter, now * 1000);
    expect(r.source).toBe('defillama');
    expect(r.networks.map((n) => n.id)).toEqual(['ethereum', 'arbitrum']);
    expect(r.networks[0].tvlChange7d).not.toBeNull();
    expect(r.networks[1].tvlChange7d).toBeNull();
    expect(r.overview.totalTvlUsd).toBe(63e9);
    expect(r.overview.l2TvlUsd).toBe(3e9);
    expect(r.overview.l2SharePct).toBe(4.8);
    expect(r.overview.allChainsTvlUsd).toBe(64e9);
  });

  it('throws on source failure (no static fallback)', async () => {
    EcosystemService.resetCache();
    const adapter = new DefiLlamaAdapter({ fetchFn: mockFetch(true) });
    await expect(EcosystemService.fetchReport(adapter, now * 1000)).rejects.toBeInstanceOf(AdapterNetworkError);
  });
});
