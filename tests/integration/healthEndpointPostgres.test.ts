/**
 * CRYPTORA — `/api/health`, `/api/health/live`, `/api/health/ready` на НАСТОЯЩЕМ
 * стеке: embedded PostgreSQL + настоящие миграции + настоящее Express-приложение.
 *
 * Что здесь доказывается (а не декларируется):
 *   • health реально ходит в БД (`SELECT 1`) и это видно по latency;
 *   • при недоступной БД ответ 503 и status=error, а не 200 «всё хорошо»;
 *   • liveness отвечает 200 даже когда БД лежит — иначе liveness-проба
 *     перезапускала бы здоровый процесс при аварии базы;
 *   • readiness при лежащей БД отдаёт 503;
 *   • ни один секрет не утекает в публичный ответ;
 *   • инварианты записи сигналов работают на настоящей схеме:
 *     свеча из будущего не сохраняется, дубль не создаётся, невозможный
 *     порядок времён отвергается.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { listen, HttpClient } from '../helpers/httpHarness';

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
let client: HttpClient;
let closeServer: () => Promise<void>;
let signalRepo: any = null;
let telemetryModule: any = null;

beforeAll(async () => {
  let EmbeddedPostgres: any;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    skipReason = `embedded-postgres недоступен: ${(e as Error).message}`;
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-health-'));
  const port = await freePort();

  try {
    pg = new EmbeddedPostgres({
      databaseDir: dataDir, user: 'cryptora', password: 'cryptora', port, persistent: false,
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
    env: { ...process.env, DATABASE_URL: url }, cwd: ROOT, encoding: 'utf8',
  });

  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET = 'integration-test-secret';
  process.env.NODE_ENV = 'development';
  process.env.SESSION_STORE = 'memory';

  const { createApp } = await import('../../server/app.js');
  const harness = await listen(createApp());
  client = harness.client;
  closeServer = harness.close;

  signalRepo = await import('../../server/services/signalRepository.js');
  telemetryModule = await import('../../server/services/health/telemetry.js');

  db = await pg.getPgClient('cryptora');
  await db.connect();
}, 240_000);

afterAll(async () => {
  try { if (db) await db.end(); } catch { /* уже закрыто */ }
  try { if (closeServer) await closeServer(); } catch { /* уже остановлен */ }
  try {
    const { closePool } = await import('../../server/db/pool.js');
    await closePool();
  } catch { /* пул уже закрыт */ }
  try { if (pg) await pg.stop(); } catch { /* уже остановлена */ }
});

const guard = (ctx: any) => {
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.warn(`[healthEndpointPostgres] SKIPPED: ${skipReason}`);
    ctx.skip();
    return true;
  }
  return false;
};

const HOUR = 3_600_000;

describe('GET /api/health (настоящий стек)', () => {
  it('здоровая БД: 200 и реальная измеренная задержка SELECT 1', async (ctx) => {
    if (guard(ctx)) return;

    const res = await client.get('/api/health');
    const body = res.body as any;

    expect(res.status).toBe(200);
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body.database.status).toBe('ok');
    expect(typeof body.database.latencyMs).toBe('number');
    expect(body.database.latencyMs).toBeLessThan(2000);
  });

  it('контракт ответа содержит все обязательные разделы', async (ctx) => {
    if (guard(ctx)) return;

    const body = (await client.get('/api/health')).body as any;

    for (const key of ['status', 'timestamp', 'uptimeSeconds', 'version',
      'database', 'marketData', 'signalMonitor', 'radarMonitor', 'strategyScheduler']) {
      expect(body).toHaveProperty(key);
    }
    expect(body.database).toHaveProperty('latencyMs');
    expect(body.marketData).toHaveProperty('lastSuccessfulUpdate');
    expect(body.marketData).toHaveProperty('ageSeconds');
    expect(body.signalMonitor).toHaveProperty('lastCycleAt');
    expect(body.radarMonitor).toHaveProperty('lastCycleAt');
    expect(body.strategyScheduler).toHaveProperty('lastCycleAt');
  });

  it('не раскрывает секретов', async (ctx) => {
    if (guard(ctx)) return;

    const raw = JSON.stringify((await client.get('/api/health')).body);

    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    expect(raw).not.toContain('integration-test-secret');
    expect(raw).not.toMatch(/\bpassword\b/i);
    expect(raw).not.toMatch(/\bbot\d{6,}:/);
    expect(raw).not.toMatch(/@[\w.-]+\.[a-z]{2,}/i);
  });

  it('liveness отвечает 200 и не трогает БД', async (ctx) => {
    if (guard(ctx)) return;

    const res = await client.get('/api/health/live');
    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('alive');
  });

  it('readiness отвечает структурой готовности', async (ctx) => {
    if (guard(ctx)) return;

    const res = await client.get('/api/health/ready');
    const body = res.body as any;

    // Мониторы в тестовом процессе не запускаются ⇒ not_ready/503 ожидаемо.
    expect([200, 503]).toContain(res.status);
    expect(body).toHaveProperty('subsystems');
    expect(body.database.status).toBe('ok');
  });

  it('свежесть рыночных данных попадает в отчёт из телеметрии', async (ctx) => {
    if (guard(ctx)) return;

    telemetryModule.getHealthTelemetry().recordMarketData('binance-spot-candles', {
      sourceTimestampMs: Date.now() - 60_000,
      receivedAtMs: Date.now(),
      intervalSeconds: 3600,
    });

    const body = (await client.get('/api/health')).body as any;
    expect(body.marketData.feeds['binance-spot-candles'].observed).toBe(true);
    expect(body.marketData.feeds['binance-spot-candles'].status).toBe('ok');
    expect(body.marketData.lastSuccessfulUpdate).toBeTruthy();
  });
});

