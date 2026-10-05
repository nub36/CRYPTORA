/** @vitest-environment node */
/**
 * CRYPTORA — Telegram-события полного жизненного цикла сигнала на НАСТОЯЩЕМ
 * PostgreSQL.
 *
 * Проверяется сквозной путь: настоящий `SignalMonitor` → настоящий
 * `syncSignalLifecycle` → настоящая классификация/дедупликация
 * (`signalLifecycleEvents`, миграция 018) → зарегистрированный слушатель
 * уведомлений. Подменяется ТОЛЬКО сетевой слой рыночных данных (свечи).
 *
 * Обязательные сценарии (по постановке задачи):
 *   • ACTIVE → NEW_SIGNAL один раз;
 *   • ENTRY (FILL) → один раз, повторный тик молчит;
 *   • TP1 → один раз; следующий TP (TP2) → один раз;
 *   • BREAKEVEN → один раз;
 *   • SL после входа → один раз (≠ «отмена»);
 *   • INVALIDATED/CANCELLED до входа → «отмена» один раз (≠ Stop Loss);
 *   • рестарт монитора (новый инстанс, та же БД) и повторные тики НЕ
 *     создают повторных уведомлений;
 *   • CLOSED не создаёт бессмысленный дубль сразу после TP/SL/BE;
 *   • гонка двух писателей (монитор + скан-синхронизация) не дублирует FILL.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '../..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      if (typeof a === 'object' && a) {
        const p = a.port;
        srv.close(() => resolve(p));
      } else srv.close(() => reject(new Error('no address')));
    });
  });
}

let pg: any = null;
let db: any = null;
let skipReason: string | null = null;
let repo: any = null;
let monitorMod: any = null;
let eventsMod: any = null;
let notificationBus: any = null;

/** Собирает все уведомления, ушедшие через emitSignalNotification. */
const emitted: Array<{ signalId: unknown; eventType: string }> = [];
const flushNotifications = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeAll(async () => {
  let EmbeddedPostgres: any;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    skipReason = `embedded-postgres недоступен: ${(e as Error).message}`;
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-signal-events-'));
  const port = await freePort();

  try {
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'cryptora',
      password: 'cryptora',
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    const admin = await pg.getPgClient('postgres');
    await admin.connect();
    await admin.query('CREATE DATABASE cryptora');
    await admin.end();
  } catch (e) {
    skipReason = `не удалось поднять PostgreSQL: ${(e as Error).message}`;
    pg = null;
    return;
  }

  const url = `postgresql://cryptora:cryptora@127.0.0.1:${port}/cryptora`;
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: url },
    cwd: ROOT,
    encoding: 'utf8',
  });

  process.env.DATABASE_URL = url;
  repo = await import('../../server/services/signalRepository.js');
  monitorMod = await import('../../server/services/signalMonitor/signalMonitor.js');
  eventsMod = await import('../../server/services/signalLifecycleEvents.js');
  notificationBus = await import('../../server/services/notificationEvents.js');
  const { closePool } = await import('../../server/db/pool.js');
  void closePool;

  db = await pg.getPgClient('cryptora');
  await db.connect();

  notificationBus.registerSignalNotificationListener((signal: any, eventType: string) => {
    emitted.push({ signalId: signal?.id, eventType });
  });
}, 300_000);

afterAll(async () => {
  try {
    notificationBus?.registerSignalNotificationListener(null);
  } catch { /* модуль не загрузился — пропускаем */ }
  try {
    if (db) await db.end();
  } catch { /* уже закрыто */ }
  try {
    const { closePool } = await import('../../server/db/pool.js');
    await closePool();
  } catch { /* пул уже закрыт */ }
  try {
    if (pg) await pg.stop();
  } catch { /* БД уже остановлена */ }
});

const guard = (ctx: any) => {
  if (skipReason) ctx.skip();
  return Boolean(skipReason);
};

async function q(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows;
}

const H = 3_600_000;
const SETUP_TS = new Date('2026-10-04T09:00:00Z').getTime();

const ZONE_LO = 64500;
const ZONE_HI = 64700;
const STOP = 63800;
const TP1 = 65500;
const TP2 = 66200;

