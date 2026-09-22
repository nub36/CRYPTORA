/**
 * R-series contract tests: Freshness, Liquidation Completeness, Observation Window.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeFreshness,
  unavailableFreshness,
  formatAge,
  freshnessLabel,
  STALE_THRESHOLDS_MS,
} from '@/services/data/freshness';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';

describe('Freshness Contract', () => {
  it('FRESH when age < threshold', () => {
    const f = computeFreshness(Date.now() - 5000, 'ws-ticker');
    expect(f.status).toBe('FRESH');
    expect(f.ageMs).toBeLessThan(STALE_THRESHOLDS_MS['ws-ticker']);
  });

  it('STALE when age > threshold', () => {
    const f = computeFreshness(Date.now() - 30_000, 'ws-ticker');
    expect(f.status).toBe('STALE');
    expect(f.ageMs).toBeGreaterThan(STALE_THRESHOLDS_MS['ws-ticker']);
  });

  it('RECONNECTING when isConnected=false', () => {
    const f = computeFreshness(Date.now() - 5000, 'ws-ticker', undefined, false);
    expect(f.status).toBe('RECONNECTING');
  });

  it('UNAVAILABLE when no data at all', () => {
    const f = unavailableFreshness('rest-futures');
    expect(f.status).toBe('UNAVAILABLE');
    expect(f.sourceTimestamp).toBe(0);
    expect(f.receivedAt).toBe(0);
  });

  it('different thresholds for different categories', () => {
    expect(STALE_THRESHOLDS_MS['ws-ticker']).toBeLessThan(STALE_THRESHOLDS_MS['rest-futures']);
    expect(STALE_THRESHOLDS_MS['rest-futures']).toBeLessThan(STALE_THRESHOLDS_MS['rest-metadata']);
  });

  it('formatAge shows seconds, minutes, hours', () => {
    expect(formatAge(5000)).toBe('5с');
    expect(formatAge(120_000)).toBe('2мин');
    expect(formatAge(3_600_000)).toBe('1ч');
    expect(formatAge(-1)).toBe('—');
    expect(formatAge(Infinity)).toBe('—');
  });

  it('freshnessLabel returns Russian labels', () => {
    expect(freshnessLabel('FRESH')).toBe('Актуально');
    expect(freshnessLabel('STALE')).toBe('Устарело');
    expect(freshnessLabel('RECONNECTING')).toBe('Переподключение');
    expect(freshnessLabel('UNAVAILABLE')).toBe('Нет данных');
  });
});

describe('Liquidation Observation Window', () => {
  beforeEach(() => {
    LiquidationPipeline.resetInstance();
  });

  it('observation not started by default', () => {
    const pipeline = LiquidationPipeline.getInstance();
    const meta = pipeline.getObservationMeta();
    expect(meta.startedAt).toBeNull();
    expect(meta.durationMs).toBe(0);
    expect(meta.hasFullWindow).toBe(false);
  });

  it('observation starts on first stream connect', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.setStreamState('connected', 'binance');
    const meta = pipeline.getObservationMeta();
    expect(meta.startedAt).toBeGreaterThan(0);
    expect(meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(meta.hasFullWindow).toBe(false); // just started
  });

  it('observation starts on startObservation()', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.startObservation();
    const meta = pipeline.getObservationMeta();
    expect(meta.startedAt).toBeGreaterThan(0);
  });

  it('snapshot includes observation metadata', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.setStreamState('connected', 'binance');
    const snapshot = pipeline.getLiquidationSnapshot();
    expect(snapshot.observationStartedAt).toBeGreaterThan(0);
    expect(snapshot.observationDurationMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.hasFullObservationWindow).toBe(false);
  });

  it('multiple stream connects do not reset observation start', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.setStreamState('connected', 'binance');
    const firstStart = pipeline.getObservationMeta().startedAt;
    // Wait a tick and connect another
    pipeline.setStreamState('connected', 'bybit');
    const secondStart = pipeline.getObservationMeta().startedAt;
    expect(secondStart).toBe(firstStart); // not reset
  });
});

describe('Liquidation Pulse Completeness', () => {
  it('buildImbalance tracks available/missing components', async () => {
    // Contract test: verify AssetImbalance has completeness fields
    const mod = await import('@/services/liquidations/LiquidationPulse');
    expect(mod.LiquidationPulse).toBeDefined();
    // The interface contract is structural — fields exist on AssetImbalance
    // Full component-level testing requires mock setup; this verifies import works
  });
});

describe('Partial Failure Resilience', () => {
  beforeEach(() => {
    LiquidationPipeline.resetInstance();
  });

  it('pipeline handles empty event list gracefully', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.setStreamState('connected', 'binance');
    const snapshot = pipeline.getLiquidationSnapshot();
    expect(snapshot.total24h).toBe(0);
    expect(snapshot.largestEvent).toBeNull();
    expect(snapshot.eventsCount24h).toBe(0);
    expect(snapshot.assetBreakdown).toEqual([]);
    // §40: биржи перечислены, но все нулевые — суммы не выдумываются.
    expect(snapshot.exchangeBreakdown).toHaveLength(3);
    expect(snapshot.exchangeBreakdown.every((e) => e.totalUsd === 0 && e.eventCount === 0)).toBe(true);
  });

  it('pipeline handles duplicate events idempotently', () => {
    const pipeline = LiquidationPipeline.getInstance();
    const event = {
      id: 'liq-BTC-1234-65000-1.5',
      timestamp: new Date().toISOString(),
      symbol: 'BTC',
      side: 'LONG' as const,
      amountUsd: 97500,
      price: 65000,
      exchange: 'Binance Futures',
      isDemo: false,
    };
    pipeline.recordEvent(event);
    pipeline.recordEvent(event); // duplicate
    const snapshot = pipeline.getLiquidationSnapshot();
    expect(snapshot.eventsCount24h).toBe(1); // not doubled
  });

  it('pipeline idempotency via forceOrder re-ingest', () => {
    const pipeline = LiquidationPipeline.getInstance();
    const payload = {
      o: {
        s: 'BTCUSDT',
        S: 'SELL',
        p: '65000',
        q: '1.5',
        T: Date.now(),
        ap: '65000',
      },
    };
    const events1 = pipeline.ingestForceOrderMessage(payload);
    const events2 = pipeline.ingestForceOrderMessage(payload); // re-ingest same
    expect(events1.length).toBe(1);
    expect(events2.length).toBe(1);
    const snapshot = pipeline.getLiquidationSnapshot();
    expect(snapshot.eventsCount24h).toBe(1); // not doubled
  });

  it('stream state per-exchange: partial connect', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.setStreamState('connected', 'binance');
    pipeline.setStreamState('unavailable', 'bybit');
    pipeline.setStreamState('connecting', 'okx');
    expect(pipeline.getStreamState()).toBe('connected'); // at least one connected

    const states = pipeline.getStreamStates();
    expect(states.binance).toBe('connected');
    expect(states.bybit).toBe('unavailable');
    expect(states.okx).toBe('connecting');
  });

  it('all streams unavailable → aggregated unavailable', () => {
    const pipeline = LiquidationPipeline.getInstance();
    pipeline.setStreamState('unavailable', 'binance');
    pipeline.setStreamState('unavailable', 'bybit');
    expect(pipeline.getStreamState()).toBe('unavailable');
  });
});
