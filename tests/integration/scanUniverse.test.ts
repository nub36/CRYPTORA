/**
 * Scan universe: server-side persistence (real PostgreSQL + real migrations +
 * real Express app). Only Binance exchangeInfo is replaced by a fixture.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { listen, HttpClient } from '../helpers/httpHarness';

const ROOT = path.resolve(__dirname, '../..');
let pg: any = null;
let db: any = null;
let skipReason: string | null = null;
let client: HttpClient;
let closeServer: () => Promise<void>;
let eu: any = null;
let sched: any = null;
const ADMIN = { email: 'scan-admin@test.local', password: 'Str0ngPass!234' };
const USER = { email: 'scan-user@test.local', password: 'Str0ngPass!234' };

const ACTIVE = ['BTC', 'ETH', 'SOL', 'LTC', 'PEPE', 'FET', 'ARB', 'NEAR', 'BNB', 'XRP', 'DOGE'];
function installActive(bases: string[] | null) {
  const exchangeInfo = { symbols: (bases ?? []).map((b) => ({ symbol: `${b}USDT`, baseAsset: b, quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true })) };
  const spot = new eu.UniverseCache({
    url: 'fixture://spot',
    transform: (b: any) => { const l = eu.filterActiveSpotUsdt(b); if (!l.length) throw new Error('none'); return l; },
    fetchFn: async () => (bases ? { ok: true, json: async () => exchangeInfo } : { ok: false, status: 503, json: async () => ({}) }),
  });
  eu.__resetUniverseCachesForTests({ spot });
}

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

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-scan-'));
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

  eu = await import('../../server/services/exchangeUniverse.js');
  // @ts-expect-error — JS module without declarations (same as tests/unit/strategyScheduler.test.ts)
  sched = await import('../../server/services/strategyEngine/strategyScheduler.js');
  installActive(ACTIVE);

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
  installActive(ACTIVE);
  // audit_log в проде append-only, но здесь это тестовая БД: без очистки
  // записи предыдущих тестов смешивались с текущими.
  await db.query(`DELETE FROM audit_log WHERE target_type = 'scan_universe'`);
});

const guard = () => {
  if (skipReason) {
    console.warn(`  ↷ SKIPPED (${skipReason})`);
    return true;
  }
  return false;
};


const saved = async () => (await q('SELECT symbol FROM scan_universe ORDER BY symbol')).map((r: any) => r.symbol);

describe('scan_universe — server-side persistence', () => {
  it('migration 008 seeds the canonical defaults', async () => {
    if (guard()) return;
    const rows = await saved();
    expect(rows).toContain('BTC');
    expect(rows).not.toContain('PEPE');
  });

  it('non-admin cannot read or change the admin scan universe', async () => {
    if (guard()) return;
    const user = await login(USER.email, USER.password);
    expect((await user.get('/api/admin/scan-universe')).status).toBe(403);
    expect((await user.post('/api/admin/scan-universe', { symbol: 'PEPE' })).status).toBe(403);
    expect(await saved()).not.toContain('PEPE');
  });

  it('admin adds an active dynamic coin → stored in PostgreSQL, audited, visible to everyone', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.post('/api/admin/scan-universe', { symbol: 'pepe' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as any).saved).toContain('PEPE');
    expect((res.body as any).activeCount).toBe(ACTIVE.length);
    expect(await saved()).toContain('PEPE');
    const audit = await q(`SELECT action, target_id FROM audit_log WHERE target_type = 'scan_universe'`);
    expect(audit.some((a: any) => a.target_id === 'PEPE')).toBe(true);
    // another session / anonymous: the same server state (not localStorage)
    const anon = new HttpClient((client as any).base);
    const pub = await anon.get('/api/strategies/scan-universe');
    expect((pub.body as any).symbols).toContain('PEPE');
  });

  it('inactive / unknown symbols are rejected', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    const res = await admin.post('/api/admin/scan-universe', { symbol: 'VEN' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await saved()).not.toContain('VEN');
  });

  it('admin removes a coin', async () => {
    if (guard()) return;
    const admin = await login(ADMIN.email, ADMIN.password);
    await admin.post('/api/admin/scan-universe', { symbol: 'LTC' });
    const res = await admin.request('DELETE', '/api/admin/scan-universe/LTC');
    expect(res.status).toBe(200);
    expect(await saved()).not.toContain('LTC');
  });

  it('scheduler scans only saved ∩ active; delisted stored symbols are never scanned', async () => {
    if (guard()) return;
    await db.query(`INSERT INTO scan_universe (symbol) VALUES ('PEPE'), ('DEADCOIN') ON CONFLICT DO NOTHING`);
    const syms = await sched.resolveScanSymbols({ symbols: null });
    expect(syms).toContain('PEPEUSDT');
    expect(syms).not.toContain('DEADCOINUSDT');
    expect(syms.every((s: string) => ACTIVE.includes(s.slice(0, -4)))).toBe(true);
    // explicit per-strategy symbols are also intersected with the active set
    expect(await sched.resolveScanSymbols({ symbols: ['BTCUSDT', 'VENUSDT'] })).toEqual(['BTCUSDT']);
  });

  it('exchangeInfo unavailable → scan skipped (no unverified list is scanned)', async () => {
    if (guard()) return;
    installActive(null);
    await expect(sched.resolveScanSymbols({ symbols: null })).rejects.toThrow(/unavailable/);
  });
});
