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
    createChart: () => ({
      applyOptions: vi.fn(),
      addCandlestickSeries: makeSeries,
      addHistogramSeries: makeSeries,
      // CandleChart рисует оверлеи (EMA/зоны) линейной серией.
      addLineSeries: makeSeries,
      // CandleChart: альтернативный тип отображения «бары».
      addBarSeries: makeSeries,
      priceScale: () => ({ applyOptions: vi.fn() }),
      subscribeCrosshairMove: vi.fn(),
      timeScale: () => ({ fitContent: vi.fn(), applyOptions: vi.fn() }),
      remove: vi.fn(),
    }),
  };
});

// Mock ResizeObserver for JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
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
