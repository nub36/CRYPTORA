/**
 * CRYPTORA — Репозиторий тестовых периодов стратегий (миграция 015).
 *
 * «Начать новый тестовый период» = атомарно, в ОДНОЙ транзакции PostgreSQL:
 *   1. заблокировать scope стратегии;
 *   2. завершить существующий ACTIVE-период (status = COMPLETED,
 *      ended_at = now() транзакции);
 *   3. создать новый ACTIVE-период;
 *   4. записать событие audit_log (STRATEGY_TEST_RUN_STARTED) той же
 *      транзакцией — чтобы аудит не разошёлся с фактом.
 *
 * Инварианты, которые этот слой обязан держать:
 *
 *  • ОДИН ACTIVE-ПЕРИОД НА СТРАТЕГИЮ. Прикладная сериализация — блокировка
 *    строки strategy_settings (SELECT … FOR UPDATE): конкурентные старты одной
 *    стратегии выстраиваются в очередь, разные стратегии не мешают друг другу.
 *    Гарантия последней линии — партициональный уникальный индекс
 *    `uq_strategy_test_runs_one_active`: даже обход сериализации не создаёт
 *    два ACTIVE-периода. V3.0 и V3.4 имеют независимые периоды.
 *
 *  • ЭТО НЕ ОЧИСТКА ДАННЫХ. Ни один сигнал не удаляется, не изменяется и не
 *    перезаписывается. Прежняя статистика остаётся доступной через фильтр
 *    «Все данные»; новая начинается с нуля потому, что новые сигналы получают
 *    test_run_id нового периода, а не потому, что старые куда-то делись.
 *
 *  • ПЕРИОД НЕ УПРАВЛЯЕТ ВКЛЮЧЁННОСТЬЮ СТРАТЕГИИ. strategy_settings не
 *    читается для изменений и не изменяется: V3.4 с enabled = FALSE остаётся
 *    выключенной и после старта периода. Включение — отдельное решение
 *    администратора через существующий PATCH /api/admin/strategies/:id.
 *
 *  • ЧЛЕНСТВО НАЗНАЧАЕТ ТОЛЬКО СЕРВЕР, ТОЛЬКО В МОМЕНТ INSERT СИГНАЛА
 *    (`insertSignal` в signalRepository.js). Здесь есть только чтение
 *    ACTIVE-периода; никаких UPDATE signals.test_run_id не существует.
 */

import { query, getClient } from '../db/pool.js';
import { getStrategy, isKnownStrategyId } from './strategyCatalog.js';

/** Домен статуса периода — тот же, что в CHECK миграции 015. */
export const TEST_RUN_STATUSES = Object.freeze(['ACTIVE', 'COMPLETED']);

/** Форма run id (UUID v1–5, любой регистр) — проверка ДО обращения к БД. */
export const TEST_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Похож ли идентификатор на `strategy_test_runs.id`. Форма, не существование. */
export function isTestRunIdShape(id) {
  return typeof id === 'string' && TEST_RUN_ID_PATTERN.test(id.trim());
}

/**
 * Валидация strategy_id против ЗАКРЫТОГО каталога кода.
 *
 * «Не доверять frontend strategy ID» — неизвестный id отклоняется ЗДЕСЬ,
 * до SQL, с 404 (как у PATCH /api/admin/strategies/:strategyId), а не падает
 * в CHECK-ограничение с 500.
 *
 * @param {string} strategyId
 * @throws {Error} statusCode = 404
 */
export function assertKnownStrategyId(strategyId) {
  if (!isKnownStrategyId(strategyId)) {
    const err = new Error(`Unknown strategy: ${strategyId}`);
    /** @type {any} */ (err).statusCode = 404;
    throw err;
  }
}

/** Строка БД → форма API. UUID наружу отдаётся (нужен как значение фильтра), но UI показывает подпись. */
function mapRow(row, signalCount = 0) {
  return {
    id: row.id,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    status: row.status,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    signalCount: Number(signalCount ?? 0),
  };
}

/**
 * Все периоды стратегии с числом сигналов-членов, новые сверху.
 *
 * Число сигналов — реальный COUNT по signals.test_run_id (authoritative
 * membership), а не по created_at >= started_at: сигнал, созданный в Run 1 и
 * закрытый во время Run 2, считается в Run 1.
 *
 * @param {{strategyId: string}} p
 * @returns {Promise<Array<ReturnType<typeof mapRow>>>}
 */
