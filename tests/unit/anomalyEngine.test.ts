import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyEngine } from '@/services/realtime/AnomalyEngine';
import { TickerTick } from '@/types/realtime';

const makeTick = (symbol: string, price: number, volume: number, high?: number, low?: number): TickerTick => ({
  symbol,
  price,
  priceChangePercent24h: 0,
  high24h: high ?? price * 1.02,
  low24h: low ?? price * 0.98,
  volume24h: volume,
  quoteVolume24h: volume * price,
  timestamp: Date.now(),
  provenance: {
    exchange: 'binance',
    market: 'spot',
    symbol: `${symbol}USDT`,
    timestamp: Date.now(),
  },
});

describe('AnomalyEngine Mathematical Unit Tests', () => {
  let engine: AnomalyEngine;

  beforeEach(() => {
    engine = new AnomalyEngine({
      windowSize: 10,
      cooldownMs: 0, // Disable cooldown for deterministic multi-event tests
    });
  });

  it('detects a statistically significant Volume Spike using Z-Score', () => {
    // Feed 9 baseline volumes with small variance (~1000)
    for (let i = 0; i < 9; i++) {
      engine.processTick(makeTick('BTC', 65000, 1000 + (i % 2 === 0 ? 20 : -20)));
    }

    // Now feed a massive volume spike (5000)
    const anomalies = engine.processTick(makeTick('BTC', 65000, 5000));

    expect(anomalies.length).toBeGreaterThan(0);
    const volAnomaly = anomalies.find((a) => a.type === 'VOLUME_SPIKE');
    expect(volAnomaly).toBeDefined();
    expect(volAnomaly?.symbol).toBe('BTC');
    expect(volAnomaly?.severity).toBe('HIGH');
    expect(volAnomaly?.isDemo).toBe(false);
    expect(volAnomaly?.metricValue).toMatch(/\+\d+\.\d+σ/);
  });

  it('detects sharp Price Velocity move', () => {
    // Baseline prices
    engine.processTick(makeTick('ETH', 3000, 500));
    engine.processTick(makeTick('ETH', 3005, 500));
    engine.processTick(makeTick('ETH', 3010, 500));

    // Sudden +5% price pump
    const anomalies = engine.processTick(makeTick('ETH', 3160, 500));

    const priceAnomaly = anomalies.find((a) => a.type === 'PRICE_MOVE');
    expect(priceAnomaly).toBeDefined();
    expect(priceAnomaly?.severity).toBe('HIGH');
    expect(priceAnomaly?.metricValue).toContain('+');
    expect(priceAnomaly?.isDemo).toBe(false);
  });

  it('detects Volatility Expansion when high-low range expands significantly', () => {
    // Normal tight 1% range
    for (let i = 0; i < 6; i++) {
      engine.processTick(makeTick('SOL', 150, 1000, 151, 149));
    }

    // Sudden volatile candle: range expanded to 10%
    const anomalies = engine.processTick(makeTick('SOL', 150, 1000, 160, 140));

    const volAnomaly = anomalies.find((a) => a.type === 'VOLATILITY_EXPANSION');
    expect(volAnomaly).toBeDefined();
    expect(volAnomaly?.severity).toBe('HIGH');
    expect(volAnomaly?.isDemo).toBe(false);
  });

  it('enforces alert cooldown preventing duplicate alert storms', () => {
    const cooldownEngine = new AnomalyEngine({
      windowSize: 10,
      cooldownMs: 60000, // 60s cooldown
    });

    for (let i = 0; i < 9; i++) {
      cooldownEngine.processTick(makeTick('BTC', 65000, 1000));
    }

    // 1st spike -> triggers alert
    const firstAlerts = cooldownEngine.processTick(makeTick('BTC', 65000, 5000));
    expect(firstAlerts.some((a) => a.type === 'VOLUME_SPIKE')).toBe(true);

    // 2nd spike immediately -> suppressed by cooldown
    const secondAlerts = cooldownEngine.processTick(makeTick('BTC', 65000, 5500));
    expect(secondAlerts.some((a) => a.type === 'VOLUME_SPIKE')).toBe(false);
  });

  it('retrieves buffered events and filters by symbol correctly', () => {
    for (let i = 0; i < 9; i++) {
      engine.processTick(makeTick('BTC', 65000, 1000));
      engine.processTick(makeTick('ETH', 3000, 1000));
    }

    engine.processTick(makeTick('BTC', 65000, 6000));
    engine.processTick(makeTick('ETH', 3000, 6000));

    const btcEvents = engine.getEvents('BTC');
    expect(btcEvents.length).toBeGreaterThan(0);
    for (const ev of btcEvents) {
      expect(ev.symbol).toBe('BTC');
    }

    const allEvents = engine.getEvents();
    expect(allEvents.length).toBeGreaterThanOrEqual(2);
  });
});
