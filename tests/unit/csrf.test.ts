/**
 * CRYPTORA — CSRF protection integration tests (item 9).
 *
 * Exercises the REAL csrfProtection middleware (server/middleware/csrf.js)
 * mounted by the REAL app, over real HTTP with full control of the
 * Origin / Referer / Host headers via node:http.
 *
 * Documented policy being verified:
 *   - safe methods (GET/HEAD/OPTIONS) are exempt;
 *   - state-changing requests must be same-origin;
 *   - a foreign Origin is rejected with 403;
 *   - a request with NEITHER Origin NOR Referer is rejected in production
 *     and allowed in development (documented difference).
 *
 * MOCKED: only the SQL layer (MemoryDb).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

const PRODUCTION_ORIGIN = 'https://cryptora.duckdns.org';
const PRODUCTION_HOST = 'cryptora.duckdns.org';
const CSRF_ERROR = 'Запрос отклонён (CSRF)';

interface RawResponse {
  status: number;
  body: unknown;
}

/** Raw HTTP request so Origin/Referer/Host can be set exactly. */
function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          let parsed: unknown = data;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startApp(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

describe('CSRF — development policy', () => {
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT = '100000';
    process.env.REGISTER_RATE_LIMIT = '100000';
    process.env.API_RATE_LIMIT = '1000000';
    process.env.SESSION_STORE = 'memory';
    process.env.NODE_ENV = 'development';
    vi.resetModules();

    const { MemoryDb } = await import('../helpers/memoryDb');
    const { __setPoolForTests } = await import('../../server/db/pool.js');
    const { createApp } = await import('../../server/app.js');
    __setPoolForTests(new MemoryDb().asPool());

    const harness = await startApp(createApp({ sessionStore: 'memory' }));
    port = harness.port;
    close = harness.close;
  });

  afterAll(async () => {
    await close();
  });

  it('GET is exempt from CSRF checks', async () => {
    const res = await rawRequest(port, 'GET', '/api/health', { Origin: 'https://evil.example' });
    expect(res.status).toBe(200);
  });

  it('same-origin state-changing request passes the CSRF gate', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Origin: `http://127.0.0.1:${port}`,
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'nobody@example.com', password: 'whatever-pass' })
    );
    // Not a CSRF rejection — it reached the real handler (unknown user → 401).
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).not.toBe(CSRF_ERROR);
  });

  it('a FOREIGN Origin is rejected with 403 CSRF', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Origin: 'https://evil.example',
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'x@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(CSRF_ERROR);
  });

  it('a foreign Referer (no Origin) is rejected with 403 CSRF', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Referer: 'https://evil.example/attack',
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'x@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(CSRF_ERROR);
  });

  it('a same-origin Referer (no Origin) passes', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Referer: `http://127.0.0.1:${port}/login`,
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'nobody@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).not.toBe(CSRF_ERROR);
  });

  it('no Origin AND no Referer is ALLOWED in development (documented)', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      JSON.stringify({ email: 'nobody@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).not.toBe(CSRF_ERROR);
  });
});

describe('CSRF — production policy (https://cryptora.duckdns.org)', () => {
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_STORE = 'postgres';
    vi.resetModules();

    const { MemoryDb } = await import('../helpers/memoryDb');
    const { __setPoolForTests } = await import('../../server/db/pool.js');
    const { createApp } = await import('../../server/app.js');
    // Store kind is 'postgres' (the production-legal value); the pool behind it
    // is the in-memory mock so no live PostgreSQL is needed.
    __setPoolForTests(new MemoryDb().asPool());

    const harness = await startApp(createApp());
    port = harness.port;
    close = harness.close;
  });

  afterAll(async () => {
    await close();
    process.env.NODE_ENV = 'test';
  });

  it('a same-origin request from cryptora.duckdns.org passes', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Origin: PRODUCTION_ORIGIN,
        Host: PRODUCTION_HOST,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'nobody@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).not.toBe(CSRF_ERROR);
  });

  it('a foreign Origin is rejected even in production', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Origin: 'https://attacker.example',
        Host: PRODUCTION_HOST,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'x@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(CSRF_ERROR);
  });

  it('a same-host http:// origin is ACCEPTED (current policy: scheme-agnostic same-host match)', async () => {
    // server/middleware/csrf.js matches BOTH `https://<host>` and `http://<host>`.
    // This is the implemented, documented behaviour — asserted here so a
    // future tightening (or loosening) is a deliberate, visible change.
    // Residual risk is low: the session cookie is Secure, so it is never sent
    // over plain HTTP, and a cross-site page cannot forge this Origin value.
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Origin: 'http://cryptora.duckdns.org',
        Host: PRODUCTION_HOST,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'x@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).not.toBe(CSRF_ERROR);
  });

  it('a subdomain of the production host is rejected (exact-host match only)', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Origin: 'https://evil.cryptora.duckdns.org',
        Host: PRODUCTION_HOST,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'x@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(CSRF_ERROR);
  });

  it('no Origin AND no Referer is REJECTED in production (documented)', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      { Host: PRODUCTION_HOST, 'Content-Type': 'application/json' },
      JSON.stringify({ email: 'x@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(CSRF_ERROR);
  });

  it('a same-origin production Referer passes', async () => {
    const res = await rawRequest(
      port,
      'POST',
      '/api/auth/login',
      {
        Referer: `${PRODUCTION_ORIGIN}/login`,
        Host: PRODUCTION_HOST,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ email: 'nobody@example.com', password: 'whatever-pass' })
    );
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).not.toBe(CSRF_ERROR);
  });

  it('PATCH is also protected (state-changing, not just POST)', async () => {
    const res = await rawRequest(
      port,
      'PATCH',
      '/api/me',
      { Origin: 'https://attacker.example', Host: PRODUCTION_HOST, 'Content-Type': 'application/json' },
      JSON.stringify({ displayName: 'Hacked' })
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(CSRF_ERROR);
  });

  it('GET remains exempt in production', async () => {
    const res = await rawRequest(port, 'GET', '/api/health', { Host: PRODUCTION_HOST });
    expect(res.status).toBe(200);
  });
});
