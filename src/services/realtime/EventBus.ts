import { TickerTick, TradeTick, OrderBookSnapshot, RealtimeConnectionState } from '@/types/realtime';
import { RadarEvent } from '@/types/market';

export type EventBusEvents = {
  ticker: TickerTick;
  trade: TradeTick;
  depth: OrderBookSnapshot;
  radar: RadarEvent;
  connection: RealtimeConnectionState;
};

export type EventCallback<T> = (data: T) => void;

export interface EventBusOptions {
  throttleIntervalMs?: number;
}

export class EventBus {
  private listeners: Map<string, Set<EventCallback<any>>> = new Map();
  private throttledTickerQueue: Map<string, TickerTick> = new Map();
  private throttleIntervalMs: number;
  private throttleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: EventBusOptions = {}) {
    this.throttleIntervalMs = options.throttleIntervalMs ?? 250;
    this.startThrottler();
  }

  private startThrottler(): void {
    if (this.throttleTimer) return;
    this.throttleTimer = setInterval(() => {
      this.flushThrottledTickers();
    }, this.throttleIntervalMs);
  }

  private flushThrottledTickers(): void {
    if (this.throttledTickerQueue.size === 0) return;

    for (const [symbol, tick] of this.throttledTickerQueue.entries()) {
      // Notify symbol-specific listeners
      const symbolListeners = this.listeners.get(`ticker:${symbol}`);
      if (symbolListeners) {
        symbolListeners.forEach((cb) => cb(tick));
      }

      // Notify wildcard listeners
      const wildcardListeners = this.listeners.get('ticker:*');
      if (wildcardListeners) {
        wildcardListeners.forEach((cb) => cb(tick));
      }
    }

    this.throttledTickerQueue.clear();
  }

  /**
   * Subscribe to a specific event topic.
   * Topics supported:
   * - `ticker:<symbol>` (e.g. `ticker:BTC`)
   * - `ticker:*` (all tickers)
   * - `trade:<symbol>`
   * - `depth:<symbol>`
   * - `radar`
   * - `connection`
   */
  public subscribe<T>(topic: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set());
    }
    this.listeners.get(topic)!.add(callback);

    return () => {
      this.unsubscribe(topic, callback);
    };
  }

  public unsubscribe<T>(topic: string, callback: EventCallback<T>): void {
    const topicListeners = this.listeners.get(topic);
    if (topicListeners) {
      topicListeners.delete(callback);
      if (topicListeners.size === 0) {
        this.listeners.delete(topic);
      }
    }
  }

  /**
   * Publish a ticker tick. By default it is queued in the throttler (250ms batch window)
   * unless immediate is specified.
   */
  public publishTicker(tick: TickerTick, immediate = false): void {
    if (immediate) {
      const symbolListeners = this.listeners.get(`ticker:${tick.symbol}`);
      if (symbolListeners) {
        symbolListeners.forEach((cb) => cb(tick));
      }
      const wildcardListeners = this.listeners.get('ticker:*');
      if (wildcardListeners) {
        wildcardListeners.forEach((cb) => cb(tick));
      }
      return;
    }

    this.throttledTickerQueue.set(tick.symbol, tick);
  }

  public publishTrade(trade: TradeTick): void {
    const symbolListeners = this.listeners.get(`trade:${trade.symbol}`);
    if (symbolListeners) {
      symbolListeners.forEach((cb) => cb(trade));
    }
    const wildcardListeners = this.listeners.get('trade:*');
    if (wildcardListeners) {
      wildcardListeners.forEach((cb) => cb(trade));
    }
  }

  public publishDepth(depth: OrderBookSnapshot): void {
    const symbolListeners = this.listeners.get(`depth:${depth.symbol}`);
    if (symbolListeners) {
      symbolListeners.forEach((cb) => cb(depth));
    }
  }

  public publishRadarEvent(event: RadarEvent): void {
    const listeners = this.listeners.get('radar');
    if (listeners) {
      listeners.forEach((cb) => cb(event));
    }
  }

  public publishConnectionState(state: RealtimeConnectionState): void {
    const listeners = this.listeners.get('connection');
    if (listeners) {
      listeners.forEach((cb) => cb(state));
    }
  }

  public clear(): void {
    this.listeners.clear();
    this.throttledTickerQueue.clear();
  }

  public destroy(): void {
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.clear();
  }
}
