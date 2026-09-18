/**
 * CRYPTORA — Backend boot smoke test (items 2 & 3).
 *
 * Imports the REAL server/app.js and calls the REAL createApp().
 * Fails if a runtime dependency is missing, the app cannot be assembled,
 * or a middleware import is broken — i.e. exactly the ERR_MODULE_NOT_FOUND
 * class of defect that slipped through before.
 *
 * No function is copied or re-implemented here.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { HttpClient } from '../helpers/httpHarness';

// Keep rate limiting out of the way for the whole suite (config.js reads env at load).
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');

describe('backend boot — real createApp()', () => {
  it('imports server/app.js without a missing runtime dependency', async () => {
    // Reaching this far already proves the module graph resolves.
    const mod = await import('../../server/app.js');
    expect(typeof mod.createApp).toBe('function');
  });

  it('assembles an Express app (no middleware import failure)', () => {
    __setPoolForTests(new MemoryDb().asPool());
    const app = createApp({ sessionStore: 'memory' });
    expect(app).toBeDefined();
    expect(typeof (app as unknown as { listen: unknown }).listen).toBe('function');
    expect(typeof (app as unknown as { use: unknown }).use).toBe('function');
  });

  it('refuses the MemoryStore under NODE_ENV=production (no silent fallback)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // config.js captured NODE_ENV at first load, so reload the module graph.
      vi.resetModules();
      const fresh = await import('../../server/app.js');
      expect(() => fresh.createApp({ sessionStore: 'memory' })).toThrow(/not permitted when NODE_ENV=production/);
    } finally {
      process.env.NODE_ENV = prev;
      vi.resetModules();
    }
  });

  it('rejects an unknown SESSION_STORE value', () => {
    expect(() =>
      createApp({ sessionStore: 'redis' as unknown as 'memory' })
    ).toThrow(/Unknown SESSION_STORE/);
  });
});

describe('real routes over real HTTP', () => {
  let close: () => Promise<void>;
  let client: HttpClient;

  beforeAll(async () => {
    __setPoolForTests(new MemoryDb().asPool());
    const harness = await listen(createApp({ sessionStore: 'memory' }));
    client = harness.client;
    close = harness.close;
  });

  afterAll(async () => {
    await close();
    __setPoolForTests(null);
  });

  it('GET /api/health → 200 with app identity', async () => {
    const res = await client.get('/api/health');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.app).toBe('CRYPTORA Market Intelligence Terminal');
    expect(body.version).toBeTruthy();
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(['connected', 'disconnected']).toContain(body.database);
  });

  it('GET /api/me without auth → 401 JSON', async () => {
    const res = await client.get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('GET /api/admin/dashboard without auth → 401 JSON', async () => {
    const res = await client.get('/api/admin/dashboard');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('GET /api/admin/users without auth → 401 JSON', async () => {
    const res = await client.get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/me without auth → 401 JSON', async () => {
    const res = await client.patch('/api/me', { displayName: 'Hacker' });
    expect(res.status).toBe(401);
  });

  it('unknown /api route → 404 with JSON body', async () => {
    const res = await client.get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.body).toMatchObject({ error: 'Ресурс не найден' });
  });

  it('unknown route under a public prefix → 404 JSON', async () => {
    const res = await client.get('/api/auth/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('unknown route under /api/admin → 401, not 404 (admin routes never leak existence)', async () => {
    // router.use(requireAuth, requireAdmin) runs before routing, so an
    // unauthenticated caller cannot distinguish "no such route" from
    // "you are not allowed". That is the intended behaviour.
    const res = await client.get('/api/admin/nope/deep');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('sets security headers via helmet', async () => {
    const res = await client.get('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
