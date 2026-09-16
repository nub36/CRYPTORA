import { describe, it, expect } from 'vitest';
import { CalendarService } from '@/services/analytics/CalendarService';
import { EcosystemService } from '@/services/analytics/EcosystemService';

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

describe('EcosystemService Unit Tests', () => {
  it('retrieves L1 and L2 network ecosystems with valid TVL and fees', () => {
    const networks = EcosystemService.getNetworks();
    expect(networks.length).toBeGreaterThan(4);

    const eth = networks.find((n) => n.id === 'ethereum');
    expect(eth).toBeDefined();
    expect(eth?.tvlUsd).toBeGreaterThan(1e10);
    expect(eth?.layer).toBe('L1');

    const arb = networks.find((n) => n.id === 'arbitrum');
    expect(arb).toBeDefined();
    expect(arb?.layer).toBe('L2');
  });

  it('calculates aggregated ecosystem metrics and L2 share', () => {
    const overview = EcosystemService.getOverview();
    expect(overview.totalTvlUsd).toBeGreaterThan(5e10);
    expect(overview.totalDailyFeesUsd).toBeGreaterThan(0);
    expect(overview.l2TvlUsd).toBeGreaterThan(0);
    expect(overview.l2SharePct).toBeGreaterThan(0);
    expect(overview.l2SharePct).toBeLessThan(100);
  });
});
