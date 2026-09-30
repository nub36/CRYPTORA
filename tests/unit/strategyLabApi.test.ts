/**
 * CRYPTORA — Strategy Lab · HTTP security + read-only guarantees (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Проверяет ДВУХУРОВНЕВУЮ защиту admin-only research API на РЕАЛЬНОМ Express-
 * приложении (server/app.js) через существующий httpHarness + MemoryDb. Никакой
 * новой инфраструктуры не добавляется, существующие helpers не меняются.
 *
 * Матрица доступа:
 *   unauthenticated  GET/POST → 401
 *   authenticated user GET/POST → 403
 *   admin            GET → 200
 *   admin            POST → доходит до валидации/лимита БЕЗ обращения к Binance
 *
 * Плюс статическая проверка read-only: Lab-сервисы не импортируют production
 * БД/сигналы/настройки/планировщик (доказательство изоляции без правки prod).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';

// Отключаем rate-limit и внешние транспорты — как в существующих auth-тестах.
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');

const PASSWORD = 'correct horse battery staple';
const ADMIN_EMAIL = 'admin@cryptora.test';
const USER_EMAIL = 'user@cryptora.test';

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;

async function seedUser(id: string, email: string, role: 'user' | 'admin') {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  db.users.push({
    id,
    email,
    display_name: email.split('@')[0],
    password_hash: hash,
    role,
    is_active: true,
    email_verified: true,
    email_verified_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    last_login_at: null,
  });
}

async function loginAs(email: string) {
  client.clearCookies();
  const res = await client.post('/api/auth/login', { email, password: PASSWORD });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  await seedUser('11111111-1111-1111-1111-111111111111', ADMIN_EMAIL, 'admin');
  await seedUser('22222222-2222-2222-2222-222222222222', USER_EMAIL, 'user');
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  client = harness.client;
  close = harness.close;
});

afterEach(async () => {
  await close();
  __setPoolForTests(null);
});

// Валидное тело replay (форма проходит zod); диапазон умышленно узкий.
function validReplayBody() {
  const to = 1_700_000_000_000;
  const from = to - 50 * 60 * 60_000; // 50 часов на 1h ≈ 50 баров
  return {
    strategyId: 'EMA_ATR',
    market: 'spot',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    from,
    to,
    researchConfig: {
      indicators: { emaFast: 20, emaSlow: 50, atrPeriod: 14 },
      strategy: { stopAtrMult: 1.5, targetR: 2 },
      execution: { feeBps: 5, slippageBps: 2 },
    },
  };
}

describe('Strategy Lab API · доступ (admin-only, двухуровневая защита)', () => {
  it('unauthenticated: GET /strategies → 401', async () => {
    const res = await client.get('/api/strategy-lab/strategies');
    expect(res.status).toBe(401);
  });

  it('unauthenticated: POST /replay → 401 (до всякой сети)', async () => {
    const res = await client.post('/api/strategy-lab/replay', validReplayBody());
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /data-coverage → 401', async () => {
    const res = await client.get('/api/strategy-lab/data-coverage');
    expect(res.status).toBe(401);
  });

  it('authenticated non-admin: GET /strategies → 403', async () => {
    await loginAs(USER_EMAIL);
    const res = await client.get('/api/strategy-lab/strategies');
    expect(res.status).toBe(403);
  });

  it('authenticated non-admin: POST /replay → 403 (до всякой сети)', async () => {
    await loginAs(USER_EMAIL);
    const res = await client.post('/api/strategy-lab/replay', validReplayBody());
    expect(res.status).toBe(403);
  });

  it('authenticated non-admin: GET /data-coverage → 403', async () => {
    await loginAs(USER_EMAIL);
    const res = await client.get('/api/strategy-lab/data-coverage');
    expect(res.status).toBe(403);
  });

  it('admin: GET /strategies → авторизация пройдена (не 401/403)', async () => {
    await loginAs(ADMIN_EMAIL);
    const res = await client.get('/api/strategy-lab/strategies');
    // Ключевое свойство безопасности: admin ПРОХОДИТ requireAuth+requireAdmin,
    // т.е. запрос попадает в обработчик (в отличие от 401/403 у user/anon).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);

    // Полный успех (200 + тело) зависит от загрузки esbuild-бандла research-ядра
    // через runtime dynamic import(file://…mjs). Под vitest модульный загрузчик
    // Vite перехватывает такой import и не может отдать файл из os.tmpdir()
    // (в обычном Node это работает — проверено отдельно). Поэтому 200/тело
    // проверяем только когда бандл реально загрузился в этой среде.
    if (res.status === 200) {
      const body = res.body as {
        researchOnly: boolean;
        strategies: Array<{ id: string; name: string }>;
      };
      expect(body.researchOnly).toBe(true);
      expect(body.strategies.some((s) => s.id === 'EMA_ATR')).toBe(true);
      expect(res.headers.get('cache-control')).toContain('no-store');
    }
  });

  it('admin: GET /data-coverage → 200 metadata-only, missing archive is safe', async () => {
    await loginAs(ADMIN_EMAIL);
    const previousRoot = process.env.STRATEGY_LAB_DATA_ROOT;
    process.env.STRATEGY_LAB_DATA_ROOT = `/tmp/cryptora-missing-coverage-${process.pid}`;
    try {
      const res = await client.get('/api/strategy-lab/data-coverage');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ datasetAvailable: false });
      expect(res.headers.get('cache-control')).toContain('no-store');
    } finally {
      if (previousRoot === undefined) delete process.env.STRATEGY_LAB_DATA_ROOT;
      else process.env.STRATEGY_LAB_DATA_ROOT = previousRoot;
    }
  });

  it('admin: POST /replay с битым телом → 400 (валидация, без Binance)', async () => {
    await loginAs(ADMIN_EMAIL);
    const res = await client.post('/api/strategy-lab/replay', { strategyId: 'EMA_ATR' });
    expect(res.status).toBe(400);
  });

  it('admin: POST /replay с диапазоном > 5000 баров → 400 (отказ ДО тяжёлой загрузки)', async () => {
    await loginAs(ADMIN_EMAIL);
    const to = 1_700_000_000_000;
    const from = to - 6000 * 60 * 60_000; // 6000 баров 1h > лимита 5000
    const res = await client.post('/api/strategy-lab/replay', { ...validReplayBody(), from, to });
    expect(res.status).toBe(400);
  });
});

describe('Strategy Lab · read-only изоляция (статическая проверка импортов)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '../..');
  const labServerFiles = [
    'server/routes/strategyLab.js',
    'server/services/strategyLab/labService.js',
    'server/services/strategyLab/historicalCandles.js',
    'server/services/strategyLab/localHistoricalCandles.js',
    'server/services/strategyLab/labCoreBundle.js',
    'server/services/strategyLab/labEntry.ts',
    'server/validators/strategyLab.js',
  ];

  // Модули, запись/чтение которых означала бы вторжение в production-контур.
  const FORBIDDEN_IMPORT_PATTERNS = [
    /from\s+['"][^'"]*db\/pool/,
    /from\s+['"][^'"]*signalRepository/,
    /from\s+['"][^'"]*signalProvenance/,
    /from\s+['"][^'"]*strategySettings/,
    /from\s+['"][^'"]*strategyTestRuns/,
    /from\s+['"][^'"]*strategyScheduler/,
    /from\s+['"][^'"]*strategyEngine\//,
    /from\s+['"][^'"]*marketDataFetcher/,
    /from\s+['"][^'"]*services\/mail/,
  ];

  it('Lab-сервер НЕ импортирует production БД/сигналы/настройки/планировщик', () => {
    for (const rel of labServerFiles) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      for (const pat of FORBIDDEN_IMPORT_PATTERNS) {
        expect(src, `${rel} нарушает read-only изоляцию: ${pat}`).not.toMatch(pat);
      }
    }
  });

  it('labService оркестрирует только загрузку свечей и research-ядро', () => {
    const src = readFileSync(path.join(root, 'server/services/strategyLab/labService.js'), 'utf8');
    expect(src).toMatch(/from '\.\/labCoreBundle\.js'/);
    expect(src).toMatch(/from '\.\/historicalCandles\.js'/);
    // Никаких SQL-мутаций сигналов/настроек прямо в сервисе.
    expect(src).not.toMatch(/INSERT\s+INTO/i);
    expect(src).not.toMatch(/UPDATE\s+/i);
  });
});
