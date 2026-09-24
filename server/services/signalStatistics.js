/**
 * CRYPTORA — Серверная статистика сигналов.
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ БРАУЗЕРНОЙ СВОДКИ. Источник здесь — сохранённый серверный
 * жизненный цикл (таблица `signals`, PostgreSQL), а не `SignalsAuditLedger` из
 * localStorage одного браузера. Поэтому:
 *
 *   • «опубликован» ≠ «совершилась сделка». Сигнал, который так и не дождался
 *     входа (EXPIRED / CANCELLED / UNRESOLVED), идёт отдельной строкой и НЕ
 *     попадает в знаменатель win rate;
 *   • знаменатель win rate — завершённые сделки С ИЗВЕСТНЫМ результатом:
 *     wins + losses + breakEven;
 *   • R не пересчитывается: `result_r` / `net_result_r` берутся как их посчитало
 *     ядро. Сервер только агрегирует;
 *   • NULL не превращается в 0: если завершённых сделок с известным R нет,
 *     win rate = null, а средний R = null. «Нет данных» ≠ «0 %»;
 *   • сделка «в ноль» (result_r = 0) — ОТДЕЛЬНАЯ корзина `breakEven`, а не
 *     убыток. Убыток требует строго `result_r < 0`.
 *   • классификация идёт ТОЛЬКО по записанному `result_r` и НИКОГДА по названию
 *     исхода (`close_reason`) или по lifecycle-статусу: `TP1_THEN_BE` не
 *     объявляется «в ноль» автоматически — он в ноль ровно тогда, когда
 *     `result_r = 0`. Исход лишь решает, была ли сделка (терминальный статус),
 *     но не знак её результата.
 *   • классификация одна и построена на GROSS `result_r` (до комиссий). Net
 *     (`net_result_r`) показывается отдельными суммами и средними, но своей
 *     знаковой классификации не имеет: иначе одна сделка могла бы быть
 *     «прибыльной» по gross и «убыточной» по net одновременно.
 *
 * Классификация завершённой сделки по результату (все четыре корзики
 * взаимоисключающи и покрывают `completed`):
 *
 *   wins       — result_r >  0
 *   losses     — result_r <  0
 *   breakEven  — result_r =  0
 *   unrated    — result_r IS NULL
 *
 * Всё агрегируется в SQL (GROUP BY), поэтому разрезы «по стратегии», «по
 * инструменту» и «по периоду» не требуют выгрузки таблицы в память.
 */

import { query } from '../db/pool.js';
import {
  OPEN_SIGNAL_STATUSES,
  TRADE_CLOSED_STATUSES,
  NO_TRADE_STATUSES,
  CLOSED_SIGNAL_STATUSES,
  SIGNAL_STATUSES,
} from './signalRepository.js';

/** Периоды агрегации. Окно включительное слева: `created_at >= from`. */
export const STATISTICS_PERIODS = Object.freeze(['all', '24h', '7d', '30d', '90d']);

const PERIOD_MS = Object.freeze({
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
  '90d': 90 * 24 * 3_600_000,
});

/** Граница окна периода (null = без ограничения). Чистая функция — тестируема. */
export function periodStart(period, nowMs = Date.now()) {
  const span = PERIOD_MS[period];
  if (!span) return null;
  return new Date(nowMs - span);
}

/**
 * Форма одной строки сводки — общая для «всего», «по стратегии», «по инструменту».
 * @param {any} r строка SQL
 */
