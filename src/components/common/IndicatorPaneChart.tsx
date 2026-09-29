import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time, TickMarkType } from 'lightweight-charts';
import type { OHLCV, Timeframe } from '@/types/market';
import type { KlineTick } from '@/types/realtime';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import { mergeKlineIntoCandles } from '@/services/realtime/candleHandoff';
import { ChartTimeRangeSync } from './ChartTimeRangeSync';
import { formatChartAxisTime } from '@/utils/chartTime';
import { readThemeToken } from '@/theme/theme';
import { useTheme } from '@/context/ThemeContext';
import { RSI_FIXED_PRICE_RANGE } from './chartPresentationConfig';

interface IndicatorPaneChartProps {
  kind: 'RSI' | 'MACD';
  candles: OHLCV[];
  realtimeKline: KlineTick | null | undefined;
  expectedSymbol: string;
  timeframe: Timeframe;
  interval: string;
  height: number;
  showTimeAxis: boolean;
  timeSync: ChartTimeRangeSync;
  /** Shared minimum keeps every independent lightweight-charts plot boundary aligned. */
  priceScaleMinimumWidth: number;
  onPriceScaleWidthChange: (width: number) => void;
}

export const IndicatorPaneChart: React.FC<IndicatorPaneChartProps> = ({
  kind, candles, realtimeKline, expectedSymbol, timeframe, interval, height, showTimeAxis, timeSync,
  priceScaleMinimumWidth, onPriceScaleWidthChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const signalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const histogramRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const zeroRef = useRef<ISeriesApi<'Line'> | null>(null);
  const levelRefs = useRef<Array<ISeriesApi<'Line'> | null>>([]);
  const { resolved: theme } = useTheme();
  const widthCallbackRef = useRef(onPriceScaleWidthChange);
  widthCallbackRef.current = onPriceScaleWidthChange;

  const reportPriceScaleWidth = useCallback((chart: IChartApi) => {
    try {
      const width = chart.priceScale('right').width();
      if (Number.isFinite(width) && width > 0) widthCallbackRef.current(width);
    } catch { /* scale is not ready yet */ }
  }, []);

  const effectiveCandles = useMemo(() => realtimeKline
    ? mergeKlineIntoCandles(candles, realtimeKline, expectedSymbol, interval)
    : candles, [candles, realtimeKline, expectedSymbol, interval]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#090e1a') },
        textColor: readThemeToken('--chart-text', '#94a3b8'),
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
      },
      rightPriceScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        scaleMargins: kind === 'RSI' ? { top: 0.08, bottom: 0.08 } : { top: 0.1, bottom: 0.1 },
        minimumWidth: priceScaleMinimumWidth,
      },
      timeScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        barSpacing: 10,
        visible: showTimeAxis,
        tickMarkFormatter: (time: Time, tickType: TickMarkType) => formatChartAxisTime(time, tickType),
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (time: Time) => formatChartAxisTime(time, TickMarkType.Time),
      },
    });
    chartRef.current = chart;

    if (kind === 'RSI') {
      const rsi = chart.addLineSeries({
        color: '#a78bfa', lineWidth: 2,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: RSI_FIXED_PRICE_RANGE }),
      });
      seriesRef.current = rsi;
      levelRefs.current = [30, 50, 70].map((_level, index) => chart.addLineSeries({
        color: index === 1 ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.65)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: RSI_FIXED_PRICE_RANGE }),
      }));
    } else {
      seriesRef.current = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      signalRef.current = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      histogramRef.current = chart.addHistogramSeries({
        priceLineVisible: false,
        lastValueVisible: false,
        base: 0,
        priceScaleId: 'right',
      });
      zeroRef.current = chart.addLineSeries({ color: 'rgba(148, 163, 184, 0.55)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    }

    const unregister = timeSync.add(chart);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect?.width && chartRef.current === chart) {
          chart.applyOptions({ width: rect.width, ...(rect.height > 0 ? { height: rect.height } : {}) });
          reportPriceScaleWidth(chart);
        }
      });
      observer.observe(containerRef.current);
    }
    const handleResize = () => {
      if (containerRef.current && chartRef.current === chart) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight || height });
        reportPriceScaleWidth(chart);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
      unregister();
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
      seriesRef.current = null;
      signalRef.current = null;
      histogramRef.current = null;
      zeroRef.current = null;
      levelRefs.current = [];
    };
    // Creation is intentionally independent from pane height: pointer resize
    // must resize the existing chart, not destroy its series/history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, timeSync, reportPriceScaleWidth]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      height,
      rightPriceScale: { minimumWidth: priceScaleMinimumWidth },
    });
    reportPriceScaleWidth(chart);
  }, [height, priceScaleMinimumWidth, reportPriceScaleWidth]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#090e1a') },
        textColor: readThemeToken('--chart-text', '#94a3b8'),
      },
      grid: { vertLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') }, horzLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') } },
      rightPriceScale: { borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)') },
    });
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().applyOptions({
      visible: showTimeAxis,
    });
    chart.applyOptions({ localization: { timeFormatter: (time: Time) => formatChartAxisTime(time, TickMarkType.Time) } });
    timeSync.syncFrom(chart);
  }, [showTimeAxis, timeSync]);

  useEffect(() => {
    const times = effectiveCandles.map((candle) => candle.time as Time);
    if (kind === 'RSI') {
      const values = IndicatorEngine.calculateRSI(effectiveCandles.map((candle) => candle.close), 14);
      const offset = effectiveCandles.length - values.length;
      const rsiData = values.map((value, index) => ({ time: times[index + offset], value: Math.max(0, Math.min(100, value)) }));
      seriesRef.current?.setData(rsiData);
      [30, 50, 70].forEach((value, index) => {
        levelRefs.current[index]?.setData(times.map((time) => ({ time, value })));
      });
    } else {
      const values = IndicatorEngine.calculateMACD(effectiveCandles.map((candle) => candle.close), 12, 26, 9);
      const offset = effectiveCandles.length - values.length;
      const macd = values.map((value, index) => ({ time: times[index + offset], value: value.macd }));
      const signal = values.map((value, index) => ({ time: times[index + offset], value: value.signal }));
      const histogram = values.map((value, index) => ({
        time: times[index + offset], value: value.hist,
        color: value.hist >= 0 ? 'rgba(16, 185, 129, 0.65)' : 'rgba(244, 63, 94, 0.65)',
      }));
      seriesRef.current?.setData(macd);
      signalRef.current?.setData(signal);
      histogramRef.current?.setData(histogram);
      zeroRef.current?.setData(times.map((time) => ({ time, value: 0 })));
    }
    if (chartRef.current) timeSync.syncFrom(chartRef.current);
  }, [effectiveCandles, kind, timeSync]);

  return (
    <section className="relative w-full border-t border-white/[0.06] bg-surface/80" aria-label={`${kind} indicator pane`}>
      <span className="absolute left-3 top-2 z-[1] rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
        {kind === 'RSI' ? 'RSI · 14 · 30 / 50 / 70' : 'MACD · 12 / 26 / 9 · zero'}
      </span>
      <div ref={containerRef} className="w-full" style={{ height }} />
      <span className="sr-only">{timeframe} indicator scale independent from BTC price</span>
    </section>
  );
};
