import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '@/services/realtime/EventBus';
import { TickerTick, TradeTick, OrderBookSnapshot } from '@/types/realtime';

const createMockTick = (symbol: string, price: number): TickerTick => ({
  symbol,
  price,
  priceChangePercent24h: 2.5,
  high24h: price * 1.05,
  low24h: price * 0.95,
  volume24h: 1000,
  quoteVolume24h: 1000 * price,
  timestamp: Date.now(),
  provenance: {
    exchange: 'binance',
    market: 'spot',
    symbol: `${symbol}USDT`,
    timestamp: Date.now(),
    isFallback: false,
  },
});

describe('EventBus Unit Tests (Throttling & Pub/Sub)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers immediate ticker publishes without waiting for throttle interval', () => {
    const bus = new EventBus({ throttleIntervalMs: 250 });
    const received: TickerTick[] = [];

    bus.subscribe<TickerTick>('ticker:BTC', (tick) => {
      received.push(tick);
    });

    bus.publishTicker(createMockTick('BTC', 65000), true);

    expect(received.length).toBe(1);
    expect(received[0].price).toBe(65000);
    bus.destroy();
  });

  it('throttles rapid ticker ticks and emits the latest state after throttle interval (250ms)', () => {
    const bus = new EventBus({ throttleIntervalMs: 250 });
    const received: TickerTick[] = [];

    bus.subscribe<TickerTick>('ticker:BTC', (tick) => {
      received.push(tick);
    });

    // Rapid ticks within 100ms
    bus.publishTicker(createMockTick('BTC', 65000));
    bus.publishTicker(createMockTick('BTC', 65050));
    bus.publishTicker(createMockTick('BTC', 65100));

    // Initially buffer has not flushed
    expect(received.length).toBe(0);

    // Fast-forward 250ms
    vi.advanceTimersByTime(250);

    // Should have flushed exactly once with the latest price
    expect(received.length).toBe(1);
    expect(received[0].price).toBe(65100);

    bus.destroy();
  });

  it('notifies wildcard ticker:* subscribers on flush', () => {
    const bus = new EventBus({ throttleIntervalMs: 250 });
    const received: string[] = [];

    bus.subscribe<TickerTick>('ticker:*', (tick) => {
      received.push(`${tick.symbol}:${tick.price}`);
    });

    bus.publishTicker(createMockTick('BTC', 65000));
    bus.publishTicker(createMockTick('ETH', 3500));

    vi.advanceTimersByTime(250);

    expect(received).toContain('BTC:65000');
    expect(received).toContain('ETH:3500');

    bus.destroy();
  });

  it('distributes trade and depth events immediately to respective channels', () => {
    const bus = new EventBus();
    const trades: TradeTick[] = [];
    const depths: OrderBookSnapshot[] = [];

    bus.subscribe<TradeTick>('trade:BTC', (t) => trades.push(t));
    bus.subscribe<OrderBookSnapshot>('depth:BTC', (d) => depths.push(d));

    const mockTrade: TradeTick = {
      id: 'trade-1',
      symbol: 'BTC',
      price: 65000,
      size: 0.5,
      side: 'buy',
      timestamp: Date.now(),
      provenance: {
        exchange: 'binance',
        market: 'spot',
        symbol: 'BTCUSDT',
        timestamp: Date.now(),
      },
    };

    const mockDepth: OrderBookSnapshot = {
      symbol: 'BTC',
      bids: [[64990, 1.2]],
      asks: [[65010, 0.8]],
      timestamp: Date.now(),
      provenance: {
        exchange: 'binance',
        market: 'spot',
        symbol: 'BTCUSDT',
        timestamp: Date.now(),
      },
    };

    bus.publishTrade(mockTrade);
    bus.publishDepth(mockDepth);

    expect(trades.length).toBe(1);
    expect(trades[0].id).toBe('trade-1');
    expect(depths.length).toBe(1);
    expect(depths[0].bids[0][0]).toBe(64990);

    bus.destroy();
  });

  it('cleans up subscription when unsubscribe callback is called', () => {
    const bus = new EventBus();
    let count = 0;

    const unsubscribe = bus.subscribe('radar', () => {
      count++;
    });

    bus.publishRadarEvent({
      id: 'r1',
      timestamp: '2026-09-15T00:00:00Z',
      symbol: 'BTC',
      type: 'VOLUME_SPIKE',
      severity: 'HIGH',
      metricValue: '3.5σ',
      observation: 'Test',
      isDemo: false,
    });

    expect(count).toBe(1);

    unsubscribe();

    bus.publishRadarEvent({
      id: 'r2',
      timestamp: '2026-09-15T00:00:01Z',
      symbol: 'BTC',
      type: 'VOLUME_SPIKE',
      severity: 'HIGH',
      metricValue: '4.0σ',
      observation: 'Test 2',
      isDemo: false,
    });

    expect(count).toBe(1);
    bus.destroy();
  });
});
