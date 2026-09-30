/**
 * CRYPTORA — Тестовые периоды стратегий (миграция 015) на НАСТОЯЩЕМ PostgreSQL.
 *
 * Всё проверяется через НАСТОЯЩИЕ миграции и НАСТОЯЩЕЕ Express-приложение из
 * server/app.js (хелпер embeddedPgHarness). Моков базы данных нет. Единственный
 * «обход» защиты — прямые SQL-проверки и UPDATE users в setup'е (тестовая
 * инфраструктура хелпера, не обход тестируемого кода).
 *
 * ЧТО ПРОВЕРЯЕТСЯ (требования владельца, §19–§20):
 *  1.  первый Run создаётся ACTIVE;
 *  2.  второй Run завершает первый (COMPLETED + ended_at), второй ACTIVE;
 *  3.  максимум один ACTIVE Run на стратегию — ПАРТИЦИОНАЛЬНЫЙ УНИКАЛЬНЫЙ
 *      ИНДЕКСОМ (прямой INSERT второго ACTIVE отклоняется БД, 23505);
 *  4.  V3.3 и V3.4 имеют ACTIVE-периоды независимо;
 *  5.  новый сигнал получает test_run_id текущего ACTIVE Run (server-side);
 *  6.  сигнал без ACTIVE Run → test_run_id = NULL, создаётся штатно;
 *  7.  исторические NULL-сигналы остаются NULL;
 *  8.  старт Run НЕ модифицирует исторические сигналы (строка неизменна);
 *  9.  открытый сигнал завершённого Run остаётся членом старого Run после
 *      исхода — исход считается в статистику Run 1, не Run 2;
 *  10. strategy_settings не изменены;
 *  11. enabled-состояния не изменены;
 *  12. V3.4 остаётся disabled;
 *  13. users не изменены;
 *  14. конкурентное создание Run безопасно (один ACTIVE);
 *  15. non-admin → 401/403;
 *  16. неизвестная стратегия отклоняется.
 *
 * Плюс статистика по периодам: «Все данные» / Run A / Run B (0 сигналов →
 * честные нули и «—», не NaN и не fake 0%) / добавление сигнала в Run B.
 *
 * ПОРЯДОК ТЕСТОВ ВАЖЕН: тесты одного файла выполняются последовательно и
 * делят одну базу. Стратегии распределены по блокам, чтобы блоки не мешали
 * друг другу: V3.4 — создание периодов и членство, V3.3 — независимость и
 * «открытый сигнал через границу периода», V2.8 — NULL-членство и конкуренция,
 * V3.0 — статистика (начинает с чистого состояния «периодов не было»).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { startPgHarness, type PgHarness, type PgHarnessResult } from '../helpers/embeddedPgHarness';

let result: PgHarnessResult;
let h: PgHarness;
let skipReason: string | null = null;

// Модули сервера — импортируются ПОСЛЕ установки DATABASE_URL хелпером.
let signalRepo: any;
let provenance: any;

const V3_0 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V3_3 = 'V3_3_HTF_ZONE_MITIGATION';
const V3_4 = 'V3_4_HTF_ZONE_MITIGATION_QUALITY';
const V2_8 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';

const ADMIN = { email: 'testruns-admin@test.local', password: 'Str0ngPass!234' };
const USER = { email: 'testruns-user@test.local', password: 'Str0ngPass!234' };

/** admin-клиент (сессия) и plain-клиент (без сессии). */
let admin: any;
let plainUser: any;
let anon: any;
/** id администратора — для проверки created_by и audit_log. */
let adminId = '';

