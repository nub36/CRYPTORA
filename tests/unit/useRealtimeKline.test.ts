import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KlineTick, RealtimeConnectionState } from '@/types/realtime';

const feedMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(value: any) => void>>();
  return {
    handlers,
    feed: {
      getConnectionState: vi.fn(() => 'connected' as RealtimeConnectionState),
      subscribeKline: vi.fn(),
      unsubscribeKline: vi.fn(),
      eventBus: {
        subscribe: vi.fn((topic: string, callback: (value: any) => void) => {
          if (!handlers.has(topic)) handlers.set(topic, new Set());
          handlers.get(topic)!.add(callback);
          return () => {
            handlers.get(topic)?.delete(callback);
            if (handlers.get(topic)?.size === 0) handlers.delete(topic);
          };
        }),
      },
    },
  };
});

vi.mock('@/services/realtime/RealtimeFeedManager', () => ({
  RealtimeFeedManager: { getInstance: () => feedMock.feed },
}));

import { useRealtimeKline } from '@/hooks/useRealtimeKline';

function emit(topic: string, value: unknown): void {
  feedMock.handlers.get(topic)?.forEach((callback) => callback(value));
}

describe('useRealtimeKline lifecycle', () => {
  beforeEach(() => {
    feedMock.handlers.clear();
    feedMock.feed.getConnectionState.mockReturnValue('connected');
    feedMock.feed.subscribeKline.mockClear();
    feedMock.feed.unsubscribeKline.mockClear();
  });

  it('delivers klines, reconciles after reconnect, and cleans both subscriptions on unmount', () => {
    const onKlineTick = vi.fn();
    const onReconnect = vi.fn();
    const { unmount } = renderHook(() => useRealtimeKline({ symbol: 'BTC', timeframe: '15m', onKlineTick, onReconnect }));
    expect(feedMock.feed.subscribeKline).toHaveBeenCalledWith('BTC', '15m');

    const event: KlineTick = {
      symbol: 'BTC', interval: '15m', openTime: 1_780_000_000_000, closeTime: 1_780_000_899_000,
      open: 100, high: 102, low: 99, close: 101, volume: 3, isClosed: false, timestamp: 1_780_000_005_000,
      provenance: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', timestamp: 1_780_000_005_000 },
    };
    act(() => emit('kline:BTC:15m', event));
    expect(onKlineTick).toHaveBeenCalledWith(event);

    act(() => {
      emit('connection', 'disconnected');
      emit('connection', 'connected');
    });
    expect(onReconnect).toHaveBeenCalledOnce();

    unmount();
    expect(feedMock.feed.unsubscribeKline).toHaveBeenCalledWith('BTC', '15m');
    expect(feedMock.handlers.size).toBe(0);
  });
});
