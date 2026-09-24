import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock lightweight-charts for JSDOM canvas environment
vi.mock('lightweight-charts', () => {
  // Общий стаб серии: всё, что CandleChart вызывает на candlestick/histogram/line.
  const makeSeries = () => ({
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    // LiquidationPriceChart ставит метки событий поверх свечей.
    setMarkers: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
  });
  return {
    ColorType: { Solid: 'solid' },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
    createChart: () => {
      const timeScale = {
        fitContent: vi.fn(), applyOptions: vi.fn(), getVisibleLogicalRange: vi.fn(() => null),
        setVisibleLogicalRange: vi.fn(), subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
      };
      return ({
      applyOptions: vi.fn(),
      addCandlestickSeries: makeSeries,
      addHistogramSeries: makeSeries,
      // CandleChart рисует оверлеи (EMA/зоны) линейной серией.
      addLineSeries: makeSeries,
      // CandleChart: альтернативный тип отображения «бары».
      addBarSeries: makeSeries,
      priceScale: () => ({ applyOptions: vi.fn() }),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      timeScale: () => timeScale,
      remove: vi.fn(),
    });
    },
  };
});

// Mock ResizeObserver for JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/**
 * Файл выполняется для ВСЕХ тестов, включая те, что явно просят окружение node
 * (`// @vitest-environment node` — серверные контрактные тесты). В node нет
 * `window`, и безусловный `Object.defineProperty(window, …)` ронял сбор файла
 * целиком. Браузерные моки применяются только там, где есть браузерное окно;
 * в jsdom поведение прежнее.
 */
const hasWindow = typeof window !== 'undefined';

// Mock window.matchMedia
if (hasWindow) Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
