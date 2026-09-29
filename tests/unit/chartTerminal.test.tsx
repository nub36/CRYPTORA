import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CHART_TERMINAL_COMPACT_QUERY, ChartTerminal, formatTerminalTimeframe } from '@/components/common/ChartTerminal';
import type { ChartTerminalProps } from '@/components/common/ChartTerminal';

vi.mock('@/components/common/CandleChart', () => ({
  CandleChart: (props: Record<string, unknown>) => (
    <div data-testid="chart-engine">
      <span>{String(props.symbol)}</span>
      <span data-testid="chart-engine-timeframe">{String(props.timeframe)}</span>
      <span data-testid="chart-engine-type">{String(props.chartType)}</span>
      <span data-testid="chart-engine-volume">{String(props.showVolume)}</span>
      <span data-testid="chart-engine-compact-labels">{String(props.compactPriceLabels)}</span>
      <span data-testid="chart-engine-has-slot">{String(Boolean(props.topRightSlot))}</span>
      {props.topRightSlot as React.ReactNode}
    </div>
  ),
}));

const baseProps = (): ChartTerminalProps => ({
  data: [],
  symbol: 'XRP/USDT',
  timeframe: '15m',
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

afterEach(() => cleanup());

describe('ChartTerminal toolbar', () => {
  it('formats only the compact Russian timeframe labels', () => {
    expect(formatTerminalTimeframe('5m')).toBe('5м');
    expect(formatTerminalTimeframe('15m')).toBe('15м');
    expect(formatTerminalTimeframe('1h')).toBe('1ч');
    expect(formatTerminalTimeframe('1W')).toBe('1Н');
  });

  it('opens the timeframe menu, switches timeframe, and closes after selection', () => {
    const props = baseProps();
    const { rerender } = render(<ChartTerminal {...props} />);
    const trigger = screen.getByTestId('chart-timeframe-trigger');

    expect(trigger).toHaveTextContent('15м');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Таймфрейм: 15м' })).toBeInTheDocument();
    expect(screen.getByTestId('chart-timeframe-1h')).toHaveTextContent('1ч');

    fireEvent.click(screen.getByTestId('chart-timeframe-1h'));
    expect(props.onTimeframeChange).toHaveBeenCalledWith('1h');
    expect(screen.queryByRole('menu', { name: 'Таймфрейм: 15м' })).not.toBeInTheDocument();

    rerender(<ChartTerminal {...props} timeframe="1h" />);
    expect(screen.getByTestId('chart-timeframe-trigger')).toHaveTextContent('1ч');
    expect(screen.getByTestId('chart-engine-timeframe')).toHaveTextContent('1h');
  });

  it('closes an open menu on Escape and outside pointer interaction', () => {
    const props = baseProps();
    render(<ChartTerminal {...props} />);
    const trigger = screen.getByTestId('chart-timeframe-trigger');

    fireEvent.click(trigger);
    expect(screen.getByTestId('chart-timeframe-trigger-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('chart-timeframe-trigger-menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByTestId('chart-timeframe-trigger-menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('chart-timeframe-trigger-menu')).not.toBeInTheDocument();
  });

  it('keeps chart type, indicator, template and settings actions functional', () => {
    const props = baseProps();
    render(<ChartTerminal {...props} />);

    fireEvent.click(screen.getByTestId('chart-type-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Линия/ }));
    expect(props.onChartTypeChange).toHaveBeenCalledWith('line');

    fireEvent.click(screen.getByTestId('chart-indicators-trigger'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /RSI/ }));
    expect(props.onShowRSIChange).toHaveBeenCalledWith(true);

    // Шаблоны и настройки переехали в «Ещё» — на ЛЮБОЙ ширине (единый toolbar).
    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Momentum/ }));
    expect(props.onShowMACDChange).toHaveBeenCalledWith(true);
    expect(props.onShowVolumeChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Объём/ }));
    expect(props.onShowVolumeChange).toHaveBeenCalledWith(false);
  });

  /**
   * ЕДИНЫЙ состав тулбара (задача §10, §17).
   *
   * Терминал рисует ОДНУ композицию контролов на всех ширинах, поэтому
   * Spot и Futures не могут разъехаться, а правку тулбара не нужно повторять
   * в мобильной и десктопной версиях.
   */
  it('renders the same four controls on desktop as on mobile', () => {
    render(<ChartTerminal {...baseProps()} />);
    const toolbar = document.querySelector('[data-qa="chart-terminal-toolbar"]')!;

    expect(toolbar.getAttribute('data-layout')).toBe('desktop');
    expect(toolbar.getAttribute('data-controls')).toBe('unified');
    const triggers = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('data-qa'));
    expect(triggers).toEqual([
      'chart-timeframe-trigger',
      'chart-type-trigger',
      'chart-indicators-trigger',
      'chart-more-trigger',
    ]);
    expect(toolbar.className).toMatch(/flex-nowrap/);
  });

  it('drops the long «1ч · таймфрейм» / «Тип графика · Свечи» labels', () => {
    render(<ChartTerminal {...baseProps()} />);

    expect(screen.getByTestId('chart-timeframe-trigger')).toHaveTextContent('15м');
    expect(screen.getByTestId('chart-timeframe-trigger').textContent).not.toMatch(/таймфрейм/i);
    // Кнопка типа показывает ТЕКУЩИЙ тип одним словом, без префикса «Тип графика ·».
    expect(screen.getByTestId('chart-type-trigger')).toHaveTextContent('Свечи');
    expect(screen.getByTestId('chart-type-trigger').textContent).not.toMatch(/·/);
    expect(document.querySelector('[data-qa="chart-terminal-toolbar"]')!.textContent).not.toMatch(/·/);
  });

  it('renders Russian terminal labels and does not duplicate the old timeframe strip', () => {
    render(<ChartTerminal {...baseProps()} />);
    expect(screen.getByText('Индикаторы')).toBeInTheDocument();
    expect(screen.getByLabelText('Развернуть график')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^5m$/ })).not.toBeInTheDocument();

    // «Шаблоны» и «Настройки» существуют, но как разделы внутри «Ещё».
    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    const menu = screen.getByTestId('chart-more-trigger-menu');
    expect(menu.querySelector('[data-qa="chart-more-templates"]')!.textContent).toBe('Шаблоны');
    expect(menu.querySelector('[data-qa="chart-more-settings"]')!.textContent).toBe('Настройки');
  });

  it('disables «Вписать данные» while the series is empty and enables it with data', () => {
    const { unmount } = render(<ChartTerminal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    expect(screen.getByTestId('chart-reset-view')).toBeDisabled();
    unmount();

    render(<ChartTerminal {...baseProps()} data={[{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }]} />);
    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    expect(screen.getByTestId('chart-reset-view')).not.toBeDisabled();
  });
});

