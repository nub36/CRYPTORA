import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetSummary, AssetCategory } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { sortData, SortConfig } from '@/utils/sorting';
import { Sparkline } from '@/components/common/Sparkline';
import { CoinIcon } from '@/components/common/CoinIcon';
import { Star, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const MarketPage: React.FC = () => {
  const { provider, watchlist, toggleWatchlist, livePrices, dataMode } = useMarketData();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig<AssetSummary>>({
    key: 'rank',
    direction: 'asc',
  });
  const navigate = useNavigate();

  useEffect(() => {
    provider
      .getAssets()
      .then((data) => {
        setAssets(data);
        setSourceUnavailable(false);
      })
      .catch(() => setSourceUnavailable(true));
  }, [provider]);

  // Handle column sort toggle
  const handleSort = (key: keyof AssetSummary) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { key, direction: 'desc' };
    });
  };

  // Filtered & sorted list
  const filteredAssets = useMemo(() => {
    let result = assets;

    if (selectedCategory !== 'all') {
      result = result.filter((a) => a.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
      );
    }

    return sortData(result, sortConfig);
  }, [assets, selectedCategory, search, sortConfig]);

  const categories: { label: string; value: AssetCategory }[] = [
    { label: 'Все активы', value: 'all' },
    { label: 'L1-сети', value: 'l1' },
    { label: 'DeFi', value: 'defi' },
    { label: 'L2-сети', value: 'l2' },
    { label: 'ИИ и данные', value: 'ai' },
    { label: 'Мемкоины', value: 'meme' },
  ];

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5">
      {sourceUnavailable && <DataSourceUnavailable subject="рыночные данные" />}
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-3 border-b border-white/[0.08] gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Рыночные котировки
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[11px] font-mono font-semibold text-brand-green bg-brand-green/10 px-2.5 py-0.5 rounded-full border border-brand-green/30">
                LIVE СПОТ · BINANCE / KUCOIN
              </span>
            ) : (
              <span className="text-[11px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                30 АКТИВОВ (QA)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Котировки, суточные дельты и спарклайны поступают из фактических источников (Binance Spot / KuCoin).'
              : 'Данные 30 активов из QA-датасета: котировки, суточные дельты и спарклайны зафиксированы для оценки интерфейса.'}
          </p>
        </div>

        {/* Search & Category Tabs */}
        <div className="flex min-w-0 flex-col sm:flex-row sm:items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Фильтр по названию или тикеру..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-surface-elevated border border-white/[0.08] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-sans w-full sm:w-64 min-h-[34px]"
            />
          </div>

          {/* Categories */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all whitespace-nowrap min-h-[32px] ${
                  selectedCategory === cat.value
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                    : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white border border-white/[0.08]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main High-Density Table */}
      <div className="bg-surface border border-white/[0.08] rounded-xl overflow-hidden shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left font-sans">
            <thead className="bg-surface-elevated/80 text-slate-400 font-sans text-[11px] uppercase border-b border-surface-border select-none sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">★</th>
                <th
                  onClick={() => handleSort('rank')}
                  className="py-2.5 px-2 cursor-pointer hover:text-white"
                >
                  <div className="flex items-center space-x-1">
                    <span>#</span>
                    {sortConfig.key === 'rank' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('symbol')}
                  className="py-2.5 px-3 cursor-pointer hover:text-white"
                >
                  <div className="flex items-center space-x-1">
                    <span>Актив</span>
                    {sortConfig.key === 'symbol' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('price')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Цена (USD)</span>
                    {sortConfig.key === 'price' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('change1h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>1h %</span>
                    {sortConfig.key === 'change1h' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('change24h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>24h %</span>
                    {sortConfig.key === 'change24h' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('change7d')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden md:table-cell"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>7d %</span>
                    {sortConfig.key === 'change7d' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('volume24h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden sm:table-cell"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>24h Объем</span>
                    {sortConfig.key === 'volume24h' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('marketCap')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Капитализация</span>
                    {sortConfig.key === 'marketCap' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th className="py-2.5 px-3 text-right hidden lg:table-cell">Тренд 7D</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border font-mono">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 font-sans">
                    По вашему запросу активы не найдены.
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const isStarred = watchlist.includes(asset.symbol);
                  return (
                    <tr
                      key={asset.id}
                      onClick={() => navigate(`/coin/${asset.symbol}`)}
                      className="hover:bg-surface-hover/80 transition-colors cursor-pointer group"
                    >
                      <td
                        className="py-2.5 px-3 text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatchlist(asset.symbol);
                        }}
                      >
                        <button
                          className="text-slate-600 hover:text-amber-400 transition-colors p-1"
                          title={isStarred ? 'Удалить из избранного' : 'Добавить в избранное'}
                          aria-label={`Избранное ${asset.symbol}`}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isStarred ? 'text-amber-400 fill-amber-400' : ''
                            }`}
                          />
                        </button>
                      </td>

                      <td className="py-2.5 px-2 text-slate-500 text-[11px]">
                        {asset.rank}
                      </td>

                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center space-x-2">
                          <CoinIcon symbol={asset.symbol} size={22} />
                          <span className="font-bold font-sans text-white group-hover:text-brand-cyan transition-colors">
                            {asset.symbol}
                          </span>
                          <span className="text-slate-400 text-xs hidden sm:inline">
                            {asset.name}
                          </span>
                          <span className="text-[11px] text-slate-400 uppercase font-sans px-1 py-0.2 bg-slate-800 rounded">
                            {asset.category}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-100 font-semibold font-mono tabular-nums">
                        {formatCurrency(livePrices[asset.symbol] ?? asset.price, {
                          decimals: (livePrices[asset.symbol] ?? asset.price) > 10 ? 2 : 4,
                        })}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          asset.change1h == null ? 'text-slate-500' : asset.change1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {asset.change1h != null ? formatPercent(asset.change1h) : '—'}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          asset.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {formatPercent(asset.change24h)}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-semibold hidden md:table-cell ${
                          asset.change7d == null ? 'text-slate-500' : asset.change7d >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {asset.change7d != null ? formatPercent(asset.change7d) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 hidden sm:table-cell font-mono tabular-nums">
                        {formatCurrency(asset.volume24h, { compact: true })}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 font-mono tabular-nums">
                        {formatCurrency(asset.marketCap, { compact: true })}
                      </td>

                      <td className="py-2.5 px-3 text-right hidden lg:table-cell">
                        <div className="flex justify-end">
                          <Sparkline data={asset.sparkline} width={90} height={22} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info in table */}
        <div className="p-3 bg-surface-elevated/50 border-t border-surface-border flex items-center justify-between text-xs text-slate-400 font-sans">
          <div>Показано: {filteredAssets.length} из {assets.length} активов{assets.length < 25 ? ` (из канонических 25)` : ''}</div>
          <div
            className={`flex items-center space-x-1 text-[11px] ${
              dataMode === 'live' ? (sourceUnavailable ? 'text-rose-400/90' : 'text-brand-green/90') : 'text-amber-400/90'
            }`}
          >
            {dataMode === 'live' ? (
              <span>{sourceUnavailable ? '● Источник недоступен' : '● Источник: Binance Spot / KuCoin'}</span>
            ) : (
              <span>● Детерминированный QA-датасет</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
