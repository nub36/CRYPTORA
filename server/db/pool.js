/**
 * CRYPTORA — PostgreSQL Connection Pool
 *
 * Singleton pg.Pool. All queries go through parameterized SQL — never string interpolation.
 *
 * ── Почему здесь есть обработчик `pool.on('error')` ─────────────────────────
 * `pg` доставляет ошибки, случившиеся на ПРОСТАИВАЮЩЕМ (не выданном вызывающему)
 * клиенте, через событие `'error'` самого пула — у такого клиента нет ожидающего
 * промиса, которому можно отдать ошибку. Без слушателя Node трактует это как
 * необработанное событие `'error'` и завершает процесс.
 *
 * Реальный сценарий, который это закрывает (найден по логу CI, F-17):
 * рестарт/failover PostgreSQL, снятие простаивающего соединения
 * (`idle_in_transaction_session_timeout`, `pg_terminate_backend()`, обрыв сети)
 * или остановка БД — сервер отвечает `FATAL 57P01 admin_shutdown`, и процесс
 * бэкенда падал целиком. В CI то же самое выглядело как «красный» прогон при
 * 1176/1176 прошедших тестах: vitest считал такие ошибки unhandled.
 *
 * Что здесь НЕ делается намеренно:
 *  • ошибки АКТИВНЫХ запросов не перехватываются — они уходят вызывающему коду
 *    (промис `query()` реджектится), как и раньше;
 *  • нет глобального проглатывания `uncaughtException`;
 *  • нет «тихого» резервного пути: пул закрыт ⇒ запрос честно отклоняется.
 */

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool;

/**
 * `closePool()` — терминальная операция: после неё пул не пересоздаётся.
 *
 * Иначе любой запрос, долетевший во время остановки процесса, открыл бы НОВОЕ
 * соединение к уже закрывающейся БД и получил бы `FATAL 57P01` без ожидающего
 * промиса (ровно так выглядела гонка в интеграционных тестах).
 */
let closed = false;

/**
 * Структурированная запись об ошибке простаивающего клиента.
 *
 * Печатаются только код/сообщение ошибки и порт: ни пароля, ни строки
 * подключения, ни значений из запросов. `connectionString` содержит секрет и
 * в лог не попадает никогда.
 *
 * @param {unknown} err
 * @param {{ poolTotal?: number, poolIdle?: number }} [meta]
 */
export function formatPoolError(err, meta = {}) {
  const e = /** @type {any} */ (err);
  return {
    event: 'pg_pool_idle_client_error',
    code: typeof e?.code === 'string' ? e.code : null,
    severity: typeof e?.severity === 'string' ? e.severity : null,
    message: e?.message ?? String(err),
    // 57P01 admin_shutdown / 57P02 crash_shutdown / 57P03 cannot_connect_now —
    // сервер сам завершил простаивающее соединение; клиент уже не используется.
    recoverable: ['57P01', '57P02', '57P03', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(
      String(e?.code ?? '')
    ),
    poolTotal: meta.poolTotal ?? null,
    poolIdle: meta.poolIdle ?? null,
  };
}

/**
 * Вешает на пул обработчик ошибок простаивающих клиентов.
 *
 * Вынесено в отдельную функцию, чтобы (а) его можно было проверить тестом без
 * настоящей БД и (б) любой созданный пул получал слушателя гарантированно.
 *
 * @param {import('pg').Pool} p
 * @param {(entry: object) => void} [log] — инъекция для тестов
 * @returns {import('pg').Pool} тот же пул
 */
export function attachPoolErrorHandlers(p, log) {
  const write =
    log ??
    ((entry) => {
      // eslint-disable-next-line no-console
      console.error('[pg-pool]', JSON.stringify(entry));
    });

  p.on('error', (err) => {
    const entry = formatPoolError(err, {
      poolTotal: typeof p.totalCount === 'number' ? p.totalCount : null,
      poolIdle: typeof p.idleCount === 'number' ? p.idleCount : null,
    });
    try {
      write(entry);
    } catch {
      // Сам логгер не имеет права ронять процесс: мы здесь именно для этого.
    }
    // pg уже удалил проблемный клиент из пула; новых действий не требуется.
    // Ошибки активных запросов сюда не попадают — они уходят вызывающему.
  });

  return p;
}

/**
 * @returns {import('pg').Pool}
 * @throws если пул закрыт (`closePool()`): новое соединение во время остановки
 *   процесса не открывается.
 */
export function getPool() {
  if (closed) {
    throw new Error(
      'PostgreSQL pool is closed (shutdown in progress) — refusing to open a new connection'
    );
  }
  if (!pool) {
    pool = attachPoolErrorHandlers(
      new Pool({
        connectionString: config.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: config.NODE_ENV === 'production' && config.DATABASE_URL.includes('sslmode')
          ? { rejectUnauthorized: false }
          : false,
      })
    );
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

export async function getClient() {
  const p = getPool();
  return p.connect();
}

/**
 * Health check: verify DB connectivity.
 * @returns {Promise<boolean>}
 */
export async function checkDatabase() {
  try {
    const p = getPool();
    await p.query('SELECT 1 AS ok');
    return true;
  } catch {
    // Недоступная БД (или закрытый пул во время остановки) — деградация, не крах.
    return false;
  }
}

/**
 * Закрывает пул. Идемпотентно и ТЕРМИНАЛЬНО: после вызова `getPool()` бросает
 * ошибку, а не создаёт новый пул.
 */
export async function closePool() {
  closed = true;
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/** Закрыт ли пул (диагностика остановки процесса и тесты). */
export function isPoolClosed() {
  return closed;
}

/**
 * Test seam — replace the pool with any object exposing `.query(text, params)`.
 *
 * Used ONLY by the integration suite so the real route handlers, middleware,
 * validators and session layer run against a controlled in-memory DB.
 * Production code never calls this. Every accessor in this module funnels
 * through getPool(), so a single injection point covers query/getClient/
 * checkDatabase.
 *
 * Инъекция снимает флаг `closed`: тест может закрыть пул в teardown одного
 * файла и работать дальше в следующем.
 *
 * @param {{ query: Function, end?: Function, connect?: Function }|null} injected
 */
export function __setPoolForTests(injected) {
  pool = injected;
  closed = false;
}
