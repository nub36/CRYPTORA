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
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart instance with modern dark terminal styling
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#090e1a' },
        textColor: '#94a3b8',
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
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
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: {
          top: 0.1,
          bottom: 0.22,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
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

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
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
    <div className="relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#090e1a] shadow-panel-elevated group">
      {/* Subtle Ambient Radial Glow */}
      <div className="absolute top-0 left-1/4 w-96 h-36 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Floating Chart Header Badge */}
      <div className="absolute top-3 left-3.5 z-10 flex items-center space-x-2 text-xs font-mono text-slate-300">
        <span className="font-bold text-white tracking-tight text-sm drop-shadow-sm">
          {symbol}
        </span>
        <span className="text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold tracking-wide">
          DEMO СВЕЧИ
        </span>
      </div>

      <div ref={chartContainerRef} className="w-full" style={{ height }} />
    </div>
  );
};