describe('GET /api/health при недоступной БД', () => {
  it('503 + status=error, liveness при этом остаётся 200', async (ctx) => {
    if (guard(ctx)) return;

    const pool = await import('../../server/db/pool.js');
    const real = pool.getPool();
    // Подменяем пул «лежащей» БД — приложение, маршруты и сериализация настоящие.
    (pool as any).__setPoolForTests({
      query: async () => { throw Object.assign(new Error('connection to server at "127.0.0.1", port 5432 failed'), { code: 'ECONNREFUSED' }); },
    });

    try {
      const health = await client.get('/api/health');
      expect(health.status).toBe(503);
      expect((health.body as any).status).toBe('error');
      expect((health.body as any).database.status).toBe('error');
      // Категория, а не текст драйвера (он содержит хост и порт).
      expect((health.body as any).database.errorCode).toBe('UNAVAILABLE');
      expect(JSON.stringify(health.body)).not.toContain('127.0.0.1');

      const live = await client.get('/api/health/live');
      expect(live.status).toBe(200);

      const ready = await client.get('/api/health/ready');
      expect(ready.status).toBe(503);
      expect((ready.body as any).status).toBe('not_ready');
    } finally {
      (pool as any).__setPoolForTests(real);
    }
  });
});

describe('Инварианты сигналов на настоящей схеме', () => {
  it('свеча из будущего не сохраняется (инвариант 2)', async (ctx) => {
    if (guard(ctx)) return;
    await db.query('DELETE FROM signals');

    const res = await signalRepo.insertSignal({
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      strategyVersion: '3.0',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      direction: 'LONG',
      signalCandleTs: new Date(Date.now() + 6 * HOUR),
      entryMin: 65000, entryMax: 65200, stopLoss: 64000, targets: [66000],
    });

    expect(res.inserted).toBe(false);
    expect(res.rejected).toBe('INVARIANT_VIOLATION');
    expect(res.violations.map((v: any) => v.code)).toContain('FUTURE_CANDLE');

    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM signals');
    expect(rows[0].n).toBe(0);
  });

  it('дубликат того же бара не создаётся (инвариант 4)', async (ctx) => {
    if (guard(ctx)) return;
    await db.query('DELETE FROM signals');

    const row = {
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      strategyVersion: '3.0',
      symbol: 'ETH/USDT',
      timeframe: '1h',
      direction: 'LONG',
      signalCandleTs: new Date(Date.now() - 2 * HOUR),
      entryMin: 3000, entryMax: 3010, stopLoss: 2950, targets: [3100, 3200],
    };

    const first = await signalRepo.insertSignal(row);
    const second = await signalRepo.insertSignal({ ...row });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false); // второй раз не вставилось: дедупликация по бару
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM signals');
    expect(rows[0].n).toBe(1);
  });

  it('невозможный порядок времён отвергается (инвариант 6)', async (ctx) => {
    if (guard(ctx)) return;
    await db.query('DELETE FROM signals');

    const candleTs = new Date(Date.now() - 3 * HOUR);
    const inserted = await signalRepo.insertSignal({
      strategyId: 'V3_3_HTF_ZONE_MITIGATION',
      strategyVersion: '3.3',
      symbol: 'SOL/USDT',
      timeframe: '1h',
      direction: 'LONG',
      signalCandleTs: candleTs,
      entryMin: 100, entryMax: 101, stopLoss: 95, targets: [110],
    });
    expect(inserted.inserted).toBe(true);

    // Закрытие РАНЬШЕ бара сетапа: такая сделка невосстановима.
    const result = await signalRepo.closeSignal(inserted.signal.id, 'TARGET_REACHED', {
      closedAt: new Date(candleTs.getTime() - HOUR),
      closePrice: 110,
      closeReason: 'TP1',
      resultR: 2,
    });
    expect(result).toBeNull();

    const { rows } = await db.query('SELECT status, closed_at FROM signals WHERE id = $1', [inserted.signal.id]);
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].closed_at).toBeNull();
  });

  it('корректный жизненный цикл по-прежнему проходит (регрессия к инвариантам)', async (ctx) => {
    if (guard(ctx)) return;
    await db.query('DELETE FROM signals');

    const candleTs = new Date(Date.now() - 5 * HOUR);
    const inserted = await signalRepo.insertSignal({
      strategyId: 'V3_3_HTF_ZONE_MITIGATION',
      strategyVersion: '3.3',
      symbol: 'ADA/USDT',
      timeframe: '1h',
      direction: 'LONG',
      signalCandleTs: candleTs,
      entryMin: 1, entryMax: 1.01, stopLoss: 0.9, targets: [1.2],
    });

    const closed = await signalRepo.closeSignal(inserted.signal.id, 'TARGET_REACHED', {
      closedAt: new Date(candleTs.getTime() + 2 * HOUR),
      closePrice: 1.2,
      closeReason: 'TP1',
      resultR: 1.9,
      fill: { price: 1.005, at: new Date(candleTs.getTime() + HOUR) },
    });

    expect(closed).not.toBeNull();
    expect(closed.status).toBe('TARGET_REACHED');
  });
});