export function mapAggregate(r) {
  const published = Number(r.published ?? 0);
  const waitingEntry = Number(r.waiting_entry ?? 0);
  const filled = Number(r.filled ?? 0);
  const completed = Number(r.completed ?? 0);
  const wins = Number(r.wins ?? 0);
  const losses = Number(r.losses ?? 0);
  const breakEven = Number(r.break_even ?? 0);
  const unrated = Number(r.unrated ?? 0);
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    published,
    waitingEntry,
    filled,
    completed,
    cancelled: Number(r.cancelled ?? 0),
    expired: Number(r.expired ?? 0),
    unresolved: Number(r.unresolved ?? 0),
    targetReached: Number(r.target_reached ?? 0),
    invalidated: Number(r.invalidated ?? 0),
    closed: Number(r.closed ?? 0),
    wins,
    losses,
    breakEven,
    /** Завершённые сделки без рассчитанного результата: result_r IS NULL. */
    unrated,
    /**
     * Завершённые сделки, по которым результат НЕ рассчитан.
     *
     * Не путать с `unresolved` выше: `unresolved` — это статус «исход не
     * отслежен», где СДЕЛКИ НЕ БЫЛО (бар сетапа вне окна наблюдения).
     * `unratedCompleted` — это завершённая сделка (`TARGET_REACHED` /
     * `INVALIDATED` / `CLOSED`), у которой в `result_r` NULL.
     */
    unratedCompleted: Number(r.unrated ?? 0),
    /**
     * Завершённые сделки с ИЗВЕСТНЫМ результатом = wins + losses + breakEven.
     * Завершённая сделка без R (unrated) сюда НЕ входит: «результат неизвестен»
     * не является ни победой, ни поражением, ни ничьей.
     *
     * Тождество: `ratedCompleted + unratedCompleted = completed`. Знаменатель
     * `ratedCompleted` взят отдельной SQL-колонкой с тем же условием
     * (`result_r IS NOT NULL`), а не вычислен как `wins + losses + breakEven`,
     * чтобы расхождение этих двух выражений было бы видно тестом, а не
     * маскировалось арифметикой.
     */
    ratedCompleted: Number(r.rated_completed ?? 0),
    /**
     * Доля успешных: `wins / ratedCompleted`, где
     * `ratedCompleted = wins + losses + breakEven`.
     *
     * Почему не `wins / completed`: завершённая сделка без результата R
     * (unrated) не имеет знака, и включать её в знаменатель — значит занижать
     * долю успешных по причине «нет данных», а не по причине убытка.
     *
     * Почему не `wins / (wins + losses)`: сделка «в ноль» (breakEven) — это
     * завершённая сделка с известным результатом, и она должна быть в
     * знаменателе. Иначе доля успешных росла бы только за счёт ничьих.
     *
     * `null` — знаменатель ноль: «нет данных» ≠ 0 %.
     */
    winRatePct:
      Number(r.rated_completed ?? 0) > 0
        ? Math.round((wins / Number(r.rated_completed)) * 1000) / 10
        : null,
    avgGrossR: num(r.avg_gross_r),
    avgNetR: num(r.avg_net_r),
    grossRSum: num(r.gross_r_sum),
    netRSum: num(r.net_r_sum),
    /**
     * Доля опубликованных сигналов, дошедших до входа: в позиции (FILLED) плюс
     * завершённые сделкой. ACTIVE (ожидают входа) сюда НЕ входит — иначе метрика
     * всегда была бы 100 %.
     */
    fillRatePct: published > 0 ? Math.round(((filled + completed) / published) * 1000) / 10 : null,
    /** Доля опубликованных сигналов, завершившихся сделкой. */
    completionRatePct: published > 0 ? Math.round((completed / published) * 1000) / 10 : null,
  };
}

/**
 * SQL-выражения сводки. Один набор для всех трёх разрезов — иначе «всего» и
 * «по стратегии» могли бы считаться по разным правилам.
 *
 * @param {number} tradeIdx номер параметра со списком статусов завершённой сделки
 */
