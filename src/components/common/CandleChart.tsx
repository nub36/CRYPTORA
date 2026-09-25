import { useTheme } from '@/context/ThemeContext';
import { readThemeToken } from '@/theme/theme';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, LineStyle, IChartApi, ISeriesApi, IPriceLine, LineData, Time, TickMarkType } from 'lightweight-charts';
import type { MouseEventParams, SeriesMarker } from 'lightweight-charts';
import type { Timeframe } from '@/types/market';
import type { ChartLevelLine, ChartMarker } from '@/types/chart';
import { IndicatorPaneChart } from './IndicatorPaneChart';
import { ChartTimeRangeSync } from './ChartTimeRangeSync';
import { formatChartAxisTime, formatChartCrosshairTime } from '@/utils/chartTime';
import { browserTimeZone, timeZoneLabel } from '@/utils/timePresentation';
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
  /** Показывать ли гистограмму объёма под графиком. Default: true. */
  showVolume?: boolean;
  /** Показывать ли технические бейджи (источник, WS) в шапке графика. Default: true. */
  showBadges?: boolean;
  /** Показывать ли оверлей с часовым поясом на графике. Default: true. */
  showTimezone?: boolean;
  /**
   * Маркеры событий поверх свечей (аддитивный props; существующие потребители
   * его не передают и ведут себя как раньше). Время — unix-секунды openTime бара,
   * который РЕАЛЬНО присутствует в `data`: маркер вне окна графика библиотека
   * не отрисует, поэтому фильтрация делается на стороне источника
   * (см. `mapSignalMarkers`).
   */
  markers?: ChartMarker[];
  /**
   * Горизонтальные уровни (аддитивный props). Линии заменяются по `id`: при
   * смене выбранного сигнала старые уровни удаляются, а не накапливаются —
   * смешать уровни двух сигналов на графике невозможно.
   */
  levelLines?: ChartLevelLine[];
  /**
   * Клик по бару с маркером. Передаётся основной маркер и ВСЕ маркеры этого
   * бара: политику выбора («какой из нескольких сигналов открыть») знает
   * доменный слой, а не общий график.
   */
  onMarkerClick?: (marker: ChartMarker, markersAtTime: ChartMarker[]) => void;
}

/** Стили линий уровней — соответствие имен и значений lightweight-charts. */
const LEVEL_LINE_STYLE: Record<NonNullable<ChartLevelLine['style']>, LineStyle> = {
  solid: LineStyle.Solid,
  dotted: LineStyle.Dotted,
  dashed: LineStyle.Dashed,
  largeDashed: LineStyle.LargeDashed,
  sparseDotted: LineStyle.SparseDotted,
};

/**
 * Доменный маркер → маркер библиотеки.
 *
 * Экспортировано как чистая функция: mapping покрыт юнит-тестами без рендера
 * графика (canvas в jsdom недоступен).
 */
export function toSeriesMarkers(markers: readonly ChartMarker[]): SeriesMarker<Time>[] {
  return markers.map((m) => ({
    time: m.time as Time,
    position: m.position,
    shape: m.shape,
    color: m.color,
    id: m.id,
    size: (m.size ?? 1) as 0 | 1 | 2 | 3 | 4,
    ...(m.text !== undefined && m.text.length > 0 ? { text: m.text } : {}),
  }));
}

/** Равенство описаний линии: цена, подпись и оформление. */
export function sameLevelLine(a: ChartLevelLine, b: ChartLevelLine): boolean {
  return (
    a.price === b.price &&
    a.title === b.title &&
    a.color === b.color &&
    (a.style ?? 'solid') === (b.style ?? 'solid') &&
    (a.lineWidth ?? 1) === (b.lineWidth ?? 1) &&
    (a.axisLabelVisible ?? true) === (b.axisLabelVisible ?? true)
  );
}

