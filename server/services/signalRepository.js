/**
 * CRYPTORA — Репозиторий сигналов (PostgreSQL, миграция 007).
 *
 * Три свойства, которые здесь критичны:
 *
 * 1. ДЕДУПЛИКАЦИЯ. Первичная защита — `INSERT … ON CONFLICT
 *    (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING`. Повторное
 *    сканирование того же закрытого бара не создаёт второй сигнал даже при
 *    параллельных сканах. Дополнительная защита — UNIQUE-констрейнт в БД.
 *
 * 2. APPEND-ONLY ЦЕПОЧКА SHA-256. Формат совпадает с клиентским
 *    SignalsAuditLedger, чтобы семантика не разъехалась:
 *        hash = 'sha256-' + sha256hex(JSON({...payload, prevHash}))
 *        previous_hash = 'GENESIS' для первой записи
 *    Это журнал целостности, а не «блокчейн»: он доказывает, что строки не
 *    редактировали задним числом, и ничего больше.
 *
 * 3. ПОСЛЕДОВАТЕЛЬНАЯ ДОПИСЬ. `previous_hash` зависит от предыдущей строки,
 *    поэтому параллельные вставки нужно сериализовать. Используется
 *    транзакционный advisory lock — он освобождается автоматически на COMMIT/
 *    ROLLBACK и не может «утечь», в отличие от прикладного мьютекса.
 */

import crypto from 'node:crypto';
import { query, getClient } from '../db/pool.js';

/** Фиксированный ключ advisory lock для сериализации дописи в цепочку. */
export const SIGNAL_CHAIN_LOCK_KEY = 730117;

export const GENESIS = 'GENESIS';

/**
 * Хэш записи. Тот же формат, что в клиентском ledger (`sha256-` + hex).
 * @param {object} payload — поля сигнала без hash/previous_hash
 * @param {string} prevHash
 */
export function computeSignalHash(payload, prevHash) {
  const body = JSON.stringify({ ...payload, prevHash });
  return `sha256-${crypto.createHash('sha256').update(body).digest('hex')}`;
}

