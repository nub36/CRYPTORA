/** @vitest-environment node */
/**
 * CRYPTORA — Монитор сигналов и серверная статистика на НАСТОЯЩЕМ PostgreSQL.
 *
 * Ничего не подменяется на уровне схемы: поднимается embedded-postgres,
 * прогоняются НАСТОЯЩИЕ миграции (001–010) настоящим раннером. Проверяется:
 *
 *   A) миграция 010 аддитивна: колонки монитора, таблица телеметрии, частичный
 *      индекс; строки, созданные до 010, продолжают существовать и читаться;
 *   B) хэш-цепочка 009 НЕ сломана новыми колонками (`verifyChain` = 0 разрывов);
 *   C) журнал наблюдения (`recordSignalMonitorCheck`) пишется идемпотентно и не
 *      трогает уровни/статус/R;
 *   D) телеметрия тика (`writeMonitorState`) — одна строка, рестарт не плодит
 *      дубликаты и не теряет историю;
 *   E) серверная статистика: published ≠ completed, win rate только по
 *      завершённым сделкам, разрывы по стратегии и инструменту, период;
 *   F) монитор (настоящий `SignalMonitor`) доходит от строки в БД до терминала
 *      через настоящий `syncSignalLifecycle`; повторный тик монотонен.
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
let stats: any = null;
let monitorMod: any = null;

beforeAll(async () => {
  let EmbeddedPostgres: any;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    skipReason = `embedded-postgres недоступен: ${(e as Error).message}`;
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-monitor-'));
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
  stats = await import('../../server/services/signalStatistics.js');
  monitorMod = await import('../../server/services/signalMonitor/signalMonitor.js');
  const { closePool } = await import('../../server/db/pool.js');

  db = await pg.getPgClient('cryptora');
  await db.connect();

  // Пул закрываем здесь, чтобы `db` (admin-клиент) остался живым.
  void closePool;
}, 300_000);

afterAll(async () => {
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

/** Один открытый сигнал. */
async function seedSignal(overrides: Record<string, unknown> = {}) {
  const base = {
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date('2026-09-20T09:00:00Z'),
    entryMin: 64500,
    entryMax: 64700,
    stopLoss: 63800,
    targets: [65500, 66200],
    ...overrides,
  };
  return repo.insertSignal(base);
}

beforeEach(async () => {
  if (skipReason) return;
  await q('DELETE FROM signals');
  await q('UPDATE signal_monitor_state SET last_error = NULL WHERE id = 1');
});