/** `Time` библиотеки (число | строка | BusinessDay) → unix-секунды. */
export function chartTimeToSeconds(time: Time | undefined): number | null {
  if (time === undefined || time === null) return null;
  if (typeof time === 'number') return Number.isFinite(time) ? Math.floor(time) : null;
  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  if (typeof time === 'object') {
    const { year, month, day } = time as { year?: number; month?: number; day?: number };
    if (typeof year === 'number' && typeof month === 'number' && typeof day === 'number') {
      return Math.floor(Date.UTC(year, month - 1, day) / 1000);
    }
  }
  return null;
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
  showVolume = true,
  showBadges = true,
  showTimezone = true,
  markers,
  levelLines,
  onMarkerClick,
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
  /**
   * Символ, данные которого сейчас РЕАЛЬНО лежат на графике.
   *
   * График persistent: при переходе BTC → RUNE компонент не пересоздаётся, а
   * `header` сразу показывает новый символ. Пока здесь не было символа, сброс
   * данных и масштаба не был привязан к смене инструмента — на проде это
   * выглядело как «в шапке RUNE/USDT, а шкала и свечи BTC ~60k–110k».
   * Авто-масштаб цены обязан пересчитываться от нового символа, иначе диапазон
   * остаётся от прошлого и свечи нового актива рисуются вне окна.
   */
  const chartSymbolRef = useRef<string | null>(null);
  const timeSyncRef = useRef(new ChartTimeRangeSync());
  /** Маркеры — для обработки клика (подписка создаётся один раз вместе с графиком). */
  const markersRef = useRef<ChartMarker[]>([]);
  /** Колбэк клика в ref: пересоздание графика из-за смены обработчика не нужно. */
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  /** Созданные линии уровней: id → линия + её описание (для точечной замены). */
  const levelLineRefs = useRef<Map<string, { line: IPriceLine; descriptor: ChartLevelLine }>>(new Map());
  /**
   * Часовой пояс графика — пояс браузера/ОС. Раньше здесь был переключатель
   * LOCAL/UTC, который выводил на график техническую метку `{timeMode}`
   * (BUG D). Переключатель убран: один источник времени на все подписи, зону
   * пользователя подставляет `Intl`, метка зоны берётся из неё же.
   */
  const timeZoneLabelText = timeZoneLabel('BROWSER');

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
        timeFormatter: (time: Time) => formatChartAxisTime(time, TickMarkType.Time, ),
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
        tickMarkFormatter: (time: Time, tickType: TickMarkType) => formatChartAxisTime(time, tickType),
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

    /**
     * Клик по бару с маркером. Общий график не знает доменной политики
     * («какой из нескольких сигналов на баре открыть»), поэтому наружу
     * отдаются основной маркер и все маркеры этого бара.
     */
    const handleClick = (param: MouseEventParams<Time>) => {
      const callback = onMarkerClickRef.current;
      if (!callback) return;
      const seconds = chartTimeToSeconds(param.time);
      if (seconds === null) return;
      const atTime = markersRef.current.filter((m) => m.time === seconds);
      if (atTime.length === 0) return;
      callback(atTime[0]!, atTime);
    };
    chart.subscribeClick(handleClick);

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
      chart.unsubscribeClick(handleClick);
      unregisterTimeSync();
      chart.remove();
      // Линии и маркеры принадлежат уничтоженной серии: ссылки обязаны быть
      // сброшены, иначе следующий эффект станет обновлять несуществующие линии.
      levelLineRefs.current = new Map();
      markersRef.current = [];
      if (chartRef.current === chart) chartRef.current = null;
      currentPriceRef.current = null;
      lastAppliedTimeRef.current = null;
    };
  }, [height]);

  /**
   * Смена инструмента: сброс состояния графика под НОВЫЙ символ.
   *
   * Контракт (BUG «RUNE с чужой шкалой»):
   *  1. данные прошлого инструмента удаляются НЕМЕДЛЕННО (`setData([])` по всем
   *     сериям), а не остаются на экране до прихода новых;
   *  2. линии (текущая цена, уровни сигнала) и маркеры прошлого инструмента
   *     снимаются: уровень BTC на графике RUNE — недостоверное состояние;
   *  3. масштаб ЦЕНЫ явно возвращается в авто-режим (`autoScale: true`). Раньше
   *     при смене символа подгонялась только ВРЕМЕННАЯ шкала (`fitContent()`), а
   *     диапазон цены оставался от прошлого актива;
   *  4. подгонка времени нового символа выполняется приходом его данных
   *     (`shouldFit` сброшен ниже), поэтому пустое состояние честно пустое, а не
   *     «чужой график»;
   *  5. ничего не пересоздаётся: серии и график переиспользуются.
   *
   * Эффект объявлен ДО эффекта наполнения данными: в одном коммите сброс обязан
   * выполниться раньше, чем на график лягут данные нового символа.
   */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (chartSymbolRef.current === symbol) return;
    const isFirstSymbol = chartSymbolRef.current === null;
    chartSymbolRef.current = symbol;

    candleSeriesRef.current?.setData([]);
    barSeriesRef.current?.setData([]);
    lineSeriesRef.current?.setData([]);
    volumeSeriesRef.current?.setData([]);
    for (const indicator of [sma20Ref, sma50Ref, sma200Ref, bbUpperRef, bbMiddleRef, bbLowerRef]) {
      indicator.current?.setData([]);
    }

    if (currentPriceRef.current && candleSeriesRef.current) {
      try { candleSeriesRef.current.removePriceLine(currentPriceRef.current as any); } catch { /* линия уже снята */ }
    }
    currentPriceRef.current = null;
    for (const { line } of levelLineRefs.current.values()) {
      try { candleSeriesRef.current?.removePriceLine(line); } catch { /* линия уже снята */ }
    }
    levelLineRefs.current = new Map();

    markersRef.current = [];
    candleSeriesRef.current?.setMarkers([]);
    barSeriesRef.current?.setMarkers([]);
    lineSeriesRef.current?.setMarkers([]);

    for (const series of [candleSeriesRef, barSeriesRef, lineSeriesRef]) {
      series.current?.priceScale().applyOptions({ autoScale: true });
    }
    try { chart.priceScale('right').applyOptions({ autoScale: true }); } catch { /* шкала может быть ещё не создана */ }

    lastAppliedTimeRef.current = null;
    chartDataLengthRef.current = 0;
    chartDataInitializedRef.current = false;
    chartTimeframeRef.current = null;

    if (!isFirstSymbol) {
      chart.timeScale().applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
      timeSyncRef.current.syncFrom(chart);
    }
  }, [symbol]);

  // REST snapshot seeds the chart in UTC seconds, then the WS path updates T or appends T+interval.
  useEffect(() => {
    const candles = data ?? [];
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const chart = chartRef.current;

    /**
     * Возврат шкалы цены в авто-режим. `lightweight-charts` держит диапазон
     * цены, пока `autoScale` включён, но после ручных изменений/перерисовок
     * persistent-графика диапазон прошлого инструмента может сохраниться —
     * поэтому при смене символа (и на пустых данных) авто-масштаб включается
     * ЯВНО, а не «по умолчанию».
     */
    const restorePriceAutoscale = () => {
      for (const series of [candleSeriesRef, barSeriesRef, lineSeriesRef]) {
        series.current?.priceScale().applyOptions({ autoScale: true });
      }
      if (chart) {
        try { chart.priceScale('right').applyOptions({ autoScale: true }); } catch { /* шкала ещё не создана */ }
      }
    };
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
      // Пустое состояние тоже возвращает авто-масштаб: иначе следующий символ
      // рисовался бы в диапазоне цены предыдущего (шкала «залипала»).
      restorePriceAutoscale();
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
        // Новый инструмент (или новый таймфрейм): диапазон цены возвращаем в
        // авто-масштаб ДО подгонки времени, чтобы свечи не рисовались в
        // диапазоне прошлого символа.
        restorePriceAutoscale();
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

  /**
   * Маркеры событий (аддитивно). Применяются ко всем сериям цены, чтобы смена
   * `chartType` не теряла историю; `height` в зависимостях — потому что при его
   * смене график пересоздаётся и маркеры нужно нанести заново.
   */
  useEffect(() => {
    const list = markers ?? [];
    markersRef.current = list;
    const seriesMarkers = toSeriesMarkers(list);
    candleSeriesRef.current?.setMarkers(seriesMarkers);
    barSeriesRef.current?.setMarkers(seriesMarkers);
    lineSeriesRef.current?.setMarkers(seriesMarkers);
  }, [markers, data, height]);

  /**
   * Горизонтальные уровни выбранного сигнала (аддитивно).
   *
   * Замена ТОЧЕЧНАЯ по `id`: `createPriceLine` не умеет менять цену, поэтому
   * изменившаяся линия пересоздаётся, а линия, которой в новом наборе нет,
   * удаляется. Именно это гарантирует, что при выборе другого сигнала его
   * уровни заменяют прежние, а не складываются с ними (§8 задачи Signals V2).
   */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const desired = levelLines ?? [];
    const existing = levelLineRefs.current;
    const next = new Map<string, { line: IPriceLine; descriptor: ChartLevelLine }>();

    for (const descriptor of desired) {
      const prev = existing.get(descriptor.id);
      if (prev && sameLevelLine(prev.descriptor, descriptor)) {
        next.set(descriptor.id, prev);
        existing.delete(descriptor.id);
        continue;
      }
      if (prev) {
        try { series.removePriceLine(prev.line); } catch { /* линия уже снята */ }
        existing.delete(descriptor.id);
      }
      const line = series.createPriceLine({
        price: descriptor.price,
        color: descriptor.color,
        lineWidth: (descriptor.lineWidth ?? 1) as 1 | 2 | 3 | 4,
        lineStyle: LEVEL_LINE_STYLE[descriptor.style ?? 'solid'],
        axisLabelVisible: descriptor.axisLabelVisible ?? true,
        title: descriptor.title,
      });
      next.set(descriptor.id, { line, descriptor });
    }

    for (const stale of existing.values()) {
      try { series.removePriceLine(stale.line); } catch { /* линия уже снята */ }
    }
    levelLineRefs.current = next;
  }, [levelLines, data, height]);

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
      localization: { timeFormatter: (time: Time) => formatChartAxisTime(time, TickMarkType.Time) },
    });
    chart.timeScale().applyOptions({ visible: !showRSI && !showMACD });
    timeSyncRef.current.syncFrom(chart);
  }, [showRSI, showMACD]);

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

  // Переключение видимости объёма
  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: showVolume });
  }, [showVolume]);

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
      <div className="absolute top-3 left-3.5 z-10 flex items-start justify-between w-[calc(100%-28px)] pointer-events-none">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-sans text-slate-300 pointer-events-auto">
          <span className="font-bold text-white tracking-tight text-sm drop-shadow-sm">{symbol}</span>
          {showBadges && (
            <>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold tracking-wide ${
                  isDemoCandles
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {isDemoCandles ? 'QA-СВЕЧИ' : (
                  <>
                    <span className="hidden sm:inline">LIVE · </span>
                    <span>{(candleSource || 'binance').toUpperCase()}</span>
                  </>
                )}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] sm:text-[11px] ${
                  klineFresh
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : 'border-slate-600/40 bg-slate-800/50 text-slate-400'
                }`}
                title={realtimeKline ? `Время последнего kline-события: ${new Date(realtimeKline.timestamp).toISOString()} UTC` : 'Последнее изменение пока только из REST'}
                data-testid="kline-freshness"
              >
                {klineFresh ? 'KLINE WS' : realtimeKline ? 'KLINE STALE' : 'KLINE REST'}
              </span>
            </>
          )}
        </div>

        {/* OHLCV tooltip when crosshair active */}
        {crosshair && (
          <div className="pointer-events-auto hidden md:flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-300 bg-slate-900/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700/50">
            <span className="text-slate-500">{formatChartCrosshairTime(crosshair.time)}</span>
            <span><span className="text-slate-500">O</span> <span className="text-slate-200">{crosshair.open.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">H</span> <span className="text-white">{crosshair.high.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">L</span> <span className="text-white">{crosshair.low.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">C</span> <span className={crosshair.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{crosshair.close.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
            <span><span className="text-slate-500">Vol</span> <span className="text-sky-400">{crosshair.volume >= 1e9 ? `${(crosshair.volume / 1e9).toFixed(1)}B` : crosshair.volume >= 1e6 ? `${(crosshair.volume / 1e6).toFixed(1)}M` : crosshair.volume.toLocaleString()}</span></span>
          </div>
        )}
        {showTimezone && (
          <span
            className="pointer-events-auto ml-auto hidden sm:inline-block rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 font-sans text-[11px] text-slate-400"
            data-qa="chart-timezone-label"
            title={`Время на графике — ваш часовой пояс (${browserTimeZone()})`}
          >{timeZoneLabelText}</span>
        )}
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
      {showRSI && <IndicatorPaneChart kind="RSI" candles={data} realtimeKline={realtimeKline} expectedSymbol={symbol.split('/')[0]} timeframe={timeframe} interval={mapTimeframeToBinanceInterval(timeframe)} height={126} showTimeAxis={!showMACD} timeSync={timeSyncRef.current} />}
      {showMACD && <IndicatorPaneChart kind="MACD" candles={data} realtimeKline={realtimeKline} expectedSymbol={symbol.split('/')[0]} timeframe={timeframe} interval={mapTimeframeToBinanceInterval(timeframe)} height={146} showTimeAxis timeSync={timeSyncRef.current} />}
    </div>
  );
};
