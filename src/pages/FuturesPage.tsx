import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { FuturesAsset } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { sortData, SortConfig } from '@/utils/sorting';
import { DerivativesEngine } from '@/services/derivatives/DerivativesEngine';
import { useNavigate } from 'react-router-dom';
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

  useEffect(() => {
    provider
      .getFuturesList()
      .then((data) => {
        setFutures(data);
        setSourceUnavailable(false);
      })
      .catch(() => setSourceUnavailable(true));
  }, [provider]);

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
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              ФЬЮЧЕРСЫ И ДЕРИВАТИВЫ (PERPETUAL MARKETS)
            </h1>
            {dataMode === 'live' ? (
              <span className="text-[10px] font-mono font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
                LIVE DERIVATIVES (BINANCE FUTURES)
              </span>
            ) : (
              <span className="text-[10px] font-mono font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ
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
        <div className="flex items-center space-x-1.5 font-mono text-xs">
          <span className="text-slate-400 mr-1.5 hidden sm:inline font-semibold">Фандинг:</span>
          <button
            onClick={() => setFilterFunding('all')}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold whitespace-nowrap min-h-[32px] ${
              filterFunding === 'all'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-[#111a30] border border-white/[0.08] text-slate-300 hover:bg-[#162342] hover:text-white'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilterFunding('positive')}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold whitespace-nowrap min-h-[32px] ${
              filterFunding === 'positive'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-[#111a30] border border-white/[0.08] text-slate-300 hover:bg-[#162342] hover:text-white'
            }`}
          >
            Лонг &gt; 0
          </button>
          <button
            onClick={() => setFilterFunding('negative')}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold whitespace-nowrap min-h-[32px] ${
              filterFunding === 'negative'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-[#111a30] border border-white/[0.08] text-slate-300 hover:bg-[#162342] hover:text-white'
            }`}
          >
            Шорт &lt; 0 (Squeeze Watch)
          </button>
        </div>
      </div>

      {/* Aggregate Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">Суммарный Открытый Интерес (OI)</div>
          <div className="text-xl font-bold text-white mt-1 tabular-nums">
            {formatCurrency(overview.totalOpenInterestUsd, { compact: true })}
          </div>
          <div className="text-[10px] text-emerald-400 mt-0.5 font-semibold">25 ключевых перп-контрактов</div>
        </div>

        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">Суточный объем деривативов</div>
          <div className="text-xl font-bold text-white mt-1 tabular-nums">
            {formatCurrency(overview.totalVolume24hUsd, { compact: true })}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Публичные данные Binance Futures</div>
        </div>

        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">Средний фандинг (8h / APR)</div>
          <div
            className={`text-xl font-bold mt-1 tabular-nums ${
              overview.averageFundingRate8h >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {overview.averageFundingRate8h >= 0 ? '+' : ''}
            {overview.averageFundingRate8h.toFixed(4)}%
          </div>
          <div className="text-[10px] text-slate-300 mt-0.5 tabular-nums">
            Годовая ставка: {formatPercent(overview.averageAnnualizedFundingApr)}
          </div>
        </div>

        <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl p-3.5 shadow-panel">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider">Рыночный режим (Базис)</div>
          <div
            className={`text-xl font-bold mt-1 tabular-nums ${
              overview.marketRegime === 'CONTANGO'
                ? 'text-cyan-400'
                : overview.marketRegime === 'BACKWARDATION'
                ? 'text-amber-400'
                : 'text-slate-200'
            }`}
          >
            {overview.marketRegime}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
            Базис перп/спот: {formatPercent(overview.averageBasisPct)}
          </div>
        </div>
      </div>

      {/* Dense Derivatives Table */}
      <div className="bg-[#0a0f1d] border border-white/[0.08] rounded-xl overflow-hidden shadow-panel">
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
                  Mark Price
                </th>
                <th
                  onClick={() => handleSort('fundingRate')}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-white"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Funding (8h)</span>
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
                    <span>Open Interest</span>
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
                  24h Объем
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
                  Short Liqs (24h)
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
                        <span className="font-bold text-white group-hover:text-brand-cyan transition-colors">
                          {f.symbol}
                        </span>
                        {!f.isDemo && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-brand-green/20 text-brand-green border border-brand-green/30">
                            LIVE
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-100 font-semibold">
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

                    <td className="py-2.5 px-3 text-right font-bold text-white">
                      {formatCurrency(f.openInterest, { compact: true })}
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right hidden md:table-cell font-semibold ${
                        f.openInterestChange1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {formatPercent(f.openInterestChange1h)}
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        f.openInterestChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {formatPercent(f.openInterestChange24h)}
                    </td>

                    <td className="py-2.5 px-3 text-right text-slate-300 hidden sm:table-cell">
                      {formatCurrency(f.futuresVolume24h, { compact: true })}
                    </td>

                    <td
                      className={`py-2.5 px-3 text-right hidden lg:table-cell ${
                        f.basisPct >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {formatPercent(f.basisPct)}
                    </td>

                    <td className="py-2.5 px-3 text-right text-rose-400 hidden md:table-cell">
                      {formatCurrency(f.shortLiquidations24h, { compact: true })}
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
