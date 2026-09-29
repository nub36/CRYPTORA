import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { paginate, DEFAULT_PAGE_SIZE } from '@/utils/pagination';
import {
  getFuturesUniverse,
  getActiveSpotBaseSet,
  futuresBaseToSpot,
  type FuturesUniverse,
} from '@/services/data/registry/exchangeUniverse';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { OiDeltaBadge } from '@/components/common/OiDeltaBadge';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { FuturesAsset } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { DerivativesEngine } from '@/services/derivatives/DerivativesEngine';
import { useNavigate } from 'react-router-dom';
import { CoinIcon } from '@/components/common/CoinIcon';
import { Star, Search } from 'lucide-react';
import { MarketTableShell, type MarketTableStatus } from '@/components/market/MarketTableShell';
import { MobileSortControl, SortableHeaderCell } from '@/components/market/MarketSortControls';
import {
  nextSortState,
  sortMarketRows,
  type MarketSortField,
  type MarketSortState,
} from '@/utils/marketSort';

/**
 * Futures instruments now share the Spot market-universe design system:
 * the same TerminalSection framing, spacing, typography, responsive table,
 * asset icon, favourite star, rank, ticker, sortable headers, positive/negative
 * colours, hover/active states, mobile sort control and loading/error/empty
 * states (see MarketTableShell / MarketSortControls).
 *
 * The COLUMNS stay derivatives-specific on purpose: spot metrics
 * (market cap, supply, 7d sparkline) are not futures facts and are never
 * substituted here.
 */

/** «Нет данных» — единая честная подпись отсутствующей метрики. */
const NO_DATA = 'Нет данных';

const NoData: React.FC<{ title?: string }> = ({ title }) => (
  <span className="font-sans text-[11px] text-slate-500" data-qa="futures-no-data" title={title}>
    {NO_DATA}
  </span>
);

function toneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'text-slate-500';
  return value >= 0 ? 'text-brand-green' : 'text-brand-red';
}

