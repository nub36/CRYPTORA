import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveSignalEngine } from '@/services/signals/live/LiveSignalEngine';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { OHLCV } from '@/types/market';

// Generate realistic candles with enough data for warmup
function generateCandles(count: number, basePrice: number, trend: 'up' | 'down' | 'flat' = 'flat'): OHLCV[] {
  const candles: OHLCV[] = [];
  let price = basePrice;
  const start = Math.floor(Date.now() / 1000) - count * 3600;
  for (let i = 0; i < count; i++) {
    const drift = trend === 'up' ? 0.001 : trend === 'down' ? -0.001 : 0;
    const noise = Math.sin(i * 0.7) * 0.005;
    const open = price;
    const change = price * (drift + noise);
    const close = open + change;
    const high = Math.max(open, close) + Math.abs(change) * 0.5;
    const low = Math.min(open, close) - Math.abs(change) * 0.5;
    candles.push({
      time: start + i * 3600,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + i * 10,
    });
    price = close;
  }
  return candles;
}

function mockProvider(h1Candles: OHLCV[], h4Candles: OHLCV[]): MarketDataProvider {
  return {
    isDemo: false,
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockImplementation((_symbol: string, tf: string) => {
      return Promise.resolve(tf === '1h' ? h1Candles : h4Candles);
    }),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockResolvedValue({ total24h: 0, dataStatus: 'UNAVAILABLE' }),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getMarketOverview: vi.fn().mockResolvedValue({}),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;
}

describe('LiveSignalEngine', () => {
  beforeEach(() => {
    LiveSignalEngine.resetInstance();
    SignalsAuditLedger['instance'] = null;
  });

  it('creates singleton instance', () => {
    const provider = mockProvider([], []);
    const engine = LiveSignalEngine.getInstance({ provider });
    expect(engine).toBeDefined();
    expect(engine!.isActive()).toBe(false);
    expect(LiveSignalEngine.getInstance()).toBe(engine);
  });

  it('start/stop lifecycle', () => {
    const provider = mockProvider([], []);
    const engine = LiveSignalEngine.getInstance({ provider })!;
    engine.start();
    expect(engine.isActive()).toBe(true);
    engine.stop();
    expect(engine.isActive()).toBe(false);
  });

  it('handles empty candles without crashing', { timeout: 15000 }, async () => {
    const h1 = generateCandles(10, 65000); // too few (< WARMUP_BARS)
    const h4 = generateCandles(20, 65000);
    const provider = mockProvider(h1, h4);
    const engine = LiveSignalEngine.getInstance({ provider })!;
    engine.start();
    await new Promise((r) => setTimeout(r, 6000));
    const ledger = SignalsAuditLedger.getInstance();
    expect(ledger.getSetups()).toHaveLength(0);
    engine.stop();
  });

  it('handles sufficient candles without crashing', { timeout: 15000 }, async () => {
    const h1 = generateCandles(100, 65000, 'up');
    const h4 = generateCandles(60, 65000, 'up');
    const provider = mockProvider(h1, h4);
    const engine = LiveSignalEngine.getInstance({ provider, strategies: ['V3.0'] })!;
    engine.start();
    await new Promise((r) => setTimeout(r, 6000));
    // May or may not produce signals depending on geometry — but should not crash
    const ledger = SignalsAuditLedger.getInstance();
    expect(ledger.getSetups()).toBeDefined();
    engine.stop();
  });

  it('resetInstance clears singleton', () => {
    const provider = mockProvider([], []);
    LiveSignalEngine.getInstance({ provider });
    LiveSignalEngine.resetInstance();
    expect(LiveSignalEngine.getInstance()).toBeNull();
  });
});
