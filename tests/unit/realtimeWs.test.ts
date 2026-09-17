import { describe, it, expect, beforeEach } from 'vitest';
import { BinanceWebSocketClient } from '@/services/realtime/BinanceWebSocketClient';
import { EventBus } from '@/services/realtime/EventBus';
import { AnomalyEngine } from '@/services/realtime/AnomalyEngine';
import { TickerTick, TradeTick, OrderBookSnapshot } from '@/types/realtime';

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Auto-open in next microtask
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 5);
  }

  public send(msg: string) {
    this.sentMessages.push(msg);
  }

  public close() {
    if (this.onclose) this.onclose();
  }

  // Helper to simulate incoming server message
  public simulateServerMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

describe('BinanceWebSocketClient Unit Tests', () => {
  let eventBus: EventBus;
  let anomalyEngine: AnomalyEngine;

  beforeEach(() => {
    MockWebSocket.instances = [];
    eventBus = new EventBus({ throttleIntervalMs: 50 });
    anomalyEngine = new AnomalyEngine({ cooldownMs: 0 });
  });

  it('manages connection lifecycle: idle -> connecting -> connected -> idle upon disconnect', async () => {
    const client = new BinanceWebSocketClient(eventBus, anomalyEngine, {
      webSocketClass: MockWebSocket,
    });

    expect(client.getConnectionState()).toBe('idle');

    client.connect();
    expect(client.getConnectionState()).toBe('connecting');

    // Wait for onopen
    await new Promise((r) => setTimeout(r, 15));
    expect(client.getConnectionState()).toBe('connected');

    client.disconnect();
    expect(client.getConnectionState()).toBe('idle');
  });

  it('parses incoming 24hrTicker frames into strongly-typed TickerTick with provenance', async () => {
    const client = new BinanceWebSocketClient(eventBus, anomalyEngine, {
      webSocketClass: MockWebSocket,
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 15));

    const receivedTicks: TickerTick[] = [];
    eventBus.subscribe<TickerTick>('ticker:BTC', (tick) => {
      receivedTicks.push(tick);
    });

    const mockWs = MockWebSocket.instances[0];

    // Simulate combined stream or direct stream message
    mockWs.simulateServerMessage({
      stream: 'btcusdt@ticker',
      data: {
        e: '24hrTicker',
        E: 1726444800000,
        s: 'BTCUSDT',
        p: '1200.00',
        P: '1.85',
        c: '65200.00',
        h: '65500.00',
        l: '63800.00',
        v: '8500.00',
        q: '550000000.00',
      },
    });

    // Advance event bus timer
    await new Promise((r) => setTimeout(r, 80));

    expect(receivedTicks.length).toBe(1);
    expect(receivedTicks[0].symbol).toBe('BTC');
    expect(receivedTicks[0].price).toBe(65200);
    expect(receivedTicks[0].provenance.exchange).toBe('binance');
    expect(receivedTicks[0].provenance.market).toBe('spot');
    expect(receivedTicks[0].provenance.symbol).toBe('BTCUSDT');

    client.disconnect();
  });

  it('parses incoming trade frames into strongly-typed TradeTick', async () => {
    const client = new BinanceWebSocketClient(eventBus, anomalyEngine, {
      webSocketClass: MockWebSocket,
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 15));

    const receivedTrades: TradeTick[] = [];
    eventBus.subscribe<TradeTick>('trade:BTC', (t) => {
      receivedTrades.push(t);
    });

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      e: 'trade',
      E: 1726444800000,
      s: 'BTCUSDT',
      t: 998877,
      p: '65210.50',
      q: '0.45',
      m: false, // buyer is not maker => market buy
    });

    expect(receivedTrades.length).toBe(1);
    expect(receivedTrades[0].symbol).toBe('BTC');
    expect(receivedTrades[0].price).toBe(65210.5);
    expect(receivedTrades[0].side).toBe('buy');
    expect(receivedTrades[0].size).toBe(0.45);

    client.disconnect();
  });

  it('parses incoming depth20 frames into OrderBookSnapshot', async () => {
    const client = new BinanceWebSocketClient(eventBus, anomalyEngine, {
      webSocketClass: MockWebSocket,
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 15));

    const receivedDepths: OrderBookSnapshot[] = [];
    eventBus.subscribe<OrderBookSnapshot>('depth:BTC', (d) => {
      receivedDepths.push(d);
    });

    const mockWs = MockWebSocket.instances[0];
    mockWs.simulateServerMessage({
      stream: 'btcusdt@depth20@100ms',
      data: {
        lastUpdateId: 100,
        bids: [
          ['65200.00', '1.5'],
          ['65190.00', '3.0'],
        ],
        asks: [
          ['65210.00', '2.0'],
          ['65220.00', '4.5'],
        ],
      },
    });

    expect(receivedDepths.length).toBe(1);
    expect(receivedDepths[0].symbol).toBe('BTC');
    expect(receivedDepths[0].bids.length).toBe(2);
    expect(receivedDepths[0].bids[0]).toEqual([65200, 1.5]);
    expect(receivedDepths[0].asks[0]).toEqual([65210, 2]);

    client.disconnect();
  });

  it('sends SUBSCRIBE payload when new symbol is subscribed', async () => {
    const client = new BinanceWebSocketClient(eventBus, anomalyEngine, {
      webSocketClass: MockWebSocket,
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 15));

    client.subscribeTicker('ETH');

    const mockWs = MockWebSocket.instances[0];
    expect(mockWs.sentMessages.length).toBeGreaterThan(0);

    const parsed = JSON.parse(mockWs.sentMessages[0]);
    expect(parsed.method).toBe('SUBSCRIBE');
    expect(parsed.params).toContain('ethusdt@ticker');

    client.disconnect();
  });
});
