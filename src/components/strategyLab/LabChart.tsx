/**
 * CRYPTORA — Strategy Lab · обёртка графика (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Переиспользует существующий CandleChart ТОЛЬКО через его публичные props
 * (data / indicators / markers / levelLines / onMarkerClick). CandleChart НЕ
 * модифицируется. EMA Fast/Slow подаются в слоты sma20/sma50 (график рисует их
 * как обычные линии; подписи цвета даём в собственной легенде Lab).
 *
 * Ограничение (§17): программное центрирование графика по клику сделки через
 * публичный API CandleChart недоступно — вместо этого мы подсвечиваем маркеры
 * выбранной сделки и её уровни. Центрирование отложено (без правки CandleChart).
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
  // '1m' у production-типа Timeframe нет — оставляем prop пустым (косметика осей).
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

function toAligned(series: (number | null)[]): number[] {
  // CandleChart.toLineData фильтрует НЕ-конечные значения → null прогрева = NaN.
  return series.map((v) => (v === null ? NaN : v));
}

interface LabChartProps {
  result: LabReplayResult | null;
  selectedTrade: LabTrade | null;
  onSelectTrade: (tradeId: string | null) => void;
  height?: number;
}

export const LabChart: React.FC<LabChartProps> = ({
  result,
  selectedTrade,
  onSelectTrade,
  height = 480,
}) => {
  const data = useMemo(() => (result ? toChartData(result) : []), [result]);

  const indicators = useMemo(
    () =>
      result
        ? {
            sma20: toAligned(result.indicators.emaFast),
            sma50: toAligned(result.indicators.emaSlow),
          }
        : undefined,
    [result]
  );

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

  if (!result || data.length === 0) {
    return (
      <div
        data-lab-tutorial="chart"
        className="flex items-center justify-center rounded-lg border border-white/[0.08] bg-surface-inset/40 text-sm text-slate-400"
        style={{ height }}
      >
        Запустите бэктест, чтобы построить график.
      </div>
    );
  }

  return (
    <div data-lab-tutorial="chart" className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#f59e0b' }} />
          EMA Fast
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#3b82f6' }} />
          EMA Slow
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#10b981' }} />
          LONG / TP
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#f43f5e' }} />
          SHORT / SL
        </span>
      </div>
      <CandleChart
        data={data}
        symbol={result.meta.symbol}
        height={height}
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
