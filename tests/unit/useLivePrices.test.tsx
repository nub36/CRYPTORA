import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { useLivePrice } from '@/hooks/useLivePrices';
import type { TickerTick } from '@/types/realtime';

const tick = (symbol: string, price: number): TickerTick => ({
  symbol, price, priceChangePercent24h: 0, high24h: price, low24h: price,
  volume24h: 1, quoteVolume24h: 1, timestamp: Date.now(),
  provenance: { exchange: 'binance', market: 'spot', symbol: `${symbol}USDT`, timestamp: Date.now() },
});

afterEach(() => RealtimeFeedManager.getInstance().destroy());

describe('symbol-scoped live price updates', () => {
  it('does not rerender the coin view for unrelated symbols in a ticker batch', () => {
    let renders = 0;
    const PriceProbe = () => {
      renders += 1;
      const price = useLivePrice('BTC');
      return <output data-testid="btc-price">{price ?? '—'}</output>;
    };
    render(<PriceProbe />);
    expect(renders).toBe(1);

    const feed = RealtimeFeedManager.getInstance();
    act(() => feed.eventBus.publishTicker(tick('ETH', 3_000), true));
    expect(renders).toBe(1);
    expect(screen.getByTestId('btc-price')).toHaveTextContent('—');

    act(() => feed.eventBus.publishTicker(tick('BTC', 60_000), true));
    expect(renders).toBe(2);
    expect(screen.getByTestId('btc-price')).toHaveTextContent('60000');
  });
});
