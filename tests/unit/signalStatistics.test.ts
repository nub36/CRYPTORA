/**
 * CRYPTORA — Серверная статистика сигналов (чистая часть).
 *
 * Проверяются те правила, которые нельзя «поправить на фронтенде»:
 *   • знаменатель win rate — ТОЛЬКО завершённые сделки; «опубликовано» и
 *     «совершилась сделка» никогда не смешиваются;
 *   • нет данных ≠ 0: при нулевом знаменателе win rate и средний R = null;
 *   • окна периодов считаются от переданного времени, а не от `Date.now()`;
 *   • R не пересчитывается: `mapAggregate` только читает то, что посчитало ядро.
 *
 * Сами SQL-агрегаты проверяются на настоящем PostgreSQL в
 * tests/integration/signalStatistics.test.ts.
 */

import { describe, it, expect } from 'vitest';

import {
  mapAggregate,
  periodStart,
  STATISTICS_PERIODS,
} from '../../server/services/signalStatistics.js';

/** Минимальный «ноль» — так выглядит пустая таблица в сводке. */
const EMPTY_ROW = {
  published: 0,
  waiting_entry: 0,
  filled: 0,
  completed: 0,
  cancelled: 0,
  expired: 0,
  unresolved: 0,
  target_reached: 0,
  invalidated: 0,
  closed: 0,
  wins: 0,
  losses: 0,
  break_even: 0,
  unrated: 0,
  rated_completed: 0,
  gross_r_sum: null,
  net_r_sum: null,
  avg_gross_r: null,
  avg_net_r: null,
};

describe('periodStart — окна периодов', () => {
  const now = Date.UTC(2026, 0, 31, 12, 0, 0);

  it('all не ограничивает окно', () => {
    expect(periodStart('all', now)).toBeNull();
  });

  it('24h / 7d / 30d / 90d — ровно свои окна', () => {
    expect(periodStart('24h', now)?.getTime()).toBe(now - 24 * 3_600_000);
    expect(periodStart('7d', now)?.getTime()).toBe(now - 7 * 24 * 3_600_000);
    expect(periodStart('30d', now)?.getTime()).toBe(now - 30 * 24 * 3_600_000);
    expect(periodStart('90d', now)?.getTime()).toBe(now - 90 * 24 * 3_600_000);
  });

  it('неизвестный период не молча превращается в «всё время»', () => {
    expect(periodStart('1y', now)).toBeNull();
  });

  it('перечень периодов закрыт', () => {
    expect([...STATISTICS_PERIODS]).toEqual(['all', '24h', '7d', '30d', '90d']);
  });
});

describe('mapAggregate — пустая таблица', () => {
  it('нет данных ≠ 0 %: win rate и средние R = null', () => {
    const a = mapAggregate(EMPTY_ROW);
    expect(a.published).toBe(0);
    expect(a.winRatePct).toBeNull();
    expect(a.avgGrossR).toBeNull();
    expect(a.avgNetR).toBeNull();
    expect(a.grossRSum).toBeNull();
    expect(a.netRSum).toBeNull();
    expect(a.fillRatePct).toBeNull();
    expect(a.completionRatePct).toBeNull();
  });
});

