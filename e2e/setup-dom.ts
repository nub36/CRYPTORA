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
