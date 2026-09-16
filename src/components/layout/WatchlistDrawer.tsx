import React, { useEffect, useState } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { AssetSummary } from '@/types/market';
import { X, Star, ArrowUpRight, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatPercent } from '@/utils/formatters';

export const WatchlistDrawer: React.FC = () => {
  const { watchlist, toggleWatchlist, isWatchlistOpen, closeWatchlist, provider } = useMarketData();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);

  // LIVE-FIRST: избранное показывает только данные активного провайдера.
  useEffect(() => {
    if (!isWatchlistOpen) return;
    let isActive = true;
    provider
      .getAssets()
      .then((list) => {
        if (!isActive) return;
        setAssets(list);
        setSourceUnavailable(false);
      })
      .catch(() => {
        if (!isActive) return;
        setAssets([]);
        setSourceUnavailable(true);
      });
    return () => {
      isActive = false;
    };
  }, [isWatchlistOpen, provider]);

  if (!isWatchlistOpen) return null;

  const watchedAssets = assets.filter((a) => watchlist.includes(a.symbol));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-surface border-l border-surface-border p-6 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-surface-border">
            <div className="flex items-center space-x-2">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Избранное (Watchlist)
              </h2>
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                {watchedAssets.length}
              </span>
            </div>
            <button
              onClick={closeWatchlist}
              className="text-slate-400 hover:text-white transition-colors p-1"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-2">
            {sourceUnavailable ? (
              <div className="text-center py-12 text-slate-400 text-sm" data-qa="watchlist-unavailable">
                <Star className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p>Фактический источник недоступен.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Значения из другого датасета вместо рыночных не подставляются.
                </p>
              </div>
            ) : watchedAssets.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                <Star className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p>Ваш список наблюдения пуст.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Нажимайте на звездочку рядом с активом в таблице рынка, чтобы добавить сюда.
                </p>
              </div>
            ) : (
              watchedAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-3 rounded-md bg-surface-elevated/60 border border-surface-border hover:border-slate-600 transition-all"
                >
                  <Link
                    to={`/coin/${asset.symbol}`}
                    onClick={closeWatchlist}
                    className="flex-1 flex items-center space-x-3 group"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-white group-hover:text-brand-cyan transition-colors">
                          {asset.symbol}
                        </span>
                        <span className="text-xs text-slate-400">{asset.name}</span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">
                        Кап: {formatCurrency(asset.marketCap, { compact: true })}
                      </div>
                    </div>
                  </Link>

                  <div className="flex items-center space-x-4">
                    <div className="text-right font-mono">
                      <div className="text-sm font-semibold text-white">
                        {formatCurrency(asset.price)}
                      </div>
                      <div
                        className={`text-xs ${
                          asset.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {formatPercent(asset.change24h)}
                      </div>
                    </div>

                    <button
                      onClick={() => toggleWatchlist(asset.symbol)}
                      className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                      title="Удалить из избранного"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-4 border-t border-surface-border flex justify-between items-center text-xs text-slate-400 font-mono">
            <span>Синхронизировано локально</span>
            <Link
              to="/market"
              onClick={closeWatchlist}
              className="text-brand-sky hover:underline flex items-center space-x-1"
            >
              <span>Все активы</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
