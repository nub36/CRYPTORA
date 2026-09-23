import { useEffect, useState } from 'react';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import type { TickerTick } from '@/types/realtime';

/** Subscribe one view to just one symbol so unrelated 250ms ticker batches do not rerender it. */
export function useLivePrice(symbol?: string): number | undefined {
  const normalized = (symbol ?? '').trim().toUpperCase();
  const [snapshot, setSnapshot] = useState<{ symbol: string; price: number | undefined }>(() => ({
    symbol: normalized,
    price: normalized ? RealtimeFeedManager.getInstance().getLatestPrice(normalized) : undefined,
  }));

  useEffect(() => {
    if (!normalized) {
      setSnapshot({ symbol: normalized, price: undefined });
      return;
    }
    const feed = RealtimeFeedManager.getInstance();
    const initialPrice = feed.getLatestPrice(normalized);
    setSnapshot((previous) => previous.symbol === normalized && previous.price === initialPrice
      ? previous
      : { symbol: normalized, price: initialPrice });
    return feed.eventBus.subscribe<TickerTick>(`ticker:${normalized}`, (tick) => {
      setSnapshot((current) => current.symbol === normalized && current.price === tick.price
        ? current
        : { symbol: normalized, price: tick.price });
    });
  }, [normalized]);

  return snapshot.symbol === normalized
    ? snapshot.price
    : normalized ? RealtimeFeedManager.getInstance().getLatestPrice(normalized) : undefined;
}

/** All-ticker snapshot intended for the compact Market table and an open alerts modal only. */
export function useLivePriceMap(enabled = true): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>(() => (
    enabled ? RealtimeFeedManager.getInstance().getAllLatestPrices() : {}
  ));

  useEffect(() => {
    if (!enabled) return;
    const feed = RealtimeFeedManager.getInstance();
    setPrices(feed.getAllLatestPrices());
    return feed.eventBus.subscribe<TickerTick>('ticker:*', (tick) => {
      setPrices((previous) => previous[tick.symbol] === tick.price
        ? previous
        : { ...previous, [tick.symbol]: tick.price });
    });
  }, [enabled]);

  return prices;
}