function aggregateSelect(tradeIdx) {
  const T = `$${tradeIdx}`;
  return `
  COUNT(*)::int                                                            AS published,
  COUNT(*) FILTER (WHERE status = 'ACTIVE')::int                            AS waiting_entry,
  COUNT(*) FILTER (WHERE status = 'FILLED')::int                            AS filled,
  COUNT(*) FILTER (WHERE status = ANY(${T}))::int                           AS completed,
  COUNT(*) FILTER (WHERE status = 'CANCELLED')::int                         AS cancelled,
  COUNT(*) FILTER (WHERE status = 'EXPIRED')::int                           AS expired,
  COUNT(*) FILTER (WHERE status = 'UNRESOLVED')::int                        AS unresolved,
  COUNT(*) FILTER (WHERE status = 'TARGET_REACHED')::int                    AS target_reached,
  COUNT(*) FILTER (WHERE status = 'INVALIDATED')::int                       AS invalidated,
  COUNT(*) FILTER (WHERE status = 'CLOSED')::int                            AS closed,
  -- КЛАССИФИКАЦИЯ ЗАВЕРШЁННЫХ СДЕЛОК ПО РЕЗУЛЬТАТУ.
  -- Три непустые корзины плюс явная корзина «без оценки». NULL не считается
  -- нулём: в PostgreSQL 'NULL = 0' даёт NULL, а не истину, поэтому ни одна из
  -- трёх корзин не захватывает NULL неявно.
  COUNT(*) FILTER (WHERE status = ANY(${T}) AND result_r > 0)::int           AS wins,
  COUNT(*) FILTER (WHERE status = ANY(${T}) AND result_r < 0)::int           AS losses,
  COUNT(*) FILTER (WHERE status = ANY(${T}) AND result_r = 0)::int           AS break_even,
  COUNT(*) FILTER (WHERE status = ANY(${T}) AND result_r IS NULL)::int       AS unrated,
  -- Знаменатель доли успешных: завершённые сделки С ИЗВЕСТНЫМ результатом.
  COUNT(*) FILTER (WHERE status = ANY(${T}) AND result_r IS NOT NULL)::int   AS rated_completed,
  -- Σ/среднее R: условие 'result_r IS NOT NULL' сделано ЯВНЫМ, а не оставлено
  -- на неявное правило «SQL-агрегат пропускает NULL». Значение то же, но
  -- намерение читается из запроса и не зависит от поведения агрегата.
  SUM(result_r) FILTER (WHERE status = ANY(${T}) AND result_r IS NOT NULL)::numeric       AS gross_r_sum,
  SUM(net_result_r) FILTER (WHERE status = ANY(${T}) AND net_result_r IS NOT NULL)::numeric AS net_r_sum,
  AVG(result_r) FILTER (WHERE status = ANY(${T}) AND result_r IS NOT NULL)::numeric       AS avg_gross_r,
  AVG(net_result_r) FILTER (WHERE status = ANY(${T}) AND net_result_r IS NOT NULL)::numeric AS avg_net_r
`;
}

