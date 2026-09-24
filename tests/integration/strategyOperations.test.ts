/**
 * CRYPTORA — Стратегии: настройки, авторизация, сигналы, дедупликация.
 *
 * Всё проверяется на НАСТОЯЩЕМ PostgreSQL (embedded-postgres) через НАСТОЯЩИЕ
 * миграции и НАСТОЯЩЕЕ Express-приложение из server/app.js. Моков базы данных нет:
 * подменяется только HTTP-слой рыночных данных (Binance из песочницы
 * недоступен), и это единственное место подмены — оно помечено ниже.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

// Модули сервера, импортируются ПОСЛЕ установки DATABASE_URL.
let api: any = null;
let settingsRepo: any = null;
let signalRepo: any = null;

const ADMIN = { email: 'strat-admin@test.local', password: 'Str0ngPass!234' };
const USER = { email: 'strat-user@test.local', password: 'Str0ngPass!234' };

async function registerAndVerify(email: string, password: string, role: 'admin' | 'user') {
  const reg = await client.post('/api/auth/register', {
    email,
    password,
    displayName: role === 'admin' ? 'Strategy Admin' : 'Plain User',
  });
  expect([200, 201, 409], `register ${email}: ${JSON.stringify(reg.body)}`).toContain(reg.status);
  // Верификация почты обязательна; токен наружу не отдаётся, поэтому
  // подтверждаем напрямую в БД — это тестовая инфраструктура, не обход защиты.
  await db.query('UPDATE users SET email_verified = TRUE, role = $2 WHERE email = $1', [email, role]);
}

async function login(email: string, password: string) {
  const fresh = new HttpClient((client as any).base);
  const res = await fresh.post('/api/auth/login', { email, password });
  expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return fresh;
}

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  return (await db.query(sql, params)).rows;
}

beforeAll(async () => {
  let EmbeddedPostgres: any;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    skipReason = `embedded-postgres недоступен: ${(e as Error).message}`;
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-strat-'));
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

  // НАСТОЯЩИЕ миграции НАСТОЯЩИМ раннером.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: url },
    cwd: ROOT,
    encoding: 'utf8',
  });

  // Конфиг сервера читает окружение при импорте — ставим ДО import().
  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET = 'integration-test-secret';
  process.env.NODE_ENV = 'development';
  process.env.REGISTRATION_ENABLED = 'true';
  process.env.SESSION_STORE = 'memory';

  const { createApp } = await import('../../server/app.js');
  const harness = await listen(createApp());
  client = harness.client;
  closeServer = harness.close;

  api = await import('../../server/services/strategySettings.js');
  settingsRepo = api;
  signalRepo = await import('../../server/services/signalRepository.js');

  db = await pg.getPgClient('cryptora');
  await db.connect();

  await registerAndVerify(ADMIN.email, ADMIN.password, 'admin');
  await registerAndVerify(USER.email, USER.password, 'user');
}, 240_000);

afterAll(async () => {
  // Порядок важен: сначала закрываем пул приложения, и только потом
  // останавливаем PostgreSQL. Иначе pg рвёт живые соединения сервера и
  // процесс получает 57P01 «terminating connection due to administrator
  // command» как unhandled error.
  try {
    if (db) await db.end();
  } catch { /* уже закрыто */ }
  try {
    if (closeServer) await closeServer();
  } catch { /* сервер уже остановлен */ }
  try {
    const { closePool } = await import('../../server/db/pool.js');
    await closePool();
  } catch { /* пул уже закрыт */ }
  try {
    if (pg) await pg.stop();
  } catch { /* БД уже остановлена */ }
});

beforeEach(async () => {
  if (skipReason) return;
  // Возвращаем состояние «как после миграции»: всё выключено, сигналов нет.
  await db.query('UPDATE strategy_settings SET enabled = FALSE, last_error = NULL, last_scan_at = NULL, last_signal_at = NULL');
  await db.query('DELETE FROM signals');
  // audit_log в проде append-only, но здесь это тестовая БД: без очистки
  // записи предыдущих тестов смешивались с текущими.
  await db.query(`DELETE FROM audit_log WHERE target_type = 'strategy'`);
});

/**
 * Пропуск через `ctx.skip()`, а не «предупреждение в stderr и успех».
 * Прежняя форма засчитывала непроверенный тест как passed: набор выглядел
 * зелёным там, где ничего не выполнялось (F-03).
 */
const guard = (ctx: any) => {
  if (skipReason) {
    ctx.skip();
    return true;
  }
  return false;
};

/* ═════════════════ Настройки стратегий ═════════════════ */