/** Строка открытого сигнала V3.0 (те же уровни, что в фикстурах монитора). */
async function seedSignal(overrides: Record<string, unknown> = {}) {
  return repo.insertSignal({
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date(SETUP_TS),
    entryMin: ZONE_LO,
    entryMax: ZONE_HI,
    stopLoss: STOP,
    targets: [TP1, TP2],
    provenanceStatus: 'VERIFIED',
    ...overrides,
  });
}

function bar(openTimeMs: number, o: number, h: number, l: number, c: number) {
  return { time: Math.floor(openTimeMs / 1000), open: o, high: h, low: l, close: c, volume: 1 };
}

/** Свечи окна: бар сетапа + указанные бары после него. */
function window(bars: Array<[number, number, number, number]>) {
  const setupBar = bar(SETUP_TS, 64400, 64500, 64300, 64450);
  const rest = bars.map(([o, h, l, c], i) => bar(SETUP_TS + (i + 1) * H, o, h, l, c));
  return [setupBar, ...rest];
}

/** Бары-примитивы сценариев (управляются правилами corridorStep/manageTrade). */
const FILL_BAR: [number, number, number, number] = [64600, 64700, 64550, 64650]; // вход @64600
const TP1_BAR: [number, number, number, number] = [64650, 65600, 64600, 65500]; // TP1, без TP2
const TP2_BAR: [number, number, number, number] = [65500, 66300, 65400, 66250]; // TP2
const BE_BAR: [number, number, number, number] = [65000, 65100, 64500, 64600]; // выход по BE (стоп=вход)
const SL_BAR: [number, number, number, number] = [64600, 64700, 63700, 63800]; // стоп без TP1
const CALM_BAR: [number, number, number, number] = [64700, 65000, 64600, 64800]; // ничего не задет

/** Настоящий монитор с настоящим ядром; свечи инъецируются. */
function makeMonitor(candles: () => unknown[], nowMs: number) {
  return new monitorMod.SignalMonitor({
    now: () => nowMs,
    listOpen: (limit: number) => repo.listOpenSignals(null, limit),
    sync: (patch: unknown) => repo.syncSignalLifecycle(patch as never),
    getCandles: async () => candles(),
    recordMonitor: (id: string, patch: unknown) => repo.recordSignalMonitorCheck(id, patch as never),
    loadCore: async () => {
      const core = await import('../../server/services/strategyEngine/strategyCoreBundle.js');
      return core.loadStrategyCore();
    },
    sleep: async () => {},
    requestTimeoutMs: 5000,
  });
}

/** События, записанные в журнале для сигнала (в порядке создания). */
async function recordedEvents(signalId: string) {
  const rows = await q(
    'SELECT event_type FROM signal_lifecycle_events WHERE signal_id = $1 ORDER BY created_at ASC, event_type ASC',
    [signalId]
  );
  return rows.map((r: any) => r.event_type);
}

/** События, реально отправленные слушателю для сигнала. */
function emittedFor(signalId: string) {
  return emitted.filter((e) => e.signalId === signalId).map((e) => e.eventType);
}

function resetEmitted() {
  emitted.length = 0;
}

beforeEach(async () => {
  if (skipReason) return;
  resetEmitted();
  await q('DELETE FROM signal_lifecycle_events');
  await q('DELETE FROM signals');
});

/* ───────────────────────── Инфраструктура ───────────────────────── */

