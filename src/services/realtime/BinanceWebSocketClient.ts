import {
  RealtimeConnectionState,
  TickerTick,
  TradeTick,
  OrderBookSnapshot,
  KlineTick,
} from '@/types/realtime';
import { getAssetByBinanceSymbol } from '../data/registry/assetRegistry';
import { EventBus } from './EventBus';
import { AnomalyEngine } from './AnomalyEngine';

export interface BinanceWebSocketOptions {
  wsUrl?: string;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxReconnectAttempts?: number;
  webSocketClass?: any;
}

export class BinanceWebSocketClient {
  private wsUrl: string;
  private reconnectInitialDelayMs: number;
  private reconnectMaxDelayMs: number;
  private maxReconnectAttempts: number;
  private webSocketClass: any;

  private ws: any = null;
  private connectionState: RealtimeConnectionState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isExplicitlyClosed = false;

  private subscribedStreams: Set<string> = new Set();
  private eventBus: EventBus;
  private anomalyEngine?: AnomalyEngine;
  private networkRecoveryAttached = false;

  constructor(
    eventBus: EventBus,
    anomalyEngine?: AnomalyEngine,
    options: BinanceWebSocketOptions = {}
  ) {
    this.eventBus = eventBus;
    this.anomalyEngine = anomalyEngine;
    this.wsUrl = options.wsUrl ?? 'wss://stream.binance.com:9443/stream';
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 1000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.webSocketClass =
      options.webSocketClass ??
      (typeof WebSocket !== 'undefined' ? WebSocket : null);
  }

  public getConnectionState(): RealtimeConnectionState {
    return this.connectionState;
  }

