/**
 * CRYPTORA — Репозиторий настроек стратегий.
 *
 * Единственный слой, который читает и пишет таблицу `strategy_settings`
 * (миграция 006). Ни маршруты, ни планировщик не ходят в SQL напрямую.
 *
 * Принципы:
 *  • PostgreSQL — источник истины. localStorage и память процесса — нет.
 *  • `null` означает «данных нет», `0` — «данных нет, но ноль». Поэтому
 *    lastScanAt/lastSignalAt отдаются как null, а не как эпоха или 0.
 *  • Математических параметров здесь нет и не будет: только ВКЛ/ВЫКЛ,
 *    интервал, список символов и телеметрия.
 */

import { query, getClient } from '../db/pool.js';
import { recordAudit } from './audit.js';
import { PRODUCT_STRATEGIES, isKnownStrategyId, BADGE_LABELS } from './strategyCatalog.js';

/** Минимальный интервал сканирования — зеркалит CHECK в миграции 006. */
export const MIN_SCAN_INTERVAL_SECONDS = 15;

/**
 * Приводит строку из БД к форме, которую отдаёт API.
 * @param {any} row
 */
function mapRow(row) {
  return {
    strategyId: row.strategy_id,
    enabled: row.enabled,
    scanIntervalSeconds: row.scan_interval_seconds,
    symbols: row.symbols ?? null,
    lastScanAt: row.last_scan_at ?? null,
    lastSignalAt: row.last_signal_at ?? null,
    lastError: row.last_error ?? null,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

/**
 * Полное состояние всех продуктовых стратегий для `GET /api/strategies`.
 *
 * Каталог — источник порядка и состава: если строки в БД по какой-то причине
 * нет, стратегия всё равно показывается, но с `enabled = false` и null в
 * телеметрии. Выдуманного состояния не появляется.
 *
 * `activeSignalCount` берётся реальным `SELECT COUNT(*)` из таблицы signals —
 * не кэшируется и не вычисляется на фронте.
 */
export async function listStrategyStates() {
  const [settings, counts] = await Promise.all([
    query('SELECT * FROM strategy_settings'),
    query(`SELECT strategy_id, COUNT(*)::int AS n
             FROM signals
            WHERE status = 'ACTIVE'
            GROUP BY strategy_id`),
  ]);

  const byId = new Map(settings.rows.map((r) => [r.strategy_id, r]));
  const countById = new Map(counts.rows.map((r) => [r.strategy_id, r.n]));

  return PRODUCT_STRATEGIES.map((meta) => {
    const row = byId.get(meta.id);
    const state = row
      ? mapRow(row)
      : {
          strategyId: meta.id,
          enabled: false,
          scanIntervalSeconds: meta.defaultScanIntervalSeconds,
          symbols: null,
          lastScanAt: null,
          lastSignalAt: null,
          lastError: null,
          updatedAt: null,
          updatedBy: null,
        };

    return {
      strategyId: meta.id,
      version: meta.version,
      name: meta.name,
      nameRu: meta.nameRu,
      timeframes: meta.timeframes,
      badge: BADGE_LABELS[meta.badge],
      enabled: state.enabled,
      status: deriveStatus(state),
      scanIntervalSeconds: state.scanIntervalSeconds,
      symbols: state.symbols,
      lastScanAt: state.lastScanAt,
      lastSignalAt: state.lastSignalAt,
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      activeSignalCount: countById.get(meta.id) ?? 0,
    };
  });
}

/**
 * Статус движка для карточки стратегии.
 *
 *  • OFF   — выключена администратором (или строки нет)
 *  • ERROR — включена, но последний скан завершился ошибкой
 *  • ON    — включена и последний скан прошёл
 * Ни одного «выдуманного» состояния: всё выводится из полей БД.
 */
export function deriveStatus(state) {
  if (!state.enabled) return 'OFF';
  if (state.lastError) return 'ERROR';
  return 'ON';
}

/** @param {string} strategyId */
export async function getStrategyState(strategyId) {
  const all = await listStrategyStates();
  return all.find((s) => s.strategyId === strategyId) ?? null;
}

/**
 * Стратегии, которые планировщик должен сканировать.
 * `enabled = false` ⇒ стратегия сюда не попадает ⇒ ноль вычислений.
 */
export async function getEnabledStrategies() {
  const { rows } = await query(
    'SELECT * FROM strategy_settings WHERE enabled = TRUE ORDER BY strategy_id'
  );
  return rows.map(mapRow);
}

/**
 * ВКЛ/ВЫКЛ стратегии. Единственная точка записи флага.
 *
 * Транзакция нужна, чтобы `strategy_settings` и `audit_log` не разошлись:
 * либо записаны оба, либо ни одного.
 *
 * @param {object} p
 * @param {string} p.strategyId
 * @param {boolean} p.enabled
 * @param {string} p.actorUserId
 * @returns {Promise<object>} новое состояние
 */
export async function setStrategyEnabled({ strategyId, enabled, actorUserId }) {
  // Проверка до SQL: неизвестная стратегия отклоняется с 404/400, а не падает
  // в CHECK-ограничение с 500.
  if (!isKnownStrategyId(strategyId)) {
    const err = new Error(`Unknown strategy: ${strategyId}`);
    /** @type {any} */ (err).statusCode = 404;
    throw err;
  }
  if (typeof enabled !== 'boolean') {
    const err = new Error('Field "enabled" must be a boolean');
    /** @type {any} */ (err).statusCode = 400;
    throw err;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Строка создана миграцией; UPDATE ... RETURNING безопаснее, чем upsert:
    // он не может создать четвёртую стратегию.
    const { rows } = await client.query(
      `UPDATE strategy_settings
          SET enabled = $2,
              updated_at = now(),
              updated_by = $3,
              -- снятие ошибки при включении: состояние должно описывать
              -- текущий цикл, а не прошлогодний сбой
              last_error = CASE WHEN $2 THEN NULL ELSE last_error END
        WHERE strategy_id = $1
        RETURNING *`,
      [strategyId, enabled, actorUserId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error(`Strategy row missing: ${strategyId}`);
      /** @type {any} */ (err).statusCode = 404;
      throw err;
    }

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'strategy', $3, $4)`,
      [
        actorUserId,
        enabled ? 'STRATEGY_ENABLED' : 'STRATEGY_DISABLED',
        strategyId,
        JSON.stringify({ strategyId, enabled }),
      ]
    );

    await client.query('COMMIT');
    return mapRow(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Телеметрия после скана. Ошибка не должна ронять процесс, поэтому вызывается
 * из `finally` планировщика.
 */
export async function recordScanResult({ strategyId, error = null }) {
  await query(
    `UPDATE strategy_settings
        SET last_scan_at = now(),
            last_error = $2
      WHERE strategy_id = $1`,
    [strategyId, error]
  );
}

/** Отмечает, что стратегия действительно породила сигнал. */
export async function recordSignalEmitted(strategyId) {
  await query(
    'UPDATE strategy_settings SET last_signal_at = now() WHERE strategy_id = $1',
    [strategyId]
  );
}

/**
 * Сводка для `GET /api/admin/strategies/status`.
 * Все числа — результат реальных запросов.
 */
export async function engineStatus() {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int                                     AS total,
      -- Алиасы в кавычках: pg приводит незакавыченные идентификаторы к нижнему
      -- регистру, и обращение rows[0].enabledCount тихо дало бы undefined.
      COUNT(*) FILTER (WHERE enabled)::int                AS "enabledCount",
      COUNT(*) FILTER (WHERE last_error IS NOT NULL)::int AS "errorCount",
      MAX(last_scan_at)                                 AS "lastScanAt",
      MAX(last_signal_at)                               AS "lastSignalAt"
    FROM strategy_settings
  `);
  const signals = await query(`
    SELECT
      COUNT(*)::int                                        AS total,
      COUNT(*) FILTER (WHERE status = 'ACTIVE')::int       AS "active"
    FROM signals
  `);
  return {
    totalStrategies: rows[0].total,
    enabledCount: rows[0].enabledCount,
    errorCount: rows[0].errorCount,
    lastScanAt: rows[0].lastScanAt ?? null,
    lastSignalAt: rows[0].lastSignalAt ?? null,
    signalsTotal: signals.rows[0].total,
    signalsActive: signals.rows[0].active,
  };
}

// recordAudit импортируется ради явной зависимости маршрутов от аудита;
// запись выполняется внутри транзакции выше, чтобы не расщеплять состояние.
export { recordAudit };
