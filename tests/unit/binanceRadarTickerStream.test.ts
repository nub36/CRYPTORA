import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceRadarTickerStream } from '../../server/services/radar/binanceRadarTickerStream.js';

type Listener = (...args: any[]) => void;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  public readyState = 0;
  public readonly sent: Array<{ method: string; params: string[]; id: number }> = [];
  public readonly url: string;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  terminate() {
    this.close();
  }

  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

const UNIVERSE_26 = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'SUI', 'NEAR', 'APT',
  'RENDER', 'TAO', 'INJ', 'UNI', 'AAVE', 'OP', 'ARB', 'TIA', 'FET', 'KAS', 'RUNE', 'SEI', 'PEPE',
];

afterEach(() => {
  vi.useRealTimers();
  FakeWebSocket.reset();
});

describe('BinanceRadarTickerStream bounded server topology', () => {
  it('uses one Binance Spot WS and one valid 26-stream subscribe frame, then delta-unsubscribes removed symbols', () => {
    const stream = new BinanceRadarTickerStream({
      onTick: () => undefined,
      WebSocketClass: FakeWebSocket,
    });

    stream.setSymbols(UNIVERSE_26);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://stream.binance.com:9443/ws');
    FakeWebSocket.instances[0].open();

    const initialSubscribe = FakeWebSocket.instances[0].sent.find((frame) => frame.method === 'SUBSCRIBE');
    expect(initialSubscribe?.params).toHaveLength(26);
    expect(initialSubscribe?.params).toContain('btcusdt@ticker');
    expect(initialSubscribe?.params).toContain('pepeusdt@ticker');

    stream.setSymbols(UNIVERSE_26.slice(0, 24));
    expect(FakeWebSocket.instances).toHaveLength(1);
    const unsubscribe = FakeWebSocket.instances[0].sent.find((frame) => frame.method === 'UNSUBSCRIBE');
    expect(unsubscribe?.params).toEqual(['seiusdt@ticker', 'pepeusdt@ticker']);
    expect(stream.getStatus().subscribedSymbols).toBe(24);
    stream.stop();
  });

  it('cancels a scheduled reconnect when the monitor stops', async () => {
    vi.useFakeTimers();
    const stream = new BinanceRadarTickerStream({
      onTick: () => undefined,
      WebSocketClass: FakeWebSocket,
      reconnectMinMs: 1_000,
      reconnectMaxMs: 30_000,
    });

    stream.setSymbols(['BTC']);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit('close'); // unexpected close schedules the exponential reconnect
    expect(stream.getStatus().state).toBe('reconnecting');

    stream.stop();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(stream.getStatus()).toMatchObject({ state: 'disconnected', subscribedSymbols: 0 });
  });
});