/** Поля, входящие в хэш. Порядок фиксирован — иначе цепочка не сойдётся. */
function hashPayload(row) {
  return {
    strategyId: row.strategy_id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    direction: row.direction,
    signalCandleTs: new Date(row.signal_candle_ts).toISOString(),
    entryMin: row.entry_min === null ? null : Number(row.entry_min),
    entryMax: row.entry_max === null ? null : Number(row.entry_max),
    stopLoss: row.stop_loss === null ? null : Number(row.stop_loss),
    tp1: row.tp1 === null ? null : Number(row.tp1),
    tp2: row.tp2 === null ? null : Number(row.tp2),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Приводит строку signals к форме API. NUMERIC приходит строкой — приводим к
 * числу, но null остаётся null: «нет данных» ≠ 0.
 */
function mapRow(r) {
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id,
    strategyId: r.strategy_id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction,
    signalCandleTs: r.signal_candle_ts,
    entryMin: num(r.entry_min),
    entryMax: num(r.entry_max),
    stopLoss: num(r.stop_loss),
    tp1: num(r.tp1),
    tp2: num(r.tp2),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at ?? null,
    closePrice: num(r.close_price),
    closeReason: r.close_reason ?? null,
    metadata: r.metadata ?? null,
    hash: r.hash,
    previousHash: r.previous_hash,
  };
}

/**
 * Добавляет сигнал, если его ещё нет.
 *
 * @returns {Promise<{inserted: boolean, signal: object|null}>}
 *   inserted=false — сигнал на этот бар уже был (дедупликация сработала).
 */
export async function insertSignal(signal) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Сериализуем только чтение хвоста + вставку: без этого два параллельных
    // скана прочитали бы один и тот же previous_hash и цепочка раздвоилась бы.
    await client.query('SELECT pg_advisory_xact_lock($1)', [SIGNAL_CHAIN_LOCK_KEY]);

    // Дедупликация ДО чтения хвоста — обычный повторный скан не берёт lock
    // надолго и не создаёт пустых записей в цепочке.
    const dup = await client.query(
      `SELECT id FROM signals
        WHERE strategy_id = $1 AND symbol = $2 AND timeframe = $3 AND signal_candle_ts = $4`,
      [signal.strategyId, signal.symbol, signal.timeframe, signal.signalCandleTs]
    );
    if (dup.rows.length > 0) {
      await client.query('COMMIT');
      return { inserted: false, signal: null };
    }

    const tail = await client.query(
      'SELECT hash FROM signals ORDER BY created_at DESC, id DESC LIMIT 1'
    );
    const prevHash = tail.rows.length > 0 ? tail.rows[0].hash : GENESIS;

    const status = signal.status ?? 'ACTIVE';
    const createdAt = signal.createdAt ?? new Date();

    /**
     * Хэш считается ТОЙ ЖЕ функцией и по ТОЙ ЖЕ форме, что и при проверке
     * (hashPayload читает имена колонок БД). Раньше вставка хэшировала
     * snake_case-объект, а verifyChain пересчитывала по camelCase — цепочка
     * не сходилась. Единая форма исключает расхождение.
     */
    const hash = computeSignalHash(
      hashPayload({
        strategy_id: signal.strategyId,
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        direction: signal.direction,
        signal_candle_ts: signal.signalCandleTs,
        entry_min: signal.entryMin ?? null,
        entry_max: signal.entryMax ?? null,
        stop_loss: signal.stopLoss ?? null,
        tp1: signal.tp1 ?? null,
        tp2: signal.tp2 ?? null,
        status,
        created_at: createdAt,
      }),
      prevHash
    );

    const { rows } = await client.query(
      `INSERT INTO signals
         (strategy_id, symbol, timeframe, direction, signal_candle_ts,
          entry_min, entry_max, stop_loss, tp1, tp2, status, created_at,
          metadata, hash, previous_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING
       RETURNING *`,
      [
        signal.strategyId, signal.symbol, signal.timeframe, signal.direction,
        signal.signalCandleTs,
        signal.entryMin ?? null, signal.entryMax ?? null, signal.stopLoss ?? null,
        signal.tp1 ?? null, signal.tp2 ?? null,
        status, createdAt,
        signal.metadata ? JSON.stringify(signal.metadata) : null,
        hash, prevHash,
      ]
    );

    await client.query('COMMIT');
    if (rows.length === 0) {
      // Гонка: между проверкой и вставкой сигнал добавился из другого скана.
      return { inserted: false, signal: null };
    }
    return { inserted: true, signal: mapRow(rows[0]) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Выборка для `GET /api/signals`.
 * Все фильтры необязательны и комбинируются; значения всегда параметризованы.
 */
export async function listSignals({ strategyId, status, symbol, limit = 50 } = {}) {
  const where = [];
  const params = [];

  if (strategyId) {
    params.push(strategyId);
    where.push(`strategy_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (symbol) {
    params.push(symbol.toUpperCase());
    where.push(`upper(symbol) = $${params.length}`);
  }

  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const limitIdx = params.length;

  const sql = `SELECT * FROM signals
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY created_at DESC, id DESC
               LIMIT $${limitIdx}`;

  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

/** Реальное число активных сигналов — источник для счётчика на /strategies. */
export async function countActiveSignals(strategyId) {
  const { rows } = strategyId
    ? await query(
        `SELECT COUNT(*)::int AS n FROM signals WHERE status='ACTIVE' AND strategy_id=$1`,
        [strategyId]
      )
    : await query(`SELECT COUNT(*)::int AS n FROM signals WHERE status='ACTIVE'`);
  return rows[0].n;
}

/**
 * Переводит сигнал в терминальное состояние.
 * @param {string} id
 * @param {'INVALIDATED'|'TARGET_REACHED'|'EXPIRED'} status
 */
export async function closeSignal(id, status, { closePrice = null, closeReason = null } = {}) {
  const { rows } = await query(
    `UPDATE signals
        SET status = $2, closed_at = now(), close_price = $3, close_reason = $4
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [id, status, closePrice, closeReason]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * Проверяет непрерывность цепочки. Возвращает количество разрывов — для
 * админ-статуса, не для публичного API.
 */
export async function verifyChain() {
  const { rows } = await query('SELECT * FROM signals ORDER BY created_at ASC, id ASC');
  let expectedPrev = GENESIS;
  let breaks = 0;
  for (const r of rows) {
    const recomputed = computeSignalHash(hashPayload(r), r.previous_hash);
    if (r.previous_hash !== expectedPrev || recomputed !== r.hash) breaks++;
    expectedPrev = r.hash;
  }
  return { rows: rows.length, breaks };
}
