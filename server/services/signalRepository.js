/**
 * CRYPTORA — Репозиторий сигналов (PostgreSQL, миграции 007 + 009).
 *
 * Четыре свойства, которые здесь критичны:
 *
 * 1. ДЕДУПЛИКАЦИЯ. Первичная защита — `INSERT … ON CONFLICT
 *    (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING`. Повторное
 *    сканирование того же закрытого бара не создаёт второй сигнал даже при
 *    параллельных сканах. Дополнительная защита — UNIQUE-констрейнт в БД.
 *    `signal_candle_ts` — это `setupOpenTime` сетапа (openTime ЗАКРЫТОГО бара,
 *    на котором он сформирован), а не время публикации: только так повторный
 *    скан и рестарт процесса дают тот же ключ.
 *
 * 2. ПОЛНОТА УРОВНЕЙ. Всё, что посчитала стратегия, сохраняется: лестница целей
 *    целиком (`targets NUMERIC[]`, а не только TP1/TP2), эффективные уровни
 *    после исполнения (`fill_stop`, `fill_targets` — V2.8 сдвигает их на дельту
 *    исполнения) и контекст (`strategy_version`, `entry_type`, `valid_for_bars`,
 *    `exit_rule`). `tp1`/`tp2` остаются как производные от лестницы — для
 *    совместимости с 007 и с hash-формой v1.
 *
 * 3. ЖИЗНЕННЫЙ ЦИКЛ. Домен статуса совпадает с ядром (`SetupStatus`):
 *    ACTIVE → FILLED → TARGET_REACHED | INVALIDATED | CLOSED, либо
 *    ACTIVE → EXPIRED | CANCELLED | UNRESOLVED. Переходы монотонны: закрытую
 *    строку изменить нельзя. Никакой новой торговой механики здесь нет —
 *    хранится то, что frozen-ядро уже определило по закрытым свечам.
 *
 * 4. APPEND-ONLY ЦЕПОЧКА SHA-256. Формат — как в клиентском SignalsAuditLedger:
 *        hash = 'sha256-' + sha256hex(JSON({...payload, prevHash}))
 *        previous_hash = 'GENESIS' для первой записи
 *    С миграции 009 (`chain_version = 2`) цепочка считается ТОЛЬКО по
 *    неизменяемой части публикации (issuance), а изменяемый исход хэшируется
 *    отдельно в `outcome_hash` — ровно как в браузерном журнале (`auditHash` +
 *    `outcomeHash`). Строки `chain_version = 1` проверяются прежней формой
 *    payload'а, поэтому старые цепочки не «ломаются» этим PR.
 *
 *    ⚠️ Серверная цепочка — НЕ та же цепочка, что в localStorage браузера:
 *    payload'ы разные (сервер хэширует строку БД, браузер — объект сетапа),
 *    поэтому `hash` строки и `auditHash` записи журнала не равны и не должны
 *    сверяться между собой. Совпадает семантика: append-only, sha256, GENESIS,
 *    отдельный хэш исхода.
 *
 * 5. ПОСЛЕДОВАТЕЛЬНАЯ ДОПИСЬ. `previous_hash` зависит от предыдущей строки,
 *    поэтому параллельные вставки нужно сериализовать. Используется
 *    транзакционный advisory lock — он освобождается автоматически на COMMIT/
 *    ROLLBACK и не может «утечь», в отличие от прикладного мьютекса.
 */

import crypto from 'node:crypto';
import { query, getClient } from '../db/pool.js';

/** Фиксированный ключ advisory lock для сериализации дописи в цепочку. */
export const SIGNAL_CHAIN_LOCK_KEY = 730117;

export const GENESIS = 'GENESIS';

/** Форма hash-payload'а, которую пишет этот код (миграция 009). */
export const CHAIN_VERSION = 2;

/**
 * Полный домен статуса — тот же, что у ядра (`SetupStatus` в
 * src/services/signals/SignalsAuditLedger.ts) и у CHECK-ограничения 009.
 */
export const SIGNAL_STATUSES = Object.freeze([
  'ACTIVE',
  'FILLED',
  'TARGET_REACHED',
  'INVALIDATED',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
  'UNRESOLVED',
]);

