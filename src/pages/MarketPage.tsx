import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { paginate, DEFAULT_PAGE_SIZE } from '@/utils/pagination';
import { getCoinNames } from '@/services/data/registry/coinLogoRegistry';
import { getActiveSpotBaseSet } from '@/services/data/registry/exchangeUniverse';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useLivePriceMap } from '@/hooks/useLivePrices';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetSummary, AssetCategory } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { buildMarketUniverse, SPOT_SORT_FIELDS } from '@/services/data/registry/marketUniverse';
import type { MarketUniverseAsset } from '@/services/data/registry/marketUniverse';
import { Sparkline } from '@/components/common/Sparkline';
import { CoinIcon } from '@/components/common/CoinIcon';
import { Star, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MarketTableShell, type MarketTableStatus } from '@/components/market/MarketTableShell';
import { MobileSortControl, SortableHeaderCell } from '@/components/market/MarketSortControls';
import { nextSortState, sortMarketRows, type MarketSortState } from '@/utils/marketSort';

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
  other: 'Прочее',
};

export const MarketPage: React.FC = () => {
  const { provider, watchlist, toggleWatchlist, dataMode } = useMarketData();
  const livePrices = useLivePriceMap();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const marketUniverse = useMemo(
    () => buildMarketUniverse(assets, dataMode === 'live'),
    [assets, dataMode],
  );
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Display names for dynamic assets from the shared metadata cache (ONE request total).
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  // Подтверждён ли список Binance exchangeInfo (тот же кэш/запрос, что у провайдера).
  // Без подтверждения показывается базовый каталог и он НЕ называется «активным».
  const [universeConfirmed, setUniverseConfirmed] = useState<boolean | null>(null);
  useEffect(() => {
    if (dataMode !== 'live') return;
    let active = true;
    void getActiveSpotBaseSet().then((set) => { if (active) setUniverseConfirmed(set !== null); });
    return () => { active = false; };
  }, [dataMode, assets]);
  const universeKey = marketUniverse.map((a) => a.symbol).join(',');
  useEffect(() => {
    let active = true;
    const symbols = universeKey ? universeKey.split(',') : [];
    if (symbols.length === 0) return;
    void getCoinNames(symbols).then((m) => { if (active) setNames(m); });
    return () => { active = false; };
  }, [universeKey]);
  const displayName = useCallback(
    (a: MarketUniverseAsset) => (a.name === a.symbol ? names.get(a.symbol) ?? a.name : a.name),
    [names],
  );
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>('all');
  const [sortState, setSortState] = useState<MarketSortState>({ key: 'rank', direction: 'asc' });
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const field = useCallback((key: string) => SPOT_SORT_FIELDS.find((f) => f.key === key)!, []);

  // Б1: список рынка обновляется сам (30с; пауза в фоновой вкладке;
  // возврат видимости/сети — внеочередной рефреш).
  const MARKET_REFRESH_MS = 30_000;

  const load = useCallback(() => {
    provider
      .getAssets()
      .then((data) => {
        setAssets(data);
        setSourceUnavailable(false);
        setLoaded(true);
      })
      .catch(() => { setSourceUnavailable(true); setLoaded(true); });
  }, [provider]);

  useAutoRefresh(load, MARKET_REFRESH_MS);

  // Column sort toggle — shared model with the Futures table.
  const handleSort = useCallback((key: string) => {
    setSortState((prev) => nextSortState(prev, SPOT_SORT_FIELDS, key));
  }, []);

  // Filtered & sorted list
  const filteredAssets = useMemo(() => {
    let result: MarketUniverseAsset[] = marketUniverse;

    if (selectedCategory !== 'all') {
      result = result.filter((a) => a.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) => a.symbol.toLowerCase().includes(q) || displayName(a).toLowerCase().includes(q)
      );
    }

    // Strict order: filters → search → SORT → pagination.
    return sortMarketRows(result, SPOT_SORT_FIELDS, sortState);
  }, [marketUniverse, selectedCategory, search, sortState, displayName]);

  // Filters/sort reset to the first page; only ONE page of rows is ever rendered.
  useEffect(() => { setPage(1); }, [selectedCategory, search, sortState]);
  const pageData = useMemo(() => paginate(filteredAssets, page, DEFAULT_PAGE_SIZE), [filteredAssets, page]);

  const tableStatus: MarketTableStatus = !loaded
    ? 'loading'
    : sourceUnavailable && marketUniverse.length === 0
      ? 'error'
      : filteredAssets.length === 0
        ? 'empty'
        : 'ready';

  const categories: { label: string; value: AssetCategory }[] = [
    { label: 'Все активы', value: 'all' },
    { label: 'Прочие Spot-активы', value: 'other' },
    { label: 'Layer-1', value: 'l1' },
    { label: 'DeFi', value: 'defi' },
    { label: 'Layer-2', value: 'l2' },
    { label: 'ИИ и данные', value: 'ai' },
    { label: 'Мемкоины', value: 'meme' },
  ];

  return (
    <div className="route-shell space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5" data-route="market" data-layout="table-first">
      {sourceUnavailable && <DataSourceUnavailable subject="рыночные данные" />}
      {dataMode === 'live' && marketUniverse.some((asset) => !asset.quote) && (
        <div role="status" className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 font-sans text-xs text-amber-200">
          Каталог содержит {marketUniverse.length} поддерживаемых Spot-активов; котировки отсутствуют для {marketUniverse.filter((asset) => !asset.quote).length}. Для них показываются метаданные и тире — без подстановки цен.
        </div>
      )}
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
              aria-label="Поиск инструмента"
              data-qa="market-search"
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

      <MarketTableShell
        label="MARKET UNIVERSE"
        title="Spot instruments"
        meta={`${filteredAssets.length} visible`}
        status={tableStatus}
        columnCount={10}
        page={pageData}
        onPage={setPage}
        paginationQa="market-pagination"
        qa="market-table"
        onRetry={load}
        errorMessage="Источник рыночных данных недоступен — котировки не подставляются."
        loadingMessage="Загрузка Spot-инструментов…"
        emptyMessage="По вашему запросу активы не найдены."
        toolbar={(
          <MobileSortControl
            fields={SPOT_SORT_FIELDS}
            state={sortState}
            onChange={setSortState}
            qa="market-sort"
            className="lg:hidden"
          />
        )}
        footerSummary={(
          <span data-qa="market-count">
            {dataMode === 'live' && universeConfirmed === false
              ? `Найдено: ${filteredAssets.length} из ${marketUniverse.length} — базовый каталог: список активных инструментов Binance (exchangeInfo) недоступен, активный статус не подтверждён`
              : `Найдено: ${filteredAssets.length} из ${marketUniverse.length} активных Spot-инструментов`}
          </span>
        )}
        footerStatus={(
          <div className={`flex items-center space-x-1 text-[11px] ${
            dataMode === 'live' ? (sourceUnavailable ? 'text-rose-400/90' : 'text-brand-green/90') : 'text-amber-400/90'
          }`}>
            {dataMode === 'live'
              ? <span>{sourceUnavailable ? '● Источник недоступен' : '● Источник: Binance Spot / KuCoin'}</span>
              : <span>● Детерминированный QA-датасет</span>}
          </div>
        )}
        head={(
          <tr>
            <th className="py-2.5 px-3 w-10 text-center" aria-label="Избранное">
              <Star className="w-3 h-3 inline-block text-slate-500" aria-hidden />
            </th>
            <SortableHeaderCell field={field('rank')} state={sortState} onSort={handleSort} align="left" />
            <SortableHeaderCell field={field('symbol')} state={sortState} onSort={handleSort} align="left" />
            <SortableHeaderCell field={field('price')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('change1h')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('change24h')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('change7d')} state={sortState} onSort={handleSort} align="right" className="hidden md:table-cell" />
            <SortableHeaderCell field={field('volume24h')} state={sortState} onSort={handleSort} align="right" className="hidden sm:table-cell" />
            <SortableHeaderCell field={field('marketCap')} state={sortState} onSort={handleSort} align="right" />
            <th scope="col" className="py-2.5 px-3 text-right hidden lg:table-cell">Тренд 7д</th>
          </tr>
        )}
      >
        {pageData.rows.map((asset) => {
                  const isStarred = watchlist.includes(asset.symbol);
                  return (
                    <tr
                      key={asset.id}
                      data-qa="market-row"
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
                          <span
                            data-qa="market-symbol"
                            className="font-bold font-sans text-white group-hover:text-brand-cyan transition-colors"
                          >
                            {asset.symbol}
                          </span>
                          <span className="text-slate-400 text-xs hidden sm:inline">
                            {displayName(asset)}
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
                        {(() => {
                          const price = livePrices[asset.symbol] ?? asset.quote?.price;
                          return price != null
                            ? formatCurrency(price, { decimals: price > 10 ? 2 : 4 })
                            : '—';
                        })()}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          asset.quote?.change1h == null ? 'text-slate-500' : asset.quote.change1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {asset.quote?.change1h != null ? formatPercent(asset.quote.change1h) : '—'}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          asset.quote == null ? 'text-slate-500' : asset.quote.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {asset.quote != null ? formatPercent(asset.quote.change24h) : '—'}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-semibold hidden md:table-cell ${
                          asset.quote?.change7d == null ? 'text-slate-500' : asset.quote.change7d >= 0 ? 'text-brand-green' : 'text-brand-red'
                        }`}
                      >
                        {asset.quote?.change7d != null ? formatPercent(asset.quote.change7d) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 hidden sm:table-cell font-mono tabular-nums">
                        {asset.quote ? formatCurrency(asset.quote.volume24h, { compact: true }) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-300 font-mono tabular-nums">
                        {asset.quote && asset.quote.marketCap > 0 ? formatCurrency(asset.quote.marketCap, { compact: true }) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right hidden lg:table-cell">
                        <div className="flex justify-end">
                          <Sparkline data={asset.quote?.sparkline ?? []} width={90} height={22} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
      </MarketTableShell>
    </div>
  );
};
