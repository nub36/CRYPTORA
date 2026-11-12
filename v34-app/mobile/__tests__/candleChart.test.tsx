/**
 * Компонент графика: рисует ровно присланные свечи и ровно серверные уровни.
 */
import { render, screen } from '@testing-library/react-native';
import { CandleChart } from '../src/components/CandleChart';
import { chartOverlayForSignal } from '../src/chartLevels';
import { makeCandles, makeSignal } from './support/fixtures';

describe('CandleChart', () => {
  it('рисует все свечи серии и подписывает диапазон цен', async () => {
    const series = makeCandles();
    await render(<CandleChart candles={series.candles} testID="chart" />);

    expect(screen.getByTestId('chart')).toBeTruthy();
    expect(screen.getByTestId('chart-candle-0')).toBeTruthy();
    expect(screen.getByTestId(`chart-candle-${series.candles.length - 1}`)).toBeTruthy();
    expect(screen.queryByTestId(`chart-candle-${series.candles.length}`)).toBeNull();
    expect(screen.getByTestId('chart-axis-max')).toBeTruthy();
    expect(screen.getByTestId('chart-axis-min')).toBeTruthy();
  });

  it('показывает уровни серверного сигнала и коридор входа', async () => {
    const overlay = chartOverlayForSignal(makeSignal());
    await render(<CandleChart candles={makeCandles().candles} overlay={overlay} testID="chart" />);

    expect(screen.getByTestId('chart-zone')).toBeTruthy();
    for (const key of ['sl', 'tp1', 'tp2']) {
      expect(screen.getByTestId(`chart-level-${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('chart-level-label-sl').props.children).toContain('SL');
    expect(screen.getByTestId('chart-level-label-tp2').props.children).toContain('TP2');
  });

  it('без уровней не рисует ни линий, ни коридора', async () => {
    await render(<CandleChart candles={makeCandles().candles} testID="chart" />);
    expect(screen.queryByTestId('chart-zone')).toBeNull();
    expect(screen.queryByTestId('chart-level-sl')).toBeNull();
  });

  it('пустая серия — честное сообщение, а не пустая сетка', async () => {
    await render(<CandleChart candles={[]} testID="chart" />);
    expect(screen.getByTestId('chart-empty')).toBeTruthy();
    expect(screen.getByText('Свечи с сервера не получены')).toBeTruthy();
  });
});