/** Общий конструктор WHERE: период, стратегия, инструмент — один код на все разрезы. */
function buildFilter({ strategyId, symbol, period, nowMs }) {
  const where = [];
  const params = [];
  const from = periodStart(period, nowMs);
  if (from) {
    params.push(from);
    where.push(`created_at >= $${params.length}`);
  }
  if (strategyId) {
    params.push(strategyId);
    where.push(`strategy_id = $${params.length}`);
  }
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    where.push(`upper(symbol) = $${params.length}`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Полная серверная статистика сигналов.
 *
 * @param {object} [filters]
 * @param {string} [filters.strategyId]
 * @param {string} [filters.symbol]
 * @param {string} [filters.period] — all | 24h | 7d | 30d | 90d
 * @param {number} [filters.nowMs] — инъекция времени (тесты)
 */
export async function getSignalStatistics(filters = {}) {
  const period = STATISTICS_PERIODS.includes(filters.period) ? filters.period : 'all';
  const nowMs = Number.isFinite(filters.nowMs) ? filters.nowMs : Date.now();
  const base = buildFilter({ ...filters, period, nowMs });

  // Список статусов завершённой сделки — ПОСЛЕДНИЙ параметр во всех запросах,
  // поэтому номер параметра одинаковый и «всего» не может разойтись с разрезом.
  const params = [...base.params, [...TRADE_CLOSED_STATUSES]];
  const tradeIdx = params.length;
  const select = aggregateSelect(tradeIdx);

  const [total, byStrategy, bySymbol] = await Promise.all([
    query(`SELECT ${select} FROM signals ${base.clause}`, params),
    query(
      `SELECT strategy_id, ${select}
         FROM signals ${base.clause}
        GROUP BY strategy_id
        ORDER BY strategy_id`,
      params
    ),
    query(
      `SELECT symbol, ${select}
         FROM signals ${base.clause}
        GROUP BY symbol
        ORDER BY published DESC, symbol ASC
        LIMIT 100`,
      params
    ),
  ]);

  return {
    period,
    filters: {
      strategyId: filters.strategyId ?? null,
      symbol: filters.symbol ?? null,
    },
    /** Домены — из репозитория, а не из этого файла. */
    statuses: [...SIGNAL_STATUSES],
    openStatuses: [...OPEN_SIGNAL_STATUSES],
    tradeClosedStatuses: [...TRADE_CLOSED_STATUSES],
    noTradeStatuses: [...NO_TRADE_STATUSES],
    closedStatuses: [...CLOSED_SIGNAL_STATUSES],
    totals: mapAggregate(total.rows[0] ?? {}),
    byStrategy: byStrategy.rows.map((r) => ({ strategyId: r.strategy_id, ...mapAggregate(r) })),
    bySymbol: bySymbol.rows.map((r) => ({ symbol: r.symbol, ...mapAggregate(r) })),
    /**
     * Определения, которые UI обязан показывать рядом с числами. Формулировки
     * намеренно человеческие: «опубликован» и «сделка» — разные события.
     */
    definitions: {
      published: 'Опубликовано сигналов — сетапов, сохранённых сервером.',
      waitingEntry: 'Ожидают входа — сигнал опубликован, цена в коридор или на открытии не вошла.',
      filled: 'В позиции — вход зафиксирован, исход ещё не определён.',
      completed: 'Завершено сделкой — исход определён по закрытым свечам (цель, стоп или правило стратегии).',
      cancelled: 'Отменены до входа — сделки не было.',
      expired: 'Истекли — коридор входа не сработал, сделки не было.',
      unresolved: 'Исход не отслежен — бар сетапа вне окна наблюдения.',
      wins: 'Прибыльные — завершённая сделка с результатом строго больше нуля.',
      losses: 'Убыточные — завершённая сделка с результатом строго меньше нуля.',
      breakEven:
        'В ноль — завершённая сделка с результатом ровно 0 R. Это НЕ убыток: отдельная корзина.',
      unrated:
        'Без расчёта результата — завершённая сделка, по которой ядро не вернуло результат. Не победа, не поражение и не ноль.',
      unratedCompleted:
        'Без расчёта результата — то же, что «без оценки R», но названо так, чтобы не путать со статусом «исход не отслежен» (unresolved): там сделки не было, а здесь сделка была.',
      ratedCompleted:
        'Завершено с известным результатом — прибыльные + убыточные + в ноль. Знаменатель доли успешных.',
      winRatePct:
        'Доля успешных — прибыльные среди завершённых сигналов с рассчитанным результатом (прибыльные + убыточные + в ноль). Отмены, истечения и неотслеженные исходы в знаменатель не входят: там сделки не было.',
      classification:
        'Прибыльные / убыточные / в ноль определяются записанным результатом (result_r): строго больше нуля, строго меньше нуля, ровно ноль. Название исхода (например TP1_THEN_BE) и статус сами по себе сделку не классифицируют — только факт её завершения. Классификация одна и построена на результате до комиссий (gross).',
      avgGrossR:
        'Средний результат в R до комиссий (1R = первоначальный риск между входом и стопом). Считается только по сделкам с известным R.',
      avgNetR:
        'Средний результат в R после комиссий (2 bps вход / 5 bps выход). Считается только по сделкам с известным R.',
      grossRSum:
        'Сумма gross R по завершённым сделкам с известным R. Сделки без R не дают вклада — это не ноль, а отсутствие значения.',
      netRSum:
        'Сумма net R по завершённым сделкам с известным R. Сделки без R не дают вклада — это не ноль, а отсутствие значения.',
    },
    source: 'server',
  };
}
