import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock lightweight-charts for JSDOM canvas environment
vi.mock('lightweight-charts', () => {
  return {
    ColorType: { Solid: 'solid' },
    createChart: () => ({
      applyOptions: vi.fn(),
      addCandlestickSeries: () => ({
        setData: vi.fn(),
        priceScale: () => ({ applyOptions: vi.fn() }),
      }),
      addHistogramSeries: () => ({
        setData: vi.fn(),
        priceScale: () => ({ applyOptions: vi.fn() }),
      }),
      timeScale: () => ({ fitContent: vi.fn() }),
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
