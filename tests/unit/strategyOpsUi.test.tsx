/**
 * CRYPTORA — Переключатель ВКЛ/ВЫКЛ и операционная панель на /strategies.
 *
 * Проверяется настоящий `StrategyOpsPanel`. Подменяется только `fetch`
 * (HTTP-слой) и роль в AuthContext — единственные две точки подмены в файле.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StrategyOpsPanel, formatTimestamp } from '@/components/strategies/StrategyOpsPanel';
import type { StrategyStateDto } from '@/services/strategyOps';

let role: 'admin' | 'user' = 'admin';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.c', role }, isAdmin: role === 'admin', loading: false }),
}));

const state = (over: Partial<StrategyStateDto> = {}): StrategyStateDto => ({
  strategyId: 'V3_3_HTF_ZONE_MITIGATION',
  version: '3.3',
  name: 'HTF Zone Mitigation & LTF Squeeze',
  nameRu: 'Митигация зоны',
  timeframes: ['1h', '4h'],
  execTimeframe: '1h',
  contextTimeframes: ['4h'],
  badge: 'Train only',
  enabled: false,
  status: 'OFF',
  scanIntervalSeconds: 60,
  symbols: null,
  lastScanAt: null,
  lastSignalAt: null,
  lastError: null,
  updatedAt: null,
  activeSignalCount: 0,
  ...over,
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  role = 'admin';
  cleanup();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Заглушка fetch: запоминает вызовы и отдаёт заданный ответ. */
function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as any;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Отображение состояния', () => {
  it('если скана не было — прочерк, а не выдуманное значение', () => {
    render(<StrategyOpsPanel state={state()} onChanged={vi.fn()} />);
    expect(screen.getByTestId('ops-lastscan-V3_3_HTF_ZONE_MITIGATION').textContent).toBe('—');
    expect(screen.getByTestId('ops-lastsignal-V3_3_HTF_ZONE_MITIGATION').textContent).toBe('—');
    expect(screen.getByTestId('ops-status-V3_3_HTF_ZONE_MITIGATION').textContent).toBe('Выключена');
  });

  it('formatTimestamp: null и мусор → прочерк', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp('not-a-date')).toBe('—');
    expect(formatTimestamp('2026-09-19T10:00:00Z')).not.toBe('—');
  });

  it('статусы Работает / Выключена / Ошибка', () => {
    const { rerender } = render(<StrategyOpsPanel state={state({ enabled: true, status: 'ON' })} onChanged={vi.fn()} />);
    expect(screen.getByTestId('ops-status-V3_3_HTF_ZONE_MITIGATION').textContent).toBe('Работает');

    rerender(
      <StrategyOpsPanel
        state={state({ enabled: true, status: 'ERROR', lastError: 'Market data unavailable' })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByTestId('ops-status-V3_3_HTF_ZONE_MITIGATION').textContent).toBe('Ошибка');
    expect(screen.getByTestId('ops-error-V3_3_HTF_ZONE_MITIGATION').textContent).toContain(
      'Market data unavailable',
    );
  });

  it('число активных сигналов показывается как пришло с сервера', () => {
    render(<StrategyOpsPanel state={state({ activeSignalCount: 3 })} onChanged={vi.fn()} />);
    expect(screen.getByTestId('ops-active-V3_3_HTF_ZONE_MITIGATION').textContent).toContain('3');
  });
});

describe('Права на переключение', () => {
  it('админу переключатель доступен', () => {
    role = 'admin';
    render(<StrategyOpsPanel state={state()} onChanged={vi.fn()} />);
    expect(screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION')).not.toBeDisabled();
  });

  it('обычному пользователю переключатель недоступен (только чтение)', () => {
    role = 'user';
    render(<StrategyOpsPanel state={state()} onChanged={vi.fn()} />);
    expect(screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION')).toBeDisabled();
    expect(screen.getByText(/Переключение доступно администратору/)).toBeTruthy();
  });

  it('клик пользователя не отправляет запрос', () => {
    role = 'user';
    const calls = mockFetch(async () => json({ enabled: true }));
    render(<StrategyOpsPanel state={state()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION'));
    expect(calls).toHaveLength(0);
  });
});

describe('Переключение через API', () => {
  it('админ включает стратегию: PATCH на сервер, состояние обновлено', async () => {
    const calls = mockFetch(async () => json({ strategyId: 'V3_3_HTF_ZONE_MITIGATION', enabled: true }));
    const onChanged = vi.fn();
    render(<StrategyOpsPanel state={state()} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toContain('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION');
    expect(calls[0]!.init!.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ enabled: true });

    // Оптимистично + подтверждение сервером.
    expect(onChanged).toHaveBeenCalledWith('V3_3_HTF_ZONE_MITIGATION', true);
  });

  it('при ошибке API значение ОТКАТЫВАЕТСЯ к серверному', async () => {
    mockFetch(async () => json({ message: 'Требуется авторизация' }, 401));
    const onChanged = vi.fn();
    render(<StrategyOpsPanel state={state({ enabled: false })} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION'));

    await waitFor(() =>
      expect(screen.getByTestId('ops-toggle-error-V3_3_HTF_ZONE_MITIGATION').textContent).toContain(
        'Требуется авторизация',
      ),
    );
    // Последний вызов — откат к false.
    const last = onChanged.mock.calls[onChanged.mock.calls.length - 1];
    expect(last).toEqual(['V3_3_HTF_ZONE_MITIGATION', false]);
  });

  it('выключение отправляет enabled=false', async () => {
    const calls = mockFetch(async () => json({ strategyId: 'V3_3_HTF_ZONE_MITIGATION', enabled: false }));
    render(<StrategyOpsPanel state={state({ enabled: true, status: 'ON' })} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ enabled: false });
  });

  it('переключатель — role=switch с корректным aria-checked', () => {
    render(<StrategyOpsPanel state={state({ enabled: true, status: 'ON' })} onChanged={vi.fn()} />);
    const sw = screen.getByTestId('ops-toggle-V3_3_HTF_ZONE_MITIGATION');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Отсутствие localStorage как источника истины', () => {
  it('панель не читает и не пишет localStorage', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    render(<StrategyOpsPanel state={state()} onChanged={vi.fn()} />);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
