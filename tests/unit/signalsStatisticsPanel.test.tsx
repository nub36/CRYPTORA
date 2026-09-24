/**
 * CRYPTORA — Серверная статистика сигналов: то, что показывает панель.
 *
 * Источник — `GET /api/signals/statistics` (агрегаты по PostgreSQL), а НЕ
 * браузерный `SignalsAuditLedger`. Поэтому тест проверяет два правила, которые
 * легко нарушить и которые дорого стоят:
 *
 *   1. «Опубликовано» и «совершилась сделка» — разные счётчики. Сигнал, который
 *      так и не дождался входа, показывается отдельной строкой и не попадает в
 *      долю успешных.
 *   2. Нет данных ≠ 0 %. При нулевом знаменателе панель показывает «—», а не
 *      «0 %» и не «0.00R».
 *
 * Запросы подменяются на уровне `fetchStats` — панель не умеет (и не должна
 * уметь) агрегировать ленту у себя.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

import { SignalStatisticsPanel } from '@/components/signals/SignalStatisticsPanel';
import type { SignalStatisticsAggregateDto, SignalStatisticsDto } from '@/services/strategyOps';

const qa = (id: string) => document.querySelector(`[data-qa="${id}"]`);
const text = (id: string) => qa(id)?.textContent ?? '';

type DtoOverrides = Omit<Partial<SignalStatisticsDto>, 'totals'> & {
  /** Разрешаем частичные totals: базовые нули подставляются автоматически. */
  totals?: Partial<SignalStatisticsAggregateDto>;
};

function dto(overrides: DtoOverrides = {}): SignalStatisticsDto {
  const totals = {
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
    winRatePct: null,
    avgGrossR: null,
    avgNetR: null,
    grossRSum: null,
    netRSum: null,
    fillRatePct: null,
    completionRatePct: null,
    ...(overrides.totals ?? {}),
  };
  return {
    period: 'all',
    filters: { strategyId: null, symbol: null },
    statuses: [],
    openStatuses: [],
    tradeClosedStatuses: [],
    noTradeStatuses: [],
    closedStatuses: [],
    byStrategy: [],
    bySymbol: [],
    definitions: { winRatePct: 'доля успешных', avgGrossR: 'gross', avgNetR: 'net' },
    source: 'server',
    ...overrides,
    totals,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open(stats: SignalStatisticsDto | Error) {
  const fetchStats = vi.fn(async () => {
    if (stats instanceof Error) throw stats;
    return stats;
  });
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<SignalStatisticsPanel symbol="BTC" fetchStats={fetchStats as never} pollMs={0} />);
  });
  return { utils, fetchStats };
}

