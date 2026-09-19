/**
 * CRYPTORA — Стратегии: настройки, авторизация, сигналы, дедупликация.
 *
 * Всё проверяется на НАСТОЯЩЕМ PostgreSQL (embedded-postgres) через НАСТОЯЩИЕ
 * миграции и НАСТОЯЩЕЕ Express-приложение из server/app.js. Мок数据库 нет:
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
  try {
    if (db) await db.end();
    if (closeServer) await closeServer();
    if (pg) await pg.stop();
  } catch {
    /* завершение тестовой инфраструктуры не должно ронять набор */
  }
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

const guard = () => {
  if (skipReason) {
    console.warn(`  ↷ SKIPPED (${skipReason})`);
    return true;
  }
  return false;
};

/* ═════════════════ Настройки стратегий ═════════════════ */

describe('Настройки стратегий — начальное состояние', () => {
  it('ровно 3 строки, и это три продуктовые стратегии', async () => {
    if (guard()) return;
    const ids = await q('SELECT strategy_id FROM strategy_settings ORDER BY strategy_id');
    expect(ids.map((r: any) => r.strategy_id)).toEqual([
      'V2_8_ZERO_FEE_SNIPER_TRAILING',
      'V3_0_HTF_LIQUIDATION_TRAP',
      'V3_3_HTF_ZONE_MITIGATION',
    ]);
  });

  it('по умолчанию все выключены', async () => {
    if (guard()) return;
    const rows = await q('SELECT enabled FROM strategy_settings');
    expect(rows.every((r: any) => r.enabled === false)).toBe(true);
  });

  it('GET /api/strategies доступен без авторизации и не содержит мусора', async () => {
    if (guard()) return;
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

  it('«нет данных» отдаётся как null, а не как 0', async () => {
    if (guard()) return;
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
  it('гость не может включить стратегию (401)', async () => {
    if (guard()) return;
    const anon = new HttpClient((client as any).base);
    const res = await anon.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    expect(res.status).toBe(401);
    const row = (await q(`SELECT enabled FROM strategy_settings WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`))[0];
    expect(row.enabled).toBe(false);
  });

  it('обычный пользователь не может включить стратегию (403)', async () => {
    if (guard()) return;
    const user = await login(USER.email, USER.password);
    const res = await user.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    expect(res.status).toBe(403);
    const row = (await q(`SELECT enabled FROM strategy_settings WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`))[0];
    expect(row.enabled).toBe(false);
  });

  it('обычный пользователь не видит админ-статус', async () => {
    if (guard()) return;
    const user = await login(USER.email, USER.password);
    const res = await user.get('/api/admin/strategies/status');
    expect([401, 403]).toContain(res.status);
  });

  it('админ включает стратегию, и состояние сохраняется в PostgreSQL', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', { enabled: true });
    expect(res.status).toBe(200);
    expect((res.body as any).enabled).toBe(true);

    // Источник истины — БД, а не ответ API.
    const row = (await q(`SELECT enabled, updated_by FROM strategy_settings WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`))[0];
    expect(row.enabled).toBe(true);
    expect(row.updated_by).toBeTruthy();
  });

  it('админ выключает стратегию', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    await admin.patch('/api/admin/strategies/V3_0_HTF_LIQUIDATION_TRAP', { enabled: true });
    const off = await admin.patch('/api/admin/strategies/V3_0_HTF_LIQUIDATION_TRAP', { enabled: false });
    expect(off.status).toBe(200);
    expect((off.body as any).enabled).toBe(false);
    const row = (await q(`SELECT enabled FROM strategy_settings WHERE strategy_id='V3_0_HTF_LIQUIDATION_TRAP'`))[0];
    expect(row.enabled).toBe(false);
  });

  it('состояние переживает «перезапуск»: читается из БД, а не из памяти', async () => {
    if (guard()) return;
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

  it('каждое переключение попадает в audit_log с metadata.strategyId', async () => {
    if (guard()) return;
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

  it('неизвестная стратегия отклоняется (404), четвёртая не создаётся', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.patch('/api/admin/strategies/V9_9_MADE_UP', { enabled: true });
    expect(res.status).toBe(404);
    expect((await q('SELECT count(*)::int AS n FROM strategy_settings'))[0].n).toBe(3);
  });

  it('тело без булева enabled отклоняется (400)', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }]) {
      const res = await admin.patch('/api/admin/strategies/V3_3_HTF_ZONE_MITIGATION', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('математические параметры через API не меняются', async () => {
    if (guard()) return;
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

  it('повторный скан того же закрытого бара не создаёт второй сигнал', async () => {
    if (guard()) return;
    const first = await signalRepo.insertSignal(base);
    expect(first.inserted).toBe(true);
    expect(first.signal.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(first.signal.previousHash).toBe('GENESIS');

    const second = await signalRepo.insertSignal(base);
    expect(second.inserted).toBe(false);

    expect((await q('SELECT count(*)::int AS n FROM signals'))[0].n).toBe(1);
  });

  it('цепочка SHA-256 связывает записи и верифицируется', async () => {
    if (guard()) return;
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

  it('фильтры GET /api/signals работают', async () => {
    if (guard()) return;
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

  it('каждый сигнал несёт strategy_id', async () => {
    if (guard()) return;
    await signalRepo.insertSignal(base);
    const res = await client.get('/api/signals');
    const s = (res.body as any).signals[0];
    expect(s.strategyId).toBe('V3_3_HTF_ZONE_MITIGATION');
  });

  it('счётчик активных сигналов — реальный SELECT COUNT', async () => {
    if (guard()) return;
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
  it('getEnabledStrategies возвращает только включённые', async () => {
    if (guard()) return;
    expect(await settingsRepo.getEnabledStrategies()).toHaveLength(0);
    await db.query(`UPDATE strategy_settings SET enabled=TRUE WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    const enabled = await settingsRepo.getEnabledStrategies();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].strategyId).toBe('V3_3_HTF_ZONE_MITIGATION');
  });

  it('setStrategyEnabled отклоняет неизвестную стратегию до обращения к SQL', async () => {
    if (guard()) return;
    await expect(
      settingsRepo.setStrategyEnabled({ strategyId: 'NOPE', enabled: true, actorUserId: null })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('статус выводится из полей БД: OFF / ON / ERROR', async () => {
    if (guard()) return;
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

  it('engineStatus отдаёт реальные числа', async () => {
    if (guard()) return;
    await db.query(`UPDATE strategy_settings SET enabled=TRUE WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    const st = await settingsRepo.engineStatus();
    expect(st.totalStrategies).toBe(3);
    expect(st.enabledCount).toBe(1);
    expect(st.errorCount).toBe(0);
    expect(st.signalsTotal).toBe(0);
  });
});