/** Счётчик уникальных свечей: дедупликация signals по signal_candle_ts. */
let candleSeq = 0;
function nextCandleTs(): Date {
  candleSeq += 1;
  // Уникальная пара (symbol, candle) не нужна: достаточно уникального ts.
  return new Date(Date.UTC(2026, 8, 1, 0, candleSeq, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Пул до выполнения условия — детерминированные checkpoint'ы гонки: тест не
 * «спит и надеется», а ждёт наблюдаемого состояния PostgreSQL (незавершённый
 * лок конкретного запроса в pg_locks/pg_stat_activity).
 */
async function waitFor(cond: () => Promise<boolean>, timeoutMs = 10_000, stepMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await sleep(stepMs);
  }
  return false;
}

/** Есть ли ожидающий лок бэкенд, чей текущий запрос совпадает с паттерном? */
async function someQueryWaitingOnLock(pattern: string): Promise<boolean> {
  const rows = await h.q(
    `SELECT COUNT(*)::int AS n
       FROM pg_stat_activity a
       JOIN pg_locks l ON l.pid = a.pid AND NOT l.granted
      WHERE a.query ILIKE $1`,
    [pattern]
  );
  return Number(rows[0]?.n ?? 0) >= 1;
}

/**
 * Настоящий путь персистентности: insertSignal из signalRepository.
 * provenance VERIFIED — иначе строка уйдёт в карантин и не попадёт в
 * статистику (миграция 011): тестируем периоды, а не карантин.
 */
async function makeSignal(overrides: Record<string, unknown> = {}) {
  const res = await signalRepo.insertSignal({
    strategyId: V3_4,
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: nextCandleTs(),
    entryMin: 100,
    entryMax: 110,
    stopLoss: 95,
    tp1: 130,
    targets: [130, 150],
    provenanceStatus: provenance.PROVENANCE_VERIFIED,
    ...overrides,
  });
  expect(res.inserted, 'insertSignal должен вставить сигнал').toBe(true);
  return res.signal;
}

/** POST /api/admin/strategy-test-runs через настоящий HTTP. */
async function startRunHttp(strategyId: string, client = admin) {
  return client.post('/api/admin/strategy-test-runs', { strategyId });
}

/** Статистика через публичный endpoint. */
async function stats(query: string) {
  const res = await anon.get(`/api/signals/statistics${query}`);
  expect(res.status, `statistics ${query}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as any;
}

beforeAll(async () => {
  result = await startPgHarness({ prefix: 'cryptora-testruns-' });
  if (!result.ok) {
    skipReason = result.skipReason;
    return;
  }
  h = result.harness;

  signalRepo = await import('../../server/services/signalRepository.js');
  provenance = await import('../../server/services/signalProvenance.js');

  await h.registerAndVerify(ADMIN.email, ADMIN.password, 'admin');
  await h.registerAndVerify(USER.email, USER.password, 'user');
  admin = await h.login(ADMIN.email, ADMIN.password);
  plainUser = await h.login(USER.email, ADMIN.password === USER.password ? USER.password : USER.password);
  anon = new (Object.getPrototypeOf(admin).constructor)((admin as any).base);

  const rows = await h.q('SELECT id FROM users WHERE email = $1', [ADMIN.email]);
  adminId = rows[0].id;
}, 300_000);

afterAll(async () => {
  if (result?.ok) await h.close();
});

/** Пропуск с честной причиной, если embedded PostgreSQL недоступен. */
function guard() {
  return skipReason ? it.skip : it;
}

describe('Стратегия: тестовые периоды — база данных', () => {
  guard()('1. первый Run создаётся ACTIVE и возвращается с newRunId/startedAt/strategyId', async () => {
    const res = await startRunHttp(V3_4);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.strategyId).toBe(V3_4);
    expect(res.body.newRunId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.startedAt).toBeTruthy();
    expect(res.body.previousRunId).toBeNull();

    const rows = await h.q('SELECT * FROM strategy_test_runs WHERE id = $1', [res.body.newRunId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].ended_at).toBeNull();
    expect(rows[0].strategy_id).toBe(V3_4);
    expect(rows[0].strategy_version).toBe('3.4');
    expect(String(rows[0].created_by)).toBe(adminId);
  });

  guard()('аудит: STRATEGY_TEST_RUN_STARTED записан с admin/strategy/run id', async () => {
    const rows = await h.q(
      `SELECT * FROM audit_log WHERE action = 'STRATEGY_TEST_RUN_STARTED' ORDER BY created_at DESC LIMIT 1`
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].actor_user_id)).toBe(adminId);
    expect(rows[0].target_type).toBe('strategy');
    expect(rows[0].target_id).toBe(V3_4);
    const meta = rows[0].metadata;
    expect(meta.newRunId).toBeTruthy();
    expect(meta.previousRunId).toBeNull();
    // Никаких секретов в metadata — только идентификаторы.
    expect(Object.keys(meta).sort()).toEqual(['newRunId', 'previousRunId', 'strategyId', 'strategyVersion']);
  });

  guard()('2. второй Run завершает первый, сам становится ACTIVE', async () => {
    const before = await h.q(
      `SELECT id FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_4]
    );
    expect(before).toHaveLength(1);

    const res = await startRunHttp(V3_4);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.previousRunId).toBe(before[0].id);

    // Первый: COMPLETED с ended_at.
    const first = await h.q('SELECT * FROM strategy_test_runs WHERE id = $1', [before[0].id]);
    expect(first[0].status).toBe('COMPLETED');
    expect(first[0].ended_at).not.toBeNull();

    // Второй: ACTIVE без ended_at; started_at второго >= ended_at первого
    // (один transaction timestamp — «дыры» между периодами нет).
    const second = await h.q('SELECT * FROM strategy_test_runs WHERE id = $1', [res.body.newRunId]);
    expect(second[0].status).toBe('ACTIVE');
    expect(second[0].ended_at).toBeNull();
    expect(new Date(second[0].started_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first[0].ended_at).getTime()
    );

    // Ровно один ACTIVE.
    const active = await h.q(
      `SELECT COUNT(*)::int AS n FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_4]
    );
    expect(active[0].n).toBe(1);
  });

  guard()('3. максимум один ACTIVE Run на стратегию — на уровне PostgreSQL (partial unique index)', async () => {
    // Прямой INSERT в обход всего прикладного кода: БД обязана отказаться.
    let violation: any = null;
    try {
      await h.db.query(
        `INSERT INTO strategy_test_runs (strategy_id) VALUES ($1)`,
        [V3_4]
      );
    } catch (e: any) {
      violation = e;
    }
    expect(violation, 'второй ACTIVE Run обязан отклоняться БД').toBeTruthy();
    expect(violation.code).toBe('23505'); // unique_violation

    // После отказа — по-прежнему один ACTIVE.
    const active = await h.q(
      `SELECT COUNT(*)::int AS n FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_4]
    );
    expect(active[0].n).toBe(1);

    // Несколько COMPLETED у одной стратегии — можно (история периодов).
    const completed = await h.q(
      `SELECT COUNT(*)::int AS n FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'COMPLETED'`,
      [V3_4]
    );
    expect(completed[0].n).toBeGreaterThanOrEqual(1);
  });

  guard()('4. V3.3 и V3.4 имеют ACTIVE-периоды независимо', async () => {
    const res = await startRunHttp(V3_3);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const active = await h.q(
      `SELECT strategy_id, COUNT(*)::int AS n FROM strategy_test_runs
        WHERE status = 'ACTIVE' GROUP BY strategy_id ORDER BY strategy_id`
    );
    const byStrategy = Object.fromEntries(active.map((r: any) => [r.strategy_id, r.n]));
    expect(byStrategy[V3_3]).toBe(1);
    expect(byStrategy[V3_4]).toBe(1);
  });

  guard()('5. новый сигнал получает test_run_id текущего ACTIVE Run (назначает сервер)', async () => {
    const activeRun = await h.q(
      `SELECT id FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_4]
    );
    expect(activeRun).toHaveLength(1);

    const signal = await makeSignal({ strategyId: V3_4, symbol: 'ETH/USDT' });
    // DTO и строка БД говорят одно и то же.
    expect(signal.testRunId).toBe(activeRun[0].id);
    const row = await h.q('SELECT test_run_id FROM signals WHERE id = $1', [signal.id]);
    expect(String(row[0].test_run_id)).toBe(activeRun[0].id);
  });

  guard()('переданный снаружи testRunId игнорируется — фронтенд никогда не назначает членство', async () => {
    const activeRun = await h.q(
      `SELECT id FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_4]
    );
    const fake = '00000000-0000-4000-8000-000000000000';
    const signal = await makeSignal({
      strategyId: V3_4,
      symbol: 'SOL/USDT',
      testRunId: fake,
    });
    expect(signal.testRunId).toBe(activeRun[0].id);
    expect(signal.testRunId).not.toBe(fake);
  });

  guard()('6. сигнал без ACTIVE Run создаётся штатно с test_run_id = NULL', async () => {
    // У V2_8 периода ещё нет.
    const signal = await makeSignal({ strategyId: V2_8, symbol: 'BNB/USDT' });
    expect(signal.testRunId).toBeNull();
    expect(signal.status).toBe('ACTIVE');
  });

  guard()('7+8. старт Run НЕ модифицирует исторические сигналы (NULL остаётся NULL, строка неизменна)', async () => {
    // Полный снимок строки до старта периода V2_8.
    const before = await h.q(
      `SELECT * FROM signals WHERE strategy_id = $1 ORDER BY created_at`,
      [V2_8]
    );
    expect(before).toHaveLength(1);
    expect(before[0].test_run_id).toBeNull();

    const res = await startRunHttp(V2_8);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const after = await h.q(
      `SELECT * FROM signals WHERE strategy_id = $1 ORDER BY created_at`,
      [V2_8]
    );
    expect(after).toHaveLength(1);
    // Ни одно поле исторической строки не изменилось — включая хэши,
    // updated_at (триггер не сработал: UPDATE не было) и test_run_id.
    expect(after[0]).toEqual(before[0]);
  });

  guard()('9. открытый сигнал завершённого Run остаётся членом старого Run после исхода', async () => {
    // Сигнал создаётся в ACTIVE-периоде V3.3 (Run 1).
    const run1 = await h.q(
      `SELECT id FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_3]
    );
    const signal = await makeSignal({ strategyId: V3_3, symbol: 'XRP/USDT' });
    expect(signal.testRunId).toBe(run1[0].id);

    // Начинается Run 2 — Run 1 завершается, сигнал ОСТАЁТСЯ открытым.
    const res = await startRunHttp(V3_3);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const run2Id = res.body.newRunId;
    expect(run2Id).not.toBe(run1[0].id);

    // Исход наступает уже во время Run 2 (TP) — настоящим путём writeLifecycle.
    const closed = await signalRepo.closeSignal(signal.id, 'TARGET_REACHED', {
      closePrice: 140,
      closeReason: 'TP1',
      resultR: 2,
      netResultR: 1.9,
    });
    expect(closed).not.toBeNull();
    expect(closed.status).toBe('TARGET_REACHED');

    // Членство НЕ переехало: сигнал навсегда в Run 1.
    const row = await h.q('SELECT test_run_id, status, result_r FROM signals WHERE id = $1', [signal.id]);
    expect(String(row[0].test_run_id)).toBe(run1[0].id);

    // Исход считается в статистику Run 1, не Run 2.
    const run1Stats = await stats(`?strategyId=${V3_3}&testRunId=${run1[0].id}`);
    expect(run1Stats.totals.published).toBe(1);
    expect(run1Stats.totals.completed).toBe(1);
    expect(run1Stats.totals.wins).toBe(1);

    const run2Stats = await stats(`?strategyId=${V3_3}&testRunId=${run2Id}`);
    expect(run2Stats.totals.published).toBe(0);
    expect(run2Stats.totals.completed).toBe(0);
  });

  guard()('10–12. strategy_settings и enabled-состояния не изменены; V3.4 остаётся disabled', async () => {
    // Миграции 006/014 сеют все четыре стратегии выключенными. Ни одна
    // операция этого набора не включала и не выключала стратегии.
    const settings = await h.q('SELECT strategy_id, enabled FROM strategy_settings ORDER BY strategy_id');
    expect(settings).toHaveLength(4);
    for (const row of settings) {
      expect(row.enabled, `${row.strategy_id} не должна была изменить enabled`).toBe(false);
    }
    const v34 = settings.find((s: any) => s.strategy_id === V3_4);
    expect(v34.enabled).toBe(false);

    // Двойная проверка через публичный API состояния стратегий.
    const res = await anon.get('/api/strategies');
    expect(res.status).toBe(200);
    const v34State = (res.body.strategies as any[]).find((s) => s.strategyId === V3_4);
    expect(v34State.enabled).toBe(false);
    expect(v34State.status).toBe('OFF');
  });

  guard()('13. users не изменены', async () => {
    const rows = await h.q('SELECT id, email, role, is_active FROM users ORDER BY email');
    // Ровно два пользователя, созданных в setup'е: admin и user.
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.role).sort()).toEqual(['admin', 'user']);
  });

  guard()('14. конкурентное создание Run безопасно: ровно один ACTIVE', async () => {
    const before = await h.q(
      `SELECT COUNT(*)::int AS n FROM strategy_test_runs WHERE strategy_id = $1`,
      [V2_8]
    );
    // Два ОДНОВРЕМЕННЫХ старта периода одной стратегии.
    const [a, b] = await Promise.all([startRunHttp(V2_8), startRunHttp(V2_8)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.newRunId).not.toBe(b.body.newRunId);

    const after = await h.q(
      `SELECT id, status FROM strategy_test_runs WHERE strategy_id = $1 ORDER BY started_at`,
      [V2_8]
    );
    expect(after.length - before[0].n).toBe(2); // созданы оба периода
    const active = after.filter((r: any) => r.status === 'ACTIVE');
    expect(active).toHaveLength(1); // но ACTIVE — ровно один
    // Побеждённый период завершён (один из двух ответов завершил чужой ACTIVE).
    const completed = after.filter((r: any) => r.status === 'COMPLETED');
    expect(completed.length).toBe(after.length - 1);
  });

  guard()('15. non-admin запрещён: без сессии 401, обычным пользователем 403', async () => {
    const unauth = await anon.post('/api/admin/strategy-test-runs', { strategyId: V3_4 });
    expect(unauth.status).toBe(401);

    const forbidden = await plainUser.post('/api/admin/strategy-test-runs', { strategyId: V3_4 });
    expect(forbidden.status).toBe(403);

    const forbiddenGet = await plainUser.get(`/api/admin/strategy-test-runs?strategyId=${V3_4}`);
    expect(forbiddenGet.status).toBe(403);

    // И ничего не создалось от этих попыток.
    const active = await h.q(
      `SELECT COUNT(*)::int AS n FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [V3_4]
    );
    expect(active[0].n).toBe(1);
  });

  guard()('16. неизвестная стратегия отклоняется (не доверяем ID с клиента)', async () => {
    const res = await startRunHttp('NOT_A_REAL_STRATEGY');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('UNKNOWN_STRATEGY');

    // Пустое тело / без strategyId — тоже 404, а не 500.
    const empty = await admin.post('/api/admin/strategy-test-runs', {});
    expect(empty.status).toBe(404);

    // Публичные endpoints валидируют стратегию так же.
    const runs = await anon.get(`/api/signals/test-runs?strategyId=NOT_A_REAL_STRATEGY`);
    expect(runs.status).toBe(400);
    const noStrategy = await anon.get('/api/signals/test-runs');
    expect(noStrategy.status).toBe(400);

    // Неверная форма testRunId в статистике — 400, а не пустые данные.
    const badRun = await anon.get(`/api/signals/statistics?testRunId=not-a-uuid`);
    expect(badRun.status).toBe(400);
  });

  guard()('админский GET отдаёт состояние раздела: enabled, текущий период, историю', async () => {
    const res = await admin.get(`/api/admin/strategy-test-runs?strategyId=${V3_4}`);
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.strategyId).toBe(V3_4);
    expect(body.enabled).toBe(false); // V3.4 не включилась от тестовых периодов
    expect(body.currentRun).not.toBeNull();
    expect(body.currentRun.status).toBe('ACTIVE');
    expect(body.currentRun.signalCount).toBe(2); // два сигнала из тестов 5
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    expect(body.runs[0].status).toBe('ACTIVE'); // новые сверху
  });

  guard()('публичный GET /api/signals/test-runs отдаёт периоды стратегии', async () => {
    const res = await anon.get(`/api/signals/test-runs?strategyId=${V3_4}`);
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.strategyId).toBe(V3_4);
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    expect(body.runs[0].status).toBe('ACTIVE');
    expect(typeof body.runs[0].signalCount).toBe('number');
  });
});

