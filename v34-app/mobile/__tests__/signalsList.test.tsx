import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SignalsListResponse } from '../src/api/types';
import { SignalsListScreen } from '../src/screens/SignalsListScreen';
import { failingApi, makeFakeApi, makeList, makeSignal } from './support/fixtures';

describe('экран списка сигналов', () => {
  it('показывает загрузку, затем карточки с серверными уровнями', async () => {
    const signal = makeSignal();
    let release: (value: SignalsListResponse) => void = () => {};
    const pending = new Promise<SignalsListResponse>((resolve) => { release = resolve; });
    const { api, calls } = makeFakeApi({ signals: () => pending });
    await render(<SignalsListScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    expect(screen.getByTestId('list-loading')).toBeTruthy();
    await act(async () => { release(makeList([signal])); });
    await screen.findByTestId('list-ready');
    expect(screen.getByText('BTC/USDT')).toBeTruthy();
    expect(screen.getByText('В позиции')).toBeTruthy();
    // Первый запрос — только открытые сигналы, лимит 50.
    expect(calls.list[0]).toEqual({ limit: 50, status: ['ACTIVE', 'FILLED'] });
  });

  it('пустой список — это «нет сетапов», а не ошибка', async () => {
    const { api } = makeFakeApi({ signals: [] });
    await render(<SignalsListScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);
    await screen.findByTestId('list-empty');
    expect(screen.getByText('Сигналов пока нет')).toBeTruthy();
    expect(screen.getByText(/Сервер проверил рынок/)).toBeTruthy();
  });

  it('сетевая ошибка отличается от пустого списка и позволяет повторить', async () => {
    let attempts = 0;
    const failing = failingApi('network').api;
    const api = {
      ...failing,
      async getSignals() {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('нет связи с сервером сигналов'), { kind: 'network' });
        return makeList([makeSignal()]);
      },
    };
    await render(<SignalsListScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);
    await screen.findByTestId('list-error');
    expect(screen.getByText(/нет связи с сервером сигналов/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Повторить'));
    await screen.findByTestId('list-ready');
    expect(attempts).toBe(2);
  });

  it('устаревшие данные помечаются предупреждением, а не выдаются за свежие', async () => {
    const { api } = makeFakeApi({
      signals: makeList([makeSignal()], { stale: true, staleReason: 'последний успешный скан был 12 минут назад' }),
    });
    await render(<SignalsListScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);
    await screen.findByTestId('list-ready');
    expect(screen.getByText('Данные могут быть устаревшими')).toBeTruthy();
    expect(screen.getByText(/12 минут назад/)).toBeTruthy();
  });

  it('нажатие на карточку передаёт id сигнала наверх', async () => {
    const signal = makeSignal({ id: 'SIG-42' });
    const onOpen = jest.fn();
    const { api } = makeFakeApi({ signals: [signal] });
    await render(<SignalsListScreen api={api} onOpenSignal={onOpen} pollMs={0} />);
    await screen.findByTestId('list-ready');
    await fireEvent.press(screen.getByTestId('signal-card-SIG-42'));
    expect(onOpen).toHaveBeenCalledWith('SIG-42');
  });

  it('фильтр «Все» запрашивает ленту без ограничения по статусу', async () => {
    const { api, calls } = makeFakeApi({ signals: [makeSignal()] });
    await render(<SignalsListScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);
    await screen.findByTestId('list-ready');
    await fireEvent.press(screen.getByText('Все'));
    await waitFor(() => expect(calls.list.length).toBeGreaterThanOrEqual(2));
    expect(calls.list[calls.list.length - 1]).toEqual({ limit: 50 });
  });
});
