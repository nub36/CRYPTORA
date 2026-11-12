/**
 * Уровни графика — только серверные значения.
 *
 * Самый важный тест здесь: отсутствующий стоп НЕ подменяется ценой входа, а
 * отсутствующий безубыток не «выводится» из факта TP1 на телефоне.
 */
import { chartOverlayForLatestSignal, chartOverlayForSignal } from '../src/chartLevels';
import { makeSignal } from './support/fixtures';

describe('уровни графика из серверного сигнала', () => {
  it('коридор, SL и цели берутся ровно из ответа сервера', () => {
    const signal = makeSignal();
    const overlay = chartOverlayForSignal(signal);
    expect(overlay.zone).toEqual({ low: 61300.17, high: 61988.43 });
    expect(overlay.levels).toEqual([
      { key: 'sl', label: 'SL', price: 60901.53, tone: 'stop' },
      { key: 'tp1', label: 'TP1', price: 62450.21, tone: 'target' },
      { key: 'tp2', label: 'TP2', price: 63980.09, tone: 'target' },
    ]);
    expect(overlay.signalId).toBe(signal.id);
  });

  it('нет initialStopLoss — нет линии SL (цена входа не подставляется)', () => {
    const signal = makeSignal({ initialStopLoss: null });
    const overlay = chartOverlayForSignal(signal);
    expect(overlay.levels.find((l) => l.key === 'sl')).toBeUndefined();
    // Цена входа существует, но линией стопа она не становится.
    expect(overlay.levels.some((l) => l.price === signal.entry?.price)).toBe(false);
  });

  it('нет подтверждённого безубытка — нет линии BE', () => {
    const signal = makeSignal({
      progress: { tp1Hit: true, tp1HitAt: '2026-10-05T12:00:00.000Z' },
    });
    const overlay = chartOverlayForSignal(signal);
    expect(overlay.levels.find((l) => l.key === 'be')).toBeUndefined();
  });

  it('BE рисуется только по подтверждённому currentStop сервера', () => {
    const signal = makeSignal({
      progress: {
        breakevenArmed: true,
        breakevenArmedAt: '2026-10-05T12:00:00.000Z',
        currentStop: 61300.17,
        currentStopBasis: 'BE_AT_ENTRY',
      },
    });
    const be = chartOverlayForSignal(signal).levels.find((l) => l.key === 'be');
    expect(be).toEqual({ key: 'be', label: 'BE · действующий стоп', price: 61300.17, tone: 'be' });
  });

  it('без сигнала нет ни коридора, ни уровней', () => {
    expect(chartOverlayForSignal(null)).toEqual({ zone: null, levels: [], signalId: null });
    expect(chartOverlayForLatestSignal([])).toEqual({ zone: null, levels: [], signalId: null });
  });

  it('берётся самый свежий сигнал пары (сервер отдаёт новыми сверху)', () => {
    const newest = makeSignal({ id: 'NEW', initialStopLoss: 60000.5 });
    const older = makeSignal({ id: 'OLD', initialStopLoss: 59000.5 });
    const overlay = chartOverlayForLatestSignal([newest, older]);
    expect(overlay.signalId).toBe('NEW');
    expect(overlay.levels.find((l) => l.key === 'sl')?.price).toBe(60000.5);
  });

  it('нечисловые уровни не превращаются в линии', () => {
    const signal = makeSignal({ initialStopLoss: Number.NaN, targets: [] });
    const overlay = chartOverlayForSignal(signal);
    expect(overlay.levels).toEqual([]);
  });
});