describe('Стратегия: тестовые периоды — статистика (§20)', () => {
  // V3_0 до этого блока периодов не имела; сигналов тоже.
  let runAId = '';
  let runBId = '';

  guard()('исторические сигналы до периодов: test_run_id = NULL', async () => {
    const any = await h.q(`SELECT COUNT(*)::int AS n FROM strategy_test_runs WHERE strategy_id = $1`, [V3_0]);
    expect(any[0].n).toBe(0);

    // Два исторических сигнала: один завершился сделкой (win), один без сделки.
    const win = await makeSignal({ strategyId: V3_0, symbol: 'DOGE/USDT' });
    const closedWin = await signalRepo.closeSignal(win.id, 'TARGET_REACHED', {
      closePrice: 0.5,
      closeReason: 'TP2',
      resultR: 1.5,
      netResultR: 1.4,
    });
    expect(closedWin.status).toBe('TARGET_REACHED');

    const noTrade = await makeSignal({ strategyId: V3_0, symbol: 'LTC/USDT' });
    const expired = await signalRepo.closeSignal(noTrade.id, 'EXPIRED', { closePrice: 0.2 });
    expect(expired.status).toBe('EXPIRED');

    const rows = await h.q('SELECT test_run_id FROM signals WHERE strategy_id = $1', [V3_0]);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.test_run_id).toBeNull();
  });

  guard()('Run A получает свои сигналы; Run B начинается с нуля', async () => {
    // Run A + три сигнала-члена: win, loss и открытый.
    const resA = await startRunHttp(V3_0);
    expect(resA.status).toBe(201);
    runAId = resA.body.newRunId;

    const win = await makeSignal({ strategyId: V3_0, symbol: 'ADA/USDT' });
    await signalRepo.closeSignal(win.id, 'TARGET_REACHED', { closePrice: 1, closeReason: 'TP1', resultR: 2, netResultR: 1.9 });

    const loss = await makeSignal({ strategyId: V3_0, symbol: 'LINK/USDT' });
    await signalRepo.closeSignal(loss.id, 'INVALIDATED', { closePrice: 0.9, closeReason: 'SL', resultR: -1, netResultR: -1.03 });

    await makeSignal({ strategyId: V3_0, symbol: 'AVAX/USDT' }); // остаётся ACTIVE

    // Run B — завершает A, членов не имеет.
    const resB = await startRunHttp(V3_0);
    expect(resB.status).toBe(201);
    runBId = resB.body.newRunId;
    expect(resB.body.previousRunId).toBe(runAId);

    const members = await h.q(
      'SELECT test_run_id, COUNT(*)::int AS n FROM signals WHERE strategy_id = $1 GROUP BY test_run_id',
      [V3_0]
    );
    const byRun = Object.fromEntries(members.map((r: any) => [r.test_run_id ?? 'NULL', r.n]));
    expect(byRun.NULL).toBe(2); // исторические
    expect(byRun[runAId]).toBe(3); // члены Run A
  });

  guard()('«Все данные» видит всё: историю и периоды', async () => {
    const all = await stats(`?strategyId=${V3_0}`);
    expect(all.totals.published).toBe(5); // 2 исторических + 3 члена Run A
    expect(all.totals.completed).toBe(3); // win + loss (Run A) + win (история)
    expect(all.totals.wins).toBe(2);
    expect(all.totals.losses).toBe(1);
    expect(all.totals.expired).toBe(1);
    expect(all.filters.testRunId).toBeNull();

    // «До тестовых периодов» — только исторические NULL-строки.
    const pre = await stats(`?strategyId=${V3_0}&testRunId=none`);
    expect(pre.totals.published).toBe(2);
    expect(pre.totals.completed).toBe(1);
    expect(pre.totals.wins).toBe(1);
    expect(pre.totals.expired).toBe(1);
  });

  guard()('Run A видит ТОЛЬКО свои сигналы-члены', async () => {
    const a = await stats(`?strategyId=${V3_0}&testRunId=${runAId}`);
    expect(a.totals.published).toBe(3);
    expect(a.totals.completed).toBe(2);
    expect(a.totals.wins).toBe(1);
    expect(a.totals.losses).toBe(1);
    expect(a.totals.waitingEntry).toBe(1); // открытый сигнал Run A
    expect(a.totals.avgNetR).not.toBeNull();
    expect(a.totals.winRatePct).toBe(50);
    // Никакие исторические и никакие V3.4/V3.3 сигналы сюда не попали.
    expect(a.byStrategy).toHaveLength(1);
    expect(a.byStrategy[0].strategyId).toBe(V3_0);
  });

  guard()('Run B: нулевая статистика — нули и «—», не NaN и не fake 0%', async () => {
    const b = await stats(`?strategyId=${V3_0}&testRunId=${runBId}`);
    expect(b.totals.published).toBe(0);
    expect(b.totals.waitingEntry).toBe(0);
    expect(b.totals.filled).toBe(0);
    expect(b.totals.completed).toBe(0);
    expect(b.totals.wins).toBe(0);
    expect(b.totals.losses).toBe(0);
    expect(b.totals.breakEven).toBe(0);
    expect(b.totals.cancelled + b.totals.expired + b.totals.unresolved).toBe(0);
    // Знаменатель ноль → null, а не 0 и не NaN.
    expect(b.totals.winRatePct).toBeNull();
    expect(b.totals.avgNetR).toBeNull();
    expect(b.totals.avgGrossR).toBeNull();
    expect(b.totals.fillRatePct).toBeNull();
    expect(b.totals.completionRatePct).toBeNull();
  });

  guard()('сигнал в Run B делает его Published = 1 (периоды живые)', async () => {
    const signal = await makeSignal({ strategyId: V3_0, symbol: 'DOT/USDT' });
    expect(signal.testRunId).toBe(runBId);

    const b = await stats(`?strategyId=${V3_0}&testRunId=${runBId}`);
    expect(b.totals.published).toBe(1);
    expect(b.totals.waitingEntry).toBe(1);
    expect(b.totals.completed).toBe(0);
    expect(b.totals.winRatePct).toBeNull();

    // Run A не «двинулся» от нового сигнала Run B.
    const a = await stats(`?strategyId=${V3_0}&testRunId=${runAId}`);
    expect(a.totals.published).toBe(3);
  });

  guard()('фильтр по членству, а не по created_at: сигнал Run B не «утекает» в Run A по времени', async () => {
    // Все сигналы Run B созданы ПОЗЖЕ started_at Run A — если бы период
    // считался как created_at >= started_at, Run A подхватил бы их. Authoritative
    // членство = test_run_id: Run A остаётся при своих трёх.
    const a = await stats(`?strategyId=${V3_0}&testRunId=${runAId}`);
    expect(a.totals.published).toBe(3);

    const b = await stats(`?strategyId=${V3_0}&testRunId=${runBId}`);
    expect(b.totals.published).toBe(1);
  });
});