describe('Настройки стратегий — начальное состояние', () => {
  it('ровно 3 строки, и это три продуктовые стратегии', async (ctx) => {
    if (guard(ctx)) return;
    const ids = await q('SELECT strategy_id FROM strategy_settings ORDER BY strategy_id');
    expect(ids.map((r: any) => r.strategy_id)).toEqual([
      'V2_8_ZERO_FEE_SNIPER_TRAILING',
      'V3_0_HTF_LIQUIDATION_TRAP',
      'V3_3_HTF_ZONE_MITIGATION',
    ]);
  });

  it('по умолчанию все выключены', async (ctx) => {
    if (guard(ctx)) return;
    const rows = await q('SELECT enabled FROM strategy_settings');
    expect(rows.every((r: any) => r.enabled === false)).toBe(true);
  });

  it('GET /api/strategies доступен без авторизации и не содержит мусора', async (ctx) => {
    if (guard(ctx)) return;
    const anon = new HttpClient((client as any).base);
    const res = await anon.get('/api/strategies');
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.strategies).toHaveLength(3);
    expect(body.source).toBe('server');

    const first = body.strategies[0];
    for (const k of ['strategyId', 'version', 'name', 'enabled', 'status', 'timeframes', 'scanIntervalSeconds', 'activeSignalCount']) {
      expect(first, `нет поля ${k}`).toHaveProperty(k);
    }
    // Внутренние исследовательские поля наружу не уходят.
    const json = JSON.stringify(body);
    for (const banned of ['sourceVerdict', 'artifactSha256', 'funnel', 'reproductionEvidence', 'variants']) {
      expect(json, `в ответе не должно быть ${banned}`).not.toContain(banned);
    }
  });

  it('GET /api/strategies объявляет таймфрейм ИСПОЛНЕНИЯ отдельно от контекста', async (ctx) => {
    if (guard(ctx)) return;
    const body = (await client.get('/api/strategies')).body as any;
    for (const s of body.strategies) {
      // Все три продуктовые стратегии исполняются на 1h (EXEC_TIMEFRAME ядра).
      expect(s.execTimeframe, s.strategyId).toBe('1h');
      expect(s.timeframes, s.strategyId).toContain('1h');
      expect(s.contextTimeframes, s.strategyId).toEqual(
        s.timeframes.filter((t: string) => t !== s.execTimeframe)
      );
    }
    const v28 = body.strategies.find((s: any) => s.strategyId === 'V2_8_ZERO_FEE_SNIPER_TRAILING');
    expect(v28.timeframes).toEqual(['1h', '4h', '1D']);
    expect(v28.contextTimeframes).toEqual(['4h', '1D']);
    // «15m» — параметр исторического исследования V2.8, а не LIVE-характеристика.
    expect(JSON.stringify(body)).not.toContain('15m');
  });

  it('activeSignalCount считает открытые (ACTIVE + FILLED) так же, как страница сигналов', async (ctx) => {
    if (guard(ctx)) return;
    const countOf = async () => {
      const res = await client.get('/api/strategies');
      return ((res.body as any).strategies.find(
        (s: any) => s.strategyId === 'V2_8_ZERO_FEE_SNIPER_TRAILING'
      )).activeSignalCount;
    };
    const openCount = async () =>
      ((await client.get('/api/signals?open=true')).body as any).count;

    await signalRepo.insertSignal(V28_SETUP);
    expect(await countOf()).toBe(1);
    expect(await openCount()).toBe(1);

    // Исполнение не «закрывает» сигнал: позиция открыта, исход ещё не ясен.
    await signalRepo.syncSignalLifecycle({
      strategyId: V28_SETUP.strategyId,
      symbol: V28_SETUP.symbol,
      timeframe: V28_SETUP.timeframe,
      signalCandleTs: V28_SETUP.signalCandleTs,
      fill: { price: 115260.25, at: '2026-09-19T05:00:00Z' },
      outcome: null,
    });
    expect(await countOf(), 'FILLED остаётся открытым сигналом').toBe(1);
    expect(await openCount()).toBe(1);

    await signalRepo.syncSignalLifecycle({
      strategyId: V28_SETUP.strategyId,
      symbol: V28_SETUP.symbol,
      timeframe: V28_SETUP.timeframe,
      signalCandleTs: V28_SETUP.signalCandleTs,
      fill: null,
      outcome: { status: 'TARGET_REACHED', exitReason: 'TP3', exitPrice: 121050, resultR: 3, netResultR: 3, closedAt: new Date('2026-09-19T15:00:00Z') },
    });
    expect(await countOf()).toBe(0);
    expect(await openCount()).toBe(0);
    expect(((await client.get('/api/signals?open=false')).body as any).count).toBe(1);
  });

  it('«нет данных» отдаётся как null, а не как 0', async (ctx) => {
    if (guard(ctx)) return;
    const res = await client.get('/api/strategies');
    const v33 = (res.body as any).strategies.find((s: any) => s.strategyId === 'V3_3_HTF_ZONE_MITIGATION');
    expect(v33.lastScanAt).toBeNull();
    expect(v33.lastSignalAt).toBeNull();
    expect(v33.lastError).toBeNull();
    // Но счётчик сигналов — реальный COUNT, и 0 здесь осмысленно.
    expect(v33.activeSignalCount).toBe(0);
  });
});

