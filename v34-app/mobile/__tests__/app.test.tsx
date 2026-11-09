import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../App';
import { makeList, makeMeta, makeSignal } from './support/fixtures';

/**
 * Интеграционный тест корневого компонента: приложение берёт адрес сервера из
 * конфигурации сборки, рисует ленту и переключает вкладки. Сеть подменена —
 * реального сервера и реального Firebase в тестах нет.
 */
function installFetchMock() {
  const signal = makeSignal();
  const calls: string[] = [];
  const fetchMock = jest.fn(async (url: string) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes('/api/v1/signals/')) {
      return { ok: true, status: 200, json: async () => ({ signal }) } as unknown as Response;
    }
    if (u.includes('/api/v1/signals')) {
      return { ok: true, status: 200, json: async () => makeList([signal]) } as unknown as Response;
    }
    if (u.includes('/api/v1/meta')) {
      return { ok: true, status: 200, json: async () => makeMeta() } as unknown as Response;
    }
    if (u.includes('/api/v1/devices')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, registered: true, pushConfigured: false, note: null }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) } as unknown as Response;
  });
  const original = global.fetch;
  // @ts-expect-error — подмена глобального fetch только внутри теста
  global.fetch = fetchMock;
  return { calls, restore: () => { global.fetch = original; } };
}

describe('корневое приложение', () => {
  let restore: () => void;
  beforeEach(() => { restore = installFetchMock().restore; });
  afterEach(() => { restore(); jest.clearAllMocks(); });

  it('открывает ленту, деталь и вкладку «О приложении»', async () => {
    await render(<App />);
    await screen.findByTestId('list-ready');

    await fireEvent.press(screen.getByTestId(`signal-card-${makeSignal().id}`));
    await screen.findByTestId('detail-ready');
    expect(screen.getByText('Сигнал опубликован')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Назад к списку'));
    await screen.findByTestId('list-ready');

    await fireEvent.press(screen.getByTestId('tab-about'));
    await screen.findByTestId('about-ready');
    expect(screen.getByText('CRYPTORA · 3.4')).toBeTruthy();
    expect(screen.getByText(/Binance/)).toBeTruthy();
  });

  it('push-регистрация не ломает приложение и отражается на вкладке «О приложении»', async () => {
    await render(<App />);
    await screen.findByTestId('list-ready');
    await fireEvent.press(screen.getByTestId('tab-about'));
    await screen.findByTestId('about-ready');

    // Статус push определяется один раз при старте: «не проверялось» должно исчезнуть.
    await waitFor(() => {
      expect(screen.queryByText('не проверялось')).toBeNull();
    });
    // Сервер сказал, что push не настроен — интерфейс не должен утверждать обратное.
    expect(screen.getAllByText(/не настроен/).length).toBeGreaterThanOrEqual(1);
  });
});