describe('Миграция 010 — аддитивность и сохранность строк', () => {
  it('колонки наблюдения и таблица телеметрии созданы', async (ctx) => {
    if (guard(ctx)) return;
    const cols = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'signals'
          AND column_name IN ('monitor_check_count','monitor_last_check_at','monitor_last_result','monitor_last_error')
        ORDER BY column_name`
    );
    expect(cols.map((r: any) => r.column_name)).toEqual([
      'monitor_check_count',
      'monitor_last_check_at',
      'monitor_last_error',
      'monitor_last_result',
    ]);

    const table = await q(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'signal_monitor_state'`
    );
    expect(table).toHaveLength(1);
  });

  it('строки, созданные ДО появления колонок 010, читаются без изменений уровней', async (ctx) => {
    if (guard(ctx)) return;
    // Симулируем «старую» строку: обнуляем журнал наблюдения, как будто 010
    // ещё не было. Сами уровни и хэши при этом не трогаются.
    const { signal } = await seedSignal();
    await q(
      `UPDATE signals SET monitor_check_count = 0, monitor_last_check_at = NULL,
                          monitor_last_result = NULL, monitor_last_error = NULL WHERE id = $1`,
      [signal.id]
    );
    const before = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    await q(
      `UPDATE signals SET monitor_check_count = monitor_check_count + 1,
                          monitor_last_check_at = now(), monitor_last_result = 'UNCHANGED'
       WHERE id = $1`,
      [signal.id]
    );
    const after = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];

    // Уровни, статус и хэши не сдвинулись.
    expect(after.entry_min).toBe(before.entry_min);
    expect(after.entry_max).toBe(before.entry_max);
    expect(after.stop_loss).toBe(before.stop_loss);
    expect(after.targets).toEqual(before.targets);
    expect(after.status).toBe(before.status);
    expect(after.hash).toBe(before.hash);
    expect(after.previous_hash).toBe(before.previous_hash);
    expect(after.outcome_hash).toBe(before.outcome_hash);
  });

  it('хэш-цепочка 009 цела после появления колонок 010', async (ctx) => {
    if (guard(ctx)) return;
    await seedSignal();
    await seedSignal({ symbol: 'SOL/USDT', signalCandleTs: new Date('2026-09-20T10:00:00Z') });
    await seedSignal({ symbol: 'ETH/USDT', signalCandleTs: new Date('2026-09-20T11:00:00Z') });
    const chain = await repo.verifyChain();
    expect(chain.breaks).toBe(0);
  });

  it('частичный индекс по открытым сигналам существует', async (ctx) => {
    if (guard(ctx)) return;
    const idx = await q(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'signals' AND indexname = 'idx_signals_open_group'`
    );
    expect(idx).toHaveLength(1);
  });
});

describe('Журнал наблюдения', () => {
  it('идемпотентен по смыслу: счётчик растёт, уровни не меняются', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    await repo.recordSignalMonitorCheck(signal.id, { result: 'UNCHANGED' });
    await repo.recordSignalMonitorCheck(signal.id, { result: 'UNCHANGED' });
    await repo.recordSignalMonitorCheck(signal.id, { result: 'ERROR', error: 'market down' });

    const row = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    expect(Number(row.monitor_check_count)).toBe(3);
    expect(row.monitor_last_result).toBe('ERROR');
    expect(row.monitor_last_error).toBe('market down');
    expect(row.monitor_last_check_at).not.toBeNull();
    // Журнал наблюдения — не источник правды о lifecycle.
    expect(row.status).toBe('ACTIVE');
    expect(row.result_r).toBeNull();
  });

  it('неизвестный результат отклоняется, а не молча пишется', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    await expect(repo.recordSignalMonitorCheck(signal.id, { result: 'NONSENSE' })).rejects.toThrow(
      /Unknown monitor result/
    );
  });

  it('ошибка рынка не создаёт ложного исхода', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    await repo.recordSignalMonitorCheck(signal.id, { result: 'ERROR', error: 'timeout' });
    const open = await repo.listOpenSignals(null, 100);
    expect(open.map((r: any) => r.id)).toContain(signal.id);
    expect(open[0].monitorLastError).toBe('timeout');
    expect(open[0].monitorCheckCount).toBe(1);
  });
});

describe('Телеметрия монитора', () => {
  it('одна строка: повторная запись обновляет, а не плодит дубликаты', async (ctx) => {
    if (guard(ctx)) return;
    await repo.writeMonitorState({
      running: true,
      lastOpenSignals: 5,
      lastGroups: 1,
      lastCandleRequests: 1,
      lastResult: 'OK',
      lastTickStartedAt: new Date('2026-09-24T08:00:00Z'),
      lastTickFinishedAt: new Date('2026-09-24T08:00:01Z'),
      lastTickDurationMs: 1000,
    });
    await repo.writeMonitorState({
      running: true,
      lastOpenSignals: 3,
      lastGroups: 1,
      lastCandleRequests: 1,
      lastResult: 'OK',
      lastTickStartedAt: new Date('2026-09-24T08:00:30Z'),
      lastTickFinishedAt: new Date('2026-09-24T08:00:31Z'),
      lastTickDurationMs: 1100,
    });

    const rows = await q('SELECT * FROM signal_monitor_state');
    expect(rows).toHaveLength(1);
    const state = await repo.readMonitorState();
    expect(state.lastOpenSignals).toBe(3);
    expect(state.lastTickDurationMs).toBe(1100);
    // Прежний тик не потерян: время старта последнего тика обновилось.
    expect(new Date(state.lastTickStartedAt).toISOString()).toBe('2026-09-24T08:00:30.000Z');
  });

  it('счётчики открытых сигналов и групп считаются из БД', async (ctx) => {
    if (guard(ctx)) return;
    await seedSignal();
    await seedSignal({ symbol: 'BTC/USDT', signalCandleTs: new Date('2026-09-20T10:00:00Z') });
    await seedSignal({ symbol: 'SOL/USDT', timeframe: '4h', signalCandleTs: new Date('2026-09-20T10:00:00Z') });
    const counts = await repo.countOpenSignalGroups();
    expect(counts.openSignals).toBe(3);
    expect(counts.groups).toBe(2);
  });
});

describe('Серверная статистика', () => {
  it('published ≠ completed: сигнал без входа не считается сделкой', async (ctx) => {
    if (guard(ctx)) return;
    // 4 опубликовано.
    await seedSignal();
    await seedSignal({ signalCandleTs: new Date('2026-09-20T10:00:00Z') });
    await seedSignal({ signalCandleTs: new Date('2026-09-20T11:00:00Z') });
    await seedSignal({ signalCandleTs: new Date('2026-09-20T12:00:00Z') });

    // Один закрыт целью, один — стопом, два отменены до входа.
    await repo.syncSignalLifecycle({
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      signalCandleTs: new Date('2026-09-20T09:00:00Z'),
      fill: { price: 64600, at: '2026-09-20T10:00:00Z' },
      outcome: {
        status: 'TARGET_REACHED',
        closedAt: '2026-09-20T14:00:00Z',
        exitReason: 'TP2',
        exitPrice: 66200,
        resultR: 2.1,
        netResultR: 2.03,
        barsHeld: 4,
      },
    });
    await repo.syncSignalLifecycle({
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      signalCandleTs: new Date('2026-09-20T10:00:00Z'),
      fill: { price: 64600, at: '2026-09-20T11:00:00Z' },
      outcome: {
        status: 'INVALIDATED',
        closedAt: '2026-09-20T12:00:00Z',
        exitReason: 'SL',
        exitPrice: 63800,
        resultR: -1,
        netResultR: -1.07,
        barsHeld: 1,
      },
    });
    await repo.syncSignalLifecycle({
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      signalCandleTs: new Date('2026-09-20T11:00:00Z'),
      fill: null,
      outcome: {
        status: 'CANCELLED',
        closedAt: '2026-09-20T13:00:00Z',
        exitReason: 'CANCELLED',
        exitPrice: null,
        resultR: null,
        netResultR: null,
        barsHeld: null,
      },
    });

    const s = await stats.getSignalStatistics({ nowMs: Date.UTC(2026, 8, 25) });
    expect(s.totals.published).toBe(4);
    expect(s.totals.waitingEntry).toBe(1);
    expect(s.totals.cancelled).toBe(1);
    expect(s.totals.completed).toBe(2);
    expect(s.totals.wins).toBe(1);
    expect(s.totals.losses).toBe(1);
    // Знаменатель win rate — 2 завершённые сделки, а не 4 опубликованных.
    expect(s.totals.winRatePct).toBe(50);
    expect(s.totals.grossRSum).toBeCloseTo(1.1, 4);
    expect(s.totals.netRSum).toBeCloseTo(0.96, 4);
    expect(s.totals.avgGrossR).toBeCloseTo(0.55, 4);
    expect(s.totals.completionRatePct).toBe(50);
    expect(s.source).toBe('server');
  });

  it('результат 0 R попадает в losses, а не в третью корзину; итог сходится по всем статусам', async (ctx) => {
    if (guard(ctx)) return;
    await q('DELETE FROM signals');
    // Все статусы по одному разу: полная проверка знаменателей.
    const cases: Array<[string, number | null]> = [
      ['ACTIVE', null],
      ['FILLED', null],
      ['TARGET_REACHED', 2.0],   // win
      ['INVALIDATED', -1.0],     // loss
      ['CLOSED', 0.0],           // TP1_THEN_BE: ровно 0 R
      ['CLOSED', -0.25],         // TP1_THEN_SL
      ['EXPIRED', null],
      ['CANCELLED', null],
      ['UNRESOLVED', null],
    ];
    const noTrade = (st: string) =>
      st === 'ACTIVE' || st === 'CANCELLED' || st === 'EXPIRED' || st === 'UNRESOLVED';
    for (let i = 0; i < cases.length; i++) {
      const [status, r] = cases[i]!;
      const ts = new Date(Date.UTC(2026, 8, 22, i, 0, 0));
      await seedSignal({ signalCandleTs: ts });
      await repo.syncSignalLifecycle({
        strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        signalCandleTs: ts,
        fill: noTrade(status)
          ? null
          : { price: 64600, at: new Date(Date.UTC(2026, 8, 22, i, 1, 0)).toISOString() },
        outcome: {
          status,
          closedAt: new Date(Date.UTC(2026, 8, 22, i, 5, 0)).toISOString(),
          exitReason: status === 'CLOSED' ? 'TP1_THEN_BE' : 'X',
          exitPrice: null,
          resultR: r,
          netResultR: r === null ? null : r - 0.07,
          barsHeld: null,
        },
      });
    }

    const s = await stats.getSignalStatistics({ nowMs: Date.UTC(2026, 8, 25) });
    const t = s.totals;
    expect(t.published).toBe(9);
    // Тождество полноты: восемь взаимоисключающих статусов дают published.
    expect(
      t.waitingEntry + t.filled + t.cancelled + t.expired + t.unresolved +
      t.targetReached + t.invalidated + t.closed
    ).toBe(t.published);
    // completed = только завершённые сделки: TARGET_REACHED + INVALIDATED + 2 × CLOSED.
    expect(t.completed).toBe(4);
    // 0 R — поражение (победа требует result_r > 0), а не «ничья».
    expect(t.wins).toBe(1);
    expect(t.losses).toBe(3);
    expect(t.wins + t.losses).toBe(t.completed);
    // ΣR считается только по completed; ACTIVE/FILLED/CANCELLED/EXPIRED/UNRESOLVED не входят.
    expect(t.grossRSum).toBeCloseTo(2.0 - 1.0 + 0.0 - 0.25, 6);
    expect(t.winRatePct).toBe(25);
    // fillRate: в числителе FILLED + completed = 1 + 4; ACTIVE/CANCELLED/… не входят.
    // Доля округляется до 0.1 % — сравниваем с округлённым значением.
    expect(t.fillRatePct).toBeCloseTo(Math.round(((1 + 4) / 9) * 1000) / 10, 6);
  }, 120_000);

  it('пустая таблица даёт null, а не 0 %', async (ctx) => {
    if (guard(ctx)) return;
    const s = await stats.getSignalStatistics({});
    expect(s.totals.published).toBe(0);
    expect(s.totals.winRatePct).toBeNull();
    expect(s.totals.grossRSum).toBeNull();
    expect(s.byStrategy).toEqual([]);
    expect(s.bySymbol).toEqual([]);
  });

  it('разрезы по стратегии и инструменту не расходятся с итогом', async (ctx) => {
    if (guard(ctx)) return;
    await seedSignal({ strategyId: 'V3_0_HTF_LIQUIDATION_TRAP', symbol: 'BTC/USDT' });
    await seedSignal({
      strategyId: 'V3_3_HTF_ZONE_MITIGATION',
      symbol: 'SOL/USDT',
      signalCandleTs: new Date('2026-09-20T10:00:00Z'),
    });
    await seedSignal({
      strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
      symbol: 'SOL/USDT',
      signalCandleTs: new Date('2026-09-20T11:00:00Z'),
    });
    const s = await stats.getSignalStatistics({});
    expect(s.totals.published).toBe(3);
    expect(s.byStrategy.reduce((acc: number, r: any) => acc + r.published, 0)).toBe(3);
    expect(s.bySymbol.reduce((acc: number, r: any) => acc + r.published, 0)).toBe(3);
    expect(s.bySymbol.map((r: any) => r.symbol)).toContain('SOL/USDT');
  });

  it('период отсекает старые сигналы', async (ctx) => {
    if (guard(ctx)) return;
    const fresh = await seedSignal({ signalCandleTs: new Date(Date.now() - 60_000) });
    const old = await seedSignal({ signalCandleTs: new Date(Date.now() - 60_000) });
    // «Старый» сигнал: created_at отодвинут на 10 дней назад (период 24h его
    // отсекает, период 90d — нет).
    await q("UPDATE signals SET created_at = now() - interval '10 days' WHERE id = $1", [old.signal.id]);
    void fresh;

    const now = Date.now();
    const all = await stats.getSignalStatistics({ nowMs: now });
    const day = await stats.getSignalStatistics({ period: '24h', nowMs: now });
    expect(all.totals.published).toBe(2);
    expect(day.totals.published).toBe(1);
  });
});

describe('Монитор на настоящем PostgreSQL', () => {
  it('строка → тик → терминальный исход, повторный тик монотонен', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();

    // Закрытые свечи: вход в коридоре на следующем баре, затем TP1 → TP2.
    const H = 3_600_000;
    const setup = new Date('2026-09-20T09:00:00Z').getTime();
    const now = setup + 6 * H;
    const raw = [
      { time: setup / 1000, open: 64400, high: 64500, low: 64300, close: 64450, volume: 1 },
      { time: (setup + H) / 1000, open: 64600, high: 64700, low: 64550, close: 64650, volume: 1 },
      { time: (setup + 2 * H) / 1000, open: 64650, high: 65600, low: 64600, close: 65500, volume: 1 },
      { time: (setup + 3 * H) / 1000, open: 65500, high: 66300, low: 65400, close: 66250, volume: 1 },
    ];

    const monitor = new monitorMod.SignalMonitor({
      now: () => now,
      listOpen: (limit: number) => repo.listOpenSignals(null, limit),
      sync: (patch: unknown) => repo.syncSignalLifecycle(patch as never),
      getCandles: async () => raw,
      recordMonitor: (id: string, patch: unknown) => repo.recordSignalMonitorCheck(id, patch as never),
      loadCore: async () => {
        const core = await import('../../server/services/strategyEngine/strategyCoreBundle.js');
        return core.loadStrategyCore();
      },
      sleep: async () => {},
      requestTimeoutMs: 5000,
    });

    const first = await monitor.tick();
    expect(first.openSignals).toBe(1);
    expect(first.groups).toBe(1);
    expect(first.candleRequests).toBeGreaterThanOrEqual(0);
    expect(first.errors).toBe(0);

    const after = await repo.listOpenSignals(null, 100);
    // Сигнал закрыт: в открытых его нет.
    expect(after.find((r: any) => r.id === signal.id)).toBeUndefined();

    const closed = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    expect(closed.status).toBe('TARGET_REACHED');
    expect(Number(closed.result_r)).toBeGreaterThan(0);
    expect(Number(closed.monitor_check_count)).toBeGreaterThanOrEqual(1);
    expect(closed.monitor_last_result).toBe('RESOLVED');
    // Журнал наблюдения не переписал хэши.
    expect(closed.hash).toBe(signal.hash);

    // Повторный тик: монотонный отказ, новые значения не появляются.
    const second = await monitor.tick();
    expect(second.openSignals).toBe(0);
    const again = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    expect(again.status).toBe('TARGET_REACHED');
    expect(again.result_r).toBe(closed.result_r);
    expect(again.monitor_check_count).toBe(closed.monitor_check_count);
  }, 120_000);

  it('рынок недоступен ⇒ строка остаётся открытой, исход не выдуман', async (ctx) => {
    if (guard(ctx)) return;
    const { signal } = await seedSignal();
    const monitor = new monitorMod.SignalMonitor({
      now: () => Date.now(),
      listOpen: (limit: number) => repo.listOpenSignals(null, limit),
      sync: (patch: unknown) => repo.syncSignalLifecycle(patch as never),
      getCandles: async () => {
        throw new Error('market unreachable');
      },
      recordMonitor: (id: string, patch: unknown) => repo.recordSignalMonitorCheck(id, patch as never),
      loadCore: async () => {
        const core = await import('../../server/services/strategyEngine/strategyCoreBundle.js');
        return core.loadStrategyCore();
      },
      sleep: async () => {},
      requestTimeoutMs: 1000,
    });
    await monitor.tick();
    const open = await repo.listOpenSignals(null, 100);
    expect(open.find((r: any) => r.id === signal.id)).toBeTruthy();
    const row = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('ACTIVE');
    expect(row.monitor_last_result).toBe('ERROR');
    expect(row.result_r).toBeNull();
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// G) Рестарт-паритет и частичный жизненный цикл.
//
// Проверяется ровно то, что требует ревью перед мержем:
//
//   1. ПАРИТЕТ РЕСТАРТА. Сигнал опубликован → монитор довёл его до
//      НЕтерминального состояния (FILLED) → «бэкенд остановился» → НОВЫЙ
//      экземпляр `SignalMonitor` поднимается и ЧИТАЕТ СТРОКУ ИЗ БД → свечи
//      продолжаются → исход. Результат обязан побитово совпасть с прогоном
//      БЕЗ рестарта (контроль). Это возможно только потому, что монитор
//      stateless: он не хранит стратегемное состояние, а восстанавливает его
//      из бара сетапа + закрытых свечей теми же frozen-функциями.
//
//   2. ЧАСТИЧНЫЙ ЦИКЛ / TP1. Выход на TP1 без TP2/стопа/таймаута обязан дать
//      НЕтерминальный статус FILLED (позиция открыта), а не «исход». Дальше
//      те же бары доводятся до терминала.
//
//   3. ПРОХОЖДЕНИЕ ПО ТРЁМ СТРАТЕГИЯМ. V3.0 и V3.3 идут через коридор
//      (`trackCorridor` → `manageTrade`), V2.8 — через вход по следующему
//      open (`trackNextOpen` → `simulateTrailing`). Разная механика — разные
//      фикстуры, один и тот же критерий паритета.
// ─────────────────────────────────────────────────────────────────────────────

const H = 3_600_000;

/** Монитор с НАСТОЯЩИМ ядром (frozen-функции из `src/`). */
function makePgMonitor(nowMs: () => number, candles: () => unknown[]) {
  return new monitorMod.SignalMonitor({
    now: nowMs,
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

/** Точки сравнения исхода: ровно то, что frozen-функция вернула в БД. */
function outcomeOf(row: any) {
  return {
    status: row.status,
    exitReason: row.close_reason,
    exitPrice: row.close_price === null ? null : Number(row.close_price),
    resultR: row.result_r === null ? null : Number(row.result_r),
    netResultR: row.net_result_r === null ? null : Number(row.net_result_r),
    barsHeld: row.bars_held === null ? null : Number(row.bars_held),
  };
}

/**
 * Один прогон «с рестартом» против контроля.
 *
 * `split` — сколько баров отдать ПЕРЕД «остановкой бэкенда». Если `split`
 * меньше полной серии, первый тик обязан оставить сигнал неразрешённым.
 */
async function parityRun(args: {
  seed: Record<string, unknown>;
  bars: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  split: number;
  expectNonTerminal: 'FILLED' | 'ACTIVE';
}) {
  // ── Контроль: один тик на всей серии ─────────────────────────────────────
  await q('DELETE FROM signals');
  const control = await seedSignal(args.seed);
  const all = args.bars.map((b) => ({ ...b, volume: 1 }));
  const controlMonitor = makePgMonitor(() => all[all.length - 1]!.time * 1000 + H, () => all);
  await controlMonitor.tick();
  const controlRow = (await q('SELECT * FROM signals WHERE id = $1', [control.signal.id]))[0];

  // ── Прогон с рестартом: тик на частичной серии, затем НОВЫЙ монитор ──────
  await q('DELETE FROM signals');
  const restarted = await seedSignal(args.seed);
  const head = all.slice(0, args.split);
  const headMonitor = makePgMonitor(() => head[head.length - 1]!.time * 1000 + H, () => head);
  await headMonitor.tick();
  const midRow = (await q('SELECT * FROM signals WHERE id = $1', [restarted.signal.id]))[0];
  // Частичный жизненный цикл: НЕ терминальный статус, позиция ещё открыта.
  expect(midRow.status).toBe(args.expectNonTerminal);
  expect(midRow.result_r).toBeNull();
  expect(['UNCHANGED', 'FILLED']).toContain(midRow.monitor_last_result);

  // «Остановка бэкенда»: headMonitor больше не используется. Новый экземпляр
  // читает состояние ИСКЛЮЧИТЕЛЬНО из `signals` через listOpenSignals.
  const resumedMonitor = makePgMonitor(() => all[all.length - 1]!.time * 1000 + H, () => all);
  const resumed = await resumedMonitor.tick();
  expect(resumed.openSignals).toBeGreaterThanOrEqual(1);
  const resumedRow = (await q('SELECT * FROM signals WHERE id = $1', [restarted.signal.id]))[0];

  return { controlRow, midRow, resumedRow, resumedMonitor, signalId: restarted.signal.id };
}

describe('Рестарт-паритет и частичный жизненный цикл (настоящий PostgreSQL)', () => {
  it('V3.0: TP1 достигнут ⇒ FILLED; рестарт даёт тот же исход, что без рестарта', async (ctx) => {
    if (guard(ctx)) return;
    const setup = Date.UTC(2026, 8, 21, 9, 0, 0);
    // Коридор [64500, 64700]: вход на баре +1h, TP1=65500 на баре +2h,
    // TP2=66200 на баре +3h. На трёх барах позиция открыта (FILLED).
    const bars = [
      { time: setup / 1000, open: 64400, high: 64500, low: 64300, close: 64450 },
      { time: (setup + H) / 1000, open: 64600, high: 64700, low: 64550, close: 64650 },
      { time: (setup + 2 * H) / 1000, open: 64650, high: 65600, low: 64600, close: 65500 },
      { time: (setup + 3 * H) / 1000, open: 65500, high: 66300, low: 65400, close: 66250 },
    ];
    const { controlRow, resumedRow, resumedMonitor, signalId } = await parityRun({
      seed: { signalCandleTs: new Date(setup) },
      bars,
      split: 3,
      expectNonTerminal: 'FILLED',
    });
    expect(controlRow.status).toBe('TARGET_REACHED');
    expect(resumedRow.status).toBe('TARGET_REACHED');
    // ГЛАВНОЕ: исход после рестарта побитово равен исходу без рестарта.
    // (`outcome_hash` сюда не входит: он включает `hash` публикации строки,
    // а у контрольного и рестартованного прогона это разные строки.)
    expect(outcomeOf(resumedRow)).toEqual(outcomeOf(controlRow));
    // Журнал наблюдения пережил рестарт: счётчик проверок вырос.
    expect(resumedRow.monitor_check_count).toBeGreaterThanOrEqual(2);
    // И ещё один тик после исхода ничего не меняет.
    await resumedMonitor.tick();
    const settled = (await q('SELECT * FROM signals WHERE id = $1', [signalId]))[0];
    expect(settled.outcome_hash).toBe(resumedRow.outcome_hash);
    expect(outcomeOf(settled)).toEqual(outcomeOf(resumedRow));
  }, 120_000);

  it('V3.3: тот же критерий паритета на своей стратегии и своих константах', async (ctx) => {
    if (guard(ctx)) return;
    const setup = Date.UTC(2026, 8, 21, 10, 0, 0);
    const bars = [
      { time: setup / 1000, open: 64400, high: 64500, low: 64300, close: 64450 },
      { time: (setup + H) / 1000, open: 64600, high: 64700, low: 64550, close: 64650 },
      { time: (setup + 2 * H) / 1000, open: 64650, high: 65600, low: 64600, close: 65500 },
      { time: (setup + 3 * H) / 1000, open: 65500, high: 66300, low: 65400, close: 66250 },
    ];
    const { controlRow, resumedRow } = await parityRun({
      seed: {
        strategyId: 'V3_3_HTF_ZONE_MITIGATION',
        strategyVersion: '3.3',
        signalCandleTs: new Date(setup),
      },
      bars,
      split: 3,
      expectNonTerminal: 'FILLED',
    });
    expect(resumedRow.status).toBe('TARGET_REACHED');
    expect(outcomeOf(resumedRow)).toEqual(outcomeOf(controlRow));
  }, 120_000);

  it('V2.8: вход по следующему open ⇒ FILLED, затем trail-исход идентичен контролю', async (ctx) => {
    if (guard(ctx)) return;
    const setup = Date.UTC(2026, 8, 21, 11, 0, 0);
    // V2.8 исполняет по open СЛЕДУЮЩЕГО бара: plannedEntry=100, stop=90,
    // риск=10. Бар +1h: high 105 (0.5R). Бар +2h: high 112 (1.2R) — арм BE,
    // трейл-стоп 102. Бар +3h: high 120 (2R) — трейл-стоп 110. Бар +4h:
    // low 108 ≤ 110 ⇒ выход TRAIL по 110, grossR = 1.0.
    const bars = [
      { time: setup / 1000, open: 100, high: 100, low: 100, close: 100 },
      { time: (setup + H) / 1000, open: 100, high: 105, low: 99, close: 103 },
      { time: (setup + 2 * H) / 1000, open: 103, high: 112, low: 102, close: 111 },
      { time: (setup + 3 * H) / 1000, open: 111, high: 120, low: 110, close: 119 },
      { time: (setup + 4 * H) / 1000, open: 119, high: 119, low: 108, close: 109 },
    ];
    const { controlRow, resumedRow } = await parityRun({
      seed: {
        strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
        strategyVersion: '2.8',
        entryType: 'MARKET_NEXT_OPEN',
        signalCandleTs: new Date(setup),
        entryMin: 100,
        entryMax: 100,
        stopLoss: 90,
        targets: [110, 120],
      },
      bars,
      split: 4,
      expectNonTerminal: 'FILLED',
    });
    // V2.8 выходит не парой TP/SL, а трейлингом: причина TRAIL, статус CLOSED.
    expect(controlRow.status).toBe('CLOSED');
    expect(controlRow.close_reason).toBe('TRAIL');
    expect(resumedRow.close_reason).toBe('TRAIL');
    expect(outcomeOf(resumedRow)).toEqual(outcomeOf(controlRow));
    expect(Number(resumedRow.result_r)).toBeCloseTo(1, 6);
  }, 120_000);

  it('сигнал старше окна ядра ⇒ UNRESOLVED/OUT_OF_DATA_WINDOW, а не молчаливый ACTIVE', async (ctx) => {
    if (guard(ctx)) return;
    await q('DELETE FROM signals');
    const now = Date.UTC(2026, 8, 21, 9, 0, 0);
    // Сетап старше окна ядра (1000 баров 1h): запрос lookback упрётся в
    // максимум, биржа вернёт ровно окно, и бара сетапа в нём не будет.
    const setup = now - 2000 * H;
    const { signal } = await seedSignal({ signalCandleTs: new Date(setup) });

    // 1001 бар, последний — формирующийся: закрытых ровно 1000, сколько и
    // запрошено. Первый закрытый бар (now − 1001h) новее сетапа (now − 2000h).
    const late = Array.from({ length: 1001 }, (_, i) => ({
      time: (now - (1001 - i) * H) / 1000,
      open: 64600, high: 64700, low: 64550, close: 64650, volume: 1,
    }));
    const requested: number[] = [];
    const monitor = new monitorMod.SignalMonitor({
      now: () => now,
      listOpen: (limit: number) => repo.listOpenSignals(null, limit),
      sync: (patch: unknown) => repo.syncSignalLifecycle(patch as never),
      getCandles: async (_s: string, _tf: string, limit: number) => {
        requested.push(limit);
        return late;
      },
      recordMonitor: (id: string, patch: unknown) => repo.recordSignalMonitorCheck(id, patch as never),
      loadCore: async () => {
        const core = await import('../../server/services/strategyEngine/strategyCoreBundle.js');
        return core.loadStrategyCore();
      },
      sleep: async () => {},
      requestTimeoutMs: 5000,
    });
    await monitor.tick();

    // Окно ограничено максимумом ядра, а не «тянуть всю историю».
    expect(requested).toEqual([monitorMod.MAX_LOOKBACK_BARS]);
    const row = (await q('SELECT * FROM signals WHERE id = $1', [signal.id]))[0];
    expect(row.status).toBe('UNRESOLVED');
    expect(row.close_reason).toBe('OUT_OF_DATA_WINDOW');
    expect(row.result_r).toBeNull();
    expect(row.monitor_last_result).toBe('RESOLVED');
  }, 120_000);
});
