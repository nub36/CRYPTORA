/**
 * Экран «Пары»: пары конфигурации V3.4, график выбранной пары и её сигналы.
 *
 * Проверяется то, за что приложение отвечает перед пользователем:
 *   • пары приходят с сервера, а не из локального списка;
 *   • смена пары перезапрашивает и график, и сигналы именно этой пары;
 *   • ошибка сервера видна как ошибка, а не как «пусто» и не как «примерные»
 *     данные;
 *   • уровни на графике — только серверные (нет SL/BE — нет линий).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '../src/api/client';
import { MarketScreen } from '../src/screens/MarketScreen';
import {
  failingApi, makeCandles, makeFakeApi, makeMeta, makeSignal,
} from './support/fixtures';

const THREE_PAIRS = [
  { symbol: 'BTC/USDT', exchangeSymbol: 'BTCUSDT' },
  { symbol: 'ETH/USDT', exchangeSymbol: 'ETHUSDT' },
  { symbol: 'SOL/USDT', exchangeSymbol: 'SOLUSDT' },
];

function metaWithPairs(pairs = THREE_PAIRS) {
  return makeMeta({
    universe: {
      symbols: pairs.map((p) => p.exchangeSymbol),
      defaultSymbols: pairs.map((p) => p.exchangeSymbol),
      quote: 'USDT',
      pairs,
    },
  });
}

describe('экран «Пары»', () => {
  it('показывает пары из конфигурации сервера, график и сигналы выбранной пары', async () => {
    const { api, calls } = makeFakeApi({
      meta: metaWithPairs(),
      signals: [makeSignal()],
      candles: makeCandles(),
    });

    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('market-flatlist');
    expect(screen.getByText('Пары V3.4')).toBeTruthy();
    expect(screen.getByText(/Каноническая конфигурация · 3 пар/)).toBeTruthy();
    for (const pair of THREE_PAIRS) {
      expect(screen.getByTestId(`pair-chip-${pair.exchangeSymbol}`)).toBeTruthy();
    }
    expect(screen.getByTestId('chart-pair').props.children).toBe('BTC/USDT');

    // График и сигналы запрошены для первой пары — и только через backend.
    expect(calls.candles[0]).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 120 });
    expect(calls.list[0]).toEqual({ limit: 50, symbol: 'BTCUSDT' });
    expect(await screen.findByTestId('market-candles')).toBeTruthy();
    expect(screen.getByTestId(`signal-card-${makeSignal().id}`)).toBeTruthy();
  });

  it('смена пары перезапрашивает график и сигналы именно этой пары', async () => {
    const { api, calls } = makeFakeApi({
      meta: metaWithPairs(),
      signals: [makeSignal()],
      candles: makeCandles(),
    });
    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);
    await screen.findByTestId('market-flatlist');

    await fireEvent.press(screen.getByTestId('pair-chip-ETHUSDT'));

    await waitFor(() => {
      expect(calls.candles.at(-1)).toEqual({ symbol: 'ETHUSDT', interval: '1h', limit: 120 });
      expect(calls.list.at(-1)).toEqual({ limit: 50, symbol: 'ETHUSDT' });
    });
    expect(screen.getByTestId('chart-pair').props.children).toBe('ETH/USDT');
  });

  it('сервер недоступен — честная ошибка без пар, графика и сигналов', async () => {
    const { api } = failingApi('network');
    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('market-error');
    expect(screen.getByText('Сервер недоступен')).toBeTruthy();
    expect(screen.getByText(/нет связи с сервером сигналов/)).toBeTruthy();
    expect(screen.getByText(/backend CRYPTORA V3.4/)).toBeTruthy();
    // Ни одной «примерной» пары, ни пустого графика.
    expect(screen.queryByTestId('pair-selector')).toBeNull();
    expect(screen.queryByTestId('market-candles')).toBeNull();
    expect(screen.queryByTestId('signals-empty')).toBeNull();
  });

  it('ошибка графика не скрывает сигналы, полученные с сервера', async () => {
    const { api } = makeFakeApi({
      meta: metaWithPairs(),
      signals: [makeSignal()],
      candles: () => Promise.reject(new ApiError('http', 'биржа не отдала свечи', 502)),
    });

    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('chart-error');
    expect(screen.getByText('График недоступен')).toBeTruthy();
    expect(screen.getByText(/биржа не отдала свечи/)).toBeTruthy();
    expect(screen.getByText(/не дорисовываются на телефоне/)).toBeTruthy();
    // Сигналы — отдельный запрос: они остаются на экране.
    expect(screen.getByTestId(`signal-card-${makeSignal().id}`)).toBeTruthy();
    // И никакого «сглаженного» графика из прошлых данных.
    expect(screen.queryByTestId('market-candles')).toBeNull();
  });

  it('сигналов нет — экран говорит об этом и не рисует уровни', async () => {
    const { api } = makeFakeApi({ meta: metaWithPairs(), signals: [], candles: makeCandles() });
    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('signals-empty');
    expect(screen.getByText('Сигналов по паре нет')).toBeTruthy();
    expect(screen.getByText(/Сервер проверил рынок/)).toBeTruthy();
    expect(screen.queryByTestId('market-candles-level-sl')).toBeNull();
    expect(screen.queryByTestId('market-candles-level-tp1')).toBeNull();
    expect(screen.getByText(/серверных уровней по паре нет/)).toBeTruthy();
  });

  it('уровни графика — серверные SL/TP; без SL и BE линий нет', async () => {
    const noStop = makeSignal({ initialStopLoss: null, targets: [{ level: 1, price: 62450.21 }] });
    const { api } = makeFakeApi({ meta: metaWithPairs(), signals: [noStop], candles: makeCandles() });
    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('market-candles');
    expect(screen.queryByTestId('market-candles-level-sl')).toBeNull();
    expect(screen.queryByTestId('market-candles-level-be')).toBeNull();
    expect(screen.getByTestId('market-candles-level-tp1')).toBeTruthy();
    // Легенда перечисляет только реально показанные уровни.
    expect(screen.getByTestId('chart-legend').props.children).toContain('TP1');
    expect(screen.getByTestId('chart-legend').props.children).not.toContain('SL');
  });

  it('подтверждённый безубыток показывается линией BE', async () => {
    const be = makeSignal({
      progress: { breakevenArmed: true, currentStop: 61300.17, currentStopBasis: 'BE_AT_ENTRY' },
    });
    const { api } = makeFakeApi({ meta: metaWithPairs(), signals: [be], candles: makeCandles() });
    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('market-candles');
    expect(screen.getByTestId('market-candles-level-be')).toBeTruthy();
    expect(screen.getByTestId('market-candles-level-label-be').props.children).toContain('BE');
  });

  it('ошибка сигналов не выдаётся за пустой список', async () => {
    const { api } = makeFakeApi({ meta: metaWithPairs(), candles: makeCandles() });
    const apiWithFailure = {
      ...api,
      async getSignals() {
        throw new ApiError('network', 'нет связи с сервером сигналов');
      },
    };
    await render(<MarketScreen api={apiWithFailure} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('signals-error');
    expect(screen.getByText('Сигналы недоступны')).toBeTruthy();
    expect(screen.queryByTestId('signals-empty')).toBeNull();
    // График при этом продолжает показывать серверные свечи.
    expect(screen.getByTestId('market-candles')).toBeTruthy();
  });

  it('устаревшие свечи помечаются предупреждением', async () => {
    const { api } = makeFakeApi({
      meta: metaWithPairs(),
      signals: [makeSignal()],
      candles: makeCandles({ stale: true, staleReason: 'последний скан был 9 минут назад' }),
    });
    await render(<MarketScreen api={api} onOpenSignal={jest.fn()} pollMs={0} />);

    await screen.findByTestId('market-candles');
    expect(screen.getByText('Данные могут быть устаревшими')).toBeTruthy();
    expect(screen.getByText(/9 минут назад/)).toBeTruthy();
  });

  it('нажатие на карточку сигнала открывает деталь', async () => {
    const signal = makeSignal({ id: 'SIG-MARKET-1' });
    const onOpen = jest.fn();
    const { api } = makeFakeApi({ meta: metaWithPairs(), signals: [signal], candles: makeCandles() });
    await render(<MarketScreen api={api} onOpenSignal={onOpen} pollMs={0} />);

    await screen.findByTestId('signal-card-SIG-MARKET-1');
    await fireEvent.press(screen.getByTestId('signal-card-SIG-MARKET-1'));
    expect(onOpen).toHaveBeenCalledWith('SIG-MARKET-1');
  });
});
