import { fireEvent, render, screen } from '@testing-library/react-native';
import { SignalDetailScreen } from '../src/screens/SignalDetailScreen';
import { formatPrice, formatUtc } from '../src/format';
import { failingApi, makeFakeApi, makeSignal } from './support/fixtures';

describe('экран детали сигнала', () => {
  it('показывает уровни, статус и журнал событий с сервера', async () => {
    const signal = makeSignal();
    const { api, calls } = makeFakeApi({ detail: signal });
    await render(<SignalDetailScreen api={api} signalId={signal.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');

    expect(calls.detail).toEqual([signal.id]);
    expect(screen.getByText('BTC/USDT')).toBeTruthy();
    expect(screen.getByText(`${formatPrice(signal.entryZone!.low)} – ${formatPrice(signal.entryZone!.high)}`)).toBeTruthy();
    expect(screen.getByText(formatPrice(signal.initialStopLoss!))).toBeTruthy();
    expect(screen.getByText('Сигнал опубликован')).toBeTruthy();
    expect(screen.getAllByText(formatUtc('2026-10-05T11:02:00.000Z')).length).toBeGreaterThanOrEqual(1);
  });

  it('не подставляет цену входа вместо отсутствующего стопа', async () => {
    const signal = makeSignal({
      initialStopLoss: null,
      targets: [],
      entry: { price: 61300.17, at: '2026-10-05T11:02:00.000Z' },
    });
    const { api } = makeFakeApi({ detail: signal });
    await render(<SignalDetailScreen api={api} signalId={signal.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');

    expect(screen.getAllByText('нет данных').length).toBeGreaterThanOrEqual(2);
    // Цена входа сама по себе не выдаётся за стоп/цель.
    expect(screen.queryByText(formatPrice(61300.17))).toBeNull();
  });

  it('без подтверждённого входа прямо говорит, что входа не было', async () => {
    const signal = makeSignal({ status: 'ACTIVE', entry: null });
    const { api } = makeFakeApi({ detail: signal });
    await render(<SignalDetailScreen api={api} signalId={signal.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');
    expect(screen.getByText('входа ещё не было')).toBeTruthy();
  });

  it('прогресс TP1/TP2/безубыток показывается только по подтверждённым событиям', async () => {
    const confirmed = makeSignal({
      progress: {
        ...makeSignal().progress,
        tp1Hit: true,
        tp1HitAt: '2026-10-05T12:30:00.000Z',
        breakevenArmed: true,
        breakevenArmedAt: '2026-10-05T13:00:00.000Z',
        currentStop: 61300.17,
        currentStopBasis: 'BE_AT_ENTRY',
      },
    });
    const { api } = makeFakeApi({ detail: confirmed });
    const { unmount } = await render(<SignalDetailScreen api={api} signalId={confirmed.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');
    expect(screen.getByText(`✓ ${formatUtc('2026-10-05T12:30:00.000Z')}`)).toBeTruthy();
    expect(screen.getByText(`${formatPrice(61300.17)} (безубыток)`)).toBeTruthy();
    expect(screen.getByText(/это правило стратегии/)).toBeTruthy();
    await unmount();

    const pending = makeSignal();
    const second = makeFakeApi({ detail: pending });
    await render(<SignalDetailScreen api={second.api} signalId={pending.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');
    expect(screen.queryByText(/^✓/)).toBeNull();
    expect(screen.getAllByText('не подтверждено').length).toBeGreaterThanOrEqual(3);
  });

  it('закрытая TP1_THEN_BE: безубыток — история, а не действующий стоп', async () => {
    const closed = makeSignal({
      status: 'CLOSED',
      closedAt: '2026-10-05T18:00:00.000Z',
      outcome: {
        status: 'CLOSED',
        exitReason: 'TP1_THEN_BE',
        exitPrice: 61300.17,
        resultR: 0,
        netResultR: -0.02,
        pnlResultPct: -0.02,
        barsHeld: 7,
      },
      progress: {
        ...makeSignal().progress,
        tp1Hit: true,
        tp1HitAt: '2026-10-05T12:30:00.000Z',
        // Сервер прислал только факт «безубыток был»: действующего стопа нет.
        breakevenArmed: false,
        breakevenArmedAt: null,
        breakevenOccurred: true,
        breakevenOccurredAt: '2026-10-05T13:00:00.000Z',
        currentStop: null,
        currentStopBasis: null,
      },
    });
    const { api } = makeFakeApi({ detail: closed });
    await render(<SignalDetailScreen api={api} signalId={closed.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');

    // Событие безубытка видно как история.
    expect(screen.getByText(`✓ ${formatUtc('2026-10-05T13:00:00.000Z')}`)).toBeTruthy();
    expect(screen.getByText(/это история события, а не текущий уровень стопа/)).toBeTruthy();
    // Придуманного уровня нет: цена входа не выдаётся за действующий стоп.
    expect(screen.queryByText(`${formatPrice(61300.17)} (безубыток)`)).toBeNull();
    expect(screen.getByText('не действует — сделка закрыта')).toBeTruthy();
  });

  it('исход сделки показывается только когда сервер его прислал', async () => {
    const closed = makeSignal({
      status: 'TARGET_REACHED',
      closedAt: '2026-10-05T18:00:00.000Z',
      outcome: {
        status: 'TARGET_REACHED',
        exitReason: 'TP2',
        exitPrice: 63980.09,
        resultR: 2.1,
        netResultR: 2.03,
        pnlResultPct: 4.37,
        barsHeld: 7,
      },
    });
    const { api } = makeFakeApi({ detail: closed });
    await render(<SignalDetailScreen api={api} signalId={closed.id} onBack={jest.fn()} />);
    await screen.findByTestId('detail-ready');
    expect(screen.getByText('Исход сделки')).toBeTruthy();
    expect(screen.getByText('+2.1 R')).toBeTruthy();
    expect(screen.getByText('+4.37 %')).toBeTruthy();
  });

  it('ошибка загрузки не маскируется данными из списка и повторяется по кнопке', async () => {
    let attempts = 0;
    const failing = failingApi('http').api;
    const api = {
      ...failing,
      async getSignal(id: string) {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('сервер недоступен'), { kind: 'network' });
        return makeSignal({ id });
      },
    };
    await render(<SignalDetailScreen api={api} signalId="SIG-1" onBack={jest.fn()} />);
    await screen.findByTestId('detail-error');
    expect(screen.getByText(/сервер недоступен/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Повторить'));
    await screen.findByTestId('detail-ready');
    expect(attempts).toBe(2);
  });

  it('кнопка «Назад» возвращает к списку', async () => {
    const signal = makeSignal();
    const { api } = makeFakeApi({ detail: signal });
    const onBack = jest.fn();
    await render(<SignalDetailScreen api={api} signalId={signal.id} onBack={onBack} />);
    await screen.findByTestId('detail-ready');
    await fireEvent.press(screen.getByLabelText('Назад к списку'));
    expect(onBack).toHaveBeenCalled();
  });
});
