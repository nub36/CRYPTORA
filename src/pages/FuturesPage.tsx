import React, { useState, useEffect, useMemo } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { FuturesAsset } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { sortData, SortConfig } from '@/utils/sorting';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown } from 'lucide-react';

export const FuturesPage: React.FC = () => {
  const { provider } = useMarketData();
  const [futures, setFutures] = useState<FuturesAsset[]>([]);
  const [filterFunding, setFilterFunding] = useState<'all' | 'positive' | 'negative'>('all');
  const [sortConfig, setSortConfig] = useState<SortConfig<FuturesAsset>>({
    key: 'openInterest',
    direction: 'desc',
  });
  const navigate = useNavigate();

  useEffect(() => {
    provider.getFuturesList().then((data) => {
      setFutures(data);
    });
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

  // Aggregate derivatives statistics
  const aggregateOI = futures.reduce((acc, f) => acc + f.openInterest, 0);
  const aggregateVolume = futures.reduce((acc, f) => acc + f.futuresVolume24h, 0);
  const totalLongLiqs = futures.reduce((acc, f) => acc + f.longLiquidations24h, 0);
  const totalShortLiqs = futures.reduce((acc, f) => acc + f.shortLiquidations24h, 0);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Page Title & Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              ФЬЮЧЕРСЫ И ДЕРИВАТИВЫ (PERPETUAL MARKETS)
            </h1>
            <span className="text-[10px] font-mono font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Демо-срез бессрочных фьючерсов: открытый интерес (OI), ставки финансирования, базис и ликвидации.
          </p>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center space-x-1 font-mono text-xs">
          <span className="text-slate-400 mr-1.5 hidden sm:inline">Фандинг:</span>
          <button
            onClick={() => setFilterFunding('all')}
            className={`px-2.5 py-1 rounded transition-colors ${
              filterFunding === 'all'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface border border-surface-border text-slate-300 hover:bg-surface-hover'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilterFunding('positive')}
            className={`px-2.5 py-1 rounded transition-colors ${
              filterFunding === 'positive'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface border border-surface-border text-slate-300 hover:bg-surface-hover'
            }`}
          >
            Лонг &gt; 0
          </button>
          <button
            onClick={() => setFilterFunding('negative')}
            className={`px-2.5 py-1 rounded transition-colors ${
              filterFunding === 'negative'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface border border-surface-border text-slate-300 hover:bg-surface-hover'
            }`}
          >
            Шорт &lt; 0 (Squeeze Watch)
          </button>
        </div>
      </div>

      {/* Aggregate Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] text-slate-400">Суммарный Открытый Интерес (OI)</div>
          <div className="text-lg font-bold text-white mt-0.5">
            {formatCurrency(aggregateOI, { compact: true })}
          </div>
          <div className="text-[10px] text-brand-green mt-0.5">+6.8% за 24 часа</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] text-slate-400">Суточный объем фьючерсов</div>
          <div className="text-lg font-bold text-white mt-0.5">
            {formatCurrency(aggregateVolume, { compact: true })}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Соотношение спот/перп: 1:1.6</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] text-slate-400">Ликвидации Long (24h)</div>
          <div className="text-lg font-bold text-brand-green mt-0.5">
            {formatCurrency(totalLongLiqs, { compact: true })}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Закрытие длинных позиций</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-3">
          <div className="text-[11px] text-slate-400">Ликвидации Short (24h)</div>
          <div className="text-lg font-bold text-brand-red mt-0.5">
            {formatCurrency(totalShortLiqs, { compact: true })}
          </div>
          <div className="text-[10px] text-rose-400 mt-0.5">Каскадный шорт-сквиз</div>
        </div>
      </div>

      {/* Dense Derivatives Table */}
      <div className="bg-surface border border-surface-border rounded-lg overflow-hidden shadow-xl">
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
                      <span className="font-bold text-white group-hover:text-brand-cyan transition-colors">
                        {f.symbol}
                      </span>
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
