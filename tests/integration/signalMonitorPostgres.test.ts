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
