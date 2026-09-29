import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { OHLCV } from '@/types/market';
import { CandleChart } from '@/components/common/CandleChart';

/**
 * ОБЪЁМ НЕ ДОЛЖЕН ВЫГЛЯДЕТЬ КАК ЦЕНА (задача §13).
 *
 * На production-скриншоте MEW USD-M у правой шкалы висел зелёный ярлык
 * `84,369,082.00`. Это последнее значение гистограммы ОБЪЁМА: серия живёт на
 * overlay-шкале (`priceScaleId: ''`), но её «последнее значение» и price-line
 * рисуются на той же правой кромке, что и цена инструмента, и проходят через
 * общий `localization.priceFormatter` — поэтому объём читался как котировка.
 *
 * Данные при этом не скрываются: гистограмма остаётся, значение объёма
 * доступно в подсказке OHLCV. Тест фиксирует ровно два презентационных флага.
 */
const chartCapture = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightweight-charts')>();
  const createSeries = (options: unknown) => ({
    options,
    setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: vi.fn(() => ({ id: 'price-line' })),
    removePriceLine: vi.fn(),
    setMarkers: vi.fn(),
  });
  return {
    ...actual,
    createChart: vi.fn((_container: HTMLElement, options: unknown) => {
      const instance: any = {
        options,
        series: [],
        histogramOptions: [] as any[],
        candleOptions: [] as any[],
        applyOptions: vi.fn(),
        remove: vi.fn(),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        timeScale: () => instance.scale,
        priceScale: () => ({ width: vi.fn(() => 88), applyOptions: vi.fn() }),
        scale: {
          applyOptions: vi.fn(), fitContent: vi.fn(),
          getVisibleLogicalRange: vi.fn(() => null), setVisibleLogicalRange: vi.fn(),
          subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
        },
        addCandlestickSeries: vi.fn((o: any) => { instance.candleOptions.push(o); const s = createSeries(o); instance.series.push(s); return s; }),
        addBarSeries: vi.fn((o: any) => { const s = createSeries(o); instance.series.push(s); return s; }),
        addLineSeries: vi.fn((o: any) => { const s = createSeries(o); instance.series.push(s); return s; }),
        addHistogramSeries: vi.fn((o: any) => { instance.histogramOptions.push(o); const s = createSeries(o); instance.series.push(s); return s; }),
      };
      chartCapture.instances.push(instance);
      return instance;
    }),
  };
});

const data: OHLCV[] = [
  { time: 1_780_000_000, open: 0.000471, high: 0.000488, low: 0.000469, close: 0.000478, volume: 84_369_082 },
  { time: 1_780_000_900, open: 0.000478, high: 0.000481, low: 0.000474, close: 0.000479, volume: 62_100_500 },
];

beforeEach(() => { chartCapture.instances = []; });
afterEach(() => cleanup());

describe('main price scale never shows a volume value', () => {
  it('creates the volume histogram without a last-value label and without a price line', () => {
    render(<CandleChart data={data} symbol="MEW/USDT" timeframe="15m" showVolume />);

    const price = chartCapture.instances.find((chart: any) => chart.options.rightPriceScale?.scaleMargins);
    expect(price).toBeDefined();
    const volume = price.histogramOptions.find((options: any) => options.priceFormat?.type === 'volume');
    expect(volume).toBeDefined();
    // Overlay-шкала объёма (не правая шкала цены).
    expect(volume.priceScaleId).toBe('');
    // И никаких его отпечатков на правой кромке.
    expect(volume.lastValueVisible).toBe(false);
    expect(volume.priceLineVisible).toBe(false);
  });

  it('keeps the instrument price itself on the right scale', () => {
    render(<CandleChart data={data} symbol="MEW/USDT" timeframe="15m" showVolume />);
    const price = chartCapture.instances.find((chart: any) => chart.options.rightPriceScale?.scaleMargins);
    const candle = price.candleOptions[0];
    // Свеча тоже не рисует дубль-метку, цену показывает сама шкала —
    // но её формат остаётся ценовым, а не объёмным.
    expect(candle.priceFormat?.type ?? 'price').not.toBe('volume');
    expect(price.options.localization.priceFormatter(0.000478)).toBe('0.000478');
    // Объём такого размера в цену превратиться уже не может: метки нет.
    expect(price.histogramOptions.every((o: any) => o.lastValueVisible === false)).toBe(true);
  });
});
