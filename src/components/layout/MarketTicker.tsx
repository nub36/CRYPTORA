import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { AssetSummary } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Sparkline } from '@/components/common/Sparkline';
import { TrendingUp, TrendingDown, RadioTower } from 'lucide-react';

/**
 * MarketTicker — полоса рыночных котировок под шапкой.
 *
 * LIVE-FIRST (v0.8.5): котировки приходят только из активного провайдера данных.
 * Если фактический источник недоступен, полоса честно сообщает об этом и не
 * подставляет числа из другого датасета (инвариант: сбой LIVE ≠ подмена на QA-датасет).
 */
export const MarketTicker: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);

  const isLiveMode = dataMode === 'live';

  useEffect(() => {
    let isActive = true;
    setSourceUnavailable(false);
    provider
      .getAssets()
      .then((list) => {
        if (!isActive) return;
        setAssets(list.slice(0, 10));
      })
      .catch(() => {
        if (!isActive) return;
        setAssets([]);
        setSourceUnavailable(true);
      });
    return () => {
      isActive = false;
    };
  }, [provider]);

  const isEmpty = assets.length === 0;

  return (
    <div className="w-full bg-[#060912]/95 backdrop-blur-md border-b border-white/[0.06] text-xs overflow-x-auto select-none shadow-inner">
      <div className="flex items-center min-w-max px-3.5 py-1.5 space-x-5">
        {/* Метка фактического источника котировок */}
        <div className="flex items-center space-x-2 pr-3.5 border-r border-white/[0.08] flex-shrink-0">
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full ${
                isLiveMode ? 'bg-emerald-400' : 'bg-amber-400'
              } opacity-60`}
            ></span>
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isLiveMode ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            ></span>
          </span>
          <span
            className={`text-[10px] uppercase tracking-[0.14em] font-mono font-bold ${
              isLiveMode ? 'text-emerald-400/90' : 'text-amber-300/90'
            }`}
          >
            {isLiveMode ? 'LIVE TICKER' : 'QA TICKER'}
          </span>
        </div>

        {isEmpty ? (
          <div
            className="flex items-center space-x-2 text-[11px] font-sans text-slate-400"
            data-qa="ticker-source-state"
          >
            <RadioTower className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <span>
              {sourceUnavailable
                ? isLiveMode
                  ? 'Фактический рыночный поток недоступен — значения не подставляются.'
                  : 'Датасет источника недоступен.'
                : 'Ожидание данных от источника…'}
            </span>
          </div>
        ) : (
          assets.map((asset) => {
            const isPositive = asset.change24h >= 0;
            return (
              <Link
                key={asset.symbol}
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

                {asset.sparkline && asset.sparkline.length > 1 && (
                  <div className="hidden sm:block opacity-75 group-hover:opacity-100 transition-opacity pl-1">
                    <Sparkline data={asset.sparkline} width={42} height={15} />
                  </div>
                )}

                <span className="text-white/[0.08] pl-2 font-normal">/</span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
};
