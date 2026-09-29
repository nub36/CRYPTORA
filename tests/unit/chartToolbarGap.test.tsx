import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CHART_TERMINAL_COMPACT_QUERY, ChartTerminal } from '@/components/common/ChartTerminal';
import type { ChartTerminalProps } from '@/components/common/ChartTerminal';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * LAYOUT-КОНТРАКТ TOOLBAR ГРАФИКА (UI-cleanup после PR #37, §1).
 *
 * Регрессия: обёртка `ml-auto flex shrink-0` у «Ещё» отталкивала `•••` к
 * правому краю терминала, и между «Индикаторами» и `•••` висела пустая
 * полоса шириной в большую часть экрана:
 *
 *     [1ч] [Свечи] [Индикаторы] .................... [•••]
 *
 * Требуемый вид — четыре контрола ВПЛОТНУЮ слева с одинаковым gap:
 *
 *     [1ч] [Свечи] [Индикаторы] [•••]
 *
 * Здесь зафиксирован и DOM-контракт (порядок и соседство), и CSS-контракт
 * (никаких ml-auto / justify-between / flex-grow / искусственных спейсеров),
 * на desktop и на мобильной композиции.
 */

vi.mock('@/components/common/CandleChart', () => ({
  // Мок воспроизводит слот мобильного fullscreen-оверлея, чтобы контракт
  // «fullscreen существует ровно один и НЕ в toolbar» проверялся честно.
  CandleChart: (props: { topRightSlot?: React.ReactNode }) => (
    <div data-testid="chart-engine">{props.topRightSlot ?? null}</div>
  ),
}));

const baseProps = (): ChartTerminalProps => ({
  data: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }],
  symbol: 'SOL/USDT',
  timeframe: '1h',
  onTimeframeChange: vi.fn(),
  chartType: 'candles',
  onChartTypeChange: vi.fn(),
  showRSI: false,
  onShowRSIChange: vi.fn(),
  showMACD: false,
  onShowMACDChange: vi.fn(),
  showMA: true,
  onShowMAChange: vi.fn(),
  showVolume: true,
  onShowVolumeChange: vi.fn(),
  showTimezone: true,
  onShowTimezoneChange: vi.fn(),
});

const TOOLBAR_QA = '[data-qa="chart-terminal-toolbar"]';

/** Запрещённые классы-«расталкиватели» и спейсеры внутри toolbar. */
const FORBIDDEN_CLASS_FRAGMENTS = [
  'ml-auto', 'mr-auto', 'mx-auto',
  'justify-between', 'justify-end', 'justify-around', 'justify-evenly',
  'flex-grow', 'flex-1', 'grow', 'spacer',
] as const;

const hasClass = (className: string, fragment: string) =>
  new RegExp(`(^| )${fragment}( |$)`).test(className);

/** Рендерит терминал в заданной композиции и возвращает toolbar. */
function renderToolbar(compact: boolean): HTMLElement {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === CHART_TERMINAL_COMPACT_QUERY ? compact : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  try {
    render(<ChartTerminal {...baseProps()} />);
  } finally {
    if (original) Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
    else delete (window as { matchMedia?: unknown }).matchMedia;
  }
  const toolbar = document.querySelector<HTMLElement>(TOOLBAR_QA);
  expect(toolbar).not.toBeNull();
  expect(toolbar!.getAttribute('data-layout')).toBe(compact ? 'compact' : 'desktop');
  return toolbar!;
}

afterEach(() => cleanup());

for (const composition of [
  { name: 'desktop', compact: false },
  { name: 'mobile', compact: true },
] as const) {
  describe(`ChartTerminal toolbar adjacency — ${composition.name} composition`, () => {
    it('renders exactly four controls in order: timeframe, type, indicators, more', () => {
      const toolbar = renderToolbar(composition.compact);
      const triggers = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('data-qa'));
      expect(triggers).toEqual([
        'chart-timeframe-trigger',
        'chart-type-trigger',
        'chart-indicators-trigger',
        'chart-more-trigger',
      ]);
    });

    it('the «•••» control immediately follows «Индикаторы» (no spacer in between)', () => {
      const toolbar = renderToolbar(composition.compact);
      const more = toolbar.querySelector('[data-qa="chart-more-trigger"]')!;
      const moreWrapper = more.parentElement!;
      const indicators = toolbar.querySelector('[data-qa="chart-indicators-trigger"]')!;
      const indicatorsWrapper = indicators.parentElement!;

      // Обёртки контролов — СОСЕДНИЕ дети toolbar: между ними нет ни спейсера,
      // ни ещё одного слоя-обёртки, отталкивающего «Ещё» вправо.
      expect(moreWrapper.previousElementSibling).toBe(indicatorsWrapper);
      expect(moreWrapper.parentElement).toBe(toolbar);
      expect(indicatorsWrapper.parentElement).toBe(toolbar);
      expect(Array.from(toolbar.children)).toHaveLength(4);
    });

    it('the toolbar and its children contain no ml-auto / justify-between / spacer rules', () => {
      const toolbar = renderToolbar(composition.compact);
      for (const node of [toolbar, ...Array.from(toolbar.querySelectorAll<HTMLElement>('[class]'))]) {
        for (const fragment of FORBIDDEN_CLASS_FRAGMENTS) {
          expect(hasClass(node.className, fragment), `${node.tagName} must not use "${fragment}"`).toBe(false);
        }
      }
    });

    it('the toolbar is left-aligned (justify-start) with a uniform 6px gap', () => {
      const toolbar = renderToolbar(composition.compact);
      // Явный flex-start + одинаковый gap-1.5 (6px) для всех четырёх контролов.
      expect(hasClass(toolbar.className, 'justify-start')).toBe(true);
      expect(hasClass(toolbar.className, 'gap-1.5')).toBe(true);
      expect(hasClass(toolbar.className, 'flex-nowrap')).toBe(true);
      expect(hasClass(toolbar.className, 'items-center')).toBe(true);
    });

    it('every control wrapper is an equal shrink-0 flex child', () => {
      const toolbar = renderToolbar(composition.compact);
      const wrappers = Array.from(toolbar.children) as HTMLElement[];
      expect(wrappers).toHaveLength(4);
      for (const wrapper of wrappers) {
        expect(hasClass(wrapper.className, 'shrink-0')).toBe(true);
      }
    });

    it('fullscreen stays OUTSIDE the toolbar (desktop rail / mobile in-frame overlay)', () => {
      renderToolbar(composition.compact);
      const toolbar = document.querySelector<HTMLElement>(TOOLBAR_QA)!;
      const fullscreen = document.querySelectorAll('[data-qa="chart-fullscreen"]');
      expect(fullscreen).toHaveLength(1);
      expect(toolbar.contains(fullscreen[0])).toBe(false);
    });
  });
}

describe('ChartTerminal toolbar — source-level contract', () => {
  it('the source no longer wraps «Ещё» in a right-pushing wrapper', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/common/ChartTerminal.tsx'), 'utf8');
    // JSX-обёртка с ml-auto (отталкивавшая «Ещё» к правому краю) удалена;
    // в исходнике символ встречается только в пояснительном комментарии.
    expect(source).not.toMatch(/<div className="ml-auto/);
    // Контейнер toolbar кодирует выравнивание явно.
    expect(source).toMatch(/justify-start gap-1\.5/);
  });
});