describe('Миграция 018 — signal_lifecycle_events', () => {
  it('таблица создана, домен event_type ограничен', async (ctx) => {
    if (guard(ctx)) return;
    const cols = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'signal_lifecycle_events' ORDER BY ordinal_position`
    );
    expect(cols.map((r: any) => r.column_name)).toEqual([
      'signal_id', 'event_type', 'occurred_at', 'created_at',
    ]);

    // Домен: фиксированные события + TPn; мусор отвергается CHECK-ом.
    await expect(q(
      `INSERT INTO signal_lifecycle_events (signal_id, event_type) VALUES ('00000000-0000-0000-0000-000000000000', 'NONSENSE')`
    )).rejects.toThrow();
    await expect(q(
      `INSERT INTO signal_lifecycle_events (signal_id, event_type) VALUES ('00000000-0000-0000-0000-000000000000', 'TP0')`
    )).rejects.toThrow();
  });
});

/* ───────────────────── NEW_SIGNAL: публикация ───────────────────── */

describe('Новый сигнал (ACTIVE)', () => {
  it('NEW_SIGNAL отправляется один раз; повторная попытка молчит', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    expect(signal.status).toBe('ACTIVE');

    await eventsMod.dispatchNewSignalEvent(signal);
    await eventsMod.dispatchNewSignalEvent(signal); // рестарт/повтор
    await flushNotifications();

    expect(emittedFor(signal.id)).toEqual(['NEW_SIGNAL']);
    expect(await recordedEvents(signal.id)).toEqual(['NEW_SIGNAL']);
  });

  it('дубликат вставки сигнала (тот же ключ дедупа) не публикует второй сигнал', async (ctx) => {
    if (guard(ctx)) return;
    const first = await seedSignal();
    const second = await seedSignal(); // тот же strategy+symbol+tf+candle_ts
    expect(second.inserted).toBe(false);
    await flushNotifications();
    expect(emitted.filter((e) => e.signalId === first.signal?.id)).toEqual([]);
  });
});

/* ───────────────────── Полный цикл через монитор ───────────────────── */

describe('Жизненный цикл: монитор → события → дедупликация', () => {
  it('ENTRY: вход исполнен — уведомление один раз, повторный тик и рестарт молчат', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    const candles = () => window([FILL_BAR]);
    const now = SETUP_TS + 3 * H;

    const m1 = makeMonitor(candles, now);
    await m1.tick();
    await flushNotifications();

    const row = (await q('SELECT status FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('FILLED');
    expect(emittedFor(signal.id)).toEqual(['FILL']);
    expect(await recordedEvents(signal.id)).toEqual(['FILL']);

    // Повторный тик с теми же свечами: ничего нового.
    await m1.tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL']);

    // «Рестарт cryptora.service»: НОВЫЙ инстанс монитора, та же БД.
    const m2 = makeMonitor(candles, now);
    await m2.tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL']);
    expect(await recordedEvents(signal.id)).toEqual(['FILL']);
  }, 120_000);

  it('TP1 → TP2: обе цели уведомлены по одному разу, CLOSED-дубля нет', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    const candles = () => window([FILL_BAR, TP1_BAR, TP2_BAR]);
    const now = SETUP_TS + 6 * H;

    await makeMonitor(candles, now).tick();
    await flushNotifications();

    const row = (await q('SELECT status, close_reason FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('TARGET_REACHED');
    expect(row.close_reason).toBe('TP2');

    // TP1 доказан исходом (правило R2 frozen-ядра) и уведомлён отдельным
    // событием; TP2 — финальная цель. Третьего «закрыто» НЕТ.
    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'TP2']);
    expect(await recordedEvents(signal.id)).toEqual(expect.arrayContaining(['FILL', 'TP1', 'TP2']));

    // Повторный тик + рестарт: тишина.
    await makeMonitor(candles, now).tick();
    await makeMonitor(candles, now).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'TP2']);
  }, 120_000);

  it('TP1 частичным окном, затем BREAKEVEN: безубыток уведомлён один раз', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();

    // Тик 1: только вход (TP1 ещё не достигнут).
    const fillOnly = () => window([FILL_BAR]);
    await makeMonitor(fillOnly, SETUP_TS + 3 * H).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL']);

    // Тик 2 (после «рестарта»): TP1 достигнут, сделка ещё открыта — статус FILLED.
    const withTp1 = () => window([FILL_BAR, TP1_BAR]);
    await makeMonitor(withTp1, SETUP_TS + 4 * H).tick();
    await flushNotifications();
    const mid = (await q('SELECT status FROM signals WHERE id = $1', [signal.id]))[0];
    expect(mid.status).toBe('FILLED'); // промежуточный TP1 — не исход

    // Тик 3: выход по безубытку (стоп переведён на уровень входа после TP1).
    const withBe = () => window([FILL_BAR, TP1_BAR, BE_BAR]);
    await makeMonitor(withBe, SETUP_TS + 5 * H).tick();
    await flushNotifications();

    const row = (await q('SELECT status, close_reason FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('CLOSED');
    expect(row.close_reason).toBe('TP1_THEN_BE');
    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'BREAKEVEN']);

    // Рестарт: событие BREAKEVEN не повторяется.
    await makeMonitor(withBe, SETUP_TS + 6 * H).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'BREAKEVEN']);
  }, 120_000);

  it('STOP LOSS после входа — отдельное событие, не «отмена»', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    const candles = () => window([FILL_BAR, SL_BAR]);
    const now = SETUP_TS + 4 * H;

    await makeMonitor(candles, now).tick();
    await flushNotifications();

    const row = (await q('SELECT status, close_reason FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('INVALIDATED');
    expect(row.close_reason).toBe('SL');
    expect(emittedFor(signal.id)).toEqual(['FILL', 'STOP_LOSS']);
    expect(emittedFor(signal.id)).not.toContain('CANCELLED');

    await makeMonitor(candles, now).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL', 'STOP_LOSS']);
  }, 120_000);

  it('отмена ДО входа (стоп задет раньше коридора) — «отмена», не Stop Loss', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    // Касание зоны И стопа на одном баре до исполнения — corridorStep CANCELLED.
    const cancelledBar: [number, number, number, number] = [64900, 65000, 63700, 64000];
    const candles = () => window([cancelledBar]);
    const now = SETUP_TS + 3 * H;

    await makeMonitor(candles, now).tick();
    await flushNotifications();

    const row = (await q('SELECT status, close_reason FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('CANCELLED');
    expect(emittedFor(signal.id)).toEqual(['CANCELLED']);
    expect(emittedFor(signal.id)).not.toContain('FILL');
    expect(emittedFor(signal.id)).not.toContain('STOP_LOSS');

    await makeMonitor(candles, now).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['CANCELLED']);
  }, 120_000);

  it('истечение коридора без входа — безсделковое событие один раз', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    // Ни касания, ни стопа: цена выше зоны. Коридор живёт 3 бара.
    const awayBar: [number, number, number, number] = [64900, 65100, 64800, 65000];
    const candles = () => window([awayBar, awayBar, awayBar, awayBar]);
    const now = SETUP_TS + 6 * H;

    await makeMonitor(candles, now).tick();
    await flushNotifications();

    const row = (await q('SELECT status FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('EXPIRED');
    expect(emittedFor(signal.id)).toEqual(['CANCELLED']);
  }, 120_000);

  it('TIMEOUT → CLOSED: закрытие по правилам стратегии без дублирующих событий', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    // Вход, затем 60 «спокойных» баров: ни стопа, ни TP1 — таймаут V3.0 (50).
    const bars = Array.from({ length: 60 }, () => CALM_BAR) as Array<[number, number, number, number]>;
    const candles = () => window([FILL_BAR, ...bars]);
    const now = SETUP_TS + 70 * H;

    await makeMonitor(candles, now).tick();
    await flushNotifications();

    const row = (await q('SELECT status, close_reason FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('CLOSED');
    expect(row.close_reason).toBe('TIMEOUT');
    // Нет ни TP1 (не достигнут), ни третьего события после CLOSED.
    expect(emittedFor(signal.id)).toEqual(['FILL', 'CLOSED']);

    await makeMonitor(candles, now).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL', 'CLOSED']);
  }, 120_000);
});

/* ───────────── Второй писатель (скан-синхронизация) и гонки ───────────── */

/**
 * Путь скан-синхронизации (strategyEngine.syncLifecycleFromCore):
 * репозиторий пишет, ОРКЕСТРАТОР отправляет события — те же две строки,
 * что выполняет движок скана после syncSignalLifecycle.
 */
async function syncLikeEngineScan(patch: Record<string, unknown>) {
  const res = await repo.syncSignalLifecycle(patch as never);
  if (res.changed) await eventsMod.dispatchSignalLifecycleEvents(res.signal, res.previous ?? null);
  return res;
}

describe('Дедупликация между писателями', () => {
  it('«прямой» ACTIVE → TARGET_REACHED (fill+исход одной записью): FILL не теряется и не дублируется', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();

    // Путь скан-синхронизации: сделка завершилась до первой записи входа.
    const payload = {
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      signalCandleTs: new Date(SETUP_TS),
      fill: { price: 64600, at: new Date(SETUP_TS + H).toISOString() },
      outcome: {
        status: 'TARGET_REACHED',
        closedAt: new Date(SETUP_TS + 3 * H).toISOString(),
        exitReason: 'TP2',
        exitPrice: TP2,
        resultR: 2.1,
        netResultR: 2.03,
        barsHeld: 3,
      },
    };
    const res = await syncLikeEngineScan(payload);
    expect(res.changed).toBe(true);
    await flushNotifications();

    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'TP2']);
    // Повторная синхронизация с тем же исходом: changed=false, тишина.
    const again = await syncLikeEngineScan(payload);
    expect(again.changed).toBe(false);
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'TP2']);
  });

  it('гонка монитор × скан: второй вывод FILL погашен журналом событий', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();

    // Монитор записывает вход.
    await makeMonitor(() => window([FILL_BAR]), SETUP_TS + 3 * H).tick();
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL']);

    // «Устаревший» скан смотрел на ACTIVE и приносит fill+исход одной записью:
    // классификатор выводит FILL+TP1+TP2, но FILL уже в журнале — отправляются
    // только новые события. Это и есть защита от дубля через персистентный дедуп.
    const res = await syncLikeEngineScan({
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      signalCandleTs: new Date(SETUP_TS),
      fill: { price: 64600, at: new Date(SETUP_TS + H).toISOString() },
      outcome: {
        status: 'TARGET_REACHED',
        closedAt: new Date(SETUP_TS + 3 * H).toISOString(),
        exitReason: 'TP2',
        exitPrice: TP2,
        resultR: 2.1,
        netResultR: 2.03,
        barsHeld: 3,
      },
    });
    expect(res.changed).toBe(true);
    await flushNotifications();
    expect(emittedFor(signal.id)).toEqual(['FILL', 'TP1', 'TP2']);
  });

  it('параллельная запись одного события двумя тиками не отправляет его дважды', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    // Оба тика видят одну и ту же открытую строку и одинаковые свечи.
    const candles = () => window([FILL_BAR]);
    const now = SETUP_TS + 3 * H;
    const [a, b] = await Promise.all([
      makeMonitor(candles, now).tick(),
      makeMonitor(candles, now).tick(),
    ]);
    await flushNotifications();

    // Оба тика отработали; строка либо FILLED, либо уже терминальная,
    // но FILL отправлен ровно один раз (PK журнала событий).
    expect(a.errors + b.errors).toBe(0);
    expect(emittedFor(signal.id)).toEqual(['FILL']);
    expect(await recordedEvents(signal.id)).toEqual(['FILL']);
  }, 120_000);
});

/* ───────────────────── Журнал ≠ торговая правда ───────────────────── */

describe('Журнал событий не меняет торговые данные', () => {
  it('уведомления не трогают уровни, статусы и хэш-цепочку', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    const before = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];

    await eventsMod.dispatchNewSignalEvent(signal);
    await makeMonitor(() => window([FILL_BAR]), SETUP_TS + 3 * H).tick();
    await flushNotifications();

    const after = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    // Публикация неизменна: хэши, уровни, время свечи.
    expect(after.hash).toBe(before.hash);
    expect(after.previous_hash).toBe(before.previous_hash);
    expect(after.entry_min).toBe(before.entry_min);
    expect(after.stop_loss).toBe(before.stop_loss);
    expect(after.targets).toEqual(before.targets);
    // Статус изменил ТОЛЬКО монитор (ACTIVE→FILLED), не журнал событий.
    expect(after.status).toBe('FILLED');

    const chain = await repo.verifyChain();
    expect(chain.breaks).toBe(0);
  }, 120_000);
});
