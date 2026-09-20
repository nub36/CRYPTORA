import React, { useState, useMemo, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetSummary, AssetCategory } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { sortData, SortConfig } from '@/utils/sorting';
import { Sparkline } from '@/components/common/Sparkline';
import { CoinIcon } from '@/components/common/CoinIcon';
import { Star, Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Человекочитаемые подписи категорий активов.
 * Внутренние значения (`l1`, `l2`, …) не меняются — меняется только label.
 */
const CATEGORY_LABELS: Record<string, string> = {
  l1: 'Layer-1',
  l2: 'Layer-2',
  defi: 'DeFi',
  ai: 'ИИ и данные',
  meme: 'Мемкоины',
};

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

  // Б1: список рынка обновляется сам (30с; пауза в фоновой вкладке;
  // возврат видимости/сети — внеочередной рефреш).
  const MARKET_REFRESH_MS = 30_000;

  const load = useCallback(() => {
    provider
      .getAssets()
      .then((data) => {
        setAssets(data);
        setSourceUnavailable(false);
      })
      .catch(() => setSourceUnavailable(true));
  }, [provider]);

  useAutoRefresh(load, MARKET_REFRESH_MS);

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
    { label: 'Layer-1', value: 'l1' },
    { label: 'DeFi', value: 'defi' },
    { label: 'Layer-2', value: 'l2' },
    { label: 'ИИ и данные', value: 'ai' },
    { label: 'Мемкоины', value: 'meme' },
  ];

  /**
   * Заголовок столбца с сортировкой.
   *
   * Индикатор — отдельная иконка, а не «# ^» внутри текста: неактивный столбец
   * показывает приглушённую нейтральную иконку, активный — стрелку направления.
   * `aria-sort` объявляет текущее состояние сортировки для скринридеров.
   */
  const renderSortHeader = (
    key: SortConfig<AssetSummary>['key'],
    label: string,
    align: 'left' | 'right',
    extraClass: string
  ) => {
    const isActive = sortConfig.key === key;
    const isAsc = sortConfig.direction === 'asc';
    const alignClass = align === 'right' ? 'justify-end text-right' : 'justify-start text-left';
    return (
      <th
        key={key}
        scope="col"
        aria-sort={isActive ? (isAsc ? 'ascending' : 'descending') : 'none'}
        onClick={() => handleSort(key)}
        className={`py-2.5 px-2.5 cursor-pointer hover:text-white transition-colors ${alignClass} ${extraClass}`}
      >
        <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          <span className="whitespace-nowrap">{label}</span>
          {isActive ? (
            isAsc ? (
              <ArrowUp className="h-3 w-3 shrink-0 text-cyan-400" aria-hidden />
            ) : (
              <ArrowDown className="h-3 w-3 shrink-0 text-cyan-400" aria-hidden />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
          )}
        </span>
      </th>
    );
  };

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
              <span
                data-testid="spot-live-label"
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/30 bg-brand-green/10 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-brand-green"
              >
                <span aria-hidden className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-green" />
                </span>
                СПОТ • LIVE
                {/* Источник — вторичная, менее заметная информация */}
                <span className="font-sans font-normal tracking-normal text-slate-500">
                  Binance / KuCoin
                </span>
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
            <thead className="bg-surface-elevated/80 text-slate-400 font-sans text-[11px] border-b border-surface-border select-none sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center" aria-label="Избранное">
                  <Star className="w-3 h-3 inline-block text-slate-500" aria-hidden />
                </th>
                {renderSortHeader('rank', '#', 'left', '')}
                {renderSortHeader('symbol', 'Актив', 'left', '')}
                {renderSortHeader('price', 'Цена, USD', 'right', '')}
                {renderSortHeader('change1h', '1ч %', 'right', '')}
                {renderSortHeader('change24h', '24ч %', 'right', '')}
                {renderSortHeader('change7d', '7д %', 'right', 'hidden md:table-cell')}
                {renderSortHeader('volume24h', 'Объём 24ч', 'right', 'hidden sm:table-cell')}
                {renderSortHeader('marketCap', 'Капитализация', 'right', '')}
                <th
                  scope="col"
                  className="py-2.5 px-3 text-right hidden lg:table-cell"
                >
                  Тренд 7д
                </th>
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
                          className="text-slate-500 hover:text-amber-400 transition-colors p-1.5"
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
                          <span
                            title={CATEGORY_LABELS[asset.category] ?? asset.category}
                            className="hidden shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-sans text-[11px] leading-none text-slate-400 lg:inline-block"
                          >
                            {CATEGORY_LABELS[asset.category] ?? asset.category}
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
