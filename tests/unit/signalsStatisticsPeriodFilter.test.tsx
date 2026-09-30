/**
 * CRYPTORA — Фильтры статистики сигналов: стратегия и тестовый период.
 *
 * Требования владельца (§10–§12, §21):
 *  • селектор стратегии: «Все стратегии» + версии каталога;
 *  • селектор периода: «Все данные» / «До тестовых периодов» / «Текущий
 *    тестовый период» / предыдущие Run;
 *  • выбранный период — это test_run_id на сервере (фильтр по ЧЛЕНСТВУ,
 *    не по датам): только что начатый период показывает честные нули;
 *  • нулевой знаменатель → «—», а не NaN и не fake 0%;
 *  • «Все данные» по-прежнему показывает историческую статистику.
 *
 * Сетевой слой подменяется инъекциями компонента (fetchStats /
 * fetchStrategiesList / fetchTestRuns): реальные SQL-агрегаты и фильтр по
 * test_run_id проверяет tests/integration/strategyTestRuns.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { SignalStatisticsPanel } from '@/components/signals/SignalStatisticsPanel';
import type {
  SignalStatisticsAggregateDto,
  SignalStatisticsDto,
  StrategyStateDto,
  StrategyTestRunDto,
} from '@/services/strategyOps';

const qa = (id: string) => document.querySelector(`[data-qa="${id}"]`);
const text = (id: string) => qa(id)?.textContent ?? '';

function totals(overrides: Partial<SignalStatisticsAggregateDto> = {}): SignalStatisticsAggregateDto {
  return {
    published: 0,
    waitingEntry: 0,
    filled: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    unresolved: 0,
    targetReached: 0,
    invalidated: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    breakEven: 0,
    unrated: 0,
    unratedCompleted: 0,
    ratedCompleted: 0,
    winRatePct: null,
    avgGrossR: null,
    avgNetR: null,
    grossRSum: null,
    netRSum: null,
    fillRatePct: null,
    completionRatePct: null,
    ...overrides,
  };
}

function dto(t: SignalStatisticsAggregateDto, filters: { strategyId?: string; testRunId?: string } = {}): SignalStatisticsDto {
  return {
    period: 'all',
    filters: { strategyId: filters.strategyId ?? null, symbol: null, testRunId: filters.testRunId ?? null },
    statuses: [],
    openStatuses: [],
    tradeClosedStatuses: [],
    noTradeStatuses: [],
    closedStatuses: [],
    totals: t,
    byStrategy: [],
    bySymbol: [],
    definitions: { winRatePct: 'доля успешных', avgGrossR: 'gross', avgNetR: 'net' },
    source: 'server',
  };
}

const V3_0 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V3_4 = 'V3_4_HTF_ZONE_MITIGATION_QUALITY';

function strategyDto(id: string, version: string): StrategyStateDto {
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
  };
}

function runDto(overrides: Partial<StrategyTestRunDto> = {}): StrategyTestRunDto {
  return {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    strategyId: V3_4,
    strategyVersion: '3.4',
    startedAt: '2026-09-30T14:30:00.000Z',
    endedAt: null,
    status: 'ACTIVE',
    signalCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

interface SetupOpts {
  strategies?: StrategyStateDto[];
  runs?: StrategyTestRunDto[];
}

async function setup({ strategies = [strategyDto(V3_0, '3.0'), strategyDto(V3_4, '3.4')], runs = [] }: SetupOpts = {}) {
  const fetchStats = vi.fn(async (filters: { strategyId?: string; testRunId?: string }) =>
    dto(totals({ published: 180 }), filters)
  );
  const fetchStrategiesList = vi.fn(async () => strategies);
  const fetchTestRuns = vi.fn(async () => ({ strategyId: V3_4, runs, statuses: ['ACTIVE', 'COMPLETED'], source: 'server' }));

  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <SignalStatisticsPanel
        fetchStats={fetchStats as never}
        fetchStrategiesList={fetchStrategiesList as never}
        fetchTestRuns={fetchTestRuns as never}
        pollMs={0}
      />
    );
  });
  return { utils, fetchStats, fetchStrategiesList, fetchTestRuns };
}

async function selectStrategy(value: string) {
  await act(async () => {
    fireEvent.change(qa('signals-stat-strategy-select')!, { target: { value } });
  });
}

async function selectPeriod(value: string) {
  await act(async () => {
    fireEvent.change(qa('signals-stat-period-select')!, { target: { value } });
  });
}

function periodOptions(): string[] {
  return [...(qa('signals-stat-period-select') as HTMLSelectElement).querySelectorAll('option')].map(
    (o) => o.textContent ?? ''
  );
}

describe('Панель статистики — фильтры «Стратегия» и «Период»', () => {
  it('селекторы присутствуют: «Все стратегии» + версии каталога, период по умолчанию «Все данные»', async () => {
    await setup();
    expect(await waitFor(() => qa('signals-stat-strategy-select'))).toBeTruthy();
    expect(await waitFor(() => qa('signals-stat-period-select'))).toBeTruthy();

    const strategyOptions = [
      ...(qa('signals-stat-strategy-select') as HTMLSelectElement).querySelectorAll('option'),
    ].map((o) => o.textContent ?? '');
    expect(strategyOptions).toEqual(['Все стратегии', 'V3.0', 'V3.4']);

    expect((qa('signals-stat-period-select') as HTMLSelectElement).value).toBe('all');
    expect(periodOptions()).toContain('Все данные');
    expect(periodOptions()).toContain('До тестовых периодов');
    // Без выбранной стратегии периодов в списке нет: Run существует только в
    // рамках одной стратегии.
    expect(periodOptions().some((o) => o.includes('Текущий тестовый период'))).toBe(false);
  });

  it('первая загрузка — без фильтров: историческая статистика «Все данные»', async () => {
    const { fetchStats } = await setup();
    await waitFor(() => {
      expect(text('stat-published')).toBe('180');
    });
    expect(fetchStats).toHaveBeenCalledWith({});
  });

  it('выбор стратегии передаёт strategyId на сервер', async () => {
    const { fetchStats } = await setup();
    await waitFor(() => expect(qa('signals-stat-strategy-select')).toBeTruthy());
    await selectStrategy(V3_4);
    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ strategyId: V3_4 });
    });
  });

  it('у выбранной стратегии с ACTIVE Run появляется «Текущий тестовый период» и предыдущие Run', async () => {
    const previousRun = runDto({
      id: 'bbbbbbbb-2222-4222-8222-222222222222',
      startedAt: '2026-09-20T10:00:00.000Z',
      endedAt: '2026-09-30T14:30:00.000Z',
      status: 'COMPLETED',
      signalCount: 9,
    });
    const activeRun = runDto();
    await setup({ runs: [activeRun, previousRun] });

    await waitFor(() => expect(qa('signals-stat-strategy-select')).toBeTruthy());
    await selectStrategy(V3_4);
    await waitFor(() => {
      const options = periodOptions();
      expect(options.some((o) => o.includes('Текущий тестовый период'))).toBe(true);
      expect(options.some((o) => o.includes('20.09.2026'))).toBe(true);
    });
  });

  it('выбор текущего периода фильтрует по test_run_id и показывает нулевое состояние «—»/0', async () => {
    const activeRun = runDto();
    const { fetchStats } = await setup({
      runs: [activeRun],
      strategies: [strategyDto(V3_4, '3.4')],
    });

    // Нулевой ответ для нового периода — как реальный сервер для пустого Run.
    fetchStats.mockImplementation(async (filters: { testRunId?: string }) =>
      dto(totals(), { strategyId: V3_4, testRunId: filters.testRunId })
    );

    await waitFor(() => expect(qa('signals-stat-strategy-select')).toBeTruthy());
    await selectStrategy(V3_4);
    await selectPeriod(activeRun.id);

    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ strategyId: V3_4, testRunId: activeRun.id });
    });
    await waitFor(() => {
      expect(text('stat-published')).toBe('0');
    });
    // Нулевой знаменатель → «—», а не NaN и не 0%.
    expect(text('stat-winrate')).toBe('—');
    expect(text('stat-avg')).toBe('—');
    expect(text('stat-completed')).toBe('0');
    expect(text('stat-no-trade')).toBe('0');
    // Подсказка объясняет, почему нули — период пуст, а не данные пропали.
    expect(document.querySelector('[data-qa="signals-statistics"]')?.textContent).toContain(
      'В выбранном периоде ещё нет сигналов'
    );
  });

  it('«До тестовых периодов» передаёт testRunId=none (только исторические строки)', async () => {
    const { fetchStats } = await setup();
    await waitFor(() => expect(qa('signals-stat-period-select')).toBeTruthy());
    await selectPeriod('none');
    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ testRunId: 'none' });
    });
  });

  it('смена стратегии сбрасывает период на «Все данные»', async () => {
    const activeRun = runDto();
    const { fetchStats } = await setup({ runs: [activeRun] });

    await waitFor(() => expect(qa('signals-stat-strategy-select')).toBeTruthy());
    await selectStrategy(V3_4);
    await selectPeriod(activeRun.id);
    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ strategyId: V3_4, testRunId: activeRun.id });
    });

    // Смена стратегии → период сброшен: периоды привязаны к стратегии.
    await selectStrategy(V3_0);
    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ strategyId: V3_0 });
    });
    expect((qa('signals-stat-period-select') as HTMLSelectElement).value).toBe('all');
  });

  it('«Все данные» после выбора периода по-прежнему показывает историческую статистику', async () => {
    const activeRun = runDto();
    const { fetchStats } = await setup({ runs: [activeRun] });

    await waitFor(() => expect(qa('signals-stat-strategy-select')).toBeTruthy());
    await selectStrategy(V3_4);
    await selectPeriod(activeRun.id);
    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ strategyId: V3_4, testRunId: activeRun.id });
    });

    // Возврат к «Все данные» — фильтр периода снят, исторические цифры на месте.
    await selectPeriod('all');
    await waitFor(() => {
      expect(fetchStats).toHaveBeenLastCalledWith({ strategyId: V3_4 });
    });
    await waitFor(() => {
      expect(text('stat-published')).toBe('180');
    });
  });
});
