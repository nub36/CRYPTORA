// @vitest-environment node
/** Focused HTTP/security coverage for Saved Strategy Lab V1. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import argon2 from 'argon2';
import { defaultResearchDraft } from '@/services/strategyLab/draft';
import { indicatorIdentifier } from '@/services/strategyLab/draft/identifiers';
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
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let db: InstanceType<typeof MemoryDb>;
let close: () => Promise<void>;

function draft(name = 'EMA Saved') {
  return defaultResearchDraft(name);
}

async function seed(id: string, email: string, role: 'admin' | 'user') {
  const now = new Date();
  db.users.push({ id, email, display_name: email, password_hash: await argon2.hash(PASSWORD), role, is_active: true, email_verified: true, email_verified_at: now, created_at: now, updated_at: now, last_login_at: null });
}

async function login(client: HttpClient, email: string) {
  const response = await client.post('/api/auth/login', { email, password: PASSWORD });
  expect(response.status).toBe(200);
}

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  await seed(A, 'a@test.local', 'admin');
  await seed(B, 'b@test.local', 'admin');
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  close = harness.close;
});

afterEach(async () => { await close(); __setPoolForTests(null); });

describe('Saved Strategy Lab HTTP security contract', () => {
  it('requires auth and admin role', async () => {
    const unauth = await listen(createApp({ sessionStore: 'memory' }));
    expect((await unauth.client.get('/api/strategy-lab/saved-strategies')).status).toBe(401);
    await unauth.close();

    const nonAdmin = await listen(createApp({ sessionStore: 'memory' }));
    await login(nonAdmin.client, 'a@test.local');
    // Temporarily model a non-admin account through a separate user.
    db.users.find((u) => u.id === A)!.role = 'user';
    expect((await nonAdmin.client.get('/api/strategy-lab/saved-strategies')).status).toBe(403);
    await nonAdmin.close();
    db.users.find((u) => u.id === A)!.role = 'admin';
  });

  it('binds create/list/update to authenticated owner and ignores owner injection', async () => {
    const a = await listen(createApp({ sessionStore: 'memory' }));
    await login(a.client, 'a@test.local');
    const created = await a.client.post('/api/strategy-lab/saved-strategies', { ...draft(), ownerId: B, owner_id: B });
    expect(created.status).toBe(201);
    const id = (created.body as { strategy: { id: string } }).strategy.id;
    expect(db.savedStrategies[0].owner_id).toBe(A);
    expect(((await a.client.get('/api/strategy-lab/saved-strategies')).body as { strategies: unknown[] }).strategies).toHaveLength(1);

    const b = await listen(createApp({ sessionStore: 'memory' }));
    await login(b.client, 'b@test.local');
    expect(((await b.client.get('/api/strategy-lab/saved-strategies')).body as { strategies: unknown[] }).strategies).toHaveLength(0);
    const foreign = await b.client.request('PUT', `/api/strategy-lab/saved-strategies/${id}`, { body: { ...draft('Foreign'), ownerId: B } });
    expect(foreign.status).toBe(404);
    expect(db.savedStrategies[0].name).toBe('EMA Saved');
    await a.close(); await b.close();
  });

  it('rejects malformed UUID safely and rejects invalid DSL before INSERT/UPDATE', async () => {
    const client = await listen(createApp({ sessionStore: 'memory' }));
    await login(client.client, 'a@test.local');
    const before = db.executed.length;
    const malformed = await client.client.request('PUT', '/api/strategy-lab/saved-strategies/not-a-uuid', { body: draft() });
    expect(malformed.status).toBe(404);
    expect(db.executed.slice(before).some((sql) => /strategy_lab_saved_strategies/i.test(sql))).toBe(false);

    const invalid = draft();
    invalid.sourceCode = 'LONG(UNKNOWN_REFERENCE);';
    const rejected = await client.client.post('/api/strategy-lab/saved-strategies', invalid);
    expect(rejected.status).toBe(400);
    expect(db.savedStrategies).toHaveLength(0);
    expect(db.executed.some((sql) => /INSERT INTO strategy_lab_saved_strategies/i.test(sql))).toBe(false);
    await client.close();
  });

  it('performs no INSERT or UPDATE when saved-strategy validation fails', async () => {
    const client = await listen(createApp({ sessionStore: 'memory' }));
    await login(client.client, 'a@test.local');

    const invalidCreate = {
      ...draft('Invalid create'),
      indicators: [
        { id: 'rsi-main', type: 'RSI', name: 'RSI', period: 14, source: 'close' },
        { id: 'atr-main', type: 'ATR', name: 'ATR', period: 14 },
      ],
      sourceCode: 'strategy("Invalid create", () => { LONG(below(RSI_MAIN, 101)); SHORT(above(RSI_MAIN, 70)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });',
    };
    const createStart = db.executed.length;
    expect((await client.client.post('/api/strategy-lab/saved-strategies', invalidCreate)).status).toBe(400);
    expect(db.executed.slice(createStart).some((sql) => /INSERT\s+INTO\s+strategy_lab_saved_strategies/i.test(sql))).toBe(false);

    const created = await client.client.post('/api/strategy-lab/saved-strategies', draft('Valid before update'));
    expect(created.status).toBe(201);
    const id = (created.body as { strategy: { id: string } }).strategy.id;
    const invalidUpdate = {
      ...draft('Invalid update'),
      indicators: [...draft().indicators, { id: 'fractal-main', type: 'FRACTALS', name: 'Fractals', period: 7 }],
    };
    const updateStart = db.executed.length;
    expect((await client.client.request('PUT', `/api/strategy-lab/saved-strategies/${id}`, { body: invalidUpdate })).status).toBe(400);
    expect(db.executed.slice(updateStart).some((sql) => /UPDATE\s+strategy_lab_saved_strategies/i.test(sql))).toBe(false);
    expect(db.savedStrategies[0].name).toBe('Valid before update');
    await client.close();
  });

  it('renames RSI display text while preserving its stable ID and code identifier', async () => {
    const client = await listen(createApp({ sessionStore: 'memory' }));
    await login(client.client, 'a@test.local');
    const rsiDraft = {
      name: 'Stable RSI ID',
      apiVersion: 2,
      indicators: [
        { id: 'rsi-main', type: 'RSI', name: 'RSI 14', period: 14, source: 'close', visible: false },
        { id: 'atr-main', type: 'ATR', name: 'ATR', period: 14, visible: false },
      ],
      sourceCode: 'strategy("Stable RSI ID", () => { LONG(below(RSI_MAIN, 30)); SHORT(above(RSI_MAIN, 70)); STOP(ATR_MAIN); TAKE_PROFIT(R(1)); });',
      execution: { feeBps: 5, slippageBps: 2 },
    };
    const created = await client.client.post('/api/strategy-lab/saved-strategies', rsiDraft);
    expect(created.status).toBe(201);
    const id = (created.body as { strategy: { id: string } }).strategy.id;

    const renamed = {
      ...rsiDraft,
      indicators: rsiDraft.indicators.map((indicator) =>
        indicator.id === 'rsi-main' ? { ...indicator, name: 'Мой RSI' } : indicator
      ),
    };
    expect((await client.client.request('PUT', `/api/strategy-lab/saved-strategies/${id}`, { body: renamed })).status).toBe(200);
    const listed = await client.client.get('/api/strategy-lab/saved-strategies');
    const saved = (listed.body as { strategies: Array<{ indicators: Array<{ id: string; name: string }> }> }).strategies[0];
    const rsi = saved.indicators.find((indicator) => indicator.id === 'rsi-main')!;
    expect(rsi.name).toBe('Мой RSI');
    expect(rsi.id).toBe('rsi-main');
    expect(indicatorIdentifier(rsi.id)).toBe('RSI_MAIN');
    expect((listed.body as any).strategies[0].sourceCode).toContain('RSI_MAIN');
    await client.close();
  });

  it('round-trips RSI and Fractals through the real HTTP persistence route', async () => {
    const client = await listen(createApp({ sessionStore: 'memory' }));
    await login(client.client, 'a@test.local');
    const payload = { ...draft('Indicator round trip'), indicators: [...draft().indicators, { id: 'rsi-main', type: 'RSI', name: 'RSI', period: 14, source: 'close', visible: false }, { id: 'fractals-main', type: 'FRACTALS', name: 'Fractals', period: 5, visible: true }] };
    const created = await client.client.post('/api/strategy-lab/saved-strategies', payload);
    expect(created.status).toBe(201);
    const listed = await client.client.get('/api/strategy-lab/saved-strategies');
    expect(listed.status).toBe(200);
    const saved = (listed.body as { strategies: Array<{ indicators: Array<Record<string, unknown>> }> }).strategies[0];
    expect(saved.indicators).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'rsi-main', type: 'RSI', name: 'RSI', period: 14, source: 'close' }),
      expect.objectContaining({ id: 'fractals-main', type: 'FRACTALS', period: 5, visible: true }),
    ]));
    await client.close();
  });

  it('keeps the existing catalog route separate from saved rows', async () => {
    const client = await listen(createApp({ sessionStore: 'memory' }));
    await login(client.client, 'a@test.local');
    const catalog = await client.client.get('/api/strategy-lab/strategies');
    expect(catalog.status).toBe(200);
    expect((catalog.body as { researchOnly: boolean }).researchOnly).toBe(true);
    expect((catalog.body as { strategies: unknown[] }).strategies).toBeInstanceOf(Array);
    await client.close();
  });
});
