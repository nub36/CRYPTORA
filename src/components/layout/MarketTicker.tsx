import React from 'react';
import { Link } from 'react-router-dom';
import { DEMO_ASSETS } from '@/services/data/DemoMarketDataProvider';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Sparkline } from '@/components/common/Sparkline';

export const MarketTicker: React.FC = () => {
  // Show top 8 assets in ticker
  const tickerAssets = DEMO_ASSETS.slice(0, 8);

  return (
    <div className="w-full bg-surface border-b border-surface-border text-xs overflow-x-auto select-none">
      <div className="flex items-center min-w-max px-3 py-1.5 space-x-6">
        <div className="flex items-center space-x-1.5 pr-3 border-r border-surface-border">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span className="text-[10px] uppercase tracking-wider font-mono font-semibold text-amber-400">
            DEMO TICKER
          </span>
        </div>

        {tickerAssets.map((asset) => (
          <Link
            key={asset.id}
            to={`/coin/${asset.symbol}`}
            className="flex items-center space-x-2.5 hover:opacity-80 transition-opacity font-mono group"
          >
            <span className="font-bold text-slate-200 group-hover:text-brand-cyan transition-colors">
              {asset.symbol}
            </span>
            <span className="text-slate-300">
              {formatCurrency(asset.price, { decimals: asset.price > 10 ? 2 : 4 })}
            </span>
            <span
              className={`text-[11px] font-semibold ${
                asset.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
              }`}
            >
              {formatPercent(asset.change24h)}
            </span>
            <div className="hidden sm:block">
              <Sparkline data={asset.sparkline} width={45} height={16} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};