export async function listStrategyTestRuns({ strategyId }) {
  assertKnownStrategyId(strategyId);
  const { rows } = await query(
    `SELECT r.*, COUNT(s.id)::int AS signal_count
       FROM strategy_test_runs r
       LEFT JOIN signals s ON s.test_run_id = r.id
      WHERE r.strategy_id = $1
      GROUP BY r.id
      ORDER BY r.started_at DESC, r.id DESC`,
    [strategyId]
  );
  return rows.map((r) => mapRow(r, r.signal_count));
}

/**
 * Текущий ACTIVE-период стратегии или null.
 *
 * Именно этот SELECT (внутри транзакции INSERT сигнала) назначает членство:
 * сигнал получает test_run_id того периода, который был ACTIVE в момент
 * его создания. Если периода нет — test_run_id = NULL, сигнал создаётся штатно.
 *
 * @param {string} strategyId
 * @param {{query?: Function}} [opts] — инъекция клиента для вызова внутри чужой транзакции
 */
export async function getActiveStrategyTestRun(strategyId, opts = {}) {
  const run = opts.client ?? { query };
  const { rows } = await run.query(
    `SELECT * FROM strategy_test_runs
      WHERE strategy_id = $1 AND status = 'ACTIVE'
      LIMIT 1`,
    [strategyId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * НАЧАТЬ НОВЫЙ ТЕСТОВЫЙ ПЕРИОД — единственная мутация этой сущности.
 *
 * Транзакция (§ atomic start):
 *   BEGIN
 *     SELECT strategy_id FROM strategy_settings WHERE strategy_id = $1 FOR UPDATE
 *       — блокировка scope стратегии: конкурентные старты выстраиваются
 *         в очередь; разные стратегии не блокируют друг друга.
 *     UPDATE strategy_test_runs SET status='COMPLETED', ended_at=now()
 *       WHERE strategy_id=$1 AND status='ACTIVE' RETURNING id
 *       — предыдущий период, если он существует, завершается тем же
 *         transaction timestamp, что и started_at нового.
 *     INSERT INTO strategy_test_runs (...) VALUES (...) RETURNING *
 *     INSERT INTO audit_log (… 'STRATEGY_TEST_RUN_STARTED' …)
 *   COMMIT
 *
 * @param {object} p
 * @param {string} p.strategyId
 * @param {string|null} [p.actorUserId] — admin id для audit_log
 * @returns {Promise<{run: object, previousRunId: string|null}>}
 *   run — новый ACTIVE-период (id, startedAt, strategyId, …)
 */
export async function startStrategyTestRun({ strategyId, actorUserId = null }) {
  assertKnownStrategyId(strategyId);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // ── 1. Lock strategy/run scope ──────────────────────────────────────────
    // Строка settings существует для каждой стратегии каталога (миграции 006 и
    // 014 сеют все четыре). Если её нет — scope всё равно сериализован
    // уникальным индексом ниже; 0 строк здесь не ошибка.
    await client.query(
      'SELECT strategy_id FROM strategy_settings WHERE strategy_id = $1 FOR UPDATE',
      [strategyId]
    );

    // ── 2. Завершить предыдущий ACTIVE-период ───────────────────────────────
    // now() = transaction timestamp: ended_at прежнего и started_at нового
    // физически один момент, «дыры» между периодами нет.
    const prev = await client.query(
      `UPDATE strategy_test_runs
          SET status = 'COMPLETED', ended_at = now()
        WHERE strategy_id = $1 AND status = 'ACTIVE'
        RETURNING id`,
      [strategyId]
    );
    const previousRunId = prev.rows[0]?.id ?? null;

    // ── 3. Новый ACTIVE-период ──────────────────────────────────────────────
    // Версия — из каталога кода (информационные метаданные, identity = id).
    const inserted = await client.query(
      `INSERT INTO strategy_test_runs (strategy_id, strategy_version, started_at, status, created_by)
       VALUES ($1, $2, now(), 'ACTIVE', $3)
       RETURNING *`,
      [strategyId, getStrategy(strategyId)?.version ?? null, actorUserId]
    );
    const run = mapRow(inserted.rows[0]);

    // ── 4. Аудит той же транзакцией ─────────────────────────────────────────
    // Событие: кто начал, какой период, какой период завершён. Секретов нет:
    // metadata — только идентификаторы.
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'STRATEGY_TEST_RUN_STARTED', 'strategy', $2, $3)`,
      [
        actorUserId,
        strategyId,
        JSON.stringify({
          strategyId,
          newRunId: run.id,
          previousRunId,
          strategyVersion: run.strategyVersion,
        }),
      ]
    );

    await client.query('COMMIT');
    return { run, previousRunId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
