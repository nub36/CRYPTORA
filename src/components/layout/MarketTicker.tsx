import React from 'react';
import { Link } from 'react-router-dom';
import { DEMO_ASSETS } from '@/services/data/DemoMarketDataProvider';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Sparkline } from '@/components/common/Sparkline';
import { TrendingUp, TrendingDown } from 'lucide-react';

export const MarketTicker: React.FC = () => {
  // Show top assets in ticker
  const tickerAssets = DEMO_ASSETS.slice(0, 10);

  return (
    <div className="w-full bg-[#060912]/95 backdrop-blur-md border-b border-white/[0.06] text-xs overflow-x-auto select-none shadow-inner">
      <div className="flex items-center min-w-max px-3.5 py-1.5 space-x-5">
        {/* Strip Status Tag */}
        <div className="flex items-center space-x-2 pr-3.5 border-r border-white/[0.08] flex-shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] font-mono font-bold text-cyan-400/90">
            DEMO TICKER
          </span>
        </div>

        {/* Assets Ticker Items */}
        {tickerAssets.map((asset) => {
          const isPositive = asset.change24h >= 0;
          return (
            <Link
              key={asset.id}
              to={`/coin/${asset.symbol}`}
              className="flex items-center space-x-2 px-2 py-0.5 rounded-md hover:bg-white/[0.05] transition-all duration-150 font-mono group border border-transparent hover:border-white/[0.06]"
            >
              <span className="font-extrabold text-[12px] text-white group-hover:text-cyan-300 transition-colors tracking-tight">
                {asset.symbol}
              </span>

              <span className="text-slate-200 text-[11px] font-semibold tabular-nums">
                {formatCurrency(asset.price, { decimals: asset.price > 10 ? 2 : 4 })}
              </span>

              <span
                className={`text-[11px] font-bold tabular-nums flex items-center space-x-0.5 ${
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isPositive ? (
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-rose-400" />
                )}
                <span>{formatPercent(asset.change24h)}</span>
              </span>

              <div className="hidden sm:block opacity-75 group-hover:opacity-100 transition-opacity pl-1">
                <Sparkline
                  data={asset.sparkline}
                  width={42}
                  height={15}
                />
              </div>

              <span className="text-white/[0.08] pl-2 font-normal">/</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
