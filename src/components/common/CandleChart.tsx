import { useTheme } from '@/context/ThemeContext';
import { readThemeToken } from '@/theme/theme';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineData, Time, TickMarkType } from 'lightweight-charts';
import type { MouseEventParams } from 'lightweight-charts';
import type { Timeframe } from '@/types/market';
import { IndicatorPaneChart } from './IndicatorPaneChart';
import { ChartTimeRangeSync } from './ChartTimeRangeSync';
import { formatChartAxisTime, formatChartCrosshairTime } from '@/utils/chartTime';
import type { TimeDisplayMode } from '@/utils/timePresentation';
import { klineTimeSeconds } from '@/services/realtime/candleHandoff';
import { mapTimeframeToBinanceInterval } from '@/hooks/useRealtimeKline';
import { CHART_RIGHT_OFFSET } from './chartPresentationConfig';
import { OHLCV } from '@/types/market';
import { KlineTick } from '@/types/realtime';

export interface ChartIndicatorData {
  sma20?: number[];
  sma50?: number[];
  sma200?: number[];
  bollingerUpper?: number[];
  bollingerMiddle?: number[];
  bollingerLower?: number[];
}

/** Тип отображения цены: свечи / бары OHLC / линия закрытия. */
export type CandleChartType = 'candles' | 'bars' | 'line';

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
  timeframe?: Timeframe;
  /** Тип отображения цены. Default: 'candles'. */
  chartType?: CandleChartType;
  /** Показывать MA-линии поверх цены (SMA20/50/200 + полосы Боллинджера). Default: true. */
  showMA?: boolean;
}

/**
 * Crosshair OHLCV snapshot — shown when user hovers over chart.
 */
interface CrosshairInfo {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
}

