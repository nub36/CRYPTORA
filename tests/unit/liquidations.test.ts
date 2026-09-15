import { describe, it, expect } from 'vitest';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';

describe('LiquidationPipeline Unit Tests', () => {
  it('parses raw Binance forceOrder SELL into LONG liquidation event', () => {
    const pipeline = new LiquidationPipeline();

    const rawPayload = {
      e: 'forceOrder',
      E: 1726444800000,
      o: {
        s: 'BTCUSDT',
        S: 'SELL', // Liquidation of LONG position
        o: 'LIMIT',
        p: '64800.00',
        q: '1.25',
        ap: '64800.00',
        T: 1726444800000,
      },
    };

    const event = pipeline.processBinanceForceOrder(rawPayload);

    expect(event).toBeDefined();
    expect(event?.symbol).toBe('BTC');
    expect(event?.side).toBe('LONG');
    expect(event?.price).toBe(64800);
    expect(event?.amountUsd).toBe(64800 * 1.25);
    expect(event?.exchange).toBe('Binance Futures');
    expect(event?.isDemo).toBe(false);
  });

  it('parses raw Binance forceOrder BUY into SHORT liquidation event', () => {
    const pipeline = new LiquidationPipeline();

    const rawPayload = {
      e: 'forceOrder',
      E: 1726444800000,
      o: {
        s: 'ETHUSDT',
        S: 'BUY', // Liquidation of SHORT position
        p: '3520.00',
        q: '10.0',
        T: 1726444800000,
      },
    };

    const event = pipeline.processBinanceForceOrder(rawPayload);

    expect(event).toBeDefined();
    expect(event?.symbol).toBe('ETH');
    expect(event?.side).toBe('SHORT');
    expect(event?.amountUsd).toBe(35200);
  });

  it('safely returns null for invalid forceOrder payload', () => {
    const pipeline = new LiquidationPipeline();
    const result = pipeline.processBinanceForceOrder({ invalid: 'data' });
    expect(result).toBeNull();
  });

  it('calculates theoretical estimated liquidation clusters for 10x, 25x, 50x, 100x leverage', () => {
    const clusters = LiquidationPipeline.calculateEstimatedClusters(60000, 1000000000);

    expect(clusters.length).toBe(8); // 4 long tiers + 4 short tiers

    const longClusters = clusters.filter((c) => c.side === 'LONG');
    const shortClusters = clusters.filter((c) => c.side === 'SHORT');

    expect(longClusters.length).toBe(4);
    expect(shortClusters.length).toBe(4);

    // Long liqs must be strictly below current price
    for (const lc of longClusters) {
      expect(lc.priceLevel).toBeLessThan(60000);
      expect(lc.estimatedVolumeUsd).toBeGreaterThan(0);
    }

    // Short liqs must be strictly above current price
    for (const sc of shortClusters) {
      expect(sc.priceLevel).toBeGreaterThan(60000);
      expect(sc.estimatedVolumeUsd).toBeGreaterThan(0);
    }
  });

  it('generates a complete liquidation snapshot with exchange breakdown and timeline', () => {
    const pipeline = new LiquidationPipeline();
    const snapshot = pipeline.getLiquidationSnapshot();

    expect(snapshot.total24h).toBeGreaterThan(0);
    expect(snapshot.totalLong24h).toBeGreaterThan(0);
    expect(snapshot.totalShort24h).toBeGreaterThan(0);
    expect(snapshot.largestEvent).toBeDefined();
    expect(snapshot.recentEvents.length).toBeGreaterThan(0);
    expect(snapshot.exchangeBreakdown.length).toBeGreaterThan(0);
    expect(snapshot.timeline.length).toBeGreaterThan(0);
    expect(snapshot.isDemo).toBe(false);
  });
});
