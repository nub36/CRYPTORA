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
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
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
      // CandleChart: клик по бару с маркером (выбор сигнала на графике).
      subscribeClick: vi.fn(),
      unsubscribeClick: vi.fn(),
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

/**
 * Детерминированный ответ `GET /api/signals` для jsdom-тестов.
 *
 * `MarketDataContext` синхронизирует ПРОДАКШН-ленту колокольчика с серверной
 * лентой (`useServerSignalNotifications`) при монтировании провайдера. В тестах,
 * которые не подменяют `fetch` сами (провайдер-тесты Header/Footer/Coin page,
 * страницы, где лента не проверяется), этот запрос уходил бы в сеть и возвращал
 * ответ уже ПОСЛЕ завершения теста: React ругался на обновление вне `act`, а
 * результат зависел бы от окружения.
 *
 * Подменяется ТОЛЬКО `/api/signals` (и его подпути): ответ — честная пустая
 * серверная страница. Остальные запросы идут в исходный `fetch`, поэтому тесты,
 * которые явно проверяют ошибки источников, продолжают видеть своё поведение.
 * Тесты, ставящие `vi.stubGlobal('fetch', …)`, перекрывают эту заглушку.
 */
const emptySignalsPage = {
  signals: [],
  count: 0,
  total: 0,
  limit: 50,
  offset: 0,
  maxLimit: 200,
  ordering: 'created_at_desc',
  appliedFilters: { strategyId: null, status: null, open: null, symbol: null, direction: null },
  statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
  openStatuses: ['ACTIVE', 'FILLED'],
  source: 'server',
};

const originalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
if (originalFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    /*
     * Заглушка — только для SAME-ORIGIN (относительных) запросов браузерных
     * компонентов. Абсолютные URL (`http://127.0.0.1:<port>/api/signals`)
     * означают НАСТОЯЩИЙ сервер: так ходят integration-тесты через
     * `tests/helpers/httpHarness.ts` — подменять им ответ нельзя, иначе они
     * проверяли бы фейк вместо Express-маршрута.
     */
    if (!/^[a-z]+:\/\//i.test(url) && url.includes('/api/signals')) {
      const body = JSON.stringify(emptySignalsPage);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => emptySignalsPage,
        text: async () => body,
      } as unknown as Response);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
