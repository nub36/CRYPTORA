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
    expect(screen.getByLabelText('Полный экран')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^5m$/ })).not.toBeInTheDocument();
  });
});
