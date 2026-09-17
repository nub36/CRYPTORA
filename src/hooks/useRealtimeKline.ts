import { useEffect, useRef } from 'react';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { KlineTick } from '@/types/realtime';
import { Timeframe } from '@/types/market';

/**
 * Map our UI Timeframe type to Binance kline stream interval format.
 * Binance WS kline streams use lowercase intervals: 5m, 15m, 1h, 4h, 1d, 1w.
 */
export function mapTimeframeToBinanceInterval(tf: Timeframe): string {
  switch (tf) {
    case '5m': return '5m';
    case '15m': return '15m';
    case '30m': return '30m';
    case '1h': return '1h';
    case '4h': return '4h';
    case '1D': return '1d';
    case '1W': return '1w';
    default: return '1h';
  }
}

export interface UseRealtimeKlineOptions {
  symbol: string | undefined;
  timeframe: Timeframe;
  enabled?: boolean;
  onKlineTick: (tick: KlineTick) => void;
}

/**
 * Subscribe to Binance kline (candlestick) WebSocket stream for real-time candle updates.
 *
 * The stream fires on every trade in the current candle:
 *  - isClosed=false → candle is still forming (use chart.update())
 *  - isClosed=true  → candle just closed (use chart.update(), then a new candle begins)
 *
 * Handles:
 *  - symbol/timeframe switch: unsubscribe old stream, subscribe new
 *  - duplicate/out-of-order: consumer (CandleChart) handles via time-based dedup
 *  - unmount cleanup
 */
export function useRealtimeKline({ symbol, timeframe, enabled = true, onKlineTick }: UseRealtimeKlineOptions): void {
  const callbackRef = useRef(onKlineTick);
  callbackRef.current = onKlineTick;

  useEffect(() => {
    if (!symbol || !enabled) return;

    const feed = RealtimeFeedManager.getInstance();
    const interval = mapTimeframeToBinanceInterval(timeframe);

    // Subscribe to kline stream
    feed.subscribeKline(symbol, interval);

    // Listen for kline events on this symbol+interval
    const topic = `kline:${symbol.toUpperCase()}:${interval}`;
    const unsub = feed.eventBus.subscribe<KlineTick>(topic, (tick) => {
      callbackRef.current(tick);
    });

    return () => {
      unsub();
      feed.unsubscribeKline(symbol, interval);
    };
  }, [symbol, timeframe, enabled]);
}
