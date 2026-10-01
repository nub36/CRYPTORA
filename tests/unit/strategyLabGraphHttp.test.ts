// @vitest-environment node
/**
 * CRYPTORA — Strategy Lab · HTTP-контракт блок-схемы (RESEARCH ONLY, ADMIN ONLY)
 * ---------------------------------------------------------------------------
 * Проверяет МАРШРУТ `POST /api/strategy-lab/replay` на реальном Express-
 * приложении: сервер сам отклоняет некорректный граф (§10, §17) и сам
 * принимает корректный — независимо от фронтенда.
 *
 * Окружение node (а не jsdom): исследовательское ядро Lab собирается esbuild'ом,
 * которому нужен настоящий Node-рантайм. Сеть не используется: валидный граф
 * проверяется на запросе с заведомо слишком широким диапазоном, поэтому запрос
 * честно доходит до лимита источника и НЕ идёт в Binance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import argon2 from 'argon2';
import { createEmaTrendTemplate, cloneStrategyGraph } from '@/services/strategyLab/graph/templates';
import type { HttpClient } from '../helpers/httpHarness';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');

const PASSWORD = 'correct horse battery staple';
const ADMIN_EMAIL = 'admin@cryptora.test';

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;

/** Диапазон заведомо больше любого лимита — тяжёлая загрузка не начнётся. */
const TO_MS = 1_700_000_000_000;
const FROM_MS = TO_MS - 200_000 * 60 * 60_000;

/** Тело ответа API в тестовом виде (харнесс отдаёт `unknown`). */
function errorBody(value: unknown): { error?: string; code?: string } {
  return (value ?? {}) as { error?: string; code?: string };
}

function body(graph: unknown) {
  return {
    strategyGraph: graph,
    market: 'spot',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    from: FROM_MS,
    to: TO_MS,
  };
}

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  db.users.push({
    id: '11111111-1111-1111-1111-111111111111',
    email: ADMIN_EMAIL,
    display_name: 'admin',
    password_hash: hash,
    role: 'admin',
    is_active: true,
    email_verified: true,
    email_verified_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    last_login_at: null,
  });
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  client = harness.client;
  close = harness.close;
  const login = await client.post('/api/auth/login', { email: ADMIN_EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
});

afterEach(async () => {
  await close();
  __setPoolForTests(null);
});

describe('Strategy Lab · POST /replay со strategyGraph', () => {
  it('O. семантически некорректный граф → 400 INVALID_STRATEGY_GRAPH', async () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.edges = graph.edges.filter((e) => e.id !== 'e-up-long');
    const res = await client.post('/api/strategy-lab/replay', body(graph));
    expect(res.status).toBe(400);
    expect(errorBody(res.body).code).toBe('INVALID_STRATEGY_GRAPH');
    expect(String(errorBody(res.body).error)).toContain('LONG: не подключено условие');
  });

  it('O2. граф со сломанной СХЕМОЙ отклоняется zod-валидатором запроса', async () => {
    const res = await client.post(
      '/api/strategy-lab/replay',
      body({ schemaVersion: 1, name: 'X', authoringMode: 'blocks', nodes: 'нет', edges: [] })
    );
    expect(res.status).toBe(400);
    expect(errorBody(res.body).code).not.toBe('INVALID_STRATEGY_GRAPH');
  });

  it('O3. граф сверх лимита блоков отклоняется', async () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    for (let i = 0; i < 70; i += 1) {
      graph.nodes.push({ id: `n-${i}`, type: 'NUMBER', position: { x: i, y: 0 }, params: { value: 1 } });
    }
    const res = await client.post('/api/strategy-lab/replay', body(graph));
    expect(res.status).toBe(400);
  });

  it('P. валидный граф проходит проверку графа и доходит до лимита источника данных', async () => {
    const res = await client.post('/api/strategy-lab/replay', body(createEmaTrendTemplate()));
    expect(res.status).toBe(400);
    // Граф принят: отказ пришёл от лимита диапазона, а не от валидации схемы.
    expect(errorBody(res.body).code).toBe('REST_RANGE_TOO_LARGE');
  });
});