/** Незакрытые состояния: сетап живёт (ждёт входа или уже в позиции). */
export const OPEN_SIGNAL_STATUSES = Object.freeze(['ACTIVE', 'FILLED']);

/** Терминальные состояния: строку больше нельзя изменить. */
export const CLOSED_SIGNAL_STATUSES = Object.freeze([
  'TARGET_REACHED',
  'INVALIDATED',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
  'UNRESOLVED',
]);

/** Состояния, при которых сделка реально состоялась и у неё есть R. */
export const TRADE_CLOSED_STATUSES = Object.freeze(['TARGET_REACHED', 'INVALIDATED', 'CLOSED']);

/** Состояния, при которых сделки НЕ было (R отсутствует по смыслу, а не «0»). */
export const NO_TRADE_STATUSES = Object.freeze(['EXPIRED', 'CANCELLED', 'UNRESOLVED']);

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** pg отдаёт NUMERIC[] массивом строк; null остаётся null («нет данных» ≠ []). */
function numArray(v) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  return v.map((x) => (x === null || x === undefined ? null : Number(x)));
}

/** Канонический JSON: ключи объектов отсортированы, поэтому хэш стабилен. */
function canonicalJson(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalJson(value[k]);
    return out;
  }
  return value;
}

/**
 * Хэш записи. Формат тот же, что в клиентском ledger (`sha256-` + hex).
 * @param {object} payload — поля сигнала без hash/previous_hash
 * @param {string} prevHash
 */
export function computeSignalHash(payload, prevHash) {
  const body = JSON.stringify({ ...payload, prevHash });
  return `sha256-${crypto.createHash('sha256').update(body).digest('hex')}`;
}

/** Хэш изменяемой части (исход). prevHash не участвует: это не цепочка. */
export function computeOutcomeHash(payload) {
  const body = JSON.stringify(payload);
  return `sha256-${crypto.createHash('sha256').update(body).digest('hex')}`;
}

/**
 * Payload формы 007 (`chain_version = 1`). Сохранён БЕЗ ИЗМЕНЕНИЙ: по нему
 * проверяются строки, записанные до миграции 009.
 */