describe('ChartTerminal side fullscreen control', () => {
  it('lives on the right rail of the chart workspace, not in the top toolbar', () => {
    render(<ChartTerminal {...baseProps()} />);

    const toolbar = document.querySelector('[data-qa="chart-terminal-toolbar"]');
    const rail = screen.getByTestId('chart-side-rail');
    const fullscreen = screen.getByTestId('chart-fullscreen');

    expect(toolbar).not.toBeNull();
    // Перенос, а не дублирование: контрол существует ровно в одном месте.
    expect(document.querySelectorAll('[data-qa="chart-fullscreen"]')).toHaveLength(1);
    expect(toolbar!.contains(fullscreen)).toBe(false);
    expect(rail.contains(fullscreen)).toBe(true);
    // «Вписать» больше не постоянный контрол: он живёт пунктом внутри «Ещё».
    expect(toolbar!.querySelector('[data-qa="chart-reset-view"]')).toBeNull();
    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    expect(screen.getByTestId('chart-more-trigger-menu').querySelector('[data-qa="chart-reset-view"]')).not.toBeNull();
  });

  it('keeps the rail inside the terminal flow (no absolute overlay, no negative offsets)', () => {
    render(<ChartTerminal {...baseProps()} />);
    const rail = screen.getByTestId('chart-side-rail');

    expect(rail.className).not.toMatch(/absolute|fixed/);
    expect(rail.className).not.toMatch(/-(left|right|top|bottom|m[lrtbxy]?)-/);
    expect(rail.className).toMatch(/shrink-0/);
    // Фиксированная колонка, поэтому график сжимается, а страница не расширяется.
    expect(rail.className).toMatch(/\bw-8\b/);
  });

  it('exposes the Russian expand/collapse tooltip contract', () => {
    render(<ChartTerminal {...baseProps()} />);
    const button = screen.getByTestId('chart-fullscreen');
    expect(button).toHaveAttribute('title', 'Развернуть график');
    expect(button).toHaveAttribute('aria-label', 'Развернуть график');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ChartTerminal indicators menu alignment', () => {
  const openIndicators = (props = baseProps()) => {
    render(<ChartTerminal {...props} />);
    fireEvent.click(screen.getByTestId('chart-indicators-trigger'));
    return props;
  };

  it('renders every indicator row with identical geometry regardless of state', () => {
    openIndicators({ ...baseProps(), showMA: true, showRSI: false, showMACD: false });

    const rows = ['ma', 'rsi', 'macd'].map((key) => screen.getByTestId(`chart-indicator-row-${key}`));
    for (const row of rows) {
      // Одна и та же grid-геометрия: гибкая колонка подписи + фиксированная колонка контрола.
      expect(row.className).toMatch(/grid-cols-\[minmax\(0,1fr\)_1rem\]/);
      expect(row.className).toMatch(/\bh-9\b/);
      expect(row.className).toMatch(/\bpx-3\b/);
      expect(row.className).toMatch(/\bgap-3\b/);
      // Никаких попыток выровнять пробелами/индивидуальными margin.
      expect(row.className).not.toMatch(/\bm[lrtb]-/);
      expect(row.textContent ?? '').not.toMatch(/ {2}/);
    }

    // Активное состояние отличается ТОЛЬКО цветом — геометрия строки не «прыгает».
    const geometry = (className: string) =>
      className.split(/\s+/).filter((token) => !/cyan|slate|white/.test(token));
    expect(geometry(rows[0].className)).toEqual(geometry(rows[1].className));
    expect(geometry(rows[1].className)).toEqual(geometry(rows[2].className));
  });

  it('keeps every checkbox on one right axis with a stable box', () => {
    openIndicators({ ...baseProps(), showMA: true, showRSI: false, showMACD: true });

    for (const key of ['ma', 'rsi', 'macd']) {
      const box = document.querySelector(`[data-qa="chart-indicator-box-${key}"]`);
      expect(box).not.toBeNull();
      expect(box!.className).toMatch(/\bh-4\b/);
      expect(box!.className).toMatch(/\bw-4\b/);
      expect(box!.className).toMatch(/justify-self-end/);
      expect(box!.className).toMatch(/\bborder\b/);
      const label = document.querySelector(`[data-qa="chart-indicator-label-${key}"]`);
      expect(label!.className).toMatch(/min-w-0/);
    }

    // Unchecked-контрол занимает то же место, checked отличается только заливкой.
    expect(document.querySelector('[data-qa="chart-indicator-box-rsi"]')!.className).toMatch(/border-slate-600/);
    expect(document.querySelector('[data-qa="chart-indicator-box-macd"]')!.className).toMatch(/bg-brand-cyan/);
  });

  it('still toggles the real chart-only indicators and keeps accessibility semantics', () => {
    const props = openIndicators({ ...baseProps(), showMA: true, showRSI: false, showMACD: false });

    const ma = screen.getByRole('menuitemcheckbox', { name: /MA и Bollinger/ });
    const rsi = screen.getByRole('menuitemcheckbox', { name: /RSI/ });
    const macd = screen.getByRole('menuitemcheckbox', { name: /MACD/ });
    expect(ma).toHaveAttribute('aria-checked', 'true');
    expect(rsi).toHaveAttribute('aria-checked', 'false');
    expect(macd).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(rsi);
    expect(props.onShowRSIChange).toHaveBeenCalledWith(true);
    fireEvent.click(macd);
    expect(props.onShowMACDChange).toHaveBeenCalledWith(true);
    fireEvent.click(ma);
    expect(props.onShowMAChange).toHaveBeenCalledWith(false);
  });

  it('separates the heading and keeps the informational footer readable', () => {
    openIndicators();
    const heading = document.querySelector('[data-qa="chart-indicators-heading"]');
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe('Панели и оверлеи');
    expect(heading!.className).toMatch(/border-b/);
    expect(screen.getByText(/Визуальные инструменты графика/)).toBeInTheDocument();
  });
});

/**
 * Мобильная композиция терминала (production follow-up после PR #32).
 *
 * `useMediaQuery` читает `window.matchMedia`, поэтому компактная раскладка
 * включается детерминированным моком, а не подгонкой под JSDOM.
 */
function mockViewport(compact: boolean): () => void {
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
  return () => {
    if (original) Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
    else delete (window as { matchMedia?: unknown }).matchMedia;
  };
}

describe('ChartTerminal mobile composition', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  const renderMobile = (props = baseProps()) => {
    restore = mockViewport(true);
    render(<ChartTerminal {...props} />);
    return props;
  };

  it('collapses the three desktop rows into one compact control row', () => {
    renderMobile();

    const toolbar = document.querySelector('[data-qa="chart-terminal-toolbar"]')!;
    expect(toolbar.getAttribute('data-layout')).toBe('compact');
    // Ровно четыре постоянных контрола: таймфрейм, тип, индикаторы, «Ещё».
    const triggers = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('data-qa'));
    expect(triggers).toEqual([
      'chart-timeframe-trigger',
      'chart-type-trigger',
      'chart-indicators-trigger',
      'chart-more-trigger',
    ]);
    // Строка не должна переноситься.
    expect(toolbar.className).toMatch(/flex-nowrap/);
  });

  it('removes the permanent Шаблоны / Настройки / Вписать controls from the mobile row', () => {
    renderMobile();
    const toolbar = document.querySelector('[data-qa="chart-terminal-toolbar"]')!;

    expect(toolbar.querySelector('[data-qa="chart-templates-trigger"]')).toBeNull();
    expect(toolbar.querySelector('[data-qa="chart-settings-trigger"]')).toBeNull();
    expect(toolbar.querySelector('[data-qa="chart-reset-view"]')).toBeNull();
  });

  it('puts templates, settings and «Вписать» inside «Ещё» and reuses the same handlers', () => {
    const props = renderMobile();
    fireEvent.click(screen.getByTestId('chart-more-trigger'));

    const menu = screen.getByTestId('chart-more-trigger-menu');
    expect(menu.querySelector('[data-qa="chart-template-momentum"]')).not.toBeNull();
    expect(menu.querySelector('[data-qa="chart-setting-volume"]')).not.toBeNull();
    expect(menu.querySelector('[data-qa="chart-setting-timezone"]')).not.toBeNull();
    // «Вписать» живёт пунктом меню, а не отдельной строкой toolbar.
    expect(menu.querySelector('[data-qa="chart-reset-view"]')).not.toBeNull();

    // Те же handlers, что и на desktop — дубликата бизнес-логики нет.
    fireEvent.click(screen.getByRole('menuitem', { name: /Momentum/ }));
    expect(props.onShowMACDChange).toHaveBeenCalledWith(true);
    expect(props.onShowVolumeChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('chart-more-trigger'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Объём/ }));
    expect(props.onShowVolumeChange).toHaveBeenCalledWith(false);
  });

  it('keeps timeframe / type / indicators driving the very same state', () => {
    const props = renderMobile();

    fireEvent.click(screen.getByTestId('chart-timeframe-trigger'));
    fireEvent.click(screen.getByTestId('chart-timeframe-1h'));
    expect(props.onTimeframeChange).toHaveBeenCalledWith('1h');

    fireEvent.click(screen.getByTestId('chart-type-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Линия/ }));
    expect(props.onChartTypeChange).toHaveBeenCalledWith('line');

    fireEvent.click(screen.getByTestId('chart-indicators-trigger'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /RSI/ }));
    expect(props.onShowRSIChange).toHaveBeenCalledWith(true);
  });

  it('shortens labels but keeps the full meaning in tooltip/aria-label', () => {
    renderMobile();

    const type = screen.getByTestId('chart-type-trigger');
    expect(type).toHaveTextContent('Тип');
    expect(type).toHaveAttribute('title', 'Тип графика: Свечи');
    expect(type).toHaveAttribute('aria-label', 'Тип графика: Свечи');

    const timeframe = screen.getByTestId('chart-timeframe-trigger');
    expect(timeframe).toHaveTextContent('15м');
    expect(timeframe).toHaveAttribute('aria-label', 'Таймфрейм: 15м');

    const more = screen.getByTestId('chart-more-trigger');
    expect(more).toHaveAttribute('aria-label', 'Ещё: шаблоны, настройки, вписать данные');
    // Иконочный контрол — без микроскопического текста.
    expect((more.textContent ?? '').trim()).toBe('');

    // Индикаторы подпись не сокращается.
    expect(screen.getByTestId('chart-indicators-trigger')).toHaveTextContent('Индикаторы');
  });

  it('gives mobile triggers an explicit 36px tap height (min-h-* is capped by the global base rule)', () => {
    renderMobile();
    for (const qa of ['chart-timeframe-trigger', 'chart-type-trigger', 'chart-indicators-trigger', 'chart-more-trigger']) {
      expect(screen.getByTestId(qa).className).toMatch(/\bh-9\b/);
    }
    expect(screen.getByTestId('chart-more-trigger').className).toMatch(/\bw-9\b/);
  });

  it('drops the side rail and mounts ONE fullscreen control as an in-frame overlay', () => {
    renderMobile();

    expect(screen.queryByTestId('chart-side-rail')).toBeNull();
    // Перенос, а не вторая реализация: контрол существует ровно один.
    const controls = document.querySelectorAll('[data-qa="chart-fullscreen"]');
    expect(controls).toHaveLength(1);
    const control = controls[0] as HTMLElement;
    expect(control.getAttribute('data-variant')).toBe('overlay');
    expect(control).toHaveAttribute('title', 'Развернуть график');
    expect(control).toHaveAttribute('aria-label', 'Развернуть график');
    expect(control).toHaveAttribute('aria-pressed', 'false');
    expect(control.className).toMatch(/\bh-9\b/);
    expect(control.className).toMatch(/\bw-9\b/);
    // Он передан графику как слот, а не выделен отдельной колонкой layout.
    expect(document.querySelector('[data-qa="chart-terminal-toolbar"]')!.contains(control)).toBe(false);
  });

  it('asks the chart for compact labels on mobile and for the desktop format otherwise', () => {
    restore = mockViewport(true);
    const { unmount } = render(<ChartTerminal {...baseProps()} />);
    expect(screen.getByTestId('chart-engine-compact-labels')).toHaveTextContent('true');
    expect(screen.getByTestId('chart-engine-has-slot')).toHaveTextContent('true');
    unmount();
    restore();

    restore = mockViewport(false);
    render(<ChartTerminal {...baseProps()} />);
    expect(screen.getByTestId('chart-engine-compact-labels')).toHaveTextContent('false');
    expect(screen.getByTestId('chart-engine-has-slot')).toHaveTextContent('false');
    expect(screen.getByTestId('chart-side-rail')).toBeInTheDocument();
  });
});