export const CandleChart: React.FC<CandleChartProps> = ({
  data,
  symbol = 'BTC/USDT',
  height = 380,
  indicators,
  realtimeKline,
  showRSI = false,
  showMACD = false,
  timeframe = '15m',
  chartType = 'candles',
  showMA = true,
}) => {
  const candleSource = data[0]?.provenance?.exchange;
  const isDemoCandles = candleSource === 'synthetic-demo' || (data.length > 0 && !candleSource);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const barSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma200Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const currentPriceRef = useRef<string | null>(null);
  const lastAppliedTimeRef = useRef<number | null>(null);
  const chartDataLengthRef = useRef(0);
  const chartDataInitializedRef = useRef(false);
  const chartTimeframeRef = useRef<Timeframe | null>(null);
  const timeSyncRef = useRef(new ChartTimeRangeSync());
  const [timeMode, setTimeMode] = useState<TimeDisplayMode>('LOCAL');
  const timeModeRef = useRef<TimeDisplayMode>(timeMode);
  timeModeRef.current = timeMode;

  const [crosshair, setCrosshair] = useState<CrosshairInfo | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const klineAgeMs = realtimeKline ? clockMs - realtimeKline.timestamp : Number.POSITIVE_INFINITY;
  const klineFresh = klineAgeMs >= -5_000 && klineAgeMs <= 15_000;

  const { resolved: theme } = useTheme();

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

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
        timeFormatter: (time: Time) => formatChartAxisTime(time, TickMarkType.Time, timeModeRef.current, 'ru-RU'),
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
        // Отступ сверху, чтобы свечи/линия цены не прижимались к верхней подписи
        // оси и к последней цене (визуальный проход владельца по скринам).
        scaleMargins: { top: 0.12, bottom: 0.18 },
      },
      timeScale: {
        borderColor: readThemeToken('--chart-border', 'rgba(255, 255, 255, 0.08)'),
        timeVisible: true,
        secondsVisible: false,
        visible: !showRSI && !showMACD,
        rightOffset: CHART_RIGHT_OFFSET,
        tickMarkFormatter: (time: Time, tickType: TickMarkType) => formatChartAxisTime(time, tickType, timeModeRef.current),
        barSpacing: 10, // свечи шире — плотность как на TradingView
      },
      height,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      /**
       * Дубликат подписи текущей цены на правой оси.
       *
       * Ниже по коду текущая цена рисуется осознанно — `createPriceLine` по
       * `lastCandle.close` с `axisLabelVisible: true` (линия окрашивается по
       * направлению свечи и обновляется в реальном времени из WS). Встроенные
       * механизмы lightweight-charts показывают ТУ ЖЕ самую цену:
       *   • lastValueVisible — маркер последнего значения на оси;
       *   • priceLineVisible — собственная линия серии на том же уровне.
       * Оба по умолчанию true, поэтому на проде справа стояли две одинаковые
       * подписи (81 086,84 / 81 086,84) одна над другой.
       *
       * Осознанную линию оставляем, встроенные дубликаты выключаем — так же,
       * как уже сделано для volume и RSI ниже.
       */
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Альтернативные типы отображения (виден один — по chartType).
    const barSeries = chart.addBarSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      visible: false,
    });
    const lineSeries = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      visible: false,
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
    barSeriesRef.current = barSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;
    sma200Ref.current = sma200;
    bbUpperRef.current = bbUpper;
    bbMiddleRef.current = bbMiddle;
    bbLowerRef.current = bbLower;

    // Crosshair move → OHLCV tooltip; keep a named handler for explicit teardown.
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.seriesData) {
        setCrosshair(null);
        return;
      }
      const candle = (param.seriesData.get(candleSeries) ?? param.seriesData.get(barSeries)) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      const linePt = param.seriesData.get(lineSeries) as { value: number } | undefined;
      const vol = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      const ohlc = candle
        ?? (linePt ? { open: linePt.value, high: linePt.value, low: linePt.value, close: linePt.value } : undefined);
      if (!ohlc) {
        setCrosshair(null);
        return;
      }
      const volVal = vol?.value ?? 0;
      setCrosshair({
        time: param.time as Time,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        volume: volVal,
        change: ohlc.open !== 0 ? ((ohlc.close - ohlc.open) / ohlc.open) * 100 : 0,
      });
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current === chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        timeSyncRef.current.syncFrom(chart);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(chartContainerRef.current);
    }
    const unregisterTimeSync = timeSyncRef.current.add(chart);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      unregisterTimeSync();
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
      currentPriceRef.current = null;
      lastAppliedTimeRef.current = null;
    };
  }, [height]);

  // REST snapshot seeds the chart in UTC seconds, then the WS path updates T or appends T+interval.
  useEffect(() => {
    const candles = data ?? [];
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const chart = chartRef.current;
    const priorRange = chart?.timeScale().getVisibleLogicalRange() ?? null;
    const oldLength = chartDataLengthRef.current;
    const shouldFit = !chartDataInitializedRef.current || chartTimeframeRef.current !== timeframe;
    const chartCandles = candles.map((c) => ({ time: c.time as unknown as Time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const chartVolumes = candles.map((c) => ({
      time: c.time as unknown as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
    }));
    candleSeriesRef.current.setData(chartCandles);
    barSeriesRef.current?.setData(chartCandles);
    lineSeriesRef.current?.setData(candles.map((c) => ({ time: c.time as unknown as Time, value: c.close })));
    volumeSeriesRef.current.setData(chartVolumes);
    lastAppliedTimeRef.current = candles[candles.length - 1]?.time ?? null;
    chartDataLengthRef.current = candles.length;
    if (candles.length === 0) {
      chartDataInitializedRef.current = false;
      chartTimeframeRef.current = timeframe;
      if (currentPriceRef.current) candleSeriesRef.current.removePriceLine(currentPriceRef.current as any);
      currentPriceRef.current = null;
      return;
    }
    chartDataInitializedRef.current = true;
    chartTimeframeRef.current = timeframe;

    if (currentPriceRef.current) candleSeriesRef.current.removePriceLine(currentPriceRef.current as any);
    currentPriceRef.current = null;
    const lastCandle = candles.at(-1);
    if (lastCandle) {
      currentPriceRef.current = candleSeriesRef.current.createPriceLine({
        price: lastCandle.close,
        color: lastCandle.close >= lastCandle.open ? '#10b981' : '#f43f5e',
        lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '',
      }) as any;
    }
    if (chart) {
      const timeScale = chart.timeScale();
      if (shouldFit) {
        timeScale.fitContent();
        timeScale.applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
      } else if (priorRange) {
        const added = candles.length - oldLength;
        const wasAtRightEdge = priorRange.to >= oldLength - 1;
        const shift = wasAtRightEdge ? added : 0;
        try { timeScale.setVisibleLogicalRange({ from: priorRange.from + shift, to: priorRange.to + shift }); } catch { /* Chart may still be rebuilding its time scale. */ }
      }
      timeSyncRef.current.syncFrom(chart);
    }
  }, [data, timeframe]);

  // Binance kline update: same T replaces, T+interval appends, older/mismatched ticks are ignored.
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !realtimeKline) return;
    const expectedSymbol = symbol.split('/')[0].toUpperCase();
    const expectedInterval = mapTimeframeToBinanceInterval(timeframe);
    const k = realtimeKline;
    const seconds = klineTimeSeconds(k.openTime);
    if (k.symbol.toUpperCase().replace(/USDT$/, '') !== expectedSymbol || k.interval !== expectedInterval || seconds === null) return;
    if (lastAppliedTimeRef.current !== null && seconds < lastAppliedTimeRef.current) return;
    const time = seconds as Time;
    candleSeriesRef.current.update({ time, open: k.open, high: k.high, low: k.low, close: k.close });
    barSeriesRef.current?.update({ time, open: k.open, high: k.high, low: k.low, close: k.close });
    lineSeriesRef.current?.update({ time, value: k.close });
    volumeSeriesRef.current.update({ time, value: k.volume, color: k.close >= k.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)' });
    lastAppliedTimeRef.current = seconds;
    if (currentPriceRef.current) candleSeriesRef.current.removePriceLine(currentPriceRef.current as any);
    currentPriceRef.current = candleSeriesRef.current.createPriceLine({
      price: k.close,
      color: k.close >= k.open ? '#10b981' : '#f43f5e',
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '',
    }) as any;
    if (chartRef.current) timeSyncRef.current.syncFrom(chartRef.current);
  }, [realtimeKline, symbol, timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      localization: { timeFormatter: (time: Time) => formatChartAxisTime(time, TickMarkType.Time, timeMode, 'ru-RU') },
    });
    chart.timeScale().applyOptions({ visible: !showRSI && !showMACD });
    timeSyncRef.current.syncFrom(chart);
  }, [timeMode, showRSI, showMACD]);

  // Update indicator overlays (MA-линии; видимость — тумблер showMA)
  useEffect(() => {
    for (const r of [sma20Ref, sma50Ref, sma200Ref, bbUpperRef, bbMiddleRef, bbLowerRef]) {
      r.current?.applyOptions({ visible: showMA });
    }
    const times = data.map((c) => c.time as unknown as Time);

    const toLineData = (values: number[]): LineData[] =>
      values.map((v, i) => ({ time: times[i], value: v })).filter((d) => Number.isFinite(d.value));

    sma20Ref.current?.setData(indicators?.sma20 ? toLineData(indicators.sma20) : []);
    sma50Ref.current?.setData(indicators?.sma50 ? toLineData(indicators.sma50) : []);
    sma200Ref.current?.setData(indicators?.sma200 ? toLineData(indicators.sma200) : []);
    bbUpperRef.current?.setData(indicators?.bollingerUpper ? toLineData(indicators.bollingerUpper) : []);
    bbMiddleRef.current?.setData(indicators?.bollingerMiddle ? toLineData(indicators.bollingerMiddle) : []);
    bbLowerRef.current?.setData(indicators?.bollingerLower ? toLineData(indicators.bollingerLower) : []);
  }, [indicators, data, showMA]);

  // Переключение типа отображения без пересоздания графика
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartType === 'candles' });
    barSeriesRef.current?.applyOptions({ visible: chartType === 'bars' });
    lineSeriesRef.current?.applyOptions({ visible: chartType === 'line' });
  }, [chartType]);

  const handleResetView = useCallback(() => {
    const timeScale = chartRef.current?.timeScale();
    timeScale?.fitContent();
    timeScale?.applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
    if (chartRef.current) timeSyncRef.current.syncFrom(chartRef.current);
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
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${klineFresh ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' : 'border-slate-600/40 bg-slate-800/50 text-slate-400'}`}
            title={realtimeKline ? `Время последнего kline-события: ${new Date(realtimeKline.timestamp).toISOString()} UTC` : 'Последнее изменение пока только из REST'}
            data-testid="kline-freshness"
          >{klineFresh ? 'KLINE WS' : realtimeKline ? 'KLINE STALE' : 'KLINE REST'}</span>
        </div>

        {/* OHLCV tooltip when crosshair active */}
        {crosshair && (
          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-300 bg-slate-900/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700/50">
            <span className="text-slate-500">{formatChartCrosshairTime(crosshair.time, timeMode)}</span>
            <span><span className="text-slate-500">O</span> <span className="text-slate-200">{crosshair.open.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">H</span> <span className="text-white">{crosshair.high.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">L</span> <span className="text-white">{crosshair.low.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">C</span> <span className={crosshair.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{crosshair.close.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">Vol</span> <span className="text-sky-400">{crosshair.volume >= 1e9 ? `${(crosshair.volume / 1e9).toFixed(1)}B` : crosshair.volume >= 1e6 ? `${(crosshair.volume / 1e6).toFixed(1)}M` : crosshair.volume.toLocaleString()}</span></span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setTimeMode((mode) => mode === 'LOCAL' ? 'UTC' : 'LOCAL')}
          className="ml-auto rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 font-mono text-[11px] text-slate-300 hover:text-white"
          aria-label="Переключить локальное время и UTC"
          title={timeMode === 'LOCAL' ? 'Время браузера; нажмите для UTC' : 'UTC; нажмите для локального времени браузера'}
        >{timeMode}</button>
      </div>

      <div className="relative w-full" style={{ height }}>
        <div ref={chartContainerRef} className="w-full" style={{ height }} />
        <button
          onClick={handleResetView}
          className="absolute bottom-3 right-3 z-10 px-2 py-1 text-[11px] font-sans rounded bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700/50 opacity-0 group-hover:opacity-100"
          title="Вернуть масштаб"
        >
          ⟲ fit
        </button>
      </div>
      {showRSI && <IndicatorPaneChart kind="RSI" candles={data} realtimeKline={realtimeKline} expectedSymbol={symbol.split('/')[0]} timeframe={timeframe} interval={mapTimeframeToBinanceInterval(timeframe)} height={126} showTimeAxis={!showMACD} timeMode={timeMode} timeSync={timeSyncRef.current} />}
      {showMACD && <IndicatorPaneChart kind="MACD" candles={data} realtimeKline={realtimeKline} expectedSymbol={symbol.split('/')[0]} timeframe={timeframe} interval={mapTimeframeToBinanceInterval(timeframe)} height={146} showTimeAxis timeMode={timeMode} timeSync={timeSyncRef.current} />}
    </div>
  );
};