  public connect(): void {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    if (!this.webSocketClass) {
      this.setConnectionState('error');
      return;
    }

    this.isExplicitlyClosed = false;
    this.setConnectionState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    this.attachNetworkRecoveryListeners();

    try {
      // Build streams query if we already have subscriptions, or connect to base stream
      const streamList = Array.from(this.subscribedStreams);
      const url =
        streamList.length > 0
          ? `${this.wsUrl}?streams=${streamList.join('/')}`
          : `${this.wsUrl}?streams=btcusdt@ticker`;

      this.ws = new this.webSocketClass(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnectionState('connected');
        // Resubscribe if needed
        this.syncSubscriptions();
      };

      this.ws.onmessage = (event: any) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = () => {
        this.setConnectionState('error');
      };

      this.ws.onclose = () => {
        if (!this.isExplicitlyClosed) {
          this.setConnectionState('disconnected');
          this.scheduleReconnect();
        } else {
          this.setConnectionState('idle');
        }
      };
    } catch (err) {
      this.setConnectionState('error');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detachNetworkRecoveryListeners();
    this.reconnectAttempts = 0;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        // ignore close errors
      }
      this.ws = null;
    }
    this.setConnectionState('idle');
  }

  /**
   * Subscribe to ticker stream for a canonical or exchange symbol
   */
  public subscribeTicker(symbol: string): void {
    const binanceSymbol = symbol.toLowerCase().endsWith('usdt')
      ? symbol.toLowerCase()
      : `${symbol.toLowerCase()}usdt`;
    const stream = `${binanceSymbol}@ticker`;
    this.addStream(stream);
  }

  public subscribeTrades(symbol: string): void {
    const binanceSymbol = symbol.toLowerCase().endsWith('usdt')
      ? symbol.toLowerCase()
      : `${symbol.toLowerCase()}usdt`;
    const stream = `${binanceSymbol}@trade`;
    this.addStream(stream);
  }

  public subscribeDepth(symbol: string): void {
    const binanceSymbol = symbol.toLowerCase().endsWith('usdt')
      ? symbol.toLowerCase()
      : `${symbol.toLowerCase()}usdt`;
    const stream = `${binanceSymbol}@depth20@100ms`;
    this.addStream(stream);
  }

  /**
   * Subscribe to Binance kline (candlestick) stream for real-time candle updates.
   * Binance sends kline events for the currently forming candle on every trade.
   * When a candle closes, isClosed=true is sent as the final update for that candle.
   */
  public subscribeKline(symbol: string, interval: string): void {
    const binanceSymbol = symbol.toLowerCase().endsWith('usdt')
      ? symbol.toLowerCase()
      : `${symbol.toLowerCase()}usdt`;
    const stream = `${binanceSymbol}@kline_${interval}`;
    this.addStream(stream);
  }

  public unsubscribeKline(symbol: string, interval: string): void {
    const binanceSymbol = symbol.toLowerCase().endsWith('usdt')
      ? symbol.toLowerCase()
      : `${symbol.toLowerCase()}usdt`;
    const stream = `${binanceSymbol}@kline_${interval}`;
    this.removeStream(stream);
  }

  public unsubscribeTicker(symbol: string): void {
    const binanceSymbol = symbol.toLowerCase().endsWith('usdt')
      ? symbol.toLowerCase()
      : `${symbol.toLowerCase()}usdt`;
    const stream = `${binanceSymbol}@ticker`;
    this.removeStream(stream);
  }

  private addStream(stream: string): void {
    if (this.subscribedStreams.has(stream)) return;
    this.subscribedStreams.add(stream);

    if (this.ws && this.connectionState === 'connected') {
      const payload = {
        method: 'SUBSCRIBE',
        params: [stream],
        id: Date.now(),
      };
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        // ignore send error; will sync on reconnect
      }
    }
  }

  private removeStream(stream: string): void {
    if (!this.subscribedStreams.has(stream)) return;
    this.subscribedStreams.delete(stream);

    if (this.ws && this.connectionState === 'connected') {
      const payload = {
        method: 'UNSUBSCRIBE',
        params: [stream],
        id: Date.now(),
      };
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        // ignore
      }
    }
  }

  private syncSubscriptions(): void {
    if (!this.ws || this.connectionState !== 'connected') return;
    if (this.subscribedStreams.size === 0) return;

    const payload = {
      method: 'SUBSCRIBE',
      params: Array.from(this.subscribedStreams),
      id: Date.now(),
    };
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
  }

  private handleMessage(dataRaw: any): void {
    try {
      const text = typeof dataRaw === 'string' ? dataRaw : dataRaw.toString();
      const msg = JSON.parse(text);

      // Unwrap combined stream envelope if present
      const payload = msg.data ? msg.data : msg;

      // Ignore subscription acknowledgement messages
      if (msg.result === null && msg.id) return;

      const eventType = payload.e;

      if (eventType === '24hrTicker') {
        this.handleTickerPayload(payload);
      } else if (eventType === 'trade') {
        this.handleTradePayload(payload);
      } else if (eventType === 'kline') {
        this.handleKlinePayload(payload);
      } else if (payload.bids && payload.asks) {
        this.handleDepthPayload(msg.stream, payload);
      }
    } catch (err) {
      // JSON parse error or malformed payload, safely ignore
    }
  }

  private handleTickerPayload(payload: any): void {
    const rawSymbol = payload.s; // e.g. BTCUSDT
    const canonical = getAssetByBinanceSymbol(rawSymbol);
    const symbol = canonical ? canonical.symbol : rawSymbol.replace(/USDT$/, '');

    const tick: TickerTick = {
      symbol,
      price: parseFloat(payload.c),
      priceChangePercent24h: parseFloat(payload.P),
      high24h: parseFloat(payload.h),
      low24h: parseFloat(payload.l),
      volume24h: parseFloat(payload.v),
      quoteVolume24h: parseFloat(payload.q),
      timestamp: payload.E || Date.now(),
      provenance: {
        exchange: 'binance',
        market: 'spot',
        symbol: rawSymbol,
        timestamp: payload.E || Date.now(),
        isFallback: false,
      },
    };

    // Forward to EventBus (with 250ms UI throttler)
    this.eventBus.publishTicker(tick);

    // Forward to AnomalyEngine
    if (this.anomalyEngine) {
      this.anomalyEngine.processTick(tick);
    }
  }

  private handleKlinePayload(payload: any): void {
    const k = payload.k;
    if (!k) return;

    const rawSymbol = k.s; // e.g. BTCUSDT
    const canonical = getAssetByBinanceSymbol(rawSymbol);
    const symbol = canonical ? canonical.symbol : rawSymbol.replace(/USDT$/, '');

    const klineTick: KlineTick = {
      symbol,
      interval: k.i,
      openTime: k.t,
      closeTime: k.T,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x,
      timestamp: payload.E || Date.now(),
      provenance: {
        exchange: 'binance',
        market: 'spot',
        symbol: rawSymbol,
        timestamp: payload.E || Date.now(),
        isFallback: false,
      },
    };

    this.eventBus.publishKline(klineTick);
  }

  private handleTradePayload(payload: any): void {
    const rawSymbol = payload.s;
    const canonical = getAssetByBinanceSymbol(rawSymbol);
    const symbol = canonical ? canonical.symbol : rawSymbol.replace(/USDT$/, '');

    const trade: TradeTick = {
      id: String(payload.t),
      symbol,
      price: parseFloat(payload.p),
      size: parseFloat(payload.q),
      side: payload.m ? 'sell' : 'buy',
      timestamp: payload.T || Date.now(),
      provenance: {
        exchange: 'binance',
        market: 'spot',
        symbol: rawSymbol,
        timestamp: payload.T || Date.now(),
        isFallback: false,
      },
    };

    this.eventBus.publishTrade(trade);
  }

  private handleDepthPayload(streamName: string | undefined, payload: any): void {
    // streamName might be e.g. "btcusdt@depth20@100ms"
    const rawSymbol = streamName
      ? streamName.split('@')[0].toUpperCase()
      : 'BTCUSDT';
    const canonical = getAssetByBinanceSymbol(rawSymbol);
    const symbol = canonical ? canonical.symbol : rawSymbol.replace(/USDT$/, '');

    const bids: [number, number][] = (payload.bids || []).map((b: string[]) => [
      parseFloat(b[0]),
      parseFloat(b[1]),
    ]);
    const asks: [number, number][] = (payload.asks || []).map((a: string[]) => [
      parseFloat(a[0]),
      parseFloat(a[1]),
    ]);

    const snapshot: OrderBookSnapshot = {
      symbol,
      bids,
      asks,
      timestamp: Date.now(),
      provenance: {
        exchange: 'binance',
        market: 'spot',
        symbol: rawSymbol,
        timestamp: Date.now(),
        isFallback: false,
      },
    };

    this.eventBus.publishDepth(snapshot);
  }

  private scheduleReconnect(): void {
    // Н6: бесконечный реконнект. Ранее после maxReconnectAttempts (~4.5 мин
    // офлайна) поток умирал навсегда ('error') — до ручного F5. Теперь задержка
    // насыщается на reconnectMaxDelayMs и попытки продолжаются, пока вкладка жива.
    // maxReconnectAttempts теперь означает «число попыток до насыщения задержки».
    this.setConnectionState('reconnecting');

    const exponent = Math.min(this.reconnectAttempts, Math.max(this.maxReconnectAttempts, 1));
    const delay = Math.min(
      this.reconnectInitialDelayMs * Math.pow(2, exponent),
      this.reconnectMaxDelayMs
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Н6: возврат из офлайна — мгновенный реконнект без ожидания текущего таймера.
   * Триггеры: сетевой 'online' и возврат видимости вкладки ('visibilitychange').
   */
  private readonly handleNetworkRecovery = (): void => {
    if (this.isExplicitlyClosed) return;
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.handleNetworkRecovery();
    }
  };

  private attachNetworkRecoveryListeners(): void {
    if (this.networkRecoveryAttached || typeof window === 'undefined' || typeof document === 'undefined') return;
    window.addEventListener('online', this.handleNetworkRecovery);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.networkRecoveryAttached = true;
  }

  private detachNetworkRecoveryListeners(): void {
    if (!this.networkRecoveryAttached || typeof window === 'undefined' || typeof document === 'undefined') return;
    window.removeEventListener('online', this.handleNetworkRecovery);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.networkRecoveryAttached = false;
  }

  private setConnectionState(state: RealtimeConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.eventBus.publishConnectionState(state);
  }
}
