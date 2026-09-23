import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TickMarkType } from 'lightweight-charts';
import type { OHLCV } from '@/types/market';
import { CandleChart } from '@/components/common/CandleChart';
import { CHART_RIGHT_OFFSET, RSI_FIXED_PRICE_RANGE } from '@/components/common/chartPresentationConfig';

const chartCapture = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightweight-charts')>();
  const createSeries = (options: unknown) => ({
    options,
    setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: vi.fn(() => ({ id: 'price-line' })),
    removePriceLine: vi.fn(),
  });
  return {
    ...actual,
    createChart: vi.fn((_container: HTMLElement, options: unknown) => {
      const instance: any = {
        options,
        series: [],
        applyOptions: vi.fn(),
        remove: vi.fn(),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        timeScale: () => instance.scale,
        scale: {
          applyOptions: vi.fn(), fitContent: vi.fn(),
          getVisibleLogicalRange: vi.fn(() => null), setVisibleLogicalRange: vi.fn(),
          subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
        },
        addCandlestickSeries: vi.fn((seriesOptions: unknown) => { const series = createSeries(seriesOptions); instance.series.push(series); return series; }),
        addBarSeries: vi.fn((seriesOptions: unknown) => { const series = createSeries(seriesOptions); instance.series.push(series); return series; }),
        addLineSeries: vi.fn((seriesOptions: unknown) => { const series = createSeries(seriesOptions); instance.series.push(series); return series; }),
        addHistogramSeries: vi.fn((seriesOptions: unknown) => { const series = createSeries(seriesOptions); instance.series.push(series); return series; }),
      };
      chartCapture.instances.push(instance);
      return instance;
    }),
  };
});

const data: OHLCV[] = [
  { time: 1_780_000_000, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { time: 1_780_000_900, open: 101, high: 103, low: 100, close: 102, volume: 12 },
];

beforeEach(() => { chartCapture.instances = []; });
afterEach(() => cleanup());

describe('independent indicator panes and chart viewport', () => {
  it('keeps price, RSI and MACD in separate chart instances with independent scales', () => {
    const { unmount } = render(<CandleChart data={data} timeframe="15m" showRSI showMACD />);
    expect(chartCapture.instances).toHaveLength(3);

    const price = chartCapture.instances.find((chart: any) => chart.options.rightPriceScale?.scaleMargins);
    const rsi = chartCapture.instances.find((chart: any) => chart.series.some((series: any) => typeof series.options.autoscaleInfoProvider === 'function'));
    const macd = chartCapture.instances.find((chart: any) => chart.series.some((series: any) => series.options.base === 0));
    expect(price).toBeDefined();
    expect(rsi).toBeDefined();
    expect(macd).toBeDefined();
    expect(price.options.rightPriceScale.scaleMargins.bottom).toBeLessThan(0.3);
    const rsiSeries = rsi.series.find((series: any) => typeof series.options.autoscaleInfoProvider === 'function');
    expect(rsiSeries.options.autoscaleInfoProvider()).toEqual({ priceRange: RSI_FIXED_PRICE_RANGE });
    expect(rsi.series.filter((series: any) => typeof series.options.autoscaleInfoProvider === 'function')).toHaveLength(4); // RSI plus 30 / 50 / 70 level series.
    expect(macd.series.some((series: any) => series.options.base === 0)).toBe(true);
    expect(macd.series.some((series: any) => series.options.color === '#f59e0b')).toBe(true);

    unmount();
    for (const chart of chartCapture.instances) {
      expect(chart.remove).toHaveBeenCalledOnce();
      expect(chart.scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
    }
  });

  it('hands REST candle T to WS updates and appends the first T+interval bar', () => {
    const base = {
      symbol: 'BTC', interval: '15m', openTime: 1_780_000_000_000, closeTime: 1_780_000_899_000,
      open: 100, high: 102, low: 99, close: 101, volume: 3, isClosed: false,
      provenance: { exchange: 'binance' as const, market: 'spot' as const, symbol: 'BTCUSDT', timestamp: Date.now() },
    };
    const rest = [data[0]];
    const { rerender } = render(<CandleChart data={rest} symbol="BTC/USDT" timeframe="15m" realtimeKline={{ ...base, timestamp: Date.now() }} />);
    const price = chartCapture.instances.find((chart: any) => chart.options.rightPriceScale?.scaleMargins);
    const candleSeries = price.series[0];
    expect(candleSeries.setData).toHaveBeenCalledWith([{ time: data[0].time, open: 100, high: 102, low: 99, close: 101 }]);
    expect(candleSeries.update).toHaveBeenCalledWith({ time: data[0].time, open: 100, high: 102, low: 99, close: 101 });

    rerender(<CandleChart data={rest} symbol="BTC/USDT" timeframe="15m" realtimeKline={{ ...base, openTime: base.openTime + 900_000, closeTime: base.closeTime + 900_000, timestamp: Date.now() }} />);
    expect(candleSeries.update).toHaveBeenLastCalledWith({ time: data[0].time + 900, open: 100, high: 102, low: 99, close: 101 });
  });

  it('distinguishes candle-kline freshness from a generic connection/ticker state', () => {
    const base = {
      symbol: 'BTC', interval: '15m', openTime: 1_780_000_000_000, closeTime: 1_780_000_899_000,
      open: 100, high: 102, low: 99, close: 101, volume: 3, isClosed: false,
      provenance: { exchange: 'binance' as const, market: 'spot' as const, symbol: 'BTCUSDT', timestamp: Date.now() },
    };
    const { getByTestId, rerender } = render(<CandleChart data={[]} realtimeKline={{ ...base, timestamp: Date.now() }} />);
    expect(getByTestId('kline-freshness').textContent).toBe('KLINE WS');
    rerender(<CandleChart data={[]} realtimeKline={{ ...base, timestamp: Date.now() - 60_000 }} />);
    expect(getByTestId('kline-freshness').textContent).toBe('KLINE STALE');
  });

  it('uses a real right-side logical offset and browser-local/explicit UTC tick formatting', () => {
    const { getByRole } = render(<CandleChart data={data} />);
    const price = chartCapture.instances[0];
    expect(price.options.timeScale.rightOffset).toBe(CHART_RIGHT_OFFSET);
    expect(price.scale.applyOptions).toHaveBeenCalledWith({ rightOffset: CHART_RIGHT_OFFSET });

    const instant = Date.parse('2026-01-15T08:09:00Z') / 1000;
    const localExpected = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant * 1000);
    expect(price.options.timeScale.tickMarkFormatter(instant, TickMarkType.Time, 'en-US')).toBe(localExpected);
    fireEvent.click(getByRole('button', { name: 'Переключить локальное время и UTC' }));
    expect(price.options.timeScale.tickMarkFormatter(instant, TickMarkType.Time, 'en-US')).toContain('08:09');
  });
});
