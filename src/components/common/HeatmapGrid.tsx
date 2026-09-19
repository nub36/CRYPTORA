import React, { useEffect, useState } from 'react';
import { AssetSummary, FuturesAsset } from '@/types/market';
import { useMarketData } from '@/context/MarketDataContext';
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
  const { provider } = useMarketData();
  const [metric, setMetric] = useState<HeatmapMetric>(initialMetric);
  const [futuresList, setFuturesList] = useState<FuturesAsset[]>([]);

  // LIVE-FIRST: деривативные метрики (OI, фандинг) берутся только из активного
  // провайдера. Если фактических данных нет — плитка честно сообщает об этом,
  // значения из другого датасета или производные «на глаз» не не подставляются.
  useEffect(() => {
    let isActive = true;
    provider
      .getFuturesList()
      .then((list) => {
        if (isActive) setFuturesList(list);
      })
      .catch(() => {
        if (isActive) setFuturesList([]);
      });
    return () => {
      isActive = false;
    };
  }, [provider]);

  const displayAssets = assets.slice(0, limit);
  const isAnyLive = displayAssets.some((a) => !a.isDemo);

  const UNAVAILABLE_TILE = {
    bg: 'bg-surface-inset border-white/[0.06] text-slate-500',
    label: 'НЕТ ДАННЫХ',
    sublabel: 'источник недоступен',
  };

  // Helper to get tile style based on metric
  const getTileData = (asset: AssetSummary) => {
    const futuresRow = futuresList.find((f) => f.symbol.startsWith(asset.symbol));

    if (metric === 'change24h') {
      const val = asset.change24h;
      let bg = 'bg-slate-900/90 border-slate-700/40 text-slate-200';
      if (val >= 8) bg = 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300';
      else if (val >= 4) bg = 'bg-emerald-900/70 border-emerald-600/35 text-emerald-200';
      else if (val > 0) bg = 'bg-emerald-950/50 border-emerald-700/25 text-emerald-300';
      else if (val <= -6) bg = 'bg-rose-950/90 border-rose-500/40 text-rose-300';
      else if (val <= -2) bg = 'bg-rose-900/70 border-rose-600/35 text-rose-200';
      else if (val < 0) bg = 'bg-rose-950/50 border-rose-700/25 text-rose-300';

      return {
        bg,
        label: formatPercent(val),
        sublabel: formatCurrency(asset.price),
      };
    }

    if (metric === 'volume') {
      const val = asset.volume24h;
      let bg = 'bg-sky-950/60 border-sky-800/30 text-sky-200';
      if (val >= 10e9) bg = 'bg-sky-900/90 border-sky-400/50 text-cyan-200';
      else if (val >= 1e9) bg = 'bg-sky-950/80 border-sky-600/40 text-sky-200';
      else if (val >= 300e6) bg = 'bg-sky-950/50 border-sky-700/25 text-sky-300';

      return {
        bg,
        label: formatCurrency(val, { compact: true }),
        sublabel: `Кап.: ${formatCurrency(asset.marketCap, { compact: true })}`,
      };
    }

    if (metric === 'oi') {
      if (!futuresRow) return UNAVAILABLE_TILE;
      const oiVal = futuresRow.openInterest;
      const oiChange = futuresRow.openInterestChange24h;
      if (oiChange == null) {
        return {
          bg: 'bg-slate-900/60 border-slate-700/20 text-slate-400',
          label: formatCurrency(oiVal, { compact: true }),
          sublabel: 'OI Δ: —',
        };
      }
      const bg =
        oiChange >= 5
          ? 'bg-violet-950/90 border-violet-500/40 text-violet-200'
          : oiChange > 0
          ? 'bg-violet-950/60 border-violet-700/30 text-violet-300'
          : 'bg-slate-900/80 border-slate-700/30 text-slate-300';

      return {
        bg,
        label: formatCurrency(oiVal, { compact: true }),
        sublabel: `OI Δ: ${formatPercent(oiChange)}`,
      };
    }

    // Funding metric
    if (!futuresRow) return UNAVAILABLE_TILE;
    const fundingRate = futuresRow.fundingRate;
    let bg = 'bg-slate-900/80 border-slate-700/30 text-slate-300';
    if (fundingRate > 0.02) bg = 'bg-amber-950/90 border-amber-500/40 text-amber-200';
    else if (fundingRate > 0) bg = 'bg-emerald-950/70 border-emerald-600/30 text-emerald-300';
    else if (fundingRate < -0.015) bg = 'bg-violet-950/90 border-violet-500/40 text-violet-200';
    else if (fundingRate < 0) bg = 'bg-rose-950/70 border-rose-600/30 text-rose-300';

    return {
      bg,
      label: `${fundingRate.toFixed(4)}%`,
      sublabel: `Годовых: ${(fundingRate * 3 * 365).toFixed(1)}%`,
    };
  };

  return (
    <div className="w-full bg-surface border border-white/[0.08] rounded-xl p-3 sm:p-4 shadow-panel">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-white/[0.06] gap-2">
        <div className="flex items-center space-x-2">
          <span className="font-sans font-bold text-sm text-white tracking-wider uppercase">
            Тепловая карта
          </span>
          {isAnyLive ? (
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-500/30 font-semibold">
              LIVE
            </span>
          ) : (
            <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold">
              QA
            </span>
          )}
        </div>

        {/* Metric Selector Buttons */}
        <div className="flex items-center space-x-1.5 font-sans text-xs overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setMetric('change24h')}
            className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap font-medium min-h-[32px] ${
              metric === 'change24h'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white border border-white/[0.06]'
            }`}
          >
            24ч Change
          </button>
          <button
            onClick={() => setMetric('volume')}
            className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap font-medium min-h-[32px] ${
              metric === 'volume'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white border border-white/[0.06]'
            }`}
          >
            Volume
          </button>
          <button
            onClick={() => setMetric('oi')}
            className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap font-medium min-h-[32px] ${
              metric === 'oi'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white border border-white/[0.06]'
            }`}
          >
            Open Interest
          </button>
          <button
            onClick={() => setMetric('funding')}
            className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap font-medium min-h-[32px] ${
              metric === 'funding'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm shadow-cyan-500/30'
                : 'bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white border border-white/[0.06]'
            }`}
          >
            Funding
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
              className={`${tile.bg} p-2.5 rounded-lg border hover:border-cyan-400/60 hover:scale-[1.02] transition-all duration-150 flex flex-col justify-between min-h-[76px] shadow-sm select-none group relative overflow-hidden`}
            >
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-sm font-mono tracking-tight group-hover:text-cyan-300 transition-colors">
                  {asset.symbol}
                </span>
                <span className="text-[11px] opacity-70 font-mono">
                  #{asset.rank}
                </span>
              </div>
              <div className="mt-1">
                <div className="text-xs font-bold font-mono tracking-tight tabular-nums">
                  {tile.label}
                </div>
                <div className="text-[11px] opacity-80 font-mono truncate tabular-nums">
                  {tile.sublabel}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Legend Scale */}
      <div className="mt-3.5 pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between text-[11px] font-sans text-slate-400 gap-2">
        <div className="flex items-center space-x-1.5">
          <span className="text-slate-400 font-semibold">Шкала:</span>
          {metric === 'change24h' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-rose-900 border border-rose-500/30 inline-block"></span>
              <span className="text-[11px]">&lt;-5%</span>
              <span className="w-3.5 h-3 rounded bg-slate-800 border border-slate-600/30 inline-block"></span>
              <span className="text-[11px]">0%</span>
              <span className="w-3.5 h-3 rounded bg-emerald-900 border border-emerald-500/30 inline-block"></span>
              <span className="text-[11px]">&gt;+5%</span>
            </div>
          )}
          {metric === 'volume' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-sky-950 border border-sky-800 inline-block"></span>
              <span className="text-[11px]">&lt;$300M</span>
              <span className="w-3.5 h-3 rounded bg-sky-800 border border-sky-500 inline-block"></span>
              <span className="text-[11px]">&gt;$1B</span>
              <span className="w-3.5 h-3 rounded bg-cyan-700 border border-cyan-400 inline-block"></span>
              <span className="text-[11px]">&gt;$10B</span>
            </div>
          )}
          {metric === 'oi' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-slate-900 border border-slate-700 inline-block"></span>
              <span className="text-[11px]">Базовый</span>
              <span className="w-3.5 h-3 rounded bg-violet-950 border border-violet-700 inline-block"></span>
              <span className="text-[11px]">Рост OI</span>
              <span className="w-3.5 h-3 rounded bg-violet-800 border border-violet-500 inline-block"></span>
              <span className="text-[11px]">&gt;+5% Всплеск</span>
            </div>
          )}
          {metric === 'funding' && (
            <div className="flex items-center space-x-1">
              <span className="w-3.5 h-3 rounded bg-violet-900 inline-block"></span>
              <span className="text-[11px]">&lt;-0.01%</span>
              <span className="w-3.5 h-3 rounded bg-emerald-900 inline-block"></span>
              <span className="text-[11px]">~0.01%</span>
              <span className="w-3.5 h-3 rounded bg-amber-800 inline-block"></span>
              <span className="text-[11px]">&gt;0.02%</span>
            </div>
          )}
        </div>

        <span className="text-[11px] text-slate-400">
          Клик на плитку открывает страницу монеты
        </span>
      </div>
    </div>
  );
};
