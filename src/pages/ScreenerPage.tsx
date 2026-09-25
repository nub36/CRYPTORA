import React, { useState, useEffect, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetSummary, AssetCategory, ScreenerFilters } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Star, Sparkles } from 'lucide-react';

export const ScreenerPage: React.FC = () => {
  const { provider, watchlist, toggleWatchlist, dataMode } = useMarketData();
  const [results, setResults] = useState<AssetSummary[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [totalCount, setTotalCount] = useState(30);
  const navigate = useNavigate();

  // Filter states
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory>('all');
  const [minPriceChange, setMinPriceChange] = useState<string>('');
  const [maxPriceChange, setMaxPriceChange] = useState<string>('');
  const [minVolume, setMinVolume] = useState<string>('');
  const [fundingFilter, setFundingFilter] = useState<'all' | 'positive' | 'negative'>('all');

  // Trigger query (по изменению фильтров)
  const runScreen = useCallback(async () => {
    const filters: ScreenerFilters = {
      query: query.trim() || undefined,
      category: category !== 'all' ? category : undefined,
      minPriceChange24h: minPriceChange ? Number(minPriceChange) : undefined,
      maxPriceChange24h: maxPriceChange ? Number(maxPriceChange) : undefined,
      minVolume24h: minVolume ? Number(minVolume) * 1e6 : undefined,
      fundingFilter: fundingFilter !== 'all' ? fundingFilter : undefined,
    };

    try {
      const res = await provider.getScreenerResults(filters);
      setResults(res);
    } catch {
      // Источник не ответил — результаты не трогаем/показываем честную недоступность ниже по состоянию.
      setSourceUnavailable(true);
    }
  }, [query, category, minPriceChange, maxPriceChange, minVolume, fundingFilter, provider]);

  useEffect(() => {
    void runScreen();
  }, [runScreen]);

  const refreshCount = useCallback(() => {
    provider
      .getAssets()
      .then((a) => setTotalCount(a.length))
      .catch(() => setSourceUnavailable(true));
  }, [provider]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // Б1: скринер обновляется сам по текущим фильтрам (30с; пауза в фоновой вкладке).
  const SCREENER_REFRESH_MS = 30_000;
  useAutoRefresh(
    () => {
      void runScreen();
      void refreshCount();
    },
    SCREENER_REFRESH_MS,
    { skipImmediate: true }
  );

  const handleReset = () => {
    setQuery('');
    setCategory('all');
    setMinPriceChange('');
    setMaxPriceChange('');
    setMinVolume('');
    setFundingFilter('all');
  };

  // Presets
  const applyPresetGainers = () => {
    handleReset();
    setMinPriceChange('5');
    setMinVolume('300'); // > 300M
  };

  const applyPresetShortSqueeze = () => {
    handleReset();
    setFundingFilter('negative');
    setMinPriceChange('2');
  };

  const applyPresetLargeCap = () => {
    handleReset();
    setMinVolume('1000'); // > 1B
  };

  const applyPresetAiSector = () => {
    handleReset();
    setCategory('ai');
  };

  return (
    <div className="route-shell space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5" data-route="screener" data-layout="results-first">
      {sourceUnavailable && <DataSourceUnavailable subject="результаты скринера" />}
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Крипто-скринер
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[11px] font-mono font-semibold text-brand-green bg-brand-green/10 px-2.5 py-0.5 rounded-full border border-brand-green/30">
                LIVE СПОТ · BINANCE / KUCOIN
              </span>
            ) : (
              <span className="text-[11px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                QA-ДАТАСЕТ
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Многофакторный отбор активов по динамике цены, объемам, секторам и фандингу на фактических рыночных данных.'
              : 'Многофакторный отбор активов по динамике цены, объемам, секторам и фандингу на QA-датасете.'}
          </p>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          <span className="text-slate-400 mr-1 hidden lg:inline font-semibold">Пресеты:</span>
          <button
            onClick={applyPresetGainers}
            className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-emerald-500/50 text-slate-300 hover:text-white rounded-lg transition-all whitespace-nowrap min-h-[32px] flex items-center space-x-1.5"
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>Лидеры роста (&gt;5%)</span>
          </button>
          <button
            onClick={applyPresetShortSqueeze}
            className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-violet-500/50 text-slate-300 hover:text-white rounded-lg transition-all whitespace-nowrap min-h-[32px] flex items-center space-x-1.5"
          >
            <Sparkles className="w-3 h-3 text-violet-400" />
            <span>Short Squeeze (фандинг &lt; 0)</span>
          </button>
          <button
            onClick={applyPresetLargeCap}
            className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-cyan-500/50 text-slate-300 hover:text-white rounded-lg transition-all whitespace-nowrap min-h-[32px] flex items-center space-x-1.5"
          >
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>Крупный объём (&gt;$1B)</span>
          </button>
          <button
            onClick={applyPresetAiSector}
            className="px-3 py-1.5 bg-surface-elevated border border-white/[0.08] hover:border-amber-400/50 text-slate-300 hover:text-white rounded-lg transition-all whitespace-nowrap min-h-[32px] flex items-center space-x-1.5"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Сектор ИИ</span>
          </button>
          <button
            onClick={handleReset}
            className="p-2 bg-surface-elevated hover:bg-surface-hover text-slate-300 hover:text-white rounded-lg border border-white/[0.08] transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
            title="Сбросить все фильтры"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Parameters Form */}
      <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 sm:p-4 space-y-3 font-sans text-xs shadow-panel">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Query search */}
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Поиск инструмента</label>
            <input
              type="text"
              placeholder="BTC, SOL..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Сектор</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AssetCategory)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
            >
              <option value="all">Все сектора</option>
              <option value="l1">Layer-1</option>
              <option value="defi">DeFi</option>
              <option value="l2">Layer-2</option>
              <option value="ai">ИИ и данные</option>
              <option value="meme">Мемкоины</option>
              <option value="other">Прочее</option>
            </select>
          </div>

          {/* Min Price Change */}
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Мин 24h % (от)</label>
            <input
              type="number"
              placeholder="e.g. 3"
              value={minPriceChange}
              onChange={(e) => setMinPriceChange(e.target.value)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
            />
          </div>

          {/* Max Price Change */}
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Макс 24h % (до)</label>
            <input
              type="number"
              placeholder="e.g. 15"
              value={maxPriceChange}
              onChange={(e) => setMaxPriceChange(e.target.value)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
            />
          </div>

          {/* Min Volume */}
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Мин объем ($M)</label>
            <input
              type="number"
              placeholder="e.g. 500"
              value={minVolume}
              onChange={(e) => setMinVolume(e.target.value)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
            />
          </div>

          {/* Funding Filter */}
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Ставка фандинга</label>
            <select
              value={fundingFilter}
              onChange={(e) => setFundingFilter(e.target.value as any)}
              className="w-full bg-surface-elevated border border-surface-border rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-brand-cyan"
            >
              <option value="all">Все ставки</option>
              <option value="positive">Только &gt; 0 (платят лонги)</option>
              <option value="negative">Только &lt; 0 (платят шорты)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-surface-border/50 text-slate-400 text-xs">
          <div>
            Найдено активов:{' '}
            <strong className="text-white font-bold">{results.length}</strong> из {totalCount}
          </div>
          <div className="text-[11px] text-slate-500">
            Фильтрация выполняется мгновенно над типизированным датасетом
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-surface border border-surface-border rounded-lg overflow-hidden shadow-xl font-sans text-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-elevated/80 text-slate-400 text-[11px] uppercase border-b border-surface-border">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">★</th>
                <th className="py-2.5 px-2">#</th>
                <th className="py-2.5 px-3">Символ</th>
                <th className="py-2.5 px-3">Название</th>
                <th className="py-2.5 px-3 text-right">Цена</th>
                <th className="py-2.5 px-3 text-right">1h %</th>
                <th className="py-2.5 px-3 text-right">24h %</th>
                <th className="py-2.5 px-3 text-right">7d %</th>
                <th className="py-2.5 px-3 text-right">24h Объем</th>
                <th className="py-2.5 px-3 text-right">Капитализация</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 font-sans">
                    Нет активов, удовлетворяющих заданным условиям скринера. Попробуйте смягчить фильтры или сбросить их.
                  </td>
                </tr>
              ) : (
                results.map((asset) => {
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
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isStarred ? 'text-amber-400 fill-amber-400' : ''
                            }`}
                          />
                        </button>
                      </td>

                      <td className="py-2.5 px-2 text-slate-500">{asset.rank}</td>

                      <td className="py-2.5 px-3 font-bold text-white group-hover:text-brand-cyan transition-colors">
                        {asset.symbol}
                      </td>

                      <td className="py-2.5 px-3 text-slate-300 font-sans">
                        {asset.name}
                        <span className="text-[11px] text-slate-400 uppercase font-sans ml-2 px-1 py-0.2 bg-slate-800 rounded">
                          {asset.category}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right text-white font-semibold font-mono tabular-nums">
                        {formatCurrency(asset.price, { decimals: asset.price > 10 ? 2 : 4 })}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right ${
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
                        className={`py-2.5 px-3 text-right ${
                          asset.change7d == null ? 'text-slate-500' : asset.change7d >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {asset.change7d != null ? formatPercent(asset.change7d) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 font-mono tabular-nums">
                        {formatCurrency(asset.volume24h, { compact: true })}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 font-mono tabular-nums">
                        {formatCurrency(asset.marketCap, { compact: true })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