describe('Переключатель ВКЛ/ВЫКЛ — авторизация', () => {
  it('гость не может включить стратегию (401)', async (ctx) => {
    if (guard(ctx)) return;
    const anon = new HttpClient((client as any).base);
    const res = await anon.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    expect(res.status).toBe(401);
    const row = (await q(`SELECT enabled FROM strategy_settings WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`))[0];
    expect(row.enabled).toBe(false);
  });

  it('обычный пользователь не может включить стратегию (403)', async (ctx) => {
    if (guard(ctx)) return;
    const user = await login(USER.email, USER.password);
    const res = await user.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    expect(res.status).toBe(403);
    const row = (await q(`SELECT enabled FROM strategy_settings WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`))[0];
    expect(row.enabled).toBe(false);
  });

  it('обычный пользователь не видит админ-статус', async (ctx) => {
    if (guard(ctx)) return;
    const user = await login(USER.email, USER.password);
    const res = await user.get('/api/admin/strategies/status');
    expect([401, 403]).toContain(res.status);
  });

  it('админ включает стратегию, и состояние сохраняется в PostgreSQL', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    expect(res.status).toBe(200);
    expect((res.body as any).enabled).toBe(true);

    // Источник истины — БД, а не ответ API.
    const row = (await q(`SELECT enabled, updated_by FROM strategy_settings WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`))[0];
    expect(row.enabled).toBe(true);
    expect(row.updated_by).toBeTruthy();
  });

  it('админ выключает стратегию', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    await admin.patch('/api/admin/strategies/V3_0_HTF_LIQUIDATION_TRAP', { enabled: true });
    const off = await admin.patch('/api/admin/strategies/V3_0_HTF_LIQUIDATION_TRAP', { enabled: false });
    expect(off.status).toBe(200);
    expect((off.body as any).enabled).toBe(false);
    const row = (await q(`SELECT enabled FROM strategy_settings WHERE strategy_id='V3_0_HTF_LIQUIDATION_TRAP'`))[0];
    expect(row.enabled).toBe(false);
  });

  it('состояние переживает «перезапуск»: читается из БД, а не из памяти', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    await admin.patch('/api/admin/strategies/V2_8_ZERO_FEE_SNIPER_TRAILING', { enabled: true });

    // Имитация рестарта: свежий экземпляр репозитория читает БД заново.
    const fresh = await q('SELECT * FROM strategy_settings WHERE strategy_id=$1', ['V2_8_ZERO_FEE_SNIPER_TRAILING']);
    expect(fresh[0].enabled).toBe(true);

    const res = await client.get('/api/strategies');
    const v28 = (res.body as any).strategies.find((s: any) => s.strategyId === 'V2_8_ZERO_FEE_SNIPER_TRAILING');
    expect(v28.enabled).toBe(true);
    expect(v28.status).toBe('ON');
  });

  it('каждое переключение попадает в audit_log с metadata.strategyId', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: false });

    const rows = await q(
      `SELECT action, target_type, target_id, metadata FROM audit_log
        WHERE target_type='strategy' ORDER BY created_at ASC`
    );
    expect(rows.map((r: any) => r.action)).toEqual(['STRATEGY_ENABLED', 'STRATEGY_DISABLED']);
    for (const r of rows) {
      expect(r.target_id).toBe('V3_3_HTF_ZONE_MITIGATION');
      expect(r.metadata.strategyId).toBe('V3_3_HTF_ZONE_MITIGATION');
      expect(typeof r.metadata.enabled).toBe('boolean');
    }
  });

  it('неизвестная стратегия отклоняется (404), четвёртая не создаётся', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.patch('/api/admin/strategies/V9_9_MADE_UP', { enabled: true });
    expect(res.status).toBe(404);
    expect((await q('SELECT count(*)::int AS n FROM strategy_settings'))[0].n).toBe(3);
  });

  it('тело без булева enabled отклоняется (400)', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }]) {
      const res = await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('математические параметры через API не меняются', async (ctx) => {
    if (guard(ctx)) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', {
      enabled: true,
      rvolMin: 0.1,
      atrPeriod: 3,
      stopBufferAtr: 99,
      targets: [1, 2],
    });
    expect(res.status).toBe(200);
    // В таблице нет колонок для математики — значит и записать её некуда.
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='strategy_settings'`))
      .map((r: any) => r.column_name);
    expect(cols).not.toContain('rvol_min');
    expect(cols).not.toContain('atr_period');
    expect(cols).not.toContain('targets');
  });
});

/* ═════════════════ Сигналы и дедупликация ═════════════════ */

describe('Сигналы — хранение и дедупликация', () => {
  const base = {
    strategyId: 'V3_3_HTF_ZONE_MITIGATION',
    symbol: 'ETH/USDT',
    timeframe: '1h',
    direction: 'SHORT',
    signalCandleTs: new Date('2026-09-19T04:00:00Z'),
    entryMin: 2612.7,
    entryMax: 2617.3,
    stopLoss: 2625.0,
    tp1: 2600.0,
    tp2: 2570.0,
  };

  it('повторный скан того же закрытого бара не создаёт второй сигнал', async (ctx) => {
    if (guard(ctx)) return;
    const first = await signalRepo.insertSignal(base);
    expect(first.inserted).toBe(true);
    expect(first.signal.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(first.signal.previousHash).toBe('GENESIS');

    const second = await signalRepo.insertSignal(base);
    expect(second.inserted).toBe(false);

    expect((await q('SELECT count(*)::int AS n FROM signals'))[0].n).toBe(1);
  });

  it('цепочка SHA-256 связывает записи и верифицируется', async (ctx) => {
    if (guard(ctx)) return;
    const a = await signalRepo.insertSignal(base);
    const b = await signalRepo.insertSignal({
      ...base,
      symbol: 'BTC/USDT',
      signalCandleTs: new Date('2026-09-19T05:00:00Z'),
    });
    expect(a.inserted && b.inserted).toBe(true);

    const rows = await q('SELECT hash, previous_hash FROM signals ORDER BY created_at ASC, id ASC');
    expect(rows).toHaveLength(2);
    expect(rows[0].previous_hash).toBe('GENESIS');
    // Вторая запись ссылается на хэш первой — иначе цепочки нет.
    expect(rows[1].previous_hash).toBe(rows[0].hash);

    const chain = await signalRepo.verifyChain();
    expect(chain).toEqual({ rows: 2, breaks: 0 });
  });

  it('фильтры GET /api/signals работают', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(base);
    await signalRepo.insertSignal({ ...base, symbol: 'BTC/USDT', strategyId: 'V3_0_HTF_LIQUIDATION_TRAP' });

    const all = await client.get('/api/signals');
    expect((all.body as any).count).toBe(2);

    const byStrategy = await client.get('/api/signals?strategy=V3_0_HTF_LIQUIDATION_TRAP');
    expect((byStrategy.body as any).count).toBe(1);

    const bySymbol = await client.get('/api/signals?symbol=eth/usdt');
    expect((bySymbol.body as any).count).toBe(1);

    const byStatus = await client.get('/api/signals?status=ACTIVE');
    expect((byStatus.body as any).count).toBe(2);

    const bad = await client.get('/api/signals?status=WON');
    expect(bad.status).toBe(400);
  });

  it('каждый сигнал несёт strategy_id', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(base);
    const res = await client.get('/api/signals');
    const s = (res.body as any).signals[0];
    expect(s.strategyId).toBe('V3_3_HTF_ZONE_MITIGATION');
  });

  it('счётчик активных сигналов — реальный SELECT COUNT', async (ctx) => {
    if (guard(ctx)) return;
    expect(await signalRepo.countActiveSignals('V3_3_HTF_ZONE_MITIGATION')).toBe(0);
    await signalRepo.insertSignal(base);
    expect(await signalRepo.countActiveSignals('V3_3_HTF_ZONE_MITIGATION')).toBe(1);

    await signalRepo.closeSignal((await q('SELECT id FROM signals'))[0].id, 'TARGET_REACHED');
    expect(await signalRepo.countActiveSignals('V3_3_HTF_ZONE_MITIGATION')).toBe(0);

    const res = await client.get('/api/strategies');
    const v33 = (res.body as any).strategies.find((s: any) => s.strategyId === 'V3_3_HTF_ZONE_MITIGATION');
    expect(v33.activeSignalCount).toBe(0);
  });
});

/* ═════════════════ Репозиторий настроек ═════════════════ */

describe('Репозиторий настроек', () => {
  it('getEnabledStrategies возвращает только включённые', async (ctx) => {
    if (guard(ctx)) return;
    expect(await settingsRepo.getEnabledStrategies()).toHaveLength(0);
    await db.query(`UPDATE strategy_settings SET enabled=TRUE WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    const enabled = await settingsRepo.getEnabledStrategies();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].strategyId).toBe('V3_3_HTF_ZONE_MITIGATION');
  });

  it('setStrategyEnabled отклоняет неизвестную стратегию до обращения к SQL', async (ctx) => {
    if (guard(ctx)) return;
    await expect(
      settingsRepo.setStrategyEnabled({ strategyId: 'NOPE', enabled: true, actorUserId: null })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('статус выводится из полей БД: OFF / ON / ERROR', async (ctx) => {
    if (guard(ctx)) return;
    const states = await settingsRepo.listStrategyStates();
    expect(states.every((s: any) => s.status === 'OFF')).toBe(true);

    await db.query(`UPDATE strategy_settings SET enabled=TRUE WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    expect(
      (await settingsRepo.listStrategyStates()).find((s: any) => s.strategyId === 'V3_3_HTF_ZONE_MITIGATION').status
    ).toBe('ON');

    await db.query(`UPDATE strategy_settings SET last_error='market data down' WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    expect(
      (await settingsRepo.listStrategyStates()).find((s: any) => s.strategyId === 'V3_3_HTF_ZONE_MITIGATION').status
    ).toBe('ERROR');
  });

  it('engineStatus отдаёт реальные числа', async (ctx) => {
    if (guard(ctx)) return;
    await db.query(`UPDATE strategy_settings SET enabled=TRUE WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    const st = await settingsRepo.engineStatus();
    expect(st.totalStrategies).toBe(3);
    expect(st.enabledCount).toBe(1);
    expect(st.errorCount).toBe(0);
    expect(st.signalsTotal).toBe(0);
  });
});

/* ═════════════════ Сигналы: лестница целей и жизненный цикл (миграция 009) ═════════════════ */

/**
 * Сетап в той форме, в которой его отдаёт ledger ядра (`AnalyticalSetup`):
 * лестница целей из ТРЁХ уровней — ровно тот случай, где TP3 терялся (F-06).
 * V2.8 входит по OPEN следующего бара и сдвигает стоп/цели на дельту исполнения,
 * поэтому здесь entryType = MARKET_NEXT_OPEN и есть fill-уровни.
 */
const V28_SETUP = {
  strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
  strategyVersion: '2.8',
  engineSetupId: 'V2_8-BTCUSDT-1758283200000',
  symbol: 'BTC/USDT',
  timeframe: '1h',
  direction: 'LONG',
  signalCandleTs: new Date('2026-09-19T04:00:00Z'),
  entryType: 'MARKET_NEXT_OPEN',
  validForBars: null,
  exitRule: 'TP1 → BE, далее трейлинг по структуре 1h',
  entryMin: 115200.5,
  entryMax: 115200.5,
  stopLoss: 114310.75,
  targets: [116900.5, 118400.25, 121050.0],
  status: 'ACTIVE',
  metadata: { engineVersion: 'V2.8', riskRewardRatio: 1.94, latencyBars: 0 },
};

describe('Сигналы — ничего из посчитанного стратегией не теряется (F-06)', () => {
  it('лестница целей из 3 уровней сохраняется целиком, tp1/tp2 выводятся из неё', async (ctx) => {
    if (guard(ctx)) return;
    const res = await signalRepo.insertSignal(V28_SETUP);
    expect(res.inserted).toBe(true);

    const row = (await q('SELECT * FROM signals'))[0];
    // NUMERIC[] приходит строковым массивом из pg — сравниваем как числа.
    expect(row.targets.map(Number)).toEqual([116900.5, 118400.25, 121050.0]);
    expect(Number(row.tp1)).toBe(116900.5);
    expect(Number(row.tp2)).toBe(118400.25);
    // TP3 не «в metadata» и не в отдельной колонке: он в канонической лестнице.
    expect(row.chain_version).toBe(2);
  });

  it('GET /api/signals отдаёт TP3 — сквозное доказательство strategy → БД → API', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);

    const res = await client.get('/api/signals');
    expect(res.status).toBe(200);
    const s = (res.body as any).signals[0];
    expect(s.targets, 'третья цель обязана доехать до клиента').toEqual([116900.5, 118400.25, 121050.0]);
    expect(s.tp1).toBe(116900.5);
    expect(s.tp2).toBe(118400.25);
    expect(s).toMatchObject({
      strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
      strategyVersion: '2.8',
      engineSetupId: 'V2_8-BTCUSDT-1758283200000',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      direction: 'LONG',
      entryType: 'MARKET_NEXT_OPEN',
      exitRule: 'TP1 → BE, далее трейлинг по структуре 1h',
      entryMin: 115200.5,
      entryMax: 115200.5,
      stopLoss: 114310.75,
      status: 'ACTIVE',
      chainVersion: 2,
    });
    expect(new Date(s.signalCandleTs).toISOString()).toBe('2026-09-19T04:00:00.000Z');
    expect(s.metadata.riskRewardRatio).toBe(1.94);
  });

  it('запись в старой форме (только tp1/tp2) остаётся валидной и получает лестницу', async (ctx) => {
    if (guard(ctx)) return;
    const res = await signalRepo.insertSignal({
      strategyId: 'V3_3_HTF_ZONE_MITIGATION',
      symbol: 'ETH/USDT',
      timeframe: '1h',
      direction: 'SHORT',
      signalCandleTs: new Date('2026-09-19T06:00:00Z'),
      entryMin: 2612.7,
      entryMax: 2617.3,
      stopLoss: 2625.0,
      tp1: 2600.0,
      tp2: 2570.0,
    });
    expect(res.inserted).toBe(true);

    const row = (await q('SELECT * FROM signals'))[0];
    expect(row.targets.map(Number)).toEqual([2600.0, 2570.0]);
    expect(Number(row.tp1)).toBe(2600.0);
    expect((await client.get('/api/signals')).body).toMatchObject({ count: 1 });
  });

  it('повторная запись того же бара в другой форме не создаёт дубль и не портит уровни', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);
    // Тот же ключ дедупликации (стратегия, символ, таймфрейм, setupOpenTime),
    // но payload без третьей цели: UNIQUE обязан защитить сохранённую лестницу.
    const again = await signalRepo.insertSignal({
      ...V28_SETUP,
      targets: undefined,
      tp1: 116900.5,
      tp2: 118400.25,
    });
    expect(again.inserted).toBe(false);
    expect((await q('SELECT count(*)::int AS n FROM signals'))[0].n).toBe(1);
    expect((await q('SELECT targets FROM signals'))[0].targets.map(Number)).toEqual([
      116900.5, 118400.25, 121050.0,
    ]);
  });
});

describe('Сигналы — жизненный цикл из того, что ядро уже определило (F-08)', () => {
  const identity = {
    strategyId: V28_SETUP.strategyId,
    symbol: V28_SETUP.symbol,
    timeframe: V28_SETUP.timeframe,
    signalCandleTs: V28_SETUP.signalCandleTs,
  };

  /** V2.8: вход по OPEN следующего бара, стоп и цели сдвинуты на дельту. */
  const FILL = {
    price: 115260.25,
    at: '2026-09-19T05:00:00Z',
    barOpenTime: Date.parse('2026-09-19T05:00:00Z'),
    stop: 114370.5,
    targets: [116959.75, 118459.5, 121109.25],
  };

  /**
   * Исход в той форме, в которой его переносит движок: `closedAt` = время
   * ЗАКРЫТИЯ бара исхода (barOpenTime ядра + длительность бара исполнения).
   */
  const OUTCOME = {
    status: 'TARGET_REACHED',
    exitReason: 'TP3',
    exitPrice: 121109.25,
    resultR: 3.02,
    netResultR: 2.98,
    pnlResultPct: 5.07,
    barsHeld: 9,
    closedAt: new Date(Date.parse('2026-09-19T14:00:00Z') + 3_600_000),
  };

  it('исполнение: ACTIVE → FILLED, факт входа и сдвинутые уровни сохранены', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);

    const res = await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: null });
    expect(res).toMatchObject({ found: true, changed: true });

    const api = (await client.get('/api/signals')).body as any;
    expect(api.signals[0]).toMatchObject({
      status: 'FILLED',
      fillPrice: 115260.25,
      fillStop: 114370.5,
    });
    expect(api.signals[0].fillTargets).toEqual([116959.75, 118459.5, 121109.25]);
    expect(new Date(api.signals[0].filledAt).toISOString()).toBe('2026-09-19T05:00:00.000Z');
    // Уровни публикации не перезаписываются исполнением: обе формы видны.
    expect(api.signals[0].targets).toEqual([116900.5, 118400.25, 121050.0]);
    expect(api.signals[0].stopLoss).toBe(114310.75);
    // Исхода ещё нет: «неизвестно» не превращается в «закрыто».
    expect(api.signals[0].closedAt).toBeNull();
    expect(api.signals[0].resultR).toBeNull();
    expect(await signalRepo.countActiveSignals(V28_SETUP.strategyId)).toBe(1);
  });

  it('исход: FILLED → TARGET_REACHED с R ядра; хэш публикации не меняется', async (ctx) => {
    if (guard(ctx)) return;
    const issued = await signalRepo.insertSignal(V28_SETUP);
    const hashBefore = issued.signal!.hash;
    await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: null });

    const res = await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: OUTCOME });
    expect(res).toMatchObject({ found: true, changed: true });

    const api = (await client.get('/api/signals')).body as any;
    expect(api.signals[0]).toMatchObject({
      status: 'TARGET_REACHED',
      closeReason: 'TP3',
      closePrice: 121109.25,
      resultR: 3.02,
      netResultR: 2.98,
      pnlResultPct: 5.07,
      barsHeld: 9,
    });
    expect(new Date(api.signals[0].closedAt).toISOString()).toBe('2026-09-19T15:00:00.000Z');
    // Цепочка публикации неизменяема: hash/previous_hash те же, исход — в outcome_hash.
    expect(api.signals[0].hash).toBe(hashBefore);
    expect(api.signals[0].previousHash).toBe('GENESIS');
    expect(api.signals[0].outcomeHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(await signalRepo.countActiveSignals(V28_SETUP.strategyId)).toBe(0);
  });

  it('закрытая строка монотонна: повторная синхронизация не переписывает исход', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);
    await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: OUTCOME });

    const again = await signalRepo.syncSignalLifecycle({
      ...identity,
      fill: FILL,
      outcome: { ...OUTCOME, status: 'INVALIDATED', exitReason: 'SL', resultR: -1, netResultR: -1 },
    });
    expect(again).toMatchObject({ found: true, changed: false, reason: 'ALREADY_CLOSED' });

    const api = (await client.get('/api/signals')).body as any;
    expect(api.signals[0].status).toBe('TARGET_REACHED');
    expect(api.signals[0].resultR).toBe(3.02);
  });

  it('состояния без сделки (EXPIRED / CANCELLED / UNRESOLVED) сохраняются и не дают R', async (ctx) => {
    if (guard(ctx)) return;
    for (const [i, status] of ['EXPIRED', 'CANCELLED', 'UNRESOLVED'].entries()) {
      const res = await signalRepo.insertSignal({
        ...V28_SETUP,
        symbol: `T${i}/USDT`,
        engineSetupId: `V2_8-T${i}USDT-${i}`,
        signalCandleTs: new Date(Date.parse('2026-09-19T07:00:00Z') + i * 3_600_000),
      });
      expect(res.inserted).toBe(true);
      const sync = await signalRepo.syncSignalLifecycle({
        ...identity,
        symbol: `T${i}/USDT`,
        signalCandleTs: new Date(Date.parse('2026-09-19T07:00:00Z') + i * 3_600_000),
        fill: null,
        outcome: {
          status,
          exitReason: status,
          exitPrice: null,
          resultR: null,
          netResultR: null,
          barsHeld: null,
          closedAt: new Date(Date.parse('2026-09-19T07:00:00Z') + i * 3_600_000 + 3_600_000),
        },
      });
      expect(sync.changed, `${status} обязан сохраняться`).toBe(true);
    }

    const rows = await q('SELECT symbol, status, result_r, closed_at FROM signals ORDER BY symbol');
    expect(rows.map((r: any) => [r.symbol, r.status])).toEqual([
      ['T0/USDT', 'EXPIRED'],
      ['T1/USDT', 'CANCELLED'],
      ['T2/USDT', 'UNRESOLVED'],
    ]);
    expect(rows.every((r: any) => r.result_r === null)).toBe(true);
    expect(rows.every((r: any) => r.closed_at !== null)).toBe(true);
    expect(await signalRepo.countActiveSignals(V28_SETUP.strategyId)).toBe(0);
  });

  it('неизвестное время исхода не подменяется текущим моментом', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);
    const res = await signalRepo.syncSignalLifecycle({
      ...identity,
      fill: FILL,
      // Ни closedAt, ни barOpenTime: ядро время исхода не отдало.
      outcome: { status: 'INVALIDATED', exitReason: 'SL', exitPrice: 114370.5, resultR: -1, netResultR: -1 },
    });
    expect(res.changed).toBe(true);

    const row = (await q('SELECT status, closed_at, result_r FROM signals'))[0];
    expect(row.status).toBe('INVALIDATED');
    expect(row.closed_at, 'выдуманное время исхода недопустимо').toBeNull();
    expect(Number(row.result_r)).toBe(-1);
    // Целостность цепочки при этом сохраняется: outcome_hash считает null как null.
    expect(await signalRepo.verifyChain()).toEqual({ rows: 1, breaks: 0 });
  });

  it('синхронизация несуществующего сигнала не создаёт строку', async (ctx) => {
    if (guard(ctx)) return;
    const res = await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: OUTCOME });
    expect(res).toMatchObject({ found: false, changed: false, reason: 'NO_SUCH_SIGNAL' });
    expect((await q('SELECT count(*)::int AS n FROM signals'))[0].n).toBe(0);
  });

  it('цепочка SHA-256 остаётся целой после всех переходов (форма v2)', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);
    await signalRepo.insertSignal({
      ...V28_SETUP,
      symbol: 'ETH/USDT',
      engineSetupId: 'V2_8-ETHUSDT-1',
      signalCandleTs: new Date('2026-09-19T05:00:00Z'),
    });
    await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: OUTCOME });

    const chain = await signalRepo.verifyChain();
    expect(chain).toEqual({ rows: 2, breaks: 0 });
  });

  it('listOpenSignals возвращает только незакрытые строки и ограничен сверху', async (ctx) => {
    if (guard(ctx)) return;
    await signalRepo.insertSignal(V28_SETUP);
    await signalRepo.insertSignal({
      ...V28_SETUP,
      symbol: 'ETH/USDT',
      engineSetupId: 'V2_8-ETHUSDT-2',
      signalCandleTs: new Date('2026-09-19T05:00:00Z'),
    });
    await signalRepo.syncSignalLifecycle({ ...identity, fill: FILL, outcome: OUTCOME });

    const open = await signalRepo.listOpenSignals(V28_SETUP.strategyId, 500);
    expect(open).toHaveLength(1);
    expect(open[0].symbol).toBe('ETH/USDT');
    expect(open[0].status).toBe('ACTIVE');
    // Ключ сопоставления с ретроспективой ядра — те же поля, что UNIQUE из 007.
    expect(new Date(open[0].signalCandleTs).toISOString()).toBe('2026-09-19T05:00:00.000Z');
  });
});

/* ═════════════════ GET /api/signals — контракт ленты ═════════════════ */

describe('GET /api/signals — контракт для будущего Signals UI', () => {
  const at = (iso: string) => new Date(iso);

  /** Пять сигналов с явным created_at: порядок проверяется без гонок времени. */
  const seedFeed = async () => {
    const rows = [
      { symbol: 'BTC/USDT', strategyId: 'V3_0_HTF_LIQUIDATION_TRAP', direction: 'LONG', ts: '2026-09-19T01:00:00Z', status: 'ACTIVE' },
      { symbol: 'ETH/USDT', strategyId: 'V3_3_HTF_ZONE_MITIGATION', direction: 'SHORT', ts: '2026-09-19T02:00:00Z', status: 'FILLED' },
      { symbol: 'BTC/USDT', strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING', direction: 'SHORT', ts: '2026-09-19T03:00:00Z', status: 'TARGET_REACHED' },
      { symbol: 'SOL/USDT', strategyId: 'V3_0_HTF_LIQUIDATION_TRAP', direction: 'LONG', ts: '2026-09-19T04:00:00Z', status: 'EXPIRED' },
      { symbol: 'BTC/USDT', strategyId: 'V3_0_HTF_LIQUIDATION_TRAP', direction: 'SHORT', ts: '2026-09-19T05:00:00Z', status: 'ACTIVE' },
    ];
    for (const [i, r] of rows.entries()) {
      const res = await signalRepo.insertSignal({
        strategyId: r.strategyId,
        symbol: r.symbol,
        timeframe: '1h',
        direction: r.direction,
        signalCandleTs: at(r.ts),
        createdAt: at(r.ts),
        entryMin: 100 + i,
        entryMax: 101 + i,
        stopLoss: 95 + i,
        targets: [110 + i, 120 + i, 130 + i],
        status: r.status,
      });
      expect(res.inserted, `seed ${r.symbol} ${r.ts}`).toBe(true);
    }
    return rows;
  };

  it('порядок детерминирован: новые сверху (created_at DESC, id DESC)', async (ctx) => {
    if (guard(ctx)) return;
    const rows = await seedFeed();
    const res = await client.get('/api/signals');
    const body = res.body as any;

    expect(body.ordering).toBe('created_at_desc');
    expect(body.signals.map((s: any) => s.createdAt)).toEqual(
      [...rows].reverse().map((r) => new Date(r.ts).toISOString())
    );
    expect(body.signals.map((s: any) => s.symbol)).toEqual([
      'BTC/USDT', 'SOL/USDT', 'BTC/USDT', 'ETH/USDT', 'BTC/USDT',
    ]);
  });

  it('пагинация ограничена: count = страница, total = всё под фильтром', async (ctx) => {
    if (guard(ctx)) return;
    await seedFeed();

    const page = await client.get('/api/signals?limit=2&offset=1');
    const body = page.body as any;
    expect(body.count).toBe(2);
    expect(body.signals).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.maxLimit).toBe(200);
    // offset=1 пропускает самый новый сигнал.
    expect(body.signals[0].symbol).toBe('SOL/USDT');

    const def = await client.get('/api/signals');
    expect((def.body as any).limit).toBe(50);
    expect((def.body as any).offset).toBe(0);
  });

  it('limit/offset вне допустимых границ отклоняются, а не обрезаются молча', async (ctx) => {
    if (guard(ctx)) return;
    for (const [qs, code] of [
      ['limit=0', 'INVALID_LIMIT'],
      ['limit=201', 'INVALID_LIMIT'],
      ['limit=abc', 'INVALID_LIMIT'],
      ['offset=-1', 'INVALID_OFFSET'],
      ['offset=5001', 'INVALID_OFFSET'],
    ] as Array<[string, string]>) {
      const res = await client.get(`/api/signals?${qs}`);
      expect(res.status, qs).toBe(400);
      expect((res.body as any).error, qs).toBe(code);
    }
    expect(((await client.get('/api/signals?limit=200')).body as any).signals).toHaveLength(0);
  });

  it('символ принимается в формах BTC/USDT, BTCUSDT и BTC и нормализуется к паре', async (ctx) => {
    if (guard(ctx)) return;
    await seedFeed();

    for (const raw of ['BTC/USDT', 'btc/usdt', 'BTCUSDT', 'btcusdt', 'BTC']) {
      const res = await client.get(`/api/signals?symbol=${encodeURIComponent(raw)}`);
      expect(res.status, raw).toBe(200);
      const body = res.body as any;
      expect(body.count, raw).toBe(3);
      expect(body.appliedFilters.symbol, raw).toBe('BTC/USDT');
      expect(body.signals.every((s: any) => s.symbol === 'BTC/USDT')).toBe(true);
    }

    const bad = await client.get('/api/signals?symbol=BTC%20USD');
    expect(bad.status).toBe(400);
    expect((bad.body as any).error).toBe('INVALID_SYMBOL');
  });

  it('неизвестная стратегия — 400, а не пустой список «сигналов нет»', async (ctx) => {
    if (guard(ctx)) return;
    await seedFeed();
    const res = await client.get('/api/signals?strategy=V9_9_MADE_UP');
    expect(res.status).toBe(400);
    expect((res.body as any).error).toBe('INVALID_STRATEGY');

    const ok = await client.get('/api/signals?strategy=V3_3_HTF_ZONE_MITIGATION');
    expect(ok.status).toBe(200);
    expect((ok.body as any).count).toBe(1);
  });

  it('open=true отдаёт ACTIVE+FILLED, open=false — терминальные состояния', async (ctx) => {
    if (guard(ctx)) return;
    await seedFeed();

    const open = await client.get('/api/signals?open=true');
    expect((open.body as any).signals.map((s: any) => s.status).sort()).toEqual(['ACTIVE', 'ACTIVE', 'FILLED']);
    expect((open.body as any).appliedFilters.open).toBe(true);
    expect((open.body as any).count).toBe(3);

    const closed = await client.get('/api/signals?open=false');
    expect((closed.body as any).signals.map((s: any) => s.status).sort()).toEqual(['EXPIRED', 'TARGET_REACHED']);
    expect((closed.body as any).appliedFilters.open).toBe(false);

    const bad = await client.get('/api/signals?open=maybe');
    expect(bad.status).toBe(400);
    expect((bad.body as any).error).toBe('INVALID_OPEN');
  });

  it('status и direction фильтруют и валидируются', async (ctx) => {
    if (guard(ctx)) return;
    await seedFeed();

    expect(((await client.get('/api/signals?status=ACTIVE')).body as any).count).toBe(2);
    expect(((await client.get('/api/signals?status=FILLED')).body as any).count).toBe(1);
    expect(((await client.get('/api/signals?direction=short')).body as any).count).toBe(3);
    expect(((await client.get('/api/signals?symbol=BTCUSDT&direction=LONG&status=ACTIVE')).body as any).count).toBe(1);

    const badStatus = await client.get('/api/signals?status=WON');
    expect(badStatus.status).toBe(400);
    expect((badStatus.body as any).error).toBe('INVALID_STATUS');

    const badDirection = await client.get('/api/signals?direction=SIDEWAYS');
    expect(badDirection.status).toBe(400);
    expect((badDirection.body as any).error).toBe('INVALID_DIRECTION');
  });

  it('конверт ответа несёт домен состояний из репозитория, а не из UI', async (ctx) => {
    if (guard(ctx)) return;
    const body = (await client.get('/api/signals')).body as any;
    expect(body.source).toBe('server');
    expect(body.statuses).toEqual([
      'ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED',
    ]);
    expect(body.openStatuses).toEqual(['ACTIVE', 'FILLED']);
    expect(body.appliedFilters).toEqual({
      strategyId: null, status: null, open: null, symbol: null, direction: null,
    });
    expect(body.total).toBe(0);
    expect(body.count).toBe(0);
  });

  it('каждая строка ленты несёт полный набор полей сигнала (контракт DTO)', async (ctx) => {
    if (guard(ctx)) return;
    await seedFeed();
    const s = ((await client.get('/api/signals?limit=1')).body as any).signals[0];
    for (const field of [
      'id', 'strategyId', 'symbol', 'timeframe', 'direction', 'signalCandleTs',
      'entryMin', 'entryMax', 'stopLoss', 'tp1', 'tp2', 'targets', 'status',
      'createdAt', 'hash', 'previousHash', 'chainVersion',
      'fillPrice', 'fillStop', 'fillTargets', 'closedAt', 'closePrice', 'closeReason',
      'resultR', 'netResultR', 'barsHeld', 'metadata',
    ]) {
      expect(field in s, `в DTO нет поля ${field}`).toBe(true);
    }
    expect(s.targets).toHaveLength(3);
  });
});