describe('Согласованность статистики сигналов (§6)', () => {
  it('wins + losses + breakEven + unrated = completed, и разбивка статусов = published', async (ctx) => {
    if (guard(ctx)) return;
    await db.query('DELETE FROM signals');

    const base = Date.now() - 10 * HOUR;
    const mk = async (symbol: string, offsetHours: number) => signalRepo.insertSignal({
      strategyId: 'V3_4_LIQUIDITY_SWEEP',
      strategyVersion: '3.4',
      engineSetupId: `V3_4_LIQUIDITY_SWEEP-${symbol.replace('/', '')}-${base + offsetHours * HOUR}`,
      symbol,
      timeframe: '1h',
      direction: 'LONG',
      signalCandleTs: new Date(base + offsetHours * HOUR),
      entryMin: 10, entryMax: 10.1, stopLoss: 9, targets: [12],
      provenanceStatus: 'VERIFIED',
    });

    const a = await mk('BTC/USDT', 0);
    const b = await mk('ETH/USDT', 1);
    await mk('SOL/USDT', 2);

    await signalRepo.closeSignal(a.signal.id, 'TARGET_REACHED', {
      closedAt: new Date(base + 3 * HOUR), closePrice: 12, closeReason: 'TP1', resultR: 2,
    });
    await signalRepo.closeSignal(b.signal.id, 'INVALIDATED', {
      closedAt: new Date(base + 4 * HOUR), closePrice: 9, closeReason: 'SL', resultR: -1,
    });

    const { getSignalStatistics } = await import('../../server/services/signalStatistics.js');
    const stats = await getSignalStatistics({});
    const t = stats.totals;

    // Ни один сигнал не посчитан дважды: корзины исходов разбивают completed.
    expect(t.wins + t.losses + t.breakEven + t.unrated).toBe(t.completed);
    // Разбивка по статусам покрывает published ровно один раз.
    expect(t.waitingEntry + t.filled + t.completed + t.cancelled + t.expired + t.unresolved)
      .toBe(t.published);
    // Знаменатель не превышает числитель-носитель.
    expect(t.ratedCompleted).toBeLessThanOrEqual(t.completed);
    expect(t.wins).toBeLessThanOrEqual(t.ratedCompleted);

    expect(t.published).toBe(3);
    expect(t.wins).toBe(1);
    expect(t.losses).toBe(1);
    expect(t.waitingEntry).toBe(1);
  });

  it('явный фильтр тестового периода не смешивает исторические данные', async (ctx) => {
    if (guard(ctx)) return;

    const { getSignalStatistics, TEST_RUN_NONE } = await import('../../server/services/signalStatistics.js');
    // Все посеянные выше строки созданы вне тестовых периодов.
    const historical = await getSignalStatistics({ testRunId: TEST_RUN_NONE });
    expect(historical.totals.published).toBe(3);

    const nonexistentRun = await getSignalStatistics({
      testRunId: '00000000-0000-4000-8000-000000000000',
    });
    expect(nonexistentRun.totals.published).toBe(0);
  });
});
