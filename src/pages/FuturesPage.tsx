import React, { useState, useMemo, useCallback } from 'react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { OiDeltaBadge } from '@/components/common/OiDeltaBadge';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { FuturesAsset } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { sortData, SortConfig } from '@/utils/sorting';
import { DerivativesEngine } from '@/services/derivatives/DerivativesEngine';
import { useNavigate } from 'react-router-dom';
import { CoinIcon } from '@/components/common/CoinIcon';
import { ChevronUp, ChevronDown } from 'lucide-react';

export const FuturesPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [futures, setFutures] = useState<FuturesAsset[]>([]);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [filterFunding, setFilterFunding] = useState<'all' | 'positive' | 'negative'>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig<FuturesAsset>>({
    key: 'openInterest',
    direction: 'desc',
  });
  const navigate = useNavigate();

  // Б1: фьючерсы обновляются сами (30с; spot-OI кэшируется 60с, OI-ряд 5мин —
  // цикл почти не создаёт запросов; пауза в фоновой вкладке).
  const FUTURES_REFRESH_MS = 30_000;

  const load = useCallback(() => {
    provider
      .getFuturesList()
      .then((data) => {
        setFutures(data);
        setSourceUnavailable(false);
      })
      .catch(() => setSourceUnavailable(true));
  }, [provider]);

  useAutoRefresh(load, FUTURES_REFRESH_MS);

  const handleSort = (key: keyof FuturesAsset) => {
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

  const filteredFutures = useMemo(() => {
    let result = futures;

    if (filterFunding === 'positive') {
      result = result.filter((f) => f.fundingRate > 0);
    } else if (filterFunding === 'negative') {
      result = result.filter((f) => f.fundingRate < 0);
    }

    return sortData(result, sortConfig);
  }, [futures, filterFunding, sortConfig]);

  // Aggregate derivatives statistics via DerivativesEngine
  const overview = useMemo(
    () => DerivativesEngine.calculateAggregatedOverview(futures),
    [futures]
  );

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3.5">
      {sourceUnavailable && <DataSourceUnavailable subject="данные деривативов (OI, фандинг)" />}
      {/* Page Title & Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-white/[0.08] gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Фьючерсы и деривативы
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[11px] font-mono font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE-ДЕРИВАТИВЫ · BINANCE FUTURES
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

        {/* Filter Buttons */}
        <div className="flex items-center space-x-1.5 font-sans text-xs">
          <span className="text-slate-400 mr-1.5 hidden sm:inline font-semibold">Фандинг:</span>
          <button
            onClick={() => setFilterFunding('all')}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold whitespace-nowrap min-h-[32px] ${
              filterFunding === 'all'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated border border-white/[0.08] text-slate-300 hover:bg-surface-hover hover:text-white'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilterFunding('positive')}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold whitespace-nowrap min-h-[32px] ${
              filterFunding === 'positive'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated border border-white/[0.08] text-slate-300 hover:bg-surface-hover hover:text-white'
            }`}
          >
            Long &gt; 0
          </button>
          <button
            onClick={() => setFilterFunding('negative')}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold whitespace-nowrap min-h-[32px] ${
              filterFunding === 'negative'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated border border-white/[0.08] text-slate-300 hover:bg-surface-hover hover:text-white'
            }`}
          >
            Short &lt; 0 (риск Short Squeeze)
          </button>
        </div>
      </div>

      {/* Aggregate Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-sans">
        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Суммарный Открытый Интерес (OI)</div>
          <div className="text-xl font-bold text-white mt-1 tabular-nums font-mono">
            {formatCurrency(overview.totalOpenInterestUsd, { compact: true })}
          </div>
          <div className="text-[11px] text-emerald-400 mt-0.5 font-semibold">25 ключевых perpetual futures</div>
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
          <div
            className={`text-xl font-bold mt-1 tabular-nums  font-mono${
              overview.averageFundingRate8h >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {overview.averageFundingRate8h >= 0 ? '+' : ''}
            {overview.averageFundingRate8h.toFixed(4)}%
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5 tabular-nums font-mono">
            Годовая ставка: {formatPercent(overview.averageAnnualizedFundingApr)}
          </div>
        </div>

        <div className="bg-surface border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 tracking-wide">Рыночный режим (Базис)</div>
          <div
            className={`text-xl font-bold mt-1 tabular-nums font-mono ${
              overview.marketRegime === 'CONTANGO'
                ? 'text-cyan-400'
                : overview.marketRegime === 'BACKWARDATION'
                ? 'text-amber-400'
                : 'text-slate-200'
            }`}
          >
            {overview.marketRegime === 'CONTANGO' ? 'Контанго' : overview.marketRegime === 'BACKWARDATION' ? 'Бэквордация' : overview.marketRegime}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums font-mono">
            Базис Futures / Spot: {formatPercent(overview.averageBasisPct)}
          </div>
        </div>
      </div>

      {/* Dense Derivatives Table */}
      <div className="bg-surface border border-white/[0.08] rounded-xl overflow-hidden shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left font-mono">
            <thead className="bg-surface-elevated/80 text-slate-400 text-[11px] uppercase border-b border-surface-border select-none sticky top-0 z-10">
              <tr>
                <th
                  onClick={() => handleSort('symbol')}
                  className="py-2.5 px-3 cursor-pointer hover:text-white"
                >
                  <div className="flex items-center space-x-1">
                    <span>Контракт</span>
                    {sortConfig.key === 'symbol' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('markPrice')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  Цена метки
                </th>
                <th
                  onClick={() => handleSort('fundingRate')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Фандинг (8ч)</span>
                    {sortConfig.key === 'fundingRate' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('annualizedFundingRate')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden sm:table-cell"
                >
                  APR
                </th>
                <th
                  onClick={() => handleSort('openInterest')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Открытый интерес</span>
                    {sortConfig.key === 'openInterest' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('openInterestChange1h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden md:table-cell"
                >
                  OI 1h Δ
                </th>
                <th
                  onClick={() => handleSort('openInterestChange24h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>OI 24h Δ</span>
                    {sortConfig.key === 'openInterestChange24h' && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('futuresVolume24h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden sm:table-cell"
                >
                  Объём 24ч
                </th>
                <th
                  onClick={() => handleSort('basisPct')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden lg:table-cell"
                >
                  Базис %
                </th>
                <th
                  onClick={() => handleSort('shortLiquidations24h')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white hidden md:table-cell"
                >
                  Ликв. шортов (24ч)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filteredFutures.map((f) => {
                const baseSymbol = f.symbol.split('/')[0];
                return (
                  <tr
                    key={f.symbol}
                    onClick={() => navigate(`/coin/${baseSymbol}`)}
                    className="hover:bg-surface-hover/80 transition-colors cursor-pointer group"
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-1.5">
                        <CoinIcon symbol={baseSymbol} size={20} />
                        <span className="font-bold text-white group-hover:text-brand-cyan transition-colors">
                          {f.symbol}
                        </span>
                        {!f.isDemo && (
                          <span className="text-[11px] font-mono px-1 py-0.2 rounded bg-brand-green/20 text-brand-green border border-brand-green/30">
                            LIVE
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-100 font-semibold font-mono tabular-nums">
                      {formatCurrency(f.markPrice, { decimals: f.markPrice > 10 ? 2 : 4 })}
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        f.fundingRate >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {f.fundingRate >= 0 ? '+' : ''}
                      {(f.fundingRate).toFixed(4)}%
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right hidden sm:table-cell ${
                        f.annualizedFundingRate >= 0 ? 'text-slate-300' : 'text-rose-400'
                      }`}
                    >
                      {formatPercent(f.annualizedFundingRate)}
                    </td>

                    <td className="py-2.5 px-3 text-right font-bold text-white font-mono tabular-nums">
                      {f.openInterest != null ? formatCurrency(f.openInterest, { compact: true }) : '—'}
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right hidden md:table-cell font-semibold ${
                        f.openInterestChange1h == null ? 'text-slate-500' : f.openInterestChange1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {f.openInterestChange1h != null ? formatPercent(f.openInterestChange1h) : '—'}
                      <OiDeltaBadge source={f.openInterestChangeSource} />
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        f.openInterestChange24h == null ? 'text-slate-500' : f.openInterestChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {f.openInterestChange24h != null ? formatPercent(f.openInterestChange24h) : '—'}
                      <OiDeltaBadge source={f.openInterestChangeSource} />
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-300 hidden sm:table-cell font-mono tabular-nums">
                      {formatCurrency(f.futuresVolume24h, { compact: true })}
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right hidden lg:table-cell ${
                        f.basisPct >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {formatPercent(f.basisPct)}
                    </td>

                    <td
                      className="py-2.5 px-3 text-right text-rose-400 hidden md:table-cell font-mono tabular-nums"
                      data-qa="liq-short-24h"
                      data-source={f.liquidationsSource ?? 'ESTIMATED'}
                    >
                      {f.liquidationsSource === 'UNAVAILABLE' ? (
                        <span className="text-slate-500" title="Поток фактических ликвидаций подключён; событий по инструменту за 24ч не поступало">
                          —
                        </span>
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
