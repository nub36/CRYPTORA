/**
 * CRYPTORA — Rate limiting integration test.
 *
 * Uses the REAL express-rate-limit middleware from
 * server/middleware/rateLimit.js, with limits lowered via env so the
 * threshold is reachable inside a test run.
 *
 * MOCKED: only the SQL layer (MemoryDb).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { HttpClient } from '../helpers/httpHarness';

// Low thresholds so the limit trips quickly.
process.env.LOGIN_RATE_LIMIT = '3';
process.env.REGISTER_RATE_LIMIT = '2';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';
process.env.NODE_ENV = 'development';
vi.resetModules();

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');

describe('rate limiting — real express-rate-limit middleware', () => {
  let client: HttpClient;
  let close: () => Promise<void>;

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

  it('login is limited to LOGIN_RATE_LIMIT per window per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await client.post('/api/auth/login', {
        email: 'nobody@example.com',
        password: 'whatever-pass',
      });
      statuses.push(res.status);
    }

    // First 3 reach the handler (401 unknown user); the rest are throttled.
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3).every((s) => s === 429)).toBe(true);

    const last = await client.post('/api/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever-pass',
    });
    expect((last.body as { error: string }).error).toMatch(/Слишком много попыток входа/);
  });

  it('exposes standard RateLimit response headers (RFC 9239)', async () => {
    const res = await client.post('/api/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever-pass',
    });
    expect(res.status).toBe(429);
    // express-rate-limit v8 emits the combined RFC 9239 header, not draft-7 pairs.
    expect(res.headers.get('ratelimit')).toMatch(/limit=3/);
    expect(res.headers.get('ratelimit-policy')).toBe('3;w=60');
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('register has its own, tighter budget', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await client.post('/api/auth/register', {
        email: `u${i}@example.com`,
        displayName: `User ${i}`,
        password: 'correct horse battery',
      });
      statuses.push(res.status);
    }

    // Budget is 2: first two are accepted (201), the rest throttled (429).
    expect(statuses.slice(0, 2)).toEqual([201, 201]);
    expect(statuses.slice(2).every((s) => s === 429)).toBe(true);
  });
});