describe('Панель серверной статистики — plain-language счётчики', () => {
  it('показывает опубликовано / ожидают входа / дошли до входа / завершились', async () => {
    await open(
      dto({
        totals: {
          published: 10,
          waitingEntry: 4,
          filled: 1,
          completed: 3,
          cancelled: 2,
          expired: 0,
          unresolved: 0,
          targetReached: 2,
          invalidated: 1,
          closed: 0,
          wins: 2,
          losses: 1,
          winRatePct: 66.7,
          avgGrossR: 1.5,
          avgNetR: 1.4,
          grossRSum: 4.5,
          netRSum: 4.2,
          fillRatePct: 40,
          completionRatePct: 30,
        },
      })
    );
    expect(text('stat-published')).toBe('10');
    expect(text('stat-waiting')).toBe('4');
    expect(text('stat-filled')).toBe('4'); // 1 в позиции + 3 завершённых
    expect(text('stat-completed')).toBe('3');
    expect(text('stat-wins')).toBe('2');
    expect(text('stat-losses')).toBe('1');
    expect(text('stat-winrate')).toBe('66.7%');
    expect(text('stat-no-trade')).toBe('2');
  });

  it('R и суммы спрятаны под «Подробнее»', async () => {
    await open(
      dto({
        totals: {
          published: 4,
          completed: 2,
          wins: 1,
          losses: 1,
          winRatePct: 50,
          avgGrossR: 1.25,
          avgNetR: 1.1,
          grossRSum: 2.5,
          netRSum: 2.2,
          fillRatePct: 50,
          completionRatePct: 50,
        },
      })
    );
    // До раскрытия деталей нет.
    expect(qa('stat-avg-net')).toBeNull();
    expect(qa('stat-sum-net')).toBeNull();

    const toggle = qa('signals-statistics-details-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    expect(text('stat-avg-gross')).toBe('+1.25 R');
    expect(text('stat-avg-net')).toBe('+1.10 R');
    expect(text('stat-sum-gross')).toBe('+2.50 R');
    expect(text('stat-sum-net')).toBe('+2.20 R');
    // Пояснение знаменателя — на виду, а не спрятано.
    expect(qa('signals-statistics-details')?.textContent).toContain('только завершённые сделки');
  });

  it('отменённые и истёкшие сигналы не становятся убыточными сделками', async () => {
    await open(
      dto({
        totals: {
          published: 5,
          waitingEntry: 0,
          filled: 0,
          completed: 0,
          cancelled: 3,
          expired: 2,
          unresolved: 0,
          wins: 0,
          losses: 0,
          winRatePct: null,
          avgGrossR: null,
          avgNetR: null,
          grossRSum: null,
          netRSum: null,
          fillRatePct: 0,
          completionRatePct: 0,
        },
      })
    );
    expect(text('stat-completed')).toBe('0');
    expect(text('stat-no-trade')).toBe('5');
    // Нет завершённых сделок ⇒ нет ни доли, ни результата.
    expect(text('stat-winrate')).toBe('—');
    expect(text('stat-avg')).toBe('—');
    expect(text('stat-wins')).toBe('—');
    expect(text('stat-losses')).toBe('—');
  });

  it('пустая таблица объясняется словами, а не нулями', async () => {
    await open(dto());
    expect(text('stat-published')).toBe('0');
    expect(text('stat-winrate')).toBe('—');
    expect(qa('signals-statistics')?.textContent).toContain('Сохранённых сигналов пока нет');
  });

  it('ошибка статистики не выглядит как «сигналов нет»', async () => {
    await open(new Error('500 Internal Server Error'));
    expect(qa('signals-statistics-error')?.textContent).toContain('Серверная статистика недоступна');
    expect(qa('signals-statistics-error')?.textContent).toContain('Это не значит, что сигналов нет');
  });

  it('неполный ответ тоже считается ошибкой, а не нулями', async () => {
    await open({ definitions: {} } as unknown as SignalStatisticsDto);
    expect(qa('signals-statistics-error')).not.toBeNull();
  });

  it('разрезы по стратегии и инструменту показываются под «Подробнее»', async () => {
    await open(
      dto({
        totals: { published: 3, completed: 1, wins: 1, losses: 0, winRatePct: 100, avgNetR: 2, netRSum: 2 },
        byStrategy: [
          {
            strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
            published: 2,
            waitingEntry: 0,
            filled: 0,
            completed: 1,
            cancelled: 1,
            expired: 0,
            unresolved: 0,
            targetReached: 1,
            invalidated: 0,
            closed: 0,
            wins: 1,
            losses: 0,
            winRatePct: 100,
            avgGrossR: 2,
            avgNetR: 1.9,
            grossRSum: 2,
            netRSum: 1.9,
            fillRatePct: 50,
            completionRatePct: 50,
          },
        ],
        bySymbol: [
          {
            symbol: 'BTC/USDT',
            published: 3,
            waitingEntry: 2,
            filled: 0,
            completed: 1,
            cancelled: 0,
            expired: 0,
            unresolved: 0,
            targetReached: 1,
            invalidated: 0,
            closed: 0,
            wins: 1,
            losses: 0,
            winRatePct: 100,
            avgGrossR: 2,
            avgNetR: 1.9,
            grossRSum: 2,
            netRSum: 1.9,
            fillRatePct: 33.3,
            completionRatePct: 33.3,
          },
        ],
      })
    );
    const toggle = qa('signals-statistics-details-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    expect(qa('stat-by-strategy')?.textContent).toContain('V3_0_HTF_LIQUIDATION_TRAP');
    expect(qa('stat-by-symbol')?.textContent).toContain('BTC/USDT');
  });
});
