import { useTheme } from '@/context/ThemeContext';
import { readThemeToken } from '@/theme/theme';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import { OHLCV } from '@/types/market';
import { KlineTick } from '@/types/realtime';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';

export interface ChartIndicatorData {
  sma20?: number[];
  sma50?: number[];
  sma200?: number[];
  bollingerUpper?: number[];
  bollingerMiddle?: number[];
  bollingerLower?: number[];
}

interface CandleChartProps {
  data: OHLCV[];
  symbol?: string;
  height?: number;
  indicators?: ChartIndicatorData;
  /** Real-time kline tick from WebSocket — uses update() for efficient live updates. */
  realtimeKline?: KlineTick | null;
  /** Show RSI sub-panel (compact, 30/70 levels). Default: false. */
  showRSI?: boolean;
  /** Show MACD sub-panel (line + signal + histogram). Default: false. */
  showMACD?: boolean;
}

/**
 * Crosshair OHLCV snapshot — shown when user hovers over chart.
 */
interface CrosshairInfo {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
}

function formatCrosshairTime(t: Time | undefined): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  const d = new Date((t as number) * 1000);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const CandleChart: React.FC<CandleChartProps> = ({
  data,
  symbol = 'BTC/USDT',
  height = 380,
  indicators,
  realtimeKline,
  showRSI = false,
  showMACD = false,
}) => {
  const candleSource = data[0]?.provenance?.exchange;
  const isDemoCandles = candleSource === 'synthetic-demo' || (data.length > 0 && !candleSource);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma200Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const currentPriceRef = useRef<string | null>(null);

  // RSI sub-panel refs
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiLevel70Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiLevel50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiLevel30Ref = useRef<ISeriesApi<'Line'> | null>(null);
  // MACD sub-panel refs
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const macdZeroRef = useRef<ISeriesApi<'Line'> | null>(null);

  const [crosshair, setCrosshair] = useState<CrosshairInfo | null>(null);

  const { resolved: theme } = useTheme();

  // Theme update
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

  // Chart creation
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#090e1a') },
        textColor: readThemeToken('--chart-text', '#94a3b8'),
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
        fontSize: 11,
      },
      localization: {
        locale: 'en-US',
        priceFormatter: (price: number) => {
          if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (price >= 1) return price.toFixed(4);
          return price.toFixed(6);
        },
      },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255, 255, 255, 0.04)') },
      },
      crosshair: {
        vertLine: { color: '#22d3ee', width: 1, style: 2, labelBackgroundColor: '#131c33' },
        horzLine: { color: '#22d3ee', width: 1, style: 2, labelBackgroundColor: '#131c33' },
        mode: 0,
      },
      rightPriceScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        scaleMargins: { top: 0.08, bottom: 0.40 },
      },
      timeScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      height,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#38bdf8',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    // Indicator overlay series
    const makeSma = (color: string, width: number) =>
      chart.addLineSeries({
        color,
        lineWidth: width as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    const sma20 = makeSma('#f59e0b', 1);  // amber
    const sma50 = makeSma('#3b82f6', 1);  // blue
    const sma200 = makeSma('#a855f7', 1); // purple
    const bbUpper = makeSma('rgba(99, 102, 241, 0.5)', 1); // indigo thin
    const bbMiddle = makeSma('rgba(99, 102, 241, 0.35)', 1);
    const bbLower = makeSma('rgba(99, 102, 241, 0.5)', 1);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;
    sma200Ref.current = sma200;
    bbUpperRef.current = bbUpper;
    bbMiddleRef.current = bbMiddle;
    bbLowerRef.current = bbLower;

    // P4: RSI sub-panel — separate price scale (0–100, levels 70/50/30)
    // Position: 62%–80% of chart height when MACD also shown, else 62%–96%
    const rsiSeries = chart.addLineSeries({
      color: '#a78bfa', // violet-400
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'rsi',
      visible: false,
    });
    chart.priceScale('rsi').applyOptions({
      scaleMargins: { top: 0.62, bottom: showMACD ? 0.20 : 0.04 },
      borderVisible: false,
      entireTextOnly: true,
    });
    rsiSeriesRef.current = rsiSeries;

    // RSI level lines (70 overbought, 50 neutral, 30 oversold)
    const makeRsiLevel = (color: string) => {
      const s = chart.addLineSeries({
        color,
        lineWidth: 1,
        lineStyle: 2, // Dashed
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceScaleId: 'rsi',
        visible: false,
      });
      return s;
    };
    rsiLevel70Ref.current = makeRsiLevel('rgba(244, 63, 94, 0.4)');   // rose
    rsiLevel50Ref.current = makeRsiLevel('rgba(148, 163, 184, 0.2)'); // slate
    rsiLevel30Ref.current = makeRsiLevel('rgba(16, 185, 129, 0.4)');  // emerald

    // P5: MACD sub-panel — separate pane with MACD line + signal + histogram + zero
    const macdLineSeries = chart.addLineSeries({
      color: '#3b82f6', // blue-500
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'macd',
      visible: false,
    });
    const macdSignalSeries = chart.addLineSeries({
      color: '#f59e0b', // amber-500
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'macd',
      visible: false,
    });
    const macdHistSeries = chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
      priceScaleId: 'macd',
      visible: false,
    });
    chart.priceScale('macd').applyOptions({
      scaleMargins: { top: 0.80, bottom: 0.02 },
      borderVisible: false,
      entireTextOnly: true,
    });
    macdLineRef.current = macdLineSeries;
    macdSignalRef.current = macdSignalSeries;
    macdHistRef.current = macdHistSeries;

    // MACD zero line
    const macdZeroLine = chart.addLineSeries({
      color: 'rgba(148, 163, 184, 0.25)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'macd',
      visible: false,
    });
    macdZeroRef.current = macdZeroLine;

    // Crosshair move → OHLCV tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setCrosshair(null);
        return;
      }
      const candle = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
      const vol = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      if (!candle) {
        setCrosshair(null);
        return;
      }
      const volVal = vol?.value ?? 0;
      setCrosshair({
        time: formatCrosshairTime(param.time as Time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: volVal,
        change: candle.open !== 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0,
      });
    });

    // Responsive resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);

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

  // Update OHLCV data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !data || data.length === 0) return;

    const chartCandles = data.map((c) => ({
      time: c.time as unknown as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const chartVolumes = data.map((c) => ({
      time: c.time as unknown as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
    }));

    candleSeriesRef.current.setData(chartCandles);
    volumeSeriesRef.current.setData(chartVolumes);

    // Current price line (last close)
    const lastCandle = data[data.length - 1];
    if (lastCandle && candleSeriesRef.current) {
      if (currentPriceRef.current) {
        candleSeriesRef.current.removePriceLine(currentPriceRef.current as any);
      }
      const priceLine = candleSeriesRef.current.createPriceLine({
        price: lastCandle.close,
        color: lastCandle.close >= lastCandle.open ? '#10b981' : '#f43f5e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      });
      currentPriceRef.current = priceLine as any;
    }

    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Real-time kline update via update() — NOT setData()
  // Binance WS kline stream sends incremental updates for the current candle.
  // When isClosed=false the candle is forming; when isClosed=true it just closed.
  // Lightweight Charts update() handles both cases: updates existing bar or appends new one.
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !realtimeKline) return;

    const k = realtimeKline;
    // Binance time is in ms, OHLCV.time is in seconds
    const time = Math.floor(k.openTime / 1000) as Time;

    // Update candle using update() — this is the efficient path (no full reload)
    candleSeriesRef.current.update({
      time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    });

    // Update volume bar
    volumeSeriesRef.current.update({
      time,
      value: k.volume,
      color: k.close >= k.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
    });

    // Update current price line to reflect latest close
    if (candleSeriesRef.current) {
      if (currentPriceRef.current) {
        candleSeriesRef.current.removePriceLine(currentPriceRef.current as any);
      }
      const priceLine = candleSeriesRef.current.createPriceLine({
        price: k.close,
        color: k.close >= k.open ? '#10b981' : '#f43f5e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      });
      currentPriceRef.current = priceLine as any;
    }
  }, [realtimeKline]);

  // Update indicator overlays
  useEffect(() => {
    if (!indicators || !data || data.length === 0) return;
    const times = data.map((c) => c.time as unknown as Time);

    const toLineData = (values: number[]): LineData[] =>
      values.map((v, i) => ({ time: times[i], value: v })).filter((d) => Number.isFinite(d.value));

    if (indicators.sma20 && sma20Ref.current) {
      sma20Ref.current.setData(toLineData(indicators.sma20));
    }
    if (indicators.sma50 && sma50Ref.current) {
      sma50Ref.current.setData(toLineData(indicators.sma50));
    }
    if (indicators.sma200 && sma200Ref.current) {
      sma200Ref.current.setData(toLineData(indicators.sma200));
    }
    if (indicators.bollingerUpper && bbUpperRef.current) {
      bbUpperRef.current.setData(toLineData(indicators.bollingerUpper));
    }
    if (indicators.bollingerMiddle && bbMiddleRef.current) {
      bbMiddleRef.current.setData(toLineData(indicators.bollingerMiddle));
    }
    if (indicators.bollingerLower && bbLowerRef.current) {
      bbLowerRef.current.setData(toLineData(indicators.bollingerLower));
    }
  }, [indicators, data]);

  // RSI sub-panel data + level lines (70/50/30)
  useEffect(() => {
    if (!rsiSeriesRef.current) return;
    const vis = showRSI;
    rsiSeriesRef.current.applyOptions({ visible: vis });
    rsiLevel70Ref.current?.applyOptions({ visible: vis });
    rsiLevel50Ref.current?.applyOptions({ visible: vis });
    rsiLevel30Ref.current?.applyOptions({ visible: vis });
    if (!vis || !data || data.length < 16) return;

    const closes = data.map((c) => c.close);
    const rsiValues = IndicatorEngine.calculateRSI(closes, 14);
    const times = data.map((c) => c.time as unknown as Time);
    const offset = closes.length - rsiValues.length;
    const rsiLineData = rsiValues
      .map((v, i) => ({ time: times[i + offset], value: v }))
      .filter((d) => Number.isFinite(d.value));

    rsiSeriesRef.current.setData(rsiLineData);

    // Level lines: constant values across the same time range as RSI
    if (rsiLineData.length > 1) {
      const levelData = (val: number): LineData[] => [
        { time: rsiLineData[0].time, value: val },
        { time: rsiLineData[rsiLineData.length - 1].time, value: val },
      ];
      rsiLevel70Ref.current?.setData(levelData(70));
      rsiLevel50Ref.current?.setData(levelData(50));
      rsiLevel30Ref.current?.setData(levelData(30));
    }
  }, [data, showRSI]);

  // MACD sub-panel data + zero line
  useEffect(() => {
    if (!macdLineRef.current || !macdSignalRef.current || !macdHistRef.current) return;
    const vis = showMACD;
    macdLineRef.current.applyOptions({ visible: vis });
    macdSignalRef.current.applyOptions({ visible: vis });
    macdHistRef.current.applyOptions({ visible: vis });
    macdZeroRef.current?.applyOptions({ visible: vis });
    if (!vis || !data || data.length < 36) return;

    const closes = data.map((c) => c.close);
    const times = data.map((c) => c.time as unknown as Time);
    const macdSeries = IndicatorEngine.calculateMACD(closes, 12, 26, 9);
    const offset = closes.length - macdSeries.length;

    const lineData = macdSeries
      .map((m, i) => ({ time: times[i + offset], value: m.macd }))
      .filter((d) => Number.isFinite(d.value));
    const signalData = macdSeries
      .map((m, i) => ({ time: times[i + offset], value: m.signal }))
      .filter((d) => Number.isFinite(d.value));
    const histData = macdSeries
      .map((m, i) => ({
        time: times[i + offset],
        value: m.hist,
        color: m.hist >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)',
      }))
      .filter((d) => Number.isFinite(d.value));

    macdLineRef.current.setData(lineData);
    macdSignalRef.current.setData(signalData);
    macdHistRef.current.setData(histData);

    // Zero line spanning MACD range
    if (lineData.length > 1) {
      macdZeroRef.current?.setData([
        { time: lineData[0].time, value: 0 },
        { time: lineData[lineData.length - 1].time, value: 0 },
      ]);
    }
  }, [data, showMACD]);

  const handleResetView = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-surface shadow-panel-elevated group">
      {/* Subtle Ambient Radial Glow */}
      <div className="absolute top-0 left-1/4 w-96 h-36 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Floating Header: Symbol + Badge + OHLCV + Reset */}
      <div className="absolute top-3 left-3.5 z-10 flex items-start justify-between w-[calc(100%-28px)]">
        <div className="flex items-center space-x-2 text-xs font-sans text-slate-300">
          <span className="font-bold text-white tracking-tight text-sm drop-shadow-sm">{symbol}</span>
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

        {/* OHLCV tooltip when crosshair active */}
        {crosshair && (
          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-300 bg-slate-900/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700/50">
            <span className="text-slate-500">{crosshair.time}</span>
            <span><span className="text-slate-500">O</span> <span className="text-slate-200">{crosshair.open.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">H</span> <span className="text-white">{crosshair.high.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">L</span> <span className="text-white">{crosshair.low.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">C</span> <span className={crosshair.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{crosshair.close.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">Vol</span> <span className="text-sky-400">{crosshair.volume >= 1e9 ? `${(crosshair.volume / 1e9).toFixed(1)}B` : crosshair.volume >= 1e6 ? `${(crosshair.volume / 1e6).toFixed(1)}M` : crosshair.volume.toLocaleString()}</span></span>
          </div>
        )}
      </div>

      {/* Reset zoom button */}
      <button
        onClick={handleResetView}
        className="absolute bottom-3 right-3 z-10 px-2 py-1 text-[11px] font-sans rounded bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700/50 opacity-0 group-hover:opacity-100"
        title="Вернуть масштаб"
      >
        ⟲ fit
      </button>

      <div ref={chartContainerRef} className="w-full" style={{ height }} />
    </div>
  );
};
