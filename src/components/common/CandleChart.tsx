import { useTheme } from '@/context/ThemeContext';
import { readThemeToken } from '@/theme/theme';
import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts';
import { OHLCV } from '@/types/market';

interface CandleChartProps {
  data: OHLCV[];
  symbol?: string;
  height?: number;
}

export const CandleChart: React.FC<CandleChartProps> = ({
  data,
  symbol = 'BTC/USDT',
  height = 380,
}) => {
  // Провенанс свечей определяется данными, а не константой: демо-провайдер помечает
  // ряды синтетическим источником, LIVE-провайдер — фактическим биржевым.
  const candleSource = data[0]?.provenance?.exchange;
  const isDemoCandles = candleSource === 'synthetic-demo' || (data.length > 0 && !candleSource);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const { resolved: theme } = useTheme();

  // Темизация графика: цвета читаются из CSS-токенов (src/index.css), пересчитываются при смене темы.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bg = readThemeToken('--chart-bg', '#090e1a');
    const grid = readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)');
    const border = readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)');
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: bg }, textColor: readThemeToken('--chart-text', '#94a3b8') },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: {
        vertLine: { labelBackgroundColor: theme === 'light' ? '#e2e8f0' : '#131c33' },
        horzLine: { labelBackgroundColor: theme === 'light' ? '#e2e8f0' : '#131c33' },
      },
    });
  }, [theme]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart instance; palette from theme tokens (see effect above for live re-theming)
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#090e1a') },
        textColor: readThemeToken('--chart-text', '#94a3b8'),
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
        fontSize: 11,
      },
      localization: {
        // Явная локаль: защищает ось времени от невалидных системных тегов
        // (например `en-US@posix` в минимальных контейнерах без LANG),
        // на которых `Date.toLocaleString` бросает RangeError.
        locale: 'en-US',
      },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
      },
      crosshair: {
        vertLine: {
          color: '#22d3ee',
          width: 1,
          style: 2,
          labelBackgroundColor: '#131c33',
        },
        horzLine: {
          color: '#22d3ee',
          width: 1,
          style: 2,
          labelBackgroundColor: '#131c33',
        },
      },
      rightPriceScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        scaleMargins: {
          top: 0.1,
          bottom: 0.22,
        },
      },
      timeScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        timeVisible: true,
        secondsVisible: false,
      },
      height,
    });

    // Add Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    // Add Volume histogram series
    const volumeSeries = chart.addHistogramSeries({
      color: '#38bdf8',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Overlay over price
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Responsive resize handler
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    // Немедленная подгонка под фактическую ширину контейнера: без этого canvas может
    // остаться шире карточки (создан до финального layout/шрифтов) и обрезаться.
    handleResize();

    window.addEventListener('resize', handleResize);

    // ResizeObserver ловит смену ширины контейнера (сетка 72/28 при 1280px,
    // сайдбар, скроллбар), которую window.resize не покрывает.
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  // Update data when data changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !data || data.length === 0) return;

    // Format for lightweight-charts
    const chartCandles = data.map((c) => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const chartVolumes = data.map((c) => ({
      time: c.time as any,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
    }));

    candleSeriesRef.current.setData(chartCandles);
    volumeSeriesRef.current.setData(chartVolumes);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-surface shadow-panel-elevated group">
      {/* Subtle Ambient Radial Glow */}
      <div className="absolute top-0 left-1/4 w-96 h-36 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Floating Chart Header Badge */}
      <div className="absolute top-3 left-3.5 z-10 flex items-center space-x-2 text-xs font-sans text-slate-300">
        <span className="font-bold text-white tracking-tight text-sm drop-shadow-sm">
          {symbol}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${
            isDemoCandles
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {isDemoCandles ? 'QA-СВЕЧИ' : `LIVE · ${(candleSource || 'binance').toUpperCase()}`}
        </span>
      </div>

      <div ref={chartContainerRef} className="w-full" style={{ height }} />
    </div>
  );
};
