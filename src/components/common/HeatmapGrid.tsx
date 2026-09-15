import React, { useState } from 'react';
import { AssetSummary } from '@/types/market';
import { DEMO_FUTURES } from '@/services/data/DemoMarketDataProvider';
import { formatCurrency, formatPercent } from '@/utils/formatters';
import { Link } from 'react-router-dom';

export type HeatmapMetric = 'change24h' | 'volume' | 'oi' | 'funding';

interface HeatmapGridProps {
  assets: AssetSummary[];
  limit?: number;
  initialMetric?: HeatmapMetric;
  compact?: boolean;
}

export const HeatmapGrid: React.FC<HeatmapGridProps> = ({
  assets,
  limit = 20,
  initialMetric = 'change24h',
  compact = false,
}) => {
  const [metric, setMetric] = useState<HeatmapMetric>(initialMetric);

  const displayAssets = assets.slice(0, limit);

  // Helper to get tile style based on metric
  const getTileData = (asset: AssetSummary) => {
    const futures = DEMO_FUTURES.find((f) => f.symbol.startsWith(asset.symbol));

    if (metric === 'change24h') {
      const val = asset.change24h;
      let bg = 'bg-slate-800';
      if (val >= 8) bg = 'bg-emerald-600';
      else if (val >= 4) bg = 'bg-emerald-700';
      else if (val > 0) bg = 'bg-emerald-900/80';
      else if (val <= -6) bg = 'bg-rose-600';
      else if (val <= -2) bg = 'bg-rose-800';
      else if (val < 0) bg = 'bg-rose-950/80';

      return {
        bg,
        label: formatPercent(val),
        sublabel: formatCurrency(asset.price),
      };
    }

    if (metric === 'volume') {
      const val = asset.volume24h;
      let bg = 'bg-sky-950';
      if (val >= 10e9) bg = 'bg-sky-600';
      else if (val >= 1e9) bg = 'bg-sky-700';
      else if (val >= 300e6) bg = 'bg-sky-900';

      return {
        bg,
        label: formatCurrency(val, { compact: true }),
        sublabel: `Cap: ${formatCurrency(asset.marketCap, { compact: true })}`,
      };
    }

    if (metric === 'oi') {
      const oiVal = futures ? futures.openInterest : asset.marketCap * 0.05;
      const oiChange = futures ? futures.openInterestChange24h : asset.change24h;
      const bg = oiChange >= 5 ? 'bg-purple-700' : oiChange > 0 ? 'bg-purple-900' : 'bg-slate-800';

      return {
        bg,
        label: formatCurrency(oiVal, { compact: true }),
        sublabel: `OI Δ: ${formatPercent(oiChange)}`,
      };
    }

    // Funding metric
    const fundingRate = futures ? futures.fundingRate : 0.01;
    let bg = 'bg-slate-800';
    if (fundingRate > 0.02) bg = 'bg-amber-600';
    else if (fundingRate > 0) bg = 'bg-emerald-800';
    else if (fundingRate < -0.015) bg = 'bg-purple-800';
    else if (fundingRate < 0) bg = 'bg-rose-800';

    return {
      bg,
      label: `${(fundingRate).toFixed(4)}%`,
      sublabel: `Ann: ${(fundingRate * 3 * 365).toFixed(1)}%`,
    };
  };

  return (
    <div className="w-full bg-surface border border-surface-border rounded-lg p-3 sm:p-4">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-surface-border gap-2">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-sm text-white font-mono tracking-wide">
            ТЕПЛОВАЯ КАРТА
          </span>
          <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
            DEMO TILES
          </span>
        </div>

        {/* Metric Selector Buttons */}
        <div className="flex items-center space-x-1 font-mono text-xs overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setMetric('change24h')}
            className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
              metric === 'change24h'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover'
            }`}
          >
            24h Change
          </button>
          <button
            onClick={() => setMetric('volume')}
            className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
              metric === 'volume'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover'
            }`}
          >
            Объем (Volume)
          </button>
          <button
            onClick={() => setMetric('oi')}
            className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
              metric === 'oi'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover'
            }`}
          >
            Open Interest
          </button>
          <button
            onClick={() => setMetric('funding')}
            className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
              metric === 'funding'
                ? 'bg-brand-cyan text-slate-950 font-bold'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover'
            }`}
          >
            Funding Rate
          </button>
        </div>
      </div>

      {/* Grid of Tiles */}
      <div
        className={`grid gap-2 ${
          compact
            ? 'grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'
            : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
        }`}
      >
        {displayAssets.map((asset) => {
          const tile = getTileData(asset);
          return (
            <Link
              key={asset.id}
              to={`/coin/${asset.symbol}`}
              className={`${tile.bg} p-2.5 rounded border border-white/10 hover:border-brand-cyan hover:scale-[1.02] transition-all flex flex-col justify-between min-h-[74px] shadow-sm select-none group`}
            >
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-sm text-white font-mono group-hover:underline">
                  {asset.symbol}
                </span>
                <span className="text-[10px] text-white/70 font-mono">
                  #{asset.rank}
                </span>
              </div>
              <div className="mt-1">
                <div className="text-xs font-bold text-white font-mono tracking-tight">
                  {tile.label}
                </div>
                <div className="text-[10px] text-white/80 font-mono truncate">
                  {tile.sublabel}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Legend Scale */}
      <div className="mt-3 pt-3 border-t border-surface-border flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 gap-2">
        <div className="flex items-center space-x-1">
          <span>Шкала:</span>
          {metric === 'change24h' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-rose-700 inline-block"></span>
              <span className="text-[10px]">&lt;-5%</span>
              <span className="w-3.5 h-3 rounded bg-slate-800 inline-block"></span>
              <span className="text-[10px]">0%</span>
              <span className="w-3.5 h-3 rounded bg-emerald-700 inline-block"></span>
              <span className="text-[10px]">&gt;+5%</span>
            </div>
          )}
          {metric === 'volume' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-sky-950 inline-block"></span>
              <span className="text-[10px]">&lt;$300M</span>
              <span className="w-3.5 h-3 rounded bg-sky-700 inline-block"></span>
              <span className="text-[10px]">&gt;$1B</span>
              <span className="w-3.5 h-3 rounded bg-sky-500 inline-block"></span>
              <span className="text-[10px]">&gt;$10B</span>
            </div>
          )}
          {metric === 'oi' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-slate-800 inline-block"></span>
              <span className="text-[10px]">Базовый</span>
              <span className="w-3.5 h-3 rounded bg-purple-900 inline-block"></span>
              <span className="text-[10px]">Рост OI</span>
              <span className="w-3.5 h-3 rounded bg-purple-600 inline-block"></span>
              <span className="text-[10px]">&gt;+5% Всплеск</span>
            </div>
          )}
          {metric === 'funding' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-purple-800 inline-block"></span>
              <span className="text-[10px]">Отрицательный (&lt;-0.01%)</span>
              <span className="w-3.5 h-3 rounded bg-emerald-800 inline-block"></span>
              <span className="text-[10px]">Нормальный (~0.01%)</span>
              <span className="w-3.5 h-3 rounded bg-amber-600 inline-block"></span>
              <span className="text-[10px]">Экстремум (&gt;0.02%)</span>
            </div>
          )}
        </div>

        <span className="text-[10px] text-slate-500">
          Клик на плитку открывает страницу монеты
        </span>
      </div>
    </div>
  );
};