/**
 * Сериализация startRun ↔ insertSignal (race-аудит перед merge).
 *
 * ИНВАРИАНТ: после COMMIT нового Run B ни один сигнал, закоммиченный после
 * этой границы (после успешного ответа startRun), не может получить членство
 * в завершённом (COMPLETED) Run A. Границу держит пара строчных блокировок на
 * ОДНОЙ строке strategy_settings: insertSignal — FOR KEY SHARE до чтения
 * членства, startStrategyTestRun — FOR UPDATE до завершения старого периода.
 *
 * Оба теста ДЕТЕРМИНИРОВАННЫ: позиции участников фиксируются наблюдаемым
 * состоянием PostgreSQL (незавершённый лок конкретного запроса), а не сном.
 * Порядок пробуждения гарантирован самими блокировками, а не таймингом.
 *
 * Воспроизведение гонки без фикса (plain SELECT ACTIVE без KEY SHARE):
 * T1 читает членство Run A → T2 стартует и коммитит Run B (ничего не ждёт) →
 * T1 вставляет сигнал с test_run_id = COMPLETED Run A. Первый тест ловит
 * именно это: пока T1 не закоммитил, startRun не имеет права завершиться.
 */
describe('Стратегия: сериализация startRun ↔ insertSignal (граница периода)', () => {
  guard()('in-flight INSERT держит стратегию: startRun ждёт; сигнал до границы → старый Run, после ответа → новый', async () => {
    const S = V3_3;
    // Свежий Run A с нулём участников — состояние известно полностью.
    const resA = await startRunHttp(S);
    expect(resA.status, JSON.stringify(resA.body)).toBe(201);
    const runAId = resA.body.newRunId as string;

    // H: SHARE на таблицу signals — SELECT идут свободно, INSERT блокируется.
    // T1 дойдёт до INSERT и замрёт на нём, УЖЕ держа FOR KEY SHARE на
    // strategy_settings и УЖЕ прочитав членство (Run A).
    const blocker = new pg.Client({ connectionString: h.url });
    await blocker.connect();
    let t1: Promise<any> | null = null;
    let t2: Promise<any> | null = null;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE signals IN SHARE MODE');

      // T1: вставка сигнала, начатая ДО границы. Не await — заблокируется на INSERT.
      t1 = makeSignal({ strategyId: S, symbol: 'RUNE/USDT' });
      // Checkpoint: INSERT INTO signals ждёт лок ⇒ KEY SHARE взят, членство прочитано.
      const t1AtInsert = await waitFor(() => someQueryWaitingOnLock('INSERT INTO signals%'));
      expect(t1AtInsert, 'T1 обязан дойти до INSERT и заблокироваться на нём').toBe(true);

      // T2: старт нового периода — обязан ЖДАТЬ (FOR UPDATE × KEY SHARE T1).
      let t2Settled = false;
      t2 = startRunHttp(S).then((r: any) => {
        t2Settled = true;
        return r;
      });
      // Время здесь не делает тест хрупким: в исправленной версии T2 физически
      // не может завершиться, пока блокер держит signals и T1 держит KEY SHARE.
      // Если фикс сломан (нет KEY SHARE), T2 успевает за это время — и тест красный.
      await sleep(500);
      expect(t2Settled, 'startRun обязан ждать in-flight INSERT сигнала (сериализация)').toBe(false);
      const still = await h.q('SELECT status FROM strategy_test_runs WHERE id = $1', [runAId]);
      expect(still[0].status, 'Run A ещё ACTIVE: T2 не закоммитил').toBe('ACTIVE');

      // Отпускаем H: T1 INSERT + COMMIT (освобождает KEY SHARE) → только затем
      // T2 завершает Run A и создаёт Run B. Граница проведена ПОСЛЕ коммита T1.
      await blocker.query('COMMIT');

      const s1 = await t1;
      const resB = await t2;
      expect(resB.status, JSON.stringify(resB.body)).toBe(201);
      expect(resB.body.previousRunId).toBe(runAId);

      // Сигнал ДО границы → старый Run (членство прочитано под KEY SHARE до старта).
      expect(s1.testRunId).toBe(runAId);

      // Граница: A COMPLETED, B ACTIVE, ровно один ACTIVE.
      const runs = await h.q(
        'SELECT id, status FROM strategy_test_runs WHERE strategy_id = $1 ORDER BY started_at',
        [S]
      );
      const active = runs.filter((r: any) => r.status === 'ACTIVE');
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(resB.body.newRunId);
      expect(runs.find((r: any) => r.id === runAId).status).toBe('COMPLETED');

      // Сигнал ПОСЛЕ успешного ответа startRun → ТОЛЬКО новый Run.
      const s2 = await makeSignal({ strategyId: S, symbol: 'ATOM/USDT' });
      expect(s2.testRunId).toBe(resB.body.newRunId);

      // ИНВАРИАНТ: в COMPLETED Run A нет сигналов, закоммиченных после границы.
      // Единственный член A — s1, закоммиченный ДО старта T2 (по построению и по
      // локу); всё, что пришло после ответа, — в B.
      const membersA = await h.q('SELECT id FROM signals WHERE test_run_id = $1', [runAId]);
      expect(membersA.map((r: any) => r.id)).toEqual([s1.id]);
      const membersB = await h.q('SELECT id FROM signals WHERE test_run_id = $1', [
        resB.body.newRunId,
      ]);
      expect(membersB.map((r: any) => r.id)).toEqual([s2.id]);
    } finally {
      // Блокер обязан уйти при любом исходе — иначе его транзакция заморозит файл.
      try { await blocker.query('ROLLBACK'); } catch { /* транзакции уже нет */ }
      try { await blocker.end(); } catch { /* соединение уже закрыто */ }
      // Не оставляем висящих промисов при падении ассерта между запусками.
      if (t1) await t1.catch(() => {});
      if (t2) await t2.catch(() => {});
    }
  });

  guard()('старт периода in-flight: сигнал, пришедший во время старта, ждёт границы и входит в НОВЫЙ Run', async () => {
    const S = V3_4;
    const activeBefore = await h.q(
      `SELECT id FROM strategy_test_runs WHERE strategy_id = $1 AND status = 'ACTIVE'`,
      [S]
    );
    expect(activeBefore).toHaveLength(1);
    const runA2Id = activeBefore[0].id;

    // H: FOR UPDATE на ACTIVE-строке периода — T2 возьмёт лок strategy_settings
    // (FOR UPDATE) и замрёт на UPDATE этой строки, не закоммитив границу.
    const blocker = new pg.Client({ connectionString: h.url });
    await blocker.connect();
    let t1: Promise<any> | null = null;
    let t2: Promise<any> | null = null;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM strategy_test_runs WHERE strategy_id = $1 AND status = $2 FOR UPDATE',
        [S, 'ACTIVE']
      );

      // T2: старт периода в полёте — держит FOR UPDATE на strategy_settings.
      t2 = startRunHttp(S);
      const t2AtUpdate = await waitFor(() => someQueryWaitingOnLock('UPDATE strategy_test_runs%'));
      expect(t2AtUpdate, 'T2 обязан заблокироваться на UPDATE строки периода').toBe(true);

      // T1: вставка сигнала приходит ВО ВРЕМЯ старта — обязана ждать KEY SHARE,
      // а не читать членство до границы.
      t1 = makeSignal({ strategyId: S, symbol: 'NEAR/USDT' });
      const t1AtLock = await waitFor(() => someQueryWaitingOnLock('%FOR KEY SHARE%'));
      expect(t1AtLock, 'вставка обязана ждать FOR KEY SHARE, пока старт держит FOR UPDATE').toBe(true);

      // Отпускаем H: T2 завершает старый период, создаёт новый и КОММИТИТ →
      // только затем вставка берёт KEY SHARE и читает членство (READ COMMITTED:
      // снапшот нового statement) — это уже НОВЫЙ период.
      await blocker.query('COMMIT');

      const res2 = await t2;
      expect(res2.status, JSON.stringify(res2.body)).toBe(201);
      expect(res2.body.previousRunId).toBe(runA2Id);

      const s = await t1;
      expect(s.testRunId, 'сигнал, пришедший во время старта, входит в НОВЫЙ Run').toBe(
        res2.body.newRunId
      );
      expect(s.testRunId).not.toBe(runA2Id);

      const a2 = await h.q('SELECT status FROM strategy_test_runs WHERE id = $1', [runA2Id]);
      expect(a2[0].status).toBe('COMPLETED');
    } finally {
      try { await blocker.query('ROLLBACK'); } catch { /* транзакции уже нет */ }
      try { await blocker.end(); } catch { /* соединение уже закрыто */ }
      if (t1) await t1.catch(() => {});
      if (t2) await t2.catch(() => {});
    }
  });
});
