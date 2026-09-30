/**
 * CRYPTORA — Strategy Lab · Обёртка графика (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Переиспользует существующий CandleChart ТОЛЬКО через его публичные props
 * (data / indicators / markers / levelLines / onMarkerClick). CandleChart НЕ
 * модифицируется.
 *
 * Видимые EMA подаются в слоты sma20/sma50/sma200. Легенда отображает только
 * реально видимые на графике индикаторы.
 */

import React, { useMemo } from 'react';
import { CandleChart } from '@/components/common/CandleChart';
import type { OHLCV, Timeframe } from '@/types/market';
import type { ChartMarker } from '@/types/chart';
import type { LabReplayResult, LabTimeframe, LabTrade } from '@/services/strategyLab/types';
import { mapLabEventMarkers, mapTradeLevels } from '@/services/strategyLab/labChartProjection';

const TF_TO_CHART: Partial<Record<LabTimeframe, Timeframe>> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D',
};

function toChartData(result: LabReplayResult): OHLCV[] {
  return result.candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

function toAligned(series?: (number | null)[]): number[] | undefined {
  if (!series || series.length === 0) return undefined;
  return series.map((v) => (v === null ? NaN : v));
}

interface LabChartProps {
  result: LabReplayResult | null;
  selectedTrade: LabTrade | null;
  onSelectTrade: (tradeId: string | null) => void;
  height?: number;
}

const EMA_COLORS = [
  { label: 'Amber', color: '#f59e0b' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Purple', color: '#a855f7' },
];

export const LabChart: React.FC<LabChartProps> = ({
  result,
  selectedTrade,
  onSelectTrade,
  height,
}) => {
  const data = useMemo(() => (result ? toChartData(result) : []), [result]);

  // Выборка видимых EMA серий для графика
  const { indicators, legendEmas } = useMemo(() => {
    if (!result) return { indicators: undefined, legendEmas: [] };

    const defs = result.indicators.indicatorsList;
    const byId = result.indicators.byIndicatorId;

    if (defs && byId) {
      const visibleEmas = defs.filter((ind) => ind.type === 'EMA' && ind.visible !== false);
      const sma20 = visibleEmas[0] ? toAligned(byId[visibleEmas[0].id]) : undefined;
      const sma50 = visibleEmas[1] ? toAligned(byId[visibleEmas[1].id]) : undefined;
      const sma200 = visibleEmas[2] ? toAligned(byId[visibleEmas[2].id]) : undefined;

      const legend = visibleEmas.slice(0, 3).map((ind, i) => ({
        name: ind.name || `EMA ${ind.period}`,
        color: EMA_COLORS[i]?.color ?? '#f59e0b',
      }));

      return {
        indicators: { sma20, sma50, sma200 },
        legendEmas: legend,
      };
    }

    // Fallback на стандартные emaFast / emaSlow
    return {
      indicators: {
        sma20: toAligned(result.indicators.emaFast),
        sma50: toAligned(result.indicators.emaSlow),
      },
      legendEmas: [
        { name: 'EMA Fast', color: '#f59e0b' },
        { name: 'EMA Slow', color: '#3b82f6' },
      ],
    };
  }, [result]);

  const markers = useMemo(
    () =>
      result
        ? mapLabEventMarkers(result.events, result.candles, {
            selectedTradeId: selectedTrade?.id ?? null,
          }).markers
        : [],
    [result, selectedTrade]
  );

  const levelLines = useMemo(() => mapTradeLevels(selectedTrade), [selectedTrade]);

  const handleMarkerClick = (_marker: ChartMarker, atTime: ChartMarker[]) => {
    const withTrade = atTime.find((m) => m.payload?.tradeId);
    const tradeId = (withTrade?.payload?.tradeId as string | undefined) ?? null;
    onSelectTrade(tradeId);
  };

  const chartTf = result ? TF_TO_CHART[result.meta.timeframe as LabTimeframe] : undefined;

  // Высота: адаптивная для мобильных и десктопа (по умолчанию 360-440px)
  const effectiveHeight = height ?? 420;

  if (!result || data.length === 0) {
    return (
      <div
        data-lab-tutorial="chart"
        className="flex min-h-[320px] sm:min-h-[380px] xl:min-h-[440px] items-center justify-center rounded-lg border border-white/[0.08] bg-surface-inset/40 p-4 text-center text-sm text-slate-400"
      >
        <span>Запустите бэктест, чтобы построить график и отобразить сигналы.</span>
      </div>
    );
  }

  return (
    <div data-lab-tutorial="chart" className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-2 sm:p-3">
      {/* Легенда графика */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-slate-300">
        {legendEmas.map((item) => (
          <span key={item.name} className="flex items-center gap-1 font-medium">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
        <span className="flex items-center gap-1 font-medium">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#10b981' }} />
          LONG / TP
        </span>
        <span className="flex items-center gap-1 font-medium">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#f43f5e' }} />
          SHORT / SL
        </span>
        {selectedTrade && (
          <span className="flex items-center gap-1 text-cyan-300 font-medium">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
            Выбрана сделка {selectedTrade.side} ({selectedTrade.outcome})
          </span>
        )}
      </div>

      <CandleChart
        data={data}
        symbol={result.meta.symbol}
        height={effectiveHeight}
        timeframe={chartTf}
        indicators={indicators}
        showMA
        showVolume
        showBadges={false}
        markers={markers}
        levelLines={levelLines}
        onMarkerClick={handleMarkerClick}
      />
    </div>
  );
};
