import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { OHLCV, LiquidationEvent, Timeframe } from '@/types/market';
import type { KlineTick } from '@/types/realtime';
import { mapLiquidationMarkers } from '@/services/liquidations/liquidationMarkers';
import { useRealtimeKline } from '@/hooks/useRealtimeKline';
import { useTheme } from '@/context/ThemeContext';
import { readThemeToken } from '@/theme/theme';

interface LiquidationPriceChartProps {
  candles: OHLCV[];
  events: readonly LiquidationEvent[];
  /** BASE-тикер, напр. 'BTC'. */
  symbol: string;
  timeframe: Timeframe;
  timeframeSec: number;
  loading?: boolean;
  error?: boolean;
}

interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Exchange adapters normally provide sorted numeric OHLCV with Unix seconds.
 * Keep the chart boundary defensive: a millisecond timestamp or numeric string
 * should not silently make Lightweight Charts render a blank pane.
 */
export function normalizeLiquidationCandles(input: readonly OHLCV[]): ChartCandle[] {
  const byTime = new Map<number, ChartCandle>();
  for (const raw of input) {
    const timeValue = Number((raw as OHLCV).time);
    const time = Math.floor(timeValue > 100_000_000_000 ? timeValue / 1000 : timeValue);
    const open = Number((raw as OHLCV).open);
    const high = Number((raw as OHLCV).high);
    const low = Number((raw as OHLCV).low);
    const close = Number((raw as OHLCV).close);
    if (!Number.isFinite(time) || time <= 0 || ![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (high < low) continue;
    byTime.set(time, { time, open, high, low, close });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function compactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `$${Math.round(value)}`;
}

function eventSeconds(timestamp: string): number {
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric > 100_000_000_000 ? numeric / 1000 : numeric);
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
}

export const LiquidationPriceChart: React.FC<LiquidationPriceChartProps> = ({
  candles,
  events,
  symbol,
  timeframe,
  timeframeSec,
  loading = false,
  error = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const candlesRef = useRef<ChartCandle[]>([]);
  const lastFitKeyRef = useRef<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [realtimePrice, setRealtimePrice] = useState<number | null>(null);
  const { resolved: theme } = useTheme();

  const chartCandles = useMemo(() => normalizeLiquidationCandles(candles), [candles]);
  const mapped = useMemo(
    () => mapLiquidationMarkers(events, chartCandles, symbol, timeframeSec),
    [events, chartCandles, symbol, timeframeSec],
  );

  // Create the chart whenever the component mounts, including while REST candles
  // are still loading. The chart container stays mounted in every state.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#080d18') },
        textColor: readThemeToken('--chart-text', '#8793a8'),
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
        fontSize: 11,
      },
      localization: {
        locale: 'en-US',
        priceFormatter: (price: number) => price >= 1000
          ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : price.toPrecision(6).replace(/0+$/, '').replace(/\.$/, ''),
      },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255,255,255,0.035)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255,255,255,0.045)') },
      },
      crosshair: {
        vertLine: { color: 'rgba(34,211,238,.65)', width: 1, style: 2, labelBackgroundColor: '#10202b' },
        horzLine: { color: 'rgba(34,211,238,.55)', width: 1, style: 2, labelBackgroundColor: '#10202b' },
      },
      rightPriceScale: {
        borderColor: 'rgba(148,163,184,.15)',
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: 'rgba(148,163,184,.15)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 9,
      },
      width: Math.max(container.clientWidth, 1),
      height: Math.max(container.clientHeight, 1),
    });
    const series = chart.addCandlestickSeries({
      upColor: '#18c98b',
      downColor: '#fb5577',
      borderUpColor: '#18c98b',
      borderDownColor: '#fb5577',
      wickUpColor: '#18c98b',
      wickDownColor: '#fb5577',
      priceLineVisible: true,
      priceLineColor: '#22d3ee',
      priceLineStyle: 2,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect;
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
          setLayoutRevision((revision) => revision + 1);
        })
      : null;
    resizeObserver?.observe(container);
    const onWindowResize = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        setLayoutRevision((revision) => revision + 1);
      }
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Theme can change without re-creating the chart.
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: readThemeToken('--chart-bg', '#080d18') },
        textColor: readThemeToken('--chart-text', '#8793a8'),
      },
      grid: {
        vertLines: { color: readThemeToken('--chart-grid', 'rgba(255,255,255,0.035)') },
        horzLines: { color: readThemeToken('--chart-grid', 'rgba(255,255,255,0.045)') },
      },
    });
  }, [theme]);

  // REST history is authoritative for the selected interval. Normalize it to
  // seconds, numeric OHLC and ascending unique timestamps before setData().
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    candlesRef.current = chartCandles;
    series.setData(chartCandles.map((c) => ({
      time: c.time as unknown as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })));
    const fitKey = `${symbol}:${timeframe}`;
    if (chartCandles.length && lastFitKeyRef.current !== fitKey) {
      chart.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }
    setLayoutRevision((revision) => revision + 1);
  }, [chartCandles, symbol, timeframe]);

  useEffect(() => {
    seriesRef.current?.setMarkers(mapped.markers.map((marker) => ({
      time: marker.time as unknown as Time,
      position: marker.position,
      color: marker.color,
      shape: marker.shape,
      size: marker.size,
    })));
    setLayoutRevision((revision) => revision + 1);
  }, [mapped]);

  // Existing Binance spot kline stream updates the forming candle in place.
  // The REST history remains a fallback and is refreshed independently by page.
  const handleRealtimeKline = useCallback((tick: KlineTick) => {
    if (tick.symbol.toUpperCase() !== symbol.toUpperCase()) return;
    const bar: ChartCandle = {
      time: Math.floor(tick.openTime / 1000),
      open: Number(tick.open),
      high: Number(tick.high),
      low: Number(tick.low),
      close: Number(tick.close),
    };
    if (!Object.values(bar).every(Number.isFinite) || bar.time <= 0 || bar.low <= 0) return;
    const series = seriesRef.current;
    if (!series) return;
    const last = candlesRef.current[candlesRef.current.length - 1];
    if (last && bar.time < last.time) return;
    try {
      series.update({ ...bar, time: bar.time as unknown as Time });
      setRealtimePrice(bar.close);
      if (last?.time === bar.time) candlesRef.current[candlesRef.current.length - 1] = bar;
      else candlesRef.current = [...candlesRef.current, bar];
      setLayoutRevision((revision) => revision + 1);
    } catch {
      // A late stream frame can race a REST refresh; next REST poll reconciles it.
    }
  }, [symbol]);
  useEffect(() => {
    setRealtimePrice(null);
  }, [symbol, timeframe]);
  useRealtimeKline({
    symbol,
    timeframe,
    // Never blend Binance WS ticks into a KuCoin REST fallback series.
    enabled: candles[0]?.provenance?.exchange === 'binance',
    onKlineTick: handleRealtimeKline,
  });

  const badges = useMemo(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !chartCandles.length) return [];
    const lastCandleTime = chartCandles[chartCandles.length - 1]?.time ?? 0;
    const firstCandleTime = chartCandles[0]?.time ?? 0;
    const candidates = events
      .filter((event) => event.symbol.trim().toUpperCase() === symbol.toUpperCase())
      .map((event) => {
        const seconds = eventSeconds(event.timestamp);
        const amount = Number(event.amountUsd);
        const price = Number(event.price);
        const time = Number.isFinite(seconds) ? seconds - (seconds % timeframeSec) : NaN;
        return { event, time, amount, price };
      })
      .filter(({ time, amount, price }) => Number.isFinite(time) && time >= firstCandleTime && time <= lastCandleTime && amount > 0 && price > 0)
      // Show largest badges first; markers still retain the broader event context.
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 28);
    const width = container.clientWidth;
    const height = container.clientHeight;
    const result: Array<{ id: string; x: number; y: number; side: 'LONG' | 'SHORT'; text: string; amount: number; exchange: string }> = [];
    for (const { event, time, amount, price } of candidates) {
      const x = chart.timeScale().timeToCoordinate(time as Time);
      const y = series.priceToCoordinate(price);
      if (x == null || y == null || x < 0 || x > width - 84 || y < 5 || y > height - 34) continue;
      result.push({ id: event.id, x, y, side: event.side, text: compactUsd(amount), amount, exchange: event.exchange });
    }
    // Put smaller events first so the biggest badges are painted on top.
    return result.sort((a, b) => a.amount - b.amount);
  }, [events, chartCandles, symbol, timeframeSec, layoutRevision]);

  const latest = chartCandles[chartCandles.length - 1];
  const displayedPrice = realtimePrice ?? latest?.close;
  const statusText = loading
    ? 'Загружаем исторические свечи…'
    : error
      ? 'REST-источник временно недоступен. Повторная попытка автоматически.'
      : 'Свечи недоступны для этого инструмента';

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/[0.055] bg-surface-inset" data-qa="liq-price-chart">
      <div className="flex h-9 items-center justify-between border-b border-white/[0.06] px-3 text-[11px] font-mono">
        <div className="flex items-center gap-2 text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.75)]" />
          {candles[0]?.provenance?.exchange?.toUpperCase() ?? 'LIVE SOURCE'} · {candles[0]?.provenance?.market?.toUpperCase() ?? 'OHLC'} · {symbol}/USDT · {timeframe.toUpperCase()}
        </div>
        {displayedPrice != null && (
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-slate-500">LAST</span>
            <span className="font-semibold text-cyan-300">{displayedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}
      </div>
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[clamp(320px,54vh,560px)] w-full min-w-0"
          aria-label={`${symbol}/USDT ${timeframe} candlestick chart`}
        />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {badges.map((badge) => (
            <div
              key={badge.id}
              title={`${badge.side} · ${badge.exchange} · ${badge.text}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border font-mono font-bold leading-none shadow-[0_2px_10px_rgba(0,0,0,.45)] backdrop-blur-sm ${badge.amount >= 1_000_000 ? 'px-2 py-1 text-[11px]' : badge.amount >= 100_000 ? 'px-1.5 py-[3px] text-[11px]' : 'px-1 py-[2px] text-[11px]'} ${badge.side === 'LONG'
                ? 'border-emerald-300/35 bg-emerald-950/85 text-emerald-200'
                : 'border-rose-300/35 bg-rose-950/85 text-rose-200'}`}
              style={{ left: badge.x, top: badge.y }}
            >
              {badge.side === 'LONG' ? 'L' : 'S'} {badge.text}
            </div>
          ))}
        </div>
        {chartCandles.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface-inset/65 px-6 text-center">
            <div className="max-w-sm rounded-lg border border-white/[0.08] bg-surface/95 px-4 py-3 shadow-xl">
              <div className="text-xs font-semibold text-slate-200">{statusText}</div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Свечной график загружается отдельно от потока ликвидаций. Фактических событий сейчас может быть 0.
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] px-3 py-2 font-sans text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400" />LONG liquidation</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" />SHORT liquidation</span>
        <span className="ml-auto font-mono text-slate-500">{chartCandles.length} candles · {mapped.matched} matched events</span>
      </div>
    </div>
  );
};
