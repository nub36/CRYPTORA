import React, { useMemo } from 'react';
import { OrderBookSnapshot } from '@/types/realtime';
import { formatCurrency } from '@/utils/formatters';

interface OrderBookL2Props {
  orderBook: OrderBookSnapshot | null;
  currentPrice: number;
  symbol: string;
}

export const OrderBookL2: React.FC<OrderBookL2Props> = ({ orderBook, currentPrice, symbol }) => {
  const depthData = useMemo(() => {
    if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      // З6: данных потока ещё нет — НИКАКИХ выдуманных уровней. Рендерим скелетон
      // «ожидание потока» (см. ниже); числа появятся только из фактического WS-снапшота.
      return { bids: [] as [number, number][], asks: [] as [number, number][], isSynthetic: true };
    }

    return {
      bids: orderBook.bids.slice(0, 7),
      asks: orderBook.asks.slice(0, 7),
      isSynthetic: false,
    };
  }, [orderBook, currentPrice]);

  const { bidsWithTotal, asksWithTotal, maxCumulative, spreadUsd, spreadBps } =
    useMemo(() => {
      let bidTotal = 0;
      const bidsWithTotal = depthData.bids.map(([price, size]) => {
        bidTotal += size;
        return { price, size, total: bidTotal };
      });

      let askTotal = 0;
      const asksWithTotal = depthData.asks.map(([price, size]) => {
        askTotal += size;
        return { price, size, total: askTotal };
      });

      const maxCumulative = Math.max(bidTotal, askTotal, 1);
      const bestBid = depthData.bids[0] ? depthData.bids[0][0] : 0;
      const bestAsk = depthData.asks[0] ? depthData.asks[0][0] : 0;
      const spreadUsd = bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
      const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
      const spreadBps = mid > 0 ? (spreadUsd / mid) * 10000 : 0;

      return {
        bidsWithTotal,
        asksWithTotal,
        maxCumulative,
        bestBid,
        bestAsk,
        spreadUsd,
        spreadBps,
      };
    }, [depthData, currentPrice]);

  return (
    <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4 font-sans text-xs flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-surface-border">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-white tracking-wide">Стакан заявок (L2)</span>
          <span className="text-[11px] text-slate-400">SPOT {symbol}/USDT</span>
        </div>
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
            depthData.isSynthetic
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : 'bg-brand-green/10 text-brand-green border border-brand-green/30'
          }`}
        >
          {depthData.isSynthetic ? 'ОЖИДАНИЕ ПОТОКА (WS)' : 'BINANCE L2 · LIVE'}
        </span>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-[11px] text-slate-400 font-semibold py-1.5 border-b border-surface-border/50">
        <div>ЦЕНА (USDT)</div>
        <div className="text-right">РАЗМЕР ({symbol})</div>
        <div className="text-right">СУММА</div>
      </div>

      {/* Asks (Sell Orders, Red, reversed so lowest ask is closest to mid price) */}
      <div className="space-y-0.5 py-1">
        {depthData.isSynthetic ? (
          // З6: скелетон без чисел — ждём фактический снапшот глубины из WS-потока.
          Array.from({ length: 7 }).map((_, idx) => (
            <div key={`ask-skeleton-${idx}`} className="grid grid-cols-3 py-0.5 px-1">
              <div className="h-3 rounded-sm bg-surface-elevated animate-pulse" style={{ width: `${78 - idx * 6}%` }} />
              <div className="h-3 rounded-sm bg-surface-elevated animate-pulse w-12 justify-self-end" />
              <div className="h-3 rounded-sm bg-surface-elevated animate-pulse w-12 justify-self-end" />
            </div>
          ))
        ) : (
        asksWithTotal
          .slice()
          .reverse()
          .map((item, idx) => {
            const depthWidth = Math.min(100, (item.total / maxCumulative) * 100);
            return (
              <div
                key={`ask-${idx}`}
                className="relative grid grid-cols-3 py-0.5 px-1 hover:bg-brand-red/10 rounded transition-colors group"
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-brand-red/15 rounded-sm transition-all pointer-events-none"
                  style={{ width: `${depthWidth}%` }}
                />
                <span className="text-brand-red font-semibold z-10 font-mono tabular-nums">
                  {formatCurrency(item.price, { decimals: item.price > 10 ? 2 : 4 })}
                </span>
                <span className="text-right text-slate-300 z-10">
                  {item.size.toFixed(item.size < 1 ? 4 : 2)}
                </span>
                <span className="text-right text-slate-500 group-hover:text-slate-300 z-10">
                  {item.total.toFixed(item.total < 1 ? 4 : 2)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Mid Price & Spread Bar */}
      <div className="my-1 py-1.5 px-2 bg-surface-elevated/70 border-y border-surface-border rounded flex items-center justify-between text-xs font-bold">
        <div className="flex items-center space-x-2">
          <span className="text-white text-sm font-mono tabular-nums">
            {formatCurrency(currentPrice, { decimals: currentPrice > 10 ? 2 : 4 })}
          </span>
          <span className="text-[11px] text-slate-400 font-normal">Средняя цена</span>
        </div>
        <div className="text-[11px] text-slate-400 font-sans">
          {depthData.isSynthetic ? (
            'СПРЕД: —'
          ) : (
            <>
              СПРЕД: <span className="text-slate-200 font-bold">${spreadUsd.toFixed(2)}</span>{' '}
              <span className="text-brand-cyan">({spreadBps.toFixed(1)} bps)</span>
            </>
          )}
        </div>
      </div>

      {/* Bids (Buy Orders, Green) */}
      <div className="space-y-0.5 py-1">
        {depthData.isSynthetic ? (
          // З6: скелетон без чисел — ждём фактический снапшот глубины из WS-потока.
          Array.from({ length: 7 }).map((_, idx) => (
            <div key={`bid-skeleton-${idx}`} className="grid grid-cols-3 py-0.5 px-1">
              <div className="h-3 rounded-sm bg-surface-elevated animate-pulse" style={{ width: `${78 - idx * 6}%` }} />
              <div className="h-3 rounded-sm bg-surface-elevated animate-pulse w-12 justify-self-end" />
              <div className="h-3 rounded-sm bg-surface-elevated animate-pulse w-12 justify-self-end" />
            </div>
          ))
        ) : (
        bidsWithTotal.map((item, idx) => {
          const depthWidth = Math.min(100, (item.total / maxCumulative) * 100);
          return (
            <div
              key={`bid-${idx}`}
              className="relative grid grid-cols-3 py-0.5 px-1 hover:bg-brand-green/10 rounded transition-colors group"
            >
              {/* Visual Depth Bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-brand-green/15 rounded-sm transition-all pointer-events-none"
                style={{ width: `${depthWidth}%` }}
              />
              <span className="text-brand-green font-semibold z-10 font-mono tabular-nums">
                {formatCurrency(item.price, { decimals: item.price > 10 ? 2 : 4 })}
              </span>
              <span className="text-right text-slate-300 z-10">
                {item.size.toFixed(item.size < 1 ? 4 : 2)}
              </span>
              <span className="text-right text-slate-500 group-hover:text-slate-300 z-10">
                {item.total.toFixed(item.total < 1 ? 4 : 2)}
              </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