function hashPayloadV1(row) {
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
 * Payload формы 009 (`chain_version = 2`): ТОЛЬКО неизменяемая публикация.
 *
 * `status` сюда сознательно не входит: он меняется на протяжении жизненного
 * цикла, а цепочка публикации обязана оставаться верифицируемой после
 * перехода. Изменяемая часть покрыта `outcome_hash`.
 */
function hashPayloadV2(row) {
  return {
    chainVersion: 2,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version ?? null,
    engineSetupId: row.engine_setup_id ?? null,
    symbol: row.symbol,
    timeframe: row.timeframe,
    direction: row.direction,
    signalCandleTs: new Date(row.signal_candle_ts).toISOString(),
    entryType: row.entry_type ?? null,
    validForBars: row.valid_for_bars ?? null,
    exitRule: row.exit_rule ?? null,
    entryMin: num(row.entry_min),
    entryMax: num(row.entry_max),
    stopLoss: num(row.stop_loss),
    tp1: num(row.tp1),
    tp2: num(row.tp2),
    targets: numArray(row.targets),
    metadata: canonicalJson(row.metadata ?? null),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Payload исхода (зеркало `canonicalOutcome` клиентского журнала): якорь —
 * `hash` публикации, далее всё, что может измениться после неё.
 */
export function outcomePayload(row) {
  const hasFill = row.fill_price !== null && row.fill_price !== undefined;
  return {
    hash: row.hash,
    status: row.status,
    fill: hasFill
      ? {
          price: num(row.fill_price),
          at: row.filled_at ? new Date(row.filled_at).toISOString() : null,
          stop: num(row.fill_stop),
          targets: numArray(row.fill_targets),
        }
      : null,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    closePrice: num(row.close_price),
    closeReason: row.close_reason ?? null,
    resultR: num(row.result_r),
    netResultR: num(row.net_result_r),
    pnlResultPct: num(row.pnl_result_pct),
    barsHeld: row.bars_held ?? null,
  };
}

/** Payload нужной формы — по `chain_version` строки. */
function hashPayloadFor(row) {
  return Number(row.chain_version ?? 1) === 2 ? hashPayloadV2(row) : hashPayloadV1(row);
}

/**
 * Уровни сигнала из того, что предоставил вызывающий.
 *
 * Канонический источник — лестница `targets`. `tp1`/`tp2` производны от неё и
 * нужны для совместимости с 007/API и с hash-формой v1. Если лестницы нет
 * (старый вызов, тест), она собирается из tp1/tp2 в порядке возрастания цели.
 *
 * @returns {{tp1: number|null, tp2: number|null, targets: number[]|null}}
 */
export function resolveLevels({ targets, tp1, tp2 } = {}) {
  if (Array.isArray(targets) && targets.length > 0) {
    const ladder = targets.map((t) => num(t)).filter((t) => t !== null);
    return { tp1: ladder[0] ?? null, tp2: ladder[1] ?? null, targets: ladder };
  }
  const ladder = [num(tp1), num(tp2)].filter((t) => t !== null);
  return { tp1: num(tp1), tp2: num(tp2), targets: ladder.length > 0 ? ladder : null };
}

/**
 * Приводит строку signals к форме API. NUMERIC приходит строкой — приводим к
 * числу, но null остаётся null: «нет данных» ≠ 0.
 */
function mapRow(r) {
  return {
    id: r.id,
    strategyId: r.strategy_id,
    strategyVersion: r.strategy_version ?? null,
    engineSetupId: r.engine_setup_id ?? null,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction,
    /** openTime закрытого бара сетапа (setupOpenTime ядра). */
    signalCandleTs: r.signal_candle_ts,
    entryType: r.entry_type ?? null,
    validForBars: r.valid_for_bars ?? null,
    exitRule: r.exit_rule ?? null,
    entryMin: num(r.entry_min),
    entryMax: num(r.entry_max),
    stopLoss: num(r.stop_loss),
    tp1: num(r.tp1),
    tp2: num(r.tp2),
    /** Полная лестница целей TP1..TPn — то, что посчитала стратегия. */
    targets: numArray(r.targets),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // ── Исполнение ──
    fillPrice: num(r.fill_price),
    filledAt: r.filled_at ?? null,
    /** Эффективный стоп после исполнения (null = сдвига не было). */
    fillStop: num(r.fill_stop),
    /** Эффективные цели после исполнения (null = сдвига не было). */
    fillTargets: numArray(r.fill_targets),
    // ── Исход ──
    closedAt: r.closed_at ?? null,
    closePrice: num(r.close_price),
    closeReason: r.close_reason ?? null,
    resultR: num(r.result_r),
    netResultR: num(r.net_result_r),
    pnlResultPct: num(r.pnl_result_pct),
    barsHeld: r.bars_held ?? null,
    // ── Целостность ──
    metadata: r.metadata ?? null,
    hash: r.hash,
    previousHash: r.previous_hash,
    outcomeHash: r.outcome_hash ?? null,
    chainVersion: Number(r.chain_version ?? 1),
    // ── Журнал наблюдения (миграция 010; не влияет на уровни и хэши) ──
    monitorCheckCount: Number(r.monitor_check_count ?? 0),
    monitorLastCheckAt: r.monitor_last_check_at ?? null,
    monitorLastResult: r.monitor_last_result ?? null,
    monitorLastError: r.monitor_last_error ?? null,
  };
}

/** Колонки вставки — единый список для INSERT и для формы строки. */
const INSERT_COLUMNS = [
  'strategy_id', 'strategy_version', 'engine_setup_id', 'symbol', 'timeframe',
  'direction', 'signal_candle_ts', 'entry_type', 'valid_for_bars', 'exit_rule',
  'entry_min', 'entry_max', 'stop_loss', 'tp1', 'tp2', 'targets',
  'status', 'created_at', 'metadata', 'hash', 'previous_hash', 'chain_version',
];

/**
 * Добавляет сигнал, если его ещё нет.
 *
 * @returns {Promise<{inserted: boolean, signal: object|null}>}
 *   inserted=false — сигнал на этот бар уже был (дедупликация сработала).
 */
export async function insertSignal(signal) {
  const levels = resolveLevels(signal);
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
     * Строка в форме БД — ОДИН объект используется и для хэша, и для вставки,
     * поэтому payload и колонки не могут разойтись.
     */
    const row = {
      strategy_id: signal.strategyId,
      strategy_version: signal.strategyVersion ?? null,
      engine_setup_id: signal.engineSetupId ?? null,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      signal_candle_ts: signal.signalCandleTs,
      entry_type: signal.entryType ?? null,
      valid_for_bars: signal.validForBars ?? null,
      exit_rule: signal.exitRule ?? null,
      entry_min: signal.entryMin ?? null,
      entry_max: signal.entryMax ?? null,
      stop_loss: signal.stopLoss ?? null,
      tp1: levels.tp1,
      tp2: levels.tp2,
      targets: levels.targets,
      status,
      created_at: createdAt,
      metadata: signal.metadata ?? null,
      chain_version: CHAIN_VERSION,
    };

    const hash = computeSignalHash(hashPayloadV2(row), prevHash);

    // Порядок значений — строго INSERT_COLUMNS; расхождение было бы тихой
    // записью не в ту колонку, поэтому список один и для колонок, и для значений.
    const values = INSERT_COLUMNS.map((column) => {
      if (column === 'metadata') {
        return row.metadata === null || row.metadata === undefined ? null : JSON.stringify(row.metadata);
      }
      if (column === 'hash') return hash;
      if (column === 'previous_hash') return prevHash;
      return row[column];
    });

    const placeholders = INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await client.query(
      `INSERT INTO signals (${INSERT_COLUMNS.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING
       RETURNING *`,
      values
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
 * Фильтр выборки — общий для `listSignals` и `countSignals`, чтобы pagination
 * и счётчик не могли разойтись.
 */
function buildWhere({ strategyId, status, statuses, symbol, direction } = {}) {
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
  // Набор состояний (например, «открытые» = ACTIVE + FILLED) — один параметр
  // массивом, а не OR-цепочка: так фильтр и счётчик не могут разойтись.
  if (Array.isArray(statuses) && statuses.length > 0) {
    params.push(statuses);
    where.push(`status = ANY($${params.length})`);
  }
  if (symbol) {
    params.push(symbol.toUpperCase());
    where.push(`upper(symbol) = $${params.length}`);
  }
  if (direction) {
    params.push(direction.toUpperCase());
    where.push(`direction = $${params.length}`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** Пределы страницы: лента сигналов не может быть бесконечной. */
export const MAX_SIGNALS_LIMIT = 200;
export const DEFAULT_SIGNALS_LIMIT = 50;
export const MAX_SIGNALS_OFFSET = 5000;

/**
 * Граница рабочего набора для синхронизации жизненного цикла: сколько
 * незакрытых сигналов одной стратегии движок сопоставляет с реплеем за скан.
 * Ограничение защищает от роста числа UPDATE вместе с числом сигналов;
 * необработанные строки добираются следующим сканом (реплей окна
 * детерминирован и пересчитывается целиком).
 */
export const MAX_OPEN_SIGNALS_FOR_SYNC = 500;

/**
 * Выборка для `GET /api/signals`.
 * Все фильтры необязательны и комбинируются; значения всегда параметризованы.
 * Порядок детерминирован: новые сверху, внутри одной `created_at` — по id.
 */
export async function listSignals({
  strategyId, status, statuses, symbol, direction,
  limit = DEFAULT_SIGNALS_LIMIT, offset = 0,
} = {}) {
  const { clause, params } = buildWhere({ strategyId, status, statuses, symbol, direction });

  params.push(Math.min(Math.max(Number(limit) || DEFAULT_SIGNALS_LIMIT, 1), MAX_SIGNALS_LIMIT));
  const limitIdx = params.length;
  params.push(Math.min(Math.max(Number(offset) || 0, 0), MAX_SIGNALS_OFFSET));
  const offsetIdx = params.length;

  const sql = `SELECT * FROM signals
               ${clause}
               ORDER BY created_at DESC, id DESC
               LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

/** Сколько всего строк под фильтром — нужно для честной пагинации ленты. */
export async function countSignals(filters = {}) {
  const { clause, params } = buildWhere(filters);
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM signals ${clause}`, params);
  return rows[0].n;
}

/**
 * Незакрытые сигналы стратегии (ACTIVE + FILLED) — рабочий набор для
 * синхронизации жизненного цикла после скана.
 *
 * Один запрос с явной границей: движок сопоставляет с ним записи реплея,
 * поэтому число UPDATE не может превысить число открытых сигналов, а не число
 * баров в окне (никакой «бури запросов» на каждом скане).
 *
 * @param {string} [strategyId]
 * @param {number} [limit]
 */
export async function listOpenSignals(strategyId, limit = MAX_OPEN_SIGNALS_FOR_SYNC) {
  const params = [OPEN_SIGNAL_STATUSES];
  let sql = `SELECT * FROM signals WHERE status = ANY($1)`;
  if (strategyId) {
    params.push(strategyId);
    sql += ` AND strategy_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || MAX_OPEN_SIGNALS_FOR_SYNC, 1), MAX_OPEN_SIGNALS_FOR_SYNC));
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

/**
 * Реальное число НЕЗАКРЫТЫХ сигналов — источник для счётчика на /strategies.
 *
 * «Активный» = живой сетап: ждёт входа (ACTIVE) или уже в позиции (FILLED) —
 * тот же смысл, что у `SignalsAuditLedger.getActiveSetups()`.
 */
export async function countActiveSignals(strategyId) {
  const params = [OPEN_SIGNAL_STATUSES];
  const base = strategyId
    ? `SELECT COUNT(*)::int AS n FROM signals WHERE status = ANY($1) AND strategy_id=$2`
    : `SELECT COUNT(*)::int AS n FROM signals WHERE status = ANY($1)`;
  if (strategyId) params.push(strategyId);
  const { rows } = await query(base, params);
  return rows[0].n;
}

/**
 * Общая запись перехода: ONE UPDATE, монотонно, с пересчётом `outcome_hash`.
 *
 * Закрытую строку изменить нельзя (append-only журнал): если статус уже
 * терминальный, обновление не выполняется и это честно возвращается.
 */
async function writeLifecycle(id, patch) {
  const sets = [];
  const params = [];
  const push = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.status !== undefined) push('status', patch.status);
  if (patch.fillPrice !== undefined) push('fill_price', patch.fillPrice);
  if (patch.filledAt !== undefined) push('filled_at', patch.filledAt);
  if (patch.fillStop !== undefined) push('fill_stop', patch.fillStop);
  if (patch.fillTargets !== undefined) push('fill_targets', patch.fillTargets);
  if (patch.closedAt !== undefined) push('closed_at', patch.closedAt);
  if (patch.closePrice !== undefined) push('close_price', patch.closePrice);
  if (patch.closeReason !== undefined) push('close_reason', patch.closeReason);
  if (patch.resultR !== undefined) push('result_r', patch.resultR);
  if (patch.netResultR !== undefined) push('net_result_r', patch.netResultR);
  if (patch.pnlResultPct !== undefined) push('pnl_result_pct', patch.pnlResultPct);
  if (patch.barsHeld !== undefined) push('bars_held', patch.barsHeld);
  if (sets.length === 0) return { changed: false, signal: null, reason: 'EMPTY_PATCH' };

  /**
   * Транзакция + блокировка строки: `outcome_hash` считается от строки ПОСЛЕ
   * обновления, поэтому читать и писать её нужно атомарно. Иначе параллельные
   * «исполнение» и «исход» записали бы хэш от устаревшего состояния.
   */
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM signals WHERE id = $1 FOR UPDATE', [id]);
    if (current.rows.length === 0) {
      await client.query('COMMIT');
      return { changed: false, signal: null, reason: 'NOT_FOUND' };
    }
    const row = current.rows[0];
    if (CLOSED_SIGNAL_STATUSES.includes(row.status)) {
      await client.query('COMMIT');
      return { changed: false, signal: mapRow(row), reason: 'ALREADY_CLOSED' };
    }

    const next = {
      ...row,
      status: patch.status ?? row.status,
      fill_price: patch.fillPrice !== undefined ? patch.fillPrice : row.fill_price,
      filled_at: patch.filledAt !== undefined ? patch.filledAt : row.filled_at,
      fill_stop: patch.fillStop !== undefined ? patch.fillStop : row.fill_stop,
      fill_targets: patch.fillTargets !== undefined ? patch.fillTargets : row.fill_targets,
      closed_at: patch.closedAt !== undefined ? patch.closedAt : row.closed_at,
      close_price: patch.closePrice !== undefined ? patch.closePrice : row.close_price,
      close_reason: patch.closeReason !== undefined ? patch.closeReason : row.close_reason,
      result_r: patch.resultR !== undefined ? patch.resultR : row.result_r,
      net_result_r: patch.netResultR !== undefined ? patch.netResultR : row.net_result_r,
      pnl_result_pct: patch.pnlResultPct !== undefined ? patch.pnlResultPct : row.pnl_result_pct,
      bars_held: patch.barsHeld !== undefined ? patch.barsHeld : row.bars_held,
    };
    push('outcome_hash', computeOutcomeHash(outcomePayload(next)));

    params.push(id);
    const idIdx = params.length;
    params.push(OPEN_SIGNAL_STATUSES);
    const openIdx = params.length;

    const { rows } = await client.query(
      `UPDATE signals SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND status = ANY($${openIdx})
        RETURNING *`,
      params
    );
    await client.query('COMMIT');
    // Страховка от гонки вне транзакции: монотонность важнее скорости.
    if (rows.length === 0) return { changed: false, signal: mapRow(row), reason: 'ALREADY_CLOSED' };
    return { changed: true, signal: mapRow(rows[0]), reason: null };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Переводит сигнал в терминальное состояние.
 *
 * @param {string} id
 * @param {typeof CLOSED_SIGNAL_STATUSES[number]} status
 * @param {object} [opts]
 * @param {number|null} [opts.closePrice]
 * @param {string|null} [opts.closeReason] — причина в терминах стратегии (TP2, SL, TIMEOUT…)
 * @param {Date|string|null} [opts.closedAt]
 * @param {number|null} [opts.resultR] — gross R, посчитанный ядром
 * @param {number|null} [opts.netResultR] — net R (2/5 bps), посчитанный ядром
 * @param {number|null} [opts.pnlResultPct]
 * @param {number|null} [opts.barsHeld]
 * @param {{price:number, at?:Date|string|null, stop?:number|null, targets?:number[]|null}|null} [opts.fill]
 * @returns {Promise<object|null>} обновлённая строка или null, если переход не выполнен
 */
export async function closeSignal(id, status, opts = {}) {
  const { changed, signal } = await writeLifecycle(id, {
    status,
    /**
     * `undefined` — время закрытия не указано: берётся текущий момент (ручное
     * закрытие оператором). Явный `null` сохраняется как null: выдуманное
     * время исхода попало бы в `outcome_hash` и в историю, которую никто не
     * сможет воспроизвести.
     */
    closedAt: opts.closedAt === undefined ? new Date() : opts.closedAt,
    closePrice: opts.closePrice ?? null,
    closeReason: opts.closeReason ?? null,
    resultR: opts.resultR ?? null,
    netResultR: opts.netResultR ?? null,
    pnlResultPct: opts.pnlResultPct ?? null,
    barsHeld: opts.barsHeld ?? null,
    ...(opts.fill ? fillPatch(opts.fill) : {}),
  });
  return changed ? signal : null;
}

/** Отметить исполнение: ACTIVE → FILLED (позиция открыта, исход ещё не ясен). */
export async function markSignalFilled(id, fill) {
  const { changed, signal } = await writeLifecycle(id, { status: 'FILLED', ...fillPatch(fill) });
  return changed ? signal : null;
}

function fillPatch(fill) {
  return {
    fillPrice: num(fill?.price) ?? null,
    filledAt: fill?.at ? new Date(fill.at) : (fill?.barOpenTime ? new Date(fill.barOpenTime) : null),
    fillStop: num(fill?.stop) ?? null,
    fillTargets: Array.isArray(fill?.targets) ? fill.targets.map((t) => num(t)) : null,
  };
}

/**
 * Синхронизация жизненного цикла из того, что ядро УЖЕ посчитало.
 *
 * Движок после скана отдаёт записи реплея (`ReplayRecord`), у которых есть
 * `fill` и/или `outcome` по закрытым свечам окна. Здесь они переносятся в
 * строку сигнала, найденную по ключу дедупликации. Никакой новой торговой
 * логики: если ядро исход не определило (`outcome === null`), статус остаётся
 * прежним — «неизвестно» не превращается в «закрыто».
 *
 * @param {object} p
 * @param {string} p.strategyId
 * @param {string} p.symbol — пара в форме БД ('BTC/USDT')
 * @param {string} p.timeframe
 * @param {Date|string|number} p.signalCandleTs — setupOpenTime
 * @param {{price:number, at?:string|Date|null, barOpenTime?:number, stop?:number, targets?:number[]}|null} [p.fill]
 * @param {{status:string, closedAt?:string|Date|null, exitReason?:string|null,
 *          exitPrice?:number|null, resultR?:number|null, netResultR?:number|null,
 *          pnlResultPct?:number|null, barsHeld?:number|null}|null} [p.outcome]
 * @returns {Promise<{found:boolean, changed:boolean, reason:string|null, signal:object|null}>}
 */
export async function syncSignalLifecycle({
  strategyId, symbol, timeframe, signalCandleTs, fill = null, outcome = null,
}) {
  const { rows } = await query(
    `SELECT id, status FROM signals
      WHERE strategy_id = $1 AND symbol = $2 AND timeframe = $3 AND signal_candle_ts = $4`,
    [strategyId, symbol, timeframe, new Date(signalCandleTs)]
  );
  if (rows.length === 0) return { found: false, changed: false, reason: 'NO_SUCH_SIGNAL', signal: null };
  if (CLOSED_SIGNAL_STATUSES.includes(rows[0].status)) {
    return { found: true, changed: false, reason: 'ALREADY_CLOSED', signal: null };
  }

  if (outcome) {
    const res = await closeSignal(rows[0].id, outcome.status, {
      // Время закрытия бара исхода даёт ядро (outcome.closedAt или barOpenTime).
      // Если его нет — честный null, а не «сейчас»: момент исхода относится к
      // данным стратегии, а не к моменту записи в БД.
      closedAt: outcome.closedAt ?? (outcome.barOpenTime ? new Date(outcome.barOpenTime) : null),
      closePrice: num(outcome.exitPrice),
      closeReason: outcome.exitReason ?? null,
      resultR: num(outcome.resultR),
      netResultR: num(outcome.netResultR),
      pnlResultPct: num(outcome.pnlResultPct),
      barsHeld: outcome.barsHeld === undefined ? null : outcome.barsHeld,
      fill: fill ?? undefined,
    });
    return { found: true, changed: res !== null, reason: res ? null : 'ALREADY_CLOSED', signal: res };
  }

  if (fill && rows[0].status === 'ACTIVE') {
    const res = await markSignalFilled(rows[0].id, fill);
    return { found: true, changed: res !== null, reason: res ? null : 'ALREADY_CLOSED', signal: res };
  }

  return { found: true, changed: false, reason: 'NO_TRANSITION', signal: null };
}

/**
 * Проверяет непрерывность цепочки и хэши исходов.
 *
 * Возвращает количество разрывов — для админ-статуса, не для публичного API.
 * Форму payload'а выбирает `chain_version` строки, поэтому строки до миграции
 * 009 продолжают проверяться своей формой.
 *
 * @returns {Promise<{rows:number, breaks:number}>}
 */
export async function verifyChain() {  const { rows } = await query('SELECT * FROM signals ORDER BY created_at ASC, id ASC');
  let expectedPrev = GENESIS;
  let breaks = 0;
  for (const r of rows) {
    const recomputed = computeSignalHash(hashPayloadFor(r), r.previous_hash);
    if (r.previous_hash !== expectedPrev || recomputed !== r.hash) breaks++;
    // Исход хэшируется отдельно; его расхождение — тот же класс поломки.
    if (r.outcome_hash) {
      if (computeOutcomeHash(outcomePayload(r)) !== r.outcome_hash) breaks++;
    } else if (CLOSED_SIGNAL_STATUSES.includes(r.status)) {
      // Закрытая строка обязана нести хэш исхода.
      breaks++;
    }
    expectedPrev = r.hash;
  }
  return { rows: rows.length, breaks };
}

/* -------------------------------------------------------------------------- */
/* Журнал наблюдения (миграция 010)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Допустимые результаты проверки монитором позиций. Домен держится здесь, чтобы
 * SQL-фильтр и код не могли разойтись (CHECK-констрейнт 010 — тот же список).
 */
export const MONITOR_RESULTS = Object.freeze([
  'UNCHANGED', 'FILLED', 'RESOLVED', 'SKIP', 'ERROR', 'OUT_OF_WINDOW',
]);

/**
 * Фиксирует факт проверки сигнала серверным монитором.
 *
 * Это ЖУРНАЛ НАБЛЮДЕНИЯ, а не торговое состояние: уровни, R и хэши он не
 * трогает. Нужен, чтобы отличать «ещё не закрыт» от «монитор не смотрел» и
 * «рынок недоступен». Идемпотентен по смыслу: повторная проверка увеличивает
 * счётчик и перезаписывает результат последней.
 *
 * @param {string} id
 * @param {{result:string, error?:string|null}} patch
 * @returns {Promise<{changed:boolean}>}
 */
export async function recordSignalMonitorCheck(id, { result, error = null }) {
  if (!MONITOR_RESULTS.includes(result)) {
    const err = new Error(`Unknown monitor result: ${String(result)}`);
    /** @type {any} */ (err).statusCode = 400;
    throw err;
  }
  const { rows } = await query(
    `UPDATE signals
        SET monitor_check_count  = monitor_check_count + 1,
            monitor_last_check_at = now(),
            monitor_last_result  = $2,
            monitor_last_error   = $3,
            updated_at           = now()
      WHERE id = $1
      RETURNING id`,
    [id, result, error ?? null]
  );
  // Статус и `outcome_hash` здесь намеренно НЕ пишутся: их изменяет только
  // `syncSignalLifecycle` (через `writeLifecycle`). Иначе журнал наблюдения
  // стал бы вторым источником правды о жизненном цикле.
  return { changed: rows.length > 0 };
}

/** Телеметрия монитора (одна строка, id = 1). */
export async function readMonitorState() {
  const { rows } = await query('SELECT * FROM signal_monitor_state WHERE id = 1');
  return rows.length > 0 ? mapMonitorState(rows[0]) : null;
}

function mapMonitorState(r) {
  return {
    running: Boolean(r.running),
    lastTickStartedAt: r.last_tick_started_at ?? null,
    lastTickFinishedAt: r.last_tick_finished_at ?? null,
    lastTickDurationMs: r.last_tick_duration_ms ?? null,
    lastError: r.last_error ?? null,
    lastOpenSignals: r.last_open_signals ?? null,
    lastGroups: r.last_groups ?? null,
    lastCandleRequests: r.last_candle_requests ?? null,
    lastResult: r.last_result ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

/**
 * Сохраняет телеметрию тика. Идемпотентна по ключу (id = 1): рестарт процесса
 * не создаёт вторую строку и не теряет предыдущую.
 */
export async function writeMonitorState(state) {
  const { rows } = await query(
    `INSERT INTO signal_monitor_state
       (id, running, last_tick_started_at, last_tick_finished_at, last_tick_duration_ms,
        last_error, last_open_signals, last_groups, last_candle_requests, last_result, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (id) DO UPDATE SET
        running               = EXCLUDED.running,
        last_tick_started_at  = EXCLUDED.last_tick_started_at,
        last_tick_finished_at = EXCLUDED.last_tick_finished_at,
        last_tick_duration_ms = EXCLUDED.last_tick_duration_ms,
        last_error            = EXCLUDED.last_error,
        last_open_signals     = EXCLUDED.last_open_signals,
        last_groups           = EXCLUDED.last_groups,
        last_candle_requests  = EXCLUDED.last_candle_requests,
        last_result           = EXCLUDED.last_result,
        updated_at            = now()
     RETURNING *`,
    [
      Boolean(state.running),
      state.lastTickStartedAt ?? null,
      state.lastTickFinishedAt ?? null,
      state.lastTickDurationMs ?? null,
      state.lastError ?? null,
      state.lastOpenSignals ?? null,
      state.lastGroups ?? null,
      state.lastCandleRequests ?? null,
      state.lastResult ?? null,
    ]
  );
  return mapMonitorState(rows[0]);
}

/** Сколько открытых сигналов и сколько групп (символ × ТФ) среди них. */
export async function countOpenSignalGroups() {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT (symbol, timeframe))::int AS groups,
            COUNT(*)::int AS open_signals
       FROM signals
      WHERE status = ANY($1)`,
    [[...OPEN_SIGNAL_STATUSES]]
  );
  return { groups: rows[0].groups, openSignals: rows[0].open_signals };
}