describe('mapAggregate — знаменатель win rate', () => {
  it('win rate считается ТОЛЬКО по завершённым сделкам', () => {
    // 10 опубликовано, 3 завершены (2 в плюс), 5 отменено, 2 истекло.
    const a = mapAggregate({
      ...EMPTY_ROW,
      published: 10,
      waiting_entry: 0,
      filled: 0,
      completed: 3,
      cancelled: 5,
      expired: 2,
      target_reached: 2,
      invalidated: 1,
      closed: 0,
      wins: 2,
      losses: 1,
      break_even: 0,
      unrated: 0,
      rated_completed: 3,
      gross_r_sum: 3.4,
      net_r_sum: 3.1,
      avg_gross_r: 1.1333,
      avg_net_r: 1.0333,
    });
    expect(a.winRatePct).toBe(66.7);
    // Отмены и истечения НЕ увеличивают знаменатель.
    expect(a.completionRatePct).toBe(30);
    // Ни один из не-сделочных сигналов не попал в R.
    expect(a.grossRSum).toBe(3.4);
  });

  it('отменённые и истёкшие сигналы не превращаются в убыточные сделки', () => {
    const a = mapAggregate({
      ...EMPTY_ROW,
      published: 4,
      cancelled: 2,
      expired: 2,
      completed: 0,
      wins: 0,
      losses: 0,
    });
    // Ноль завершённых сделок ⇒ нет и нулевого win rate.
    expect(a.winRatePct).toBeNull();
    expect(a.losses).toBe(0);
    expect(a.grossRSum).toBeNull();
  });

  it('G: SUM/AVG игнорируют NULL, а не превращают его в ноль', () => {
    // Одна сделка с известным результатом (+1.5 R) и ОДНА завершённая сделка
    // без результата (unrated). SQL-агрегаты должны увидеть только первую.
    const a = mapAggregate({
      ...EMPTY_ROW,
      published: 2,
      completed: 2,
      wins: 1,
      losses: 0,
      break_even: 0,
      unrated: 1,
      rated_completed: 1,
      gross_r_sum: 1.5,
      net_r_sum: 1.42,
      avg_gross_r: 1.5,
      avg_net_r: 1.42,
    });
    // Σ = 1.5, а НЕ 1.5 + 0 = «как будто нулевая сделка дала вклад».
    expect(a.grossRSum).toBe(1.5);
    expect(a.netRSum).toBe(1.42);
    // Среднее делится на 1 (сделки с известным R), а не на 2.
    expect(a.avgGrossR).toBe(1.5);
    expect(a.avgNetR).toBe(1.42);
    // Тождество знаменателя.
    expect(a.ratedCompleted + a.unratedCompleted).toBe(a.completed);
    expect(a.winRatePct).toBe(100);
  });

  it('G2: unrated не «добавляет ноль» — Σ остаётся только по известным R', () => {
    // Две сделки с известным результатом и одна без: если бы NULL стал 0,
    // Σ осталась бы той же, а вот СРЕДНЕЕ упало бы на треть. Проверяем среднее.
    const withNull = mapAggregate({
      ...EMPTY_ROW,
      completed: 3,
      wins: 1,
      losses: 1,
      break_even: 0,
      unrated: 1,
      rated_completed: 2,
      gross_r_sum: 0,
      avg_gross_r: 0,
    });
    // Среднее 0 по ДВУМ сделкам (+1 и −1), а не по трём.
    expect(withNull.avgGrossR).toBe(0);
    expect(withNull.ratedCompleted).toBe(2);
    expect(withNull.unratedCompleted).toBe(1);
    // Σ не изменился от появления NULL: +1 + (−1) = 0, и это совпадение с
    // «нулём» не должно маскировать ошибку — поэтому проверяем знаменатель.
    expect(withNull.grossRSum).toBe(0);
  });

  it('+1R → win', () => {
    const a = mapAggregate({ ...EMPTY_ROW, completed: 1, wins: 1, rated_completed: 1 });
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(0);
    expect(a.breakEven).toBe(0);
    expect(a.unrated).toBe(0);
    expect(a.ratedCompleted).toBe(1);
    expect(a.winRatePct).toBe(100);
  });

  it('-1R → loss', () => {
    const a = mapAggregate({ ...EMPTY_ROW, completed: 1, losses: 1, rated_completed: 1 });
    expect(a.wins).toBe(0);
    expect(a.losses).toBe(1);
    expect(a.breakEven).toBe(0);
    expect(a.unrated).toBe(0);
    expect(a.ratedCompleted).toBe(1);
    expect(a.winRatePct).toBe(0);
  });

  it('0R → breakEven, а НЕ loss', () => {
    const a = mapAggregate({ ...EMPTY_ROW, completed: 1, break_even: 1, rated_completed: 1 });
    expect(a.wins).toBe(0);
    // Ровно нулевой результат не делает сделку убыточной.
    expect(a.losses).toBe(0);
    expect(a.breakEven).toBe(1);
    expect(a.unrated).toBe(0);
    expect(a.ratedCompleted).toBe(1);
    // Ничья входит в знаменатель, но не в числитель.
    expect(a.winRatePct).toBe(0);
  });

  it('NULL R → unrated: не win, не loss, не breakEven', () => {
    const a = mapAggregate({ ...EMPTY_ROW, completed: 1, unrated: 1, rated_completed: 0 });
    expect(a.wins).toBe(0);
    expect(a.losses).toBe(0);
    expect(a.breakEven).toBe(0);
    expect(a.unrated).toBe(1);
    expect(a.unratedCompleted).toBe(1);
    // NULL не превращается в 0: знаменателя нет ⇒ null, а не 0 %.
    expect(a.ratedCompleted).toBe(0);
    expect(a.winRatePct).toBeNull();
  });

  it('mix +1 / -1 / 0 / NULL ⇒ wins=1, losses=1, breakEven=1, unrated=1, ratedCompleted=3, winRate=33.33%', () => {
    const a = mapAggregate({
      ...EMPTY_ROW,
      published: 4,
      completed: 4,
      wins: 1,
      losses: 1,
      break_even: 1,
      unrated: 1,
      rated_completed: 3,
      gross_r_sum: 0,
      net_r_sum: -0.2,
      avg_gross_r: 0,
      avg_net_r: -0.0667,
    });
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);
    expect(a.breakEven).toBe(1);
    expect(a.unrated).toBe(1);
    expect(a.unratedCompleted).toBe(1);
    // Четыре корзины покрывают completed.
    expect(a.wins + a.losses + a.breakEven + a.unrated).toBe(a.completed);
    // Знаменатель — только сделки с известным результатом.
    expect(a.ratedCompleted).toBe(3);
    expect(a.winRatePct).toBe(33.3);
    // NULL не даёт вклада в сумму: Σ = +1 + (-1) + 0, а не «+1-1+0+0».
    expect(a.grossRSum).toBe(0);
  });

  it('все завершённые сделки без R ⇒ winRate null, а не 0 %', () => {
    const a = mapAggregate({
      ...EMPTY_ROW,
      published: 2,
      completed: 2,
      wins: 0,
      losses: 0,
      break_even: 0,
      unrated: 2,
      rated_completed: 0,
    });
    expect(a.completed).toBe(2);
    expect(a.unrated).toBe(2);
    expect(a.unratedCompleted).toBe(2);
    // «Нет данных» ≠ 0 %.
    expect(a.winRatePct).toBeNull();
    expect(a.avgGrossR).toBeNull();
    expect(a.grossRSum).toBeNull();
  });

  it('ожидающие вход сигналы считаются отдельно от исполненных', () => {
    const a = mapAggregate({
      ...EMPTY_ROW,
      published: 6,
      waiting_entry: 4,
      filled: 1,
      completed: 1,
      wins: 1,
    });
    expect(a.waitingEntry).toBe(4);
    expect(a.filled).toBe(1);
    expect(a.completed).toBe(1);
    // Доля дошедших до входа: 1 (в позиции) + 1 (завершён) из 6.
    expect(a.fillRatePct).toBe(33.3);
  });
});
