/**
 * One bounded server-to-Binance Spot ticker topology for Radar.
 *
 * Browser tabs never call this class. It owns one dynamic subscription set for
 * the server's effective Scan Universe (max 100 symbols) and uses Binance's
 * SUBSCRIBE/UNSUBSCRIBE protocol instead of one socket per symbol.
 */

import WebSocket from 'ws';

const WS_URL = 'wss://stream.binance.com:9443/ws';
const SUBSCRIPTION_CHUNK_SIZE = 100;
const STALE_AFTER_MS = 30_000;
const HEARTBEAT_CHECK_MS = 5_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function normalizeSymbol(raw) {
  const symbol = String(raw ?? '').trim().toUpperCase().replace(/USDT$/, '');
  return /^[A-Z0-9]{1,20}$/.test(symbol) ? symbol : null;
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

export class BinanceRadarTickerStream {
  constructor({
    onTick,
    onStateChange = () => {},
    WebSocketClass = WebSocket,
    url = WS_URL,
    staleAfterMs = STALE_AFTER_MS,
    heartbeatCheckMs = HEARTBEAT_CHECK_MS,
    reconnectMinMs = RECONNECT_MIN_MS,
    reconnectMaxMs = RECONNECT_MAX_MS,
  } = {}) {
    if (typeof onTick !== 'function') throw new Error('BinanceRadarTickerStream requires onTick');
    this.onTick = onTick;
    this.onStateChange = onStateChange;
    this.WebSocketClass = WebSocketClass;
    this.url = url;
    this.staleAfterMs = staleAfterMs;
    this.heartbeatCheckMs = heartbeatCheckMs;
    this.reconnectMinMs = reconnectMinMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.socket = null;
    this.symbols = new Set();
    this.state = 'idle';
    this.lastMessageAt = null;
    this.started = false;
    this.intentionalClose = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.requestId = 1;
    this.reconnectAttempt = 0;
  }

  setSymbols(symbols) {
    const next = new Set();
    for (const raw of symbols ?? []) {
      const symbol = normalizeSymbol(raw);
      if (symbol) next.add(symbol);
    }
    const removed = [...this.symbols].filter((symbol) => !next.has(symbol));
    const added = [...next].filter((symbol) => !this.symbols.has(symbol));
    this.symbols = next;

    if (this.symbols.size === 0) {
      this.stopSocket('idle');
      return;
    }

    this.started = true;
    if (!this.socket) {
      this.open();
      return;
    }
    if (this.isOpen()) {
      this.sendSubscription('UNSUBSCRIBE', removed);
      this.sendSubscription('SUBSCRIBE', added);
    }
  }

  getStatus() {
    return {
      state: this.state,
      subscribedSymbols: this.symbols.size,
      lastMessageAt: this.lastMessageAt ? new Date(this.lastMessageAt).toISOString() : null,
      stale: this.state === 'stale',
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  stop() {
    this.symbols.clear();
    this.stopSocket('disconnected');
  }

  isOpen() {
    return Boolean(this.socket && this.socket.readyState === this.WebSocketClass.OPEN);
  }

  open() {
    if (!this.started || this.symbols.size === 0 || this.socket) return;
    this.intentionalClose = false;
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    try {
      const socket = new this.WebSocketClass(this.url);
      this.socket = socket;
      socket.on('open', () => {
        if (this.socket !== socket) return;
        this.reconnectAttempt = 0;
        this.lastMessageAt = Date.now();
        this.setState('connected');
        this.sendSubscription('SUBSCRIBE', [...this.symbols]);
        this.startHeartbeat();
      });
      socket.on('message', (raw) => this.handleMessage(raw));
      socket.on('error', (error) => {
        if (!this.intentionalClose) this.setState('error', error instanceof Error ? error.message : String(error));
      });
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null;
        this.stopHeartbeat();
        if (this.intentionalClose || !this.started || this.symbols.size === 0) return;
        this.scheduleReconnect();
      });
    } catch (error) {
      this.socket = null;
      this.setState('error', error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
    }
  }

  sendSubscription(method, symbols) {
    if (!this.isOpen() || symbols.length === 0) return;
    for (const part of chunks(symbols.map((symbol) => `${symbol.toLowerCase()}usdt@ticker`), SUBSCRIPTION_CHUNK_SIZE)) {
      try {
        this.socket.send(JSON.stringify({ method, params: part, id: this.requestId++ }));
      } catch (error) {
        this.setState('error', error instanceof Error ? error.message : String(error));
      }
    }
  }

  handleMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
    } catch {
      return;
    }
    const ticker = payload?.data ?? payload;
    if (ticker?.e !== '24hrTicker') return;

    const exchangeSymbol = typeof ticker.s === 'string' ? ticker.s.toUpperCase() : '';
    const symbol = normalizeSymbol(exchangeSymbol);
    const timestamp = Number(ticker.E);
    const price = Number(ticker.c);
    const high24h = Number(ticker.h);
    const low24h = Number(ticker.l);
    const volume24h = Number(ticker.v);
    const quoteVolume24h = Number(ticker.q);
    const priceChangePercent24h = Number(ticker.P);

    // No guessed / local replacement values: an incomplete exchange ticker is
    // not safe Radar input and is honestly ignored.
    if (!symbol || !this.symbols.has(symbol) || !Number.isFinite(timestamp) || !Number.isFinite(price)
      || !Number.isFinite(high24h) || !Number.isFinite(low24h) || !Number.isFinite(volume24h)
      || !Number.isFinite(quoteVolume24h) || !Number.isFinite(priceChangePercent24h)) return;

    this.lastMessageAt = Date.now();
    if (this.state === 'stale') this.setState('connected');
    this.onTick({ symbol, price, priceChangePercent24h, high24h, low24h, volume24h, quoteVolume24h, timestamp });
  }

  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.lastMessageAt || !this.socket || !this.started) return;
      if (Date.now() - this.lastMessageAt <= this.staleAfterMs) return;
      this.setState('stale');
      // A stale ticker stream is not silently treated as connected; terminate so
      // ws closes quickly and the regular exponential reconnect path recovers.
      try {
        this.socket.terminate();
      } catch { /* close handler still owns recovery */ }
    }, this.heartbeatCheckMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  scheduleReconnect() {
    if (this.reconnectTimer || !this.started || this.symbols.size === 0) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectMinMs * (2 ** Math.max(0, this.reconnectAttempt - 1)), this.reconnectMaxMs);
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  stopSocket(finalState) {
    this.started = false;
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch { /* already closed */ }
    }
    this.setState(finalState);
  }

  setState(state, error = null) {
    const changed = this.state !== state;
    this.state = state;
    if (changed || error) this.onStateChange({ ...this.getStatus(), error });
  }
}
