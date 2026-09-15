import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { AssetSummary, AssetCategory } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { sortData, SortConfig } from '@/utils/sorting';
import { Sparkline } from '@/components/common/Sparkline';
import { Star, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const MarketPage: React.FC = () => {
  const { provider, watchlist, toggleWatchlist } = useMarketData();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig<AssetSummary>>({
    key: 'rank',
    direction: 'asc',
  });
  const navigate = useNavigate();

  useEffect(() => {
    provider.getAssets().then((data) => {
      setAssets(data);
    });
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
    { label: 'Layer 1', value: 'l1' },
    { label: 'DeFi', value: 'defi' },
    { label: 'Layer 2', value: 'l2' },
    { label: 'AI & Data', value: 'ai' },
    { label: 'Meme', value: 'meme' },
  ];

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-surface-border gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              РЫНОЧНЫЕ КОТИРОВКИ (MARKET)
            </h1>
            <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              30 ДЕМО-АКТИВОВ
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Таблица активов криптовалютного рынка с детерминированными показателями и спарклайнами.
          </p>
        </div>

        {/* Search & Category Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Фильтр по названию или тикеру..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-surface border border-surface-border rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-cyan font-mono w-full sm:w-64"
            />
          </div>

          {/* Categories */}
          <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={`px-2.5 py-1.5 rounded text-xs font-mono transition-colors whitespace-nowrap ${
                  selectedCategory === cat.value
                    ? 'bg-brand-cyan text-slate-950 font-bold'
                    : 'bg-surface text-slate-300 hover:bg-surface-hover border border-surface-border'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main High-Density Table */}
      <div className="bg-surface border border-surface-border rounded-lg overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left font-sans">
            <thead className="bg-surface-elevated/80 text-slate-400 font-mono text-[11px] uppercase border-b border-surface-border select-none sticky top-0 z-10">
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
                          <span className="font-bold font-mono text-white group-hover:text-brand-cyan transition-colors">
                            {asset.symbol}
                          </span>
                          <span className="text-slate-400 text-xs hidden sm:inline">
                            {asset.name}
                          </span>
                          <span className="text-[10px] text-slate-500 uppercase font-mono px-1 py-0.2 bg-slate-800 rounded">
                            {asset.category}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-100 font-semibold">
                        {formatCurrency(asset.price, { decimals: asset.price > 10 ? 2 : 4 })}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          asset.change1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {formatPercent(asset.change1h)}
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
                          asset.change7d >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {formatPercent(asset.change7d)}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 hidden sm:table-cell">
                        {formatCurrency(asset.volume24h, { compact: true })}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300">
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
        <div className="p-3 bg-surface-elevated/50 border-t border-surface-border flex items-center justify-between text-xs text-slate-400 font-mono">
          <div>Показано: {filteredAssets.length} из {assets.length} активов</div>
          <div className="flex items-center space-x-1 text-[11px] text-amber-400/90">
            <span>● Контролируемый детерминированный слой</span>
          </div>
        </div>
      </div>
    </div>
  );
};
