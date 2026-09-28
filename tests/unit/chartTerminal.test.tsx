import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartTerminal, formatTerminalTimeframe } from '@/components/common/ChartTerminal';
import type { ChartTerminalProps } from '@/components/common/ChartTerminal';

vi.mock('@/components/common/CandleChart', () => ({
  CandleChart: (props: Record<string, unknown>) => (
    <div data-testid="chart-engine">
      <span>{String(props.symbol)}</span>
      <span data-testid="chart-engine-timeframe">{String(props.timeframe)}</span>
      <span data-testid="chart-engine-type">{String(props.chartType)}</span>
      <span data-testid="chart-engine-volume">{String(props.showVolume)}</span>
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
    expect(screen.getByRole('menu', { name: '15м' })).toBeInTheDocument();
    expect(screen.getByTestId('chart-timeframe-1h')).toHaveTextContent('1ч');

    fireEvent.click(screen.getByTestId('chart-timeframe-1h'));
    expect(props.onTimeframeChange).toHaveBeenCalledWith('1h');
    expect(screen.queryByRole('menu', { name: '15м' })).not.toBeInTheDocument();

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

    fireEvent.click(screen.getByTestId('chart-templates-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Momentum/ }));
    expect(props.onShowMACDChange).toHaveBeenCalledWith(true);
    expect(props.onShowVolumeChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('chart-settings-trigger'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Объём/ }));
    expect(props.onShowVolumeChange).toHaveBeenCalledWith(false);
  });

  it('renders Russian terminal labels and does not duplicate the old timeframe strip', () => {
    render(<ChartTerminal {...baseProps()} />);
    expect(screen.getByText('Тип графика')).toBeInTheDocument();
    expect(screen.getByText('Индикаторы')).toBeInTheDocument();
    expect(screen.getByText('Шаблоны')).toBeInTheDocument();
    expect(screen.getByText('Настройки')).toBeInTheDocument();
    expect(screen.getByLabelText('Развернуть график')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^5m$/ })).not.toBeInTheDocument();
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
    // «Вписать» остаётся в верхнем toolbar.
    expect(toolbar!.querySelector('[data-qa="chart-reset-view"]')).not.toBeNull();
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