export const FuturesPage: React.FC = () => {
  const { provider, dataMode, watchlist, toggleWatchlist } = useMarketData();
  const [futures, setFutures] = useState<FuturesAsset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [filterFunding, setFilterFunding] = useState<'all' | 'positive' | 'negative' | 'favorites'>('all');
  const [sortState, setSortState] = useState<MarketSortState>({ key: 'openInterest', direction: 'desc' });
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [universe, setUniverse] = useState<FuturesUniverse | null>(null);
  const [universeLoaded, setUniverseLoaded] = useState(false);
  const [spotSet, setSpotSet] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (dataMode !== 'live') return;
    let active = true;
    void Promise.all([getFuturesUniverse(), getActiveSpotBaseSet()]).then(([u, s]) => {
      if (!active) return;
      setUniverse(u);
      setUniverseLoaded(true);
      setSpotSet(s);
    });
    return () => { active = false; };
  }, [dataMode]);

  // Б1: фьючерсы обновляются сами (30с). Данные приходят ОДНИМ агрегированным
  // серверным снимком (`/api/market/derivatives/futures`), поэтому цикл опроса
  // создаёт один запрос из браузера, а не N per-symbol OI-запросов.
  const FUTURES_REFRESH_MS = 30_000;

  const load = useCallback(() => {
    provider
      .getFuturesList()
      .then((data) => {
        setFutures(data);
        setSourceUnavailable(false);
        setLoaded(true);
      })
      .catch(() => { setSourceUnavailable(true); setLoaded(true); });
  }, [provider]);

  useAutoRefresh(load, FUTURES_REFRESH_MS);

  const baseOf = useCallback((f: FuturesAsset) => f.baseAsset ?? f.symbol.split('/')[0]!, []);

  /**
   * Sort model shared with Spot (src/utils/marketSort.ts): numeric fields
   * compare NUMBERS, alphabetical fields compare text, and null / undefined /
   * «Нет данных» always sink to the bottom in BOTH directions.
   */
  const sortFields = useMemo<MarketSortField<FuturesAsset>[]>(() => [
    { key: 'symbol', label: 'Контракт', shortLabel: 'Контракт (А→Я)', kind: 'text', value: (f) => f.symbol, defaultDirection: 'asc' },
    { key: 'rank', label: '#', shortLabel: 'Ранг', kind: 'numeric', value: (f) => futures.indexOf(f) + 1, defaultDirection: 'asc' },
    { key: 'markPrice', label: 'Цена метки', kind: 'numeric', value: (f) => f.markPrice, defaultDirection: 'desc' },
    { key: 'priceChange24h', label: '24ч %', kind: 'numeric', value: (f) => f.priceChange24h ?? null, defaultDirection: 'desc' },
    { key: 'fundingRate', label: 'Фандинг (8ч)', kind: 'numeric', value: (f) => f.fundingRate, defaultDirection: 'desc' },
    { key: 'annualizedFundingRate', label: 'APR', kind: 'numeric', value: (f) => f.annualizedFundingRate, defaultDirection: 'desc' },
    { key: 'openInterest', label: 'Открытый интерес', shortLabel: 'OI', kind: 'numeric', value: (f) => f.openInterest, defaultDirection: 'desc' },
    { key: 'openInterestChange1h', label: 'OI 1ч Δ', kind: 'numeric', value: (f) => f.openInterestChange1h, defaultDirection: 'desc' },
    { key: 'openInterestChange24h', label: 'OI 24ч Δ', kind: 'numeric', value: (f) => f.openInterestChange24h, defaultDirection: 'desc' },
    { key: 'futuresVolume24h', label: 'Объём 24ч', kind: 'numeric', value: (f) => f.futuresVolume24h, defaultDirection: 'desc' },
    { key: 'basisPct', label: 'Базис %', kind: 'numeric', value: (f) => f.basisPct, defaultDirection: 'desc' },
    { key: 'shortLiquidations24h', label: 'Ликв. shorts 24ч', shortLabel: 'Ликвидации shorts', kind: 'numeric', value: (f) => (f.liquidationsSource === 'UNAVAILABLE' ? null : f.shortLiquidations24h), defaultDirection: 'desc' },
  ], [futures]);

  /** Поиск поля по ключу — явный, чтобы порядок колонок не зависел от индексов. */
  const field = useCallback(
    (key: string) => sortFields.find((f) => f.key === key)!,
    [sortFields],
  );

  const handleSort = useCallback((key: string) => {
    setSortState((prev) => nextSortState(prev, sortFields, key));
  }, [sortFields]);

  /** Строгий порядок: фильтры → поиск → СОРТИРОВКА → пагинация. */
  const filteredFutures = useMemo(() => {
    let result = futures;

    if (filterFunding === 'positive') result = result.filter((f) => f.fundingRate > 0);
    else if (filterFunding === 'negative') result = result.filter((f) => f.fundingRate < 0);
    else if (filterFunding === 'favorites') result = result.filter((f) => watchlist.includes(baseOf(f)));

    const q = search.trim().toUpperCase();
    if (q) {
      result = result.filter(
        (f) => f.symbol.toUpperCase().includes(q) || (f.contractSymbol ?? '').includes(q),
      );
    }

    return sortMarketRows(result, sortFields, sortState);
  }, [futures, filterFunding, sortState, search, sortFields, watchlist, baseOf]);

  useEffect(() => { setPage(1); }, [filterFunding, sortState, search]);
  // Only one page of contracts is rendered: 500+ perpetuals never hit the DOM at once.
  const pageData = useMemo(() => paginate(filteredFutures, page, DEFAULT_PAGE_SIZE), [filteredFutures, page]);

  // Aggregate derivatives statistics via DerivativesEngine
  const overview = useMemo(() => DerivativesEngine.calculateAggregatedOverview(futures), [futures]);

  const tableStatus: MarketTableStatus = !loaded
    ? 'loading'
    : sourceUnavailable && futures.length === 0
      ? 'error'
      : filteredFutures.length === 0
        ? 'empty'
        : 'ready';

  const filters: Array<{ value: typeof filterFunding; label: string }> = [
    { value: 'all', label: 'Все' },
    { value: 'favorites', label: 'Избранное' },
    { value: 'positive', label: 'Long > 0' },
    { value: 'negative', label: 'Short < 0' },
  ];

  const rankOf = (f: FuturesAsset) => futures.indexOf(f) + 1;

  return (
    <div className="route-shell space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5" data-route="futures" data-layout="derivatives-workstation">
      {sourceUnavailable && <DataSourceUnavailable subject="данные деривативов (OI, фандинг)" />}

      {/* Top Header — same structure/spacing/typography as the Spot market page */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-3 border-b border-white/[0.08] gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Фьючерсы и деривативы
            </h1>
            {dataMode === 'live' ? (
              <span
                data-testid="futures-live-label"
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/30 bg-brand-green/10 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-brand-green"
              >
                <span aria-hidden className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-green" />
                </span>
                ФЬЮЧЕРСЫ • LIVE
                <span className="font-sans font-normal tracking-normal text-slate-500">Binance USD-M</span>
              </span>
            ) : (
              <span className="text-[11px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                QA-ДАТАСЕТ
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            {dataMode === 'live'
              ? 'Прямой поток метрик бессрочных деривативов: открытый интерес (OI), ставки финансирования 8h / APR, базис и аналитика ликвидаций.'
              : 'Демо-срез бессрочных фьючерсов: открытый интерес (OI), ставки финансирования, базис и ликвидации.'}
          </p>
        </div>

        {/* Search & filter chips — mirrors the Spot controls */}
        <div className="flex min-w-0 flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Фильтр по контракту…"
              aria-label="Поиск контракта"
              data-qa="futures-search"
              className="pl-8 pr-3 py-1.5 bg-surface-elevated border border-white/[0.08] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-sans w-full sm:w-64 min-h-[34px]"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {filters.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilterFunding(f.value)}
                data-qa={`futures-filter-${f.value}`}
                aria-pressed={filterFunding === f.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all whitespace-nowrap min-h-[32px] ${
                  filterFunding === f.value
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                    : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white border border-white/[0.08]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Aggregate Stats Cards (preserved) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-sans">
        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Суммарный Открытый Интерес (OI)</div>
          <div className="text-xl font-bold text-white mt-1 tabular-nums font-mono">
            {formatCurrency(overview.totalOpenInterestUsd, { compact: true })}
          </div>
          <div className="text-[11px] text-emerald-400 mt-0.5 font-semibold" data-qa="futures-universe-count">
            {universe
              ? `${futures.length} активных USDT-M perpetual · всего активных USDT-M контрактов: ${universe.activeUsdtContracts}`
              : dataMode === 'live' && universeLoaded
                ? `${futures.length} контрактов — базовый каталог: список активных контрактов Binance (exchangeInfo) недоступен, активный статус не подтверждён`
                : `${futures.length} USDT-M perpetual`}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Суточный объем деривативов</div>
          <div className="text-xl font-bold text-white mt-1 tabular-nums font-mono">
            {formatCurrency(overview.totalVolume24hUsd, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Публичные данные Binance Futures</div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Средний фандинг (8h / APR)</div>
          <div className={`text-xl font-bold mt-1 tabular-nums font-mono ${overview.averageFundingRate8h >= 0 ? 'text-brand-green' : 'text-brand-red'}`}>
            {overview.averageFundingRate8h >= 0 ? '+' : ''}
            {overview.averageFundingRate8h.toFixed(4)}%
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5 tabular-nums font-mono">
            Годовая ставка: {formatPercent(overview.averageAnnualizedFundingApr)}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Базис / режим рынка</div>
          <div className={`text-xl font-bold mt-1 tabular-nums font-mono ${overview.averageBasisPct >= 0 ? 'text-brand-green' : 'text-brand-red'}`}>
            {formatPercent(overview.averageBasisPct, { decimals: 4 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {overview.marketRegime === 'CONTANGO' ? 'Контанго' : overview.marketRegime === 'BACKWARDATION' ? 'Бэквордация' : 'Нейтрально'}
            {' · '}
            {overview.negativeFundingCount} с отрицательным фандингом
          </div>
        </div>
      </div>

      <MarketTableShell
        label="MARKET UNIVERSE"
        title="Futures instruments"
        meta={`${filteredFutures.length} visible`}
        status={tableStatus}
        columnCount={13}
        page={pageData}
        onPage={setPage}
        paginationQa="futures-pagination"
        qa="futures-table"
        onRetry={load}
        errorMessage="Источник деривативов недоступен — данные не подставляются."
        loadingMessage="Загрузка контрактов USD-M…"
        emptyMessage="По вашему запросу контракты не найдены."
        toolbar={(
          <MobileSortControl
            fields={sortFields}
            state={sortState}
            onChange={setSortState}
            qa="futures-sort"
            className="lg:hidden"
          />
        )}
        footerSummary={(
          <span data-qa="futures-count">
            Найдено: {filteredFutures.length} из {futures.length} контрактов (USD-M, USDT, PERPETUAL)
          </span>
        )}
        footerStatus={(
          <div className={`flex items-center space-x-1 text-[11px] ${
            dataMode === 'live' ? (sourceUnavailable ? 'text-rose-400/90' : 'text-brand-green/90') : 'text-amber-400/90'
          }`}>
            {dataMode === 'live'
              ? <span>{sourceUnavailable ? '● Источник недоступен' : '● Источник: Binance USD-M Futures'}</span>
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
            <SortableHeaderCell field={field('markPrice')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('priceChange24h')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('fundingRate')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('annualizedFundingRate')} state={sortState} onSort={handleSort} align="right" className="hidden sm:table-cell" />
            <SortableHeaderCell field={field('openInterest')} state={sortState} onSort={handleSort} align="right" />
            <SortableHeaderCell field={field('openInterestChange1h')} state={sortState} onSort={handleSort} align="right" className="hidden xl:table-cell" />
            <SortableHeaderCell field={field('openInterestChange24h')} state={sortState} onSort={handleSort} align="right" className="hidden md:table-cell" />
            <SortableHeaderCell field={field('futuresVolume24h')} state={sortState} onSort={handleSort} align="right" className="hidden sm:table-cell" />
            <SortableHeaderCell field={field('basisPct')} state={sortState} onSort={handleSort} align="right" className="hidden lg:table-cell" />
            <SortableHeaderCell field={field('shortLiquidations24h')} state={sortState} onSort={handleSort} align="right" className="hidden xl:table-cell" />
          </tr>
        )}
      >
        {pageData.rows.map((f) => {
          const base = baseOf(f);
          const isStarred = watchlist.includes(base);
          const spotBase = futuresBaseToSpot(base, spotSet);
          return (
            <tr
              key={f.contractSymbol ?? f.symbol}
              data-qa="futures-row"
              data-contract={f.contractSymbol ?? f.symbol}
              onClick={() => navigate(`/futures/${base}`)}
              className="group cursor-pointer transition-colors hover:bg-surface-hover/80"
            >
              <td
                className="py-2.5 px-3 text-center"
                onClick={(e) => { e.stopPropagation(); toggleWatchlist(base); }}
              >
                <button
                  className="p-1.5 text-slate-500 transition-colors hover:text-amber-400"
                  title={isStarred ? 'Удалить из избранного' : 'Добавить в избранное'}
                  aria-label={`Избранное ${base}`}
                >
                  <Star className={`w-3.5 h-3.5 ${isStarred ? 'text-amber-400 fill-amber-400' : ''}`} />
                </button>
              </td>

              <td className="py-2.5 px-2 text-[11px] text-slate-500 tabular-nums">{rankOf(f)}</td>

              <td className="py-2.5 px-3 font-sans">
                <div className="flex min-w-0 items-center space-x-2">
                  <CoinIcon symbol={base} size={22} />
                  <span
                    data-qa="futures-symbol"
                    className="truncate font-bold font-sans text-white transition-colors group-hover:text-brand-cyan"
                  >
                    {f.symbol}
                  </span>
                  <span className="hidden shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-sans text-[11px] leading-none text-slate-400 lg:inline-block">
                    PERP
                  </span>
                  {spotBase && (
                    <span className="hidden shrink-0 text-[11px] text-slate-500 xl:inline">Spot: {spotBase}</span>
                  )}
                </div>
              </td>

              <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-slate-100">
                {Number.isFinite(f.markPrice)
                  ? formatCurrency(f.markPrice, { decimals: f.markPrice > 10 ? 2 : 4 })
                  : <NoData />}
              </td>

              <td className={`py-2.5 px-3 text-right font-bold tabular-nums ${toneClass(f.priceChange24h)}`} data-qa="futures-change24h">
                {f.priceChange24h != null ? formatPercent(f.priceChange24h) : <NoData title="Биржа не вернула ticker-строку по контракту" />}
              </td>

              <td className={`py-2.5 px-3 text-right font-bold tabular-nums ${toneClass(f.fundingRate)}`}>
                {f.fundingRate >= 0 ? '+' : ''}{f.fundingRate.toFixed(4)}%
              </td>

              <td className={`py-2.5 px-3 text-right tabular-nums hidden sm:table-cell ${toneClass(f.annualizedFundingRate)}`}>
                {formatPercent(f.annualizedFundingRate)}
              </td>

              <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-white" data-qa="futures-oi">
                {f.openInterest != null
                  ? formatCurrency(f.openInterest, { compact: true })
                  : <NoData title="Открытый интерес по контракту не получен от биржи" />}
              </td>

              <td className={`py-2.5 px-3 text-right font-bold tabular-nums hidden xl:table-cell ${toneClass(f.openInterestChange1h)}`}>
                {f.openInterestChange1h != null
                  ? <>{formatPercent(f.openInterestChange1h)}<OiDeltaBadge source={f.openInterestChangeSource} /></>
                  : <NoData title="Исторический ряд OI по контракту недоступен" />}
              </td>

              <td className={`py-2.5 px-3 text-right font-bold tabular-nums hidden md:table-cell ${toneClass(f.openInterestChange24h)}`}>
                {f.openInterestChange24h != null
                  ? <>{formatPercent(f.openInterestChange24h)}<OiDeltaBadge source={f.openInterestChangeSource} /></>
                  : <NoData title="Исторический ряд OI по контракту недоступен" />}
              </td>

              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300 hidden sm:table-cell" data-qa="futures-volume">
                {f.futuresVolume24h != null
                  ? formatCurrency(f.futuresVolume24h, { compact: true })
                  : <NoData title="Биржа не вернула ticker-строку по контракту" />}
              </td>

              <td className={`py-2.5 px-3 text-right tabular-nums hidden lg:table-cell ${toneClass(f.basisPct)}`}>
                {formatPercent(f.basisPct, { decimals: 4 })}
              </td>

              <td
                className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-400 hidden xl:table-cell"
                data-qa="liq-short-24h"
                data-source={f.liquidationsSource ?? 'ESTIMATED'}
              >
                {f.liquidationsSource === 'UNAVAILABLE' ? (
                  <NoData title="Поток фактических ликвидаций подключён; событий по инструменту за 24ч не поступало" />
                ) : (
                  <>
                    {formatCurrency(f.shortLiquidations24h, { compact: true })}
                    {f.liquidationsSource !== 'ACTUAL' && (
                      <span
                        data-qa="liq-estimated"
                        title="MODEL / ESTIMATED: поток фактических ликвидаций недоступен — эвристика 0.5% оборота"
                        className="ml-1 rounded border border-white/[0.12] bg-white/[0.06] px-1 py-px text-[11px] font-semibold text-slate-400"
                      >
                        EST.
                      </span>
                    )}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </MarketTableShell>
    </div>
  );
};
