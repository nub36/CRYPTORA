/**
 * LiquidationPriceChart — цена и фактические ликвидации на одном графике.
 *
 * Свечи инструмента + полупрозрачные мелкие метки событий потока (зелёные —
 * ликвидированные лонги под свечой, красные — шорты над свечой). Метки не
 * закрывают свечи: без подписей, размер минимальный.
 *
 * Честность: метки строятся только из переданных фактических событий
 * (см. mapLiquidationMarkers); нет свечей — график не рисуется, нет событий
 * по инструменту — показаны только свечи с пояснением.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { OHLCV, LiquidationEvent } from '@/types/market';
import { mapLiquidationMarkers } from '@/services/liquidations/liquidationMarkers';
import { useTheme } from '@/context/ThemeContext';
import { readThemeToken } from '@/theme/theme';

interface LiquidationPriceChartProps {
  candles: OHLCV[];
  events: readonly LiquidationEvent[];
  /** BASE-тикер, напр. 'BTC'. */
  symbol: string;
  /** Шаг сетки свечей в секундах (1h = 3600). */
  timeframeSec?: number;
  height?: number;
}

export const LiquidationPriceChart: React.FC<LiquidationPriceChartProps> = ({
  candles,
  events,
  symbol,
  timeframeSec = 3600,
  height = 320,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const { resolved: theme } = useTheme();

  const mapped = useMemo(
    () => mapLiquidationMarkers(events, candles, symbol, timeframeSec),
    [events, candles, symbol, timeframeSec],
  );

  // Тема
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#090e1a') },
        textColor: readThemeToken('--chart-text', '#94a3b8'),
      },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
      },
    });
  }, [theme]);

  // Создание
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#090e1a') },
        textColor: readThemeToken('--chart-text', '#94a3b8'),
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
        fontSize: 11,
      },
      localization: { locale: 'en-US' },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
      },
      rightPriceScale: { borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)') },
      timeScale: { borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'), timeVisible: true },
      height,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // Данные + маркеры
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as unknown as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    seriesRef.current.setMarkers(
      mapped.markers.map((m) => ({
        time: m.time as unknown as Time,
        position: m.position,
        color: m.color,
        shape: m.shape,
        size: m.size,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles, mapped]);

  if (candles.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-xs font-sans text-slate-500" data-qa="liq-chart-empty">
        Свечи {symbol}/USDT недоступны из текущего источника — график цены не строится на выдуманных данных.
      </div>
    );
  }

  return (
    <div data-qa="liq-price-chart">
      <div ref={containerRef} className="w-full" style={{ height }} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 font-sans text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'rgba(16, 185, 129, 0.8)' }} />
          Ликвидированные лонги ({mapped.markers.filter((m) => m.side === 'LONG').length})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'rgba(244, 63, 94, 0.8)' }} />
          Ликвидированные шорты ({mapped.markers.filter((m) => m.side === 'SHORT').length})
        </span>
        {mapped.matched === 0 && <span>Событий по {symbol} в окне потока нет — показаны только свечи.</span>}
        {mapped.skipped > 0 && <span>Вне ряда свечей пропущено: {mapped.skipped}.</span>}
      </div>
    </div>
  );
};
