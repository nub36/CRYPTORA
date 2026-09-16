// @ts-ignore
import { JSDOM } from 'jsdom';
import { expect } from '@playwright/test';

declare global {
  namespace PlaywrightTest {
    interface Matchers<R> {
      toBeInTheDocument(): R;
    }
  }
}

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173',
  pretendToBeVisual: true,
});

const { window } = dom;

function setGlobal(key: string, val: any) {
  try {
    Object.defineProperty(global, key, {
      value: val,
      writable: true,
      configurable: true,
    });
  } catch {
    (global as any)[key] = val;
  }
}

setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('navigator', window.navigator);
setGlobal('location', window.location);
// Браузеры предоставляют localStorage как глобальный объект — JSDOM-шим должен
// вести себя так же, иначе persistence-контракты (cryptora_data_mode и др.)
// молча уходят в fallback и тесты проверяют не тот режим.
if (window.localStorage) {
  setGlobal('localStorage', window.localStorage);
  setGlobal('sessionStorage', window.sessionStorage);
}
setGlobal('HTMLElement', window.HTMLElement);
setGlobal('HTMLCanvasElement', window.HTMLCanvasElement);
setGlobal('Element', window.Element);
setGlobal('Node', window.Node);
setGlobal('Event', window.Event);
setGlobal('MouseEvent', window.MouseEvent);
setGlobal('KeyboardEvent', window.KeyboardEvent);
setGlobal('CustomEvent', window.CustomEvent);
setGlobal('MutationObserver', window.MutationObserver);
setGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 0));
setGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

// Canvas getContext mock for lightweight-charts
if (window.HTMLCanvasElement) {
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      fillRect: () => {},
      clearRect: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Array(w * h * 4) }),
      putImageData: () => {},
      createImageData: () => [],
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      fillText: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {},
    } as any;
  };
}

// ---------------------------------------------------------------------------
// Герметичность E2E-окружения: никаких реальных сетевых вызовов из тестов.
// Node.js предоставляет глобальные `fetch` и `WebSocket`, поэтому без явных
// заглушек Live-провайдер и realtime-клиент пытались бы реально подключаться
// к биржам. Их асинхронные отказы прилетали бы в произвольный (следующий) тест
// как uncaught exception и делали бы прогон флейки. Заглушки сохраняют честное
// поведение приложения: Live-слой сообщает об ошибке источника данных.
// ---------------------------------------------------------------------------
setGlobal('fetch', () =>
  Promise.reject(new TypeError('E2E: сеть отключена (детерминированное окружение тестов)'))
);

// `typeof WebSocket === 'undefined'` заставляет realtime-клиент честно
// сообщить о недоступности транспорта вместо попытки подключения.
setGlobal('WebSocket', undefined);

setGlobal('ResizeObserver', class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
});

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

expect.extend({
  toBeInTheDocument(received: any) {
    const pass =
      received !== null &&
      received !== undefined &&
      Boolean(received.ownerDocument && received.ownerDocument.body.contains(received));
    return {
      pass,
      message: () =>
        pass ? 'expected element not to be in document' : 'expected element to be in document',
    };
  },
});

/**
 * Изоляция состояния между тестами.
 * localStorage в JSDOM-шиме действительно работает, а провайдер рыночных данных
 * сохраняет в нём выбранный режим (`cryptora_data_mode`) и списки (watchlist/alerts).
 * Без сброса тест, переключивший режим на LIVE, загрязнял бы последующие тесты
 * (и, что важнее, включал бы реальные сетевые вызовы к биржам).
 *
 * ВАЖНО: функция экспортируется, а хук регистрируется в каждом spec-файле.
 * ES-модуль кэшируется на процесс воркера, поэтому `test.beforeEach(...)`,
 * вызванный здесь при импорте, применился бы только к первому spec-файлу.
 */
export function resetBrowserStorage(): void {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // E2E-прогон детерминирован: базовый режим тестов — демонстрационный датасет.
    // Продуктовый режим по умолчанию — LIVE (см. отдельный тест LIVE-first).
    window.localStorage.setItem('cryptora_data_mode', 'demo');
  } catch {
    /* storage может быть недоступен — тесты продолжат в режиме по умолчанию */
  }
}
