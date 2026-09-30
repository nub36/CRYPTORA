/**
 * CRYPTORA — Admin → Тестирование стратегий: контракт компонента.
 *
 * Проверяются требования владельца (§21):
 *  • селектор стратегии (V3.0 / V3.3 / V3.4);
 *  • статус выбранной стратегии (V3.4 — «Выключена»);
 *  • подтверждение перед стартом периода (текст последствий, Отмена/Старт);
 *  • «Начать новый тестовый период» создаёт Run и НЕ включает стратегию;
 *  • история периодов (ACTIVE / COMPLETED, сигналы, «Run от …»).
 *
 * Сетевой слой подменяется инъекциями компонента: тестируется ПОВЕДЕНИЕ UI,
 * а не fetch. Реальные запросы к admin API покрывает
 * tests/integration/strategyTestRuns.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { StrategyTestRunsManager } from '@/components/admin/StrategyTestRunsManager';
import type {
  AdminStrategyTestRunsDto,
  StrategyStateDto,
  StrategyTestRunDto,
} from '@/services/strategyOps';

const qa = (id: string) => document.querySelector(`[data-qa="${id}"]`);
const text = (id: string) => qa(id)?.textContent ?? '';

function strategy(id: string, version: string, overrides: Partial<StrategyStateDto> = {}): StrategyStateDto {
  return {
    strategyId: id,
    version,
    name: `Strategy ${version}`,
    nameRu: '',
    timeframes: ['1h', '4h'],
    execTimeframe: '1h',
    contextTimeframes: ['4h'],
    badge: 'RESEARCH',
    enabled: false,
    status: 'OFF',
    scanIntervalSeconds: 60,
    symbols: null,
    lastScanAt: null,
    lastSignalAt: null,
    lastError: null,
    updatedAt: null,
    activeSignalCount: 0,
    ...overrides,
  };
}

function run(overrides: Partial<StrategyTestRunDto> = {}): StrategyTestRunDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    strategyVersion: '3.4',
    startedAt: '2026-09-30T14:30:00.000Z',
    endedAt: null,
    status: 'ACTIVE',
    signalCount: 0,
    ...overrides,
  };
}

function stateDto(overrides: Partial<AdminStrategyTestRunsDto> = {}): AdminStrategyTestRunsDto {
  return {
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    enabled: false,
    engineStatus: 'OFF',
    currentRun: null,
    runs: [],
    source: 'server',
    ...overrides,
  };
}

const STRATEGIES = [
  strategy('V3_0_HTF_LIQUIDATION_TRAP', '3.0', { enabled: true, status: 'ON' }),
  strategy('V3_3_HTF_ZONE_MITIGATION', '3.3'),
  strategy('V3_4_HTF_ZONE_MITIGATION_QUALITY', '3.4'),
];

function setup({
  strategies = STRATEGIES,
  state = stateDto(),
}: { strategies?: StrategyStateDto[]; state?: AdminStrategyTestRunsDto } = {}) {
  const fetchStrategiesList = vi.fn(async () => strategies);
  // enabled в ответе — серверная правда о ВЫБРАННОЙ стратегии (как в реальном API).
  const fetchState = vi.fn(async (id: string) => ({
    ...state,
    strategyId: id,
    enabled: strategies.find((s) => s.strategyId === id)?.enabled ?? state.enabled,
  }));
  const startRun = vi.fn(async (id: string) => ({
    strategyId: id,
    newRunId: '22222222-2222-4222-8222-222222222222',
    startedAt: '2026-09-30T15:00:00.000Z',
    previousRunId: null,
    message: 'Новый тестовый период начат.',
  }));
  const utils = render(
    <StrategyTestRunsManager
      fetchStrategiesList={fetchStrategiesList as never}
      fetchState={fetchState as never}
      startRun={startRun as never}
    />
  );
  return { utils, fetchStrategiesList, fetchState, startRun };
}

describe('StrategyTestRunsManager — раздел «Тестирование стратегий»', () => {
  it('показывает селектор стратегий из каталога', async () => {
    setup();
    const select = await waitFor(() => {
      const el = qa('test-runs-strategy-select') as HTMLSelectElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options).toContain('V3.0 — Strategy 3.0');
    expect(options).toContain('V3.3 — Strategy 3.3');
    expect(options).toContain('V3.4 — Strategy 3.4');
  });

  it('показывает статус стратегии: V3.4 — Выключена', async () => {
    setup();
    await waitFor(() => {
      expect(qa('test-runs-strategy-enabled')).toBeTruthy();
    });
    // По умолчанию выбрана первая стратегия каталога (V3.0, включена).
    expect(text('test-runs-strategy-enabled')).toBe('Включена');

    // Переключение на V3.4 — выключена.
    await act(async () => {
      fireEvent.change(qa('test-runs-strategy-select')!, { target: { value: 'V3_4_HTF_ZONE_MITIGATION_QUALITY' } });
    });
    await waitFor(() => {
      expect(text('test-runs-strategy-enabled')).toBe('Выключена');
    });
    expect(qa('test-runs-strategy-enabled')?.getAttribute('data-enabled')).toBe('false');
  });

  it('без периодов: текущий тест «Нет», история объясняет пустоту', async () => {
    setup();
    await waitFor(() => {
      expect(text('test-runs-current')).toBe('Нет');
    });
    expect(text('test-runs-current-started')).toBe('—');
    expect(text('test-runs-current-signals')).toBe('0');
    expect(qa('test-runs-history-empty')).toBeTruthy();
  });

  it('подсказка о сохранности данных видна', async () => {
    setup();
    await waitFor(() => {
      expect(qa('test-runs-hint')).toBeTruthy();
    });
    expect(text('test-runs-hint')).toContain('Предыдущие сигналы и результаты не удаляются');
    expect(text('test-runs-hint')).toContain('Статистика нового периода начнётся с нуля');
  });

  it('кнопка открывает подтверждение; Отмена не отправляет запрос', async () => {
    const { startRun } = setup();
    await waitFor(() => {
      expect(qa('test-runs-start')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(qa('test-runs-start')!);
    });
    expect(qa('test-runs-confirm')).toBeTruthy();
    expect(text('test-runs-confirm')).toContain('Начать новый тестовый период V3.0?');
    expect(text('test-runs-confirm')).toContain('Предыдущий период, если он существует, будет завершён');
    expect(text('test-runs-confirm')).toContain('Исторические сигналы НЕ удаляются');
    expect(text('test-runs-confirm')).toContain('Настройки стратегии НЕ изменяются');

    await act(async () => {
      fireEvent.click(qa('test-runs-confirm-cancel')!);
    });
    expect(qa('test-runs-confirm')).toBeFalsy();
    expect(startRun).not.toHaveBeenCalled();
  });

  it('подтверждение вызывает старт периода только с strategyId и обновляет состояние', async () => {
    const { startRun, fetchState } = setup();
    await waitFor(() => {
      expect(qa('test-runs-start')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(qa('test-runs-start')!);
    });
    await act(async () => {
      fireEvent.click(qa('test-runs-confirm-start')!);
    });

    await waitFor(() => {
      expect(startRun).toHaveBeenCalledTimes(1);
    });
    // Тело запроса — ТОЛЬКО strategyId: UI не назначает run id и не трогает enabled.
    expect(startRun).toHaveBeenCalledWith('V3_0_HTF_LIQUIDATION_TRAP');

    // Состояние перечитано после старта.
    await waitFor(() => {
      expect(fetchState.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(qa('test-runs-confirm')).toBeFalsy();
    expect(qa('test-runs-notice')?.textContent).toContain('Новый тестовый период начат');
  });

  it('после старта V3.4 остаётся Выключена (период не включает стратегию)', async () => {
    // Сценарий владельца: создан Run #1 у выключенной V3.4 — включать её будет
    // вручную ПОЗЖЕ. Компонент не имеет пути включения вовсе.
    const v34 = 'V3_4_HTF_ZONE_MITIGATION_QUALITY';
    const { startRun, fetchState } = setup();
    await waitFor(() => {
      expect(qa('test-runs-strategy-select')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.change(qa('test-runs-strategy-select')!, { target: { value: v34 } });
    });
    await waitFor(() => {
      expect(text('test-runs-strategy-enabled')).toBe('Выключена');
    });

    await act(async () => {
      fireEvent.click(qa('test-runs-start')!);
    });
    await act(async () => {
      fireEvent.click(qa('test-runs-confirm-start')!);
    });
    await waitFor(() => {
      expect(startRun).toHaveBeenCalledWith(v34);
    });
    await waitFor(() => {
      expect(fetchState.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    // Вторая загрузка состояния — та же выключенная V3.4.
    expect(text('test-runs-strategy-enabled')).toBe('Выключена');
    expect(qa('test-runs-strategy-enabled')?.getAttribute('data-enabled')).toBe('false');
  });

  it('история периодов: текущий и завершённый со счётчиком сигналов', async () => {
    const completed = run({
      id: '33333333-3333-4333-8333-333333333333',
      startedAt: '2026-09-28T10:00:00.000Z',
      endedAt: '2026-09-30T14:30:00.000Z',
      status: 'COMPLETED',
      signalCount: 12,
    });
    const active = run({ signalCount: 3 });
    setup({ state: stateDto({ currentRun: active, runs: [active, completed] }) });

    await waitFor(() => {
      expect(qa('test-runs-run-0')).toBeTruthy();
    });
    expect(text('test-runs-run-0')).toContain('Run от ');
    expect(text('test-runs-run-status-0')).toBe('ACTIVE');
    expect(text('test-runs-run-status-1')).toBe('COMPLETED');
    expect(text('test-runs-current')).toContain('Run от ');
    expect(text('test-runs-current-signals')).toBe('3');
    // Сигналы завершённого периода видны в истории.
    expect(qa('test-runs-run-1')?.textContent).toContain('12');
  });
});
