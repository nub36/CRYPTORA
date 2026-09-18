/**
 * CRYPTORA — Auth integration tests (items 5, 6, 7, 10).
 *
 * REAL: route handlers, middleware, Zod validators, express-session cookie
 *       flow, Argon2id hashing/verification, audit service.
 * MOCKED: only the SQL layer, via __setPoolForTests + MemoryDb
 *         (see tests/helpers/memoryDb.ts). No business logic is duplicated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb, seedUser } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');

const PASSWORD = 'correct horse battery';
const EMAIL = 'alice@example.com';

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  client = harness.client;
  close = harness.close;
});

afterEach(async () => {
  await close();
  __setPoolForTests(null);
});

const register = (over: Partial<{ email: string; displayName: string; password: string }> = {}) =>
  client.post('/api/auth/register', {
    email: over.email ?? EMAIL,
    displayName: over.displayName ?? 'Alice',
    password: over.password ?? PASSWORD,
  });

describe('POST /api/auth/register', () => {
  it('registers a user and returns 201 with a user object', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const body = res.body as { user: Record<string, unknown> };
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.displayName).toBe('Alice');
    expect(body.user.role).toBe('user');
    expect(body.user.id).toBeTruthy();
  });

  it('stores an Argon2id hash, never the plaintext password', async () => {
    await register();
    expect(db.users).toHaveLength(1);
    expect(db.users[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(db.users[0].password_hash).not.toContain(PASSWORD);
  });

  it('the stored hash really verifies the submitted password', async () => {
    await register();
    await expect(argon2.verify(db.users[0].password_hash, PASSWORD)).resolves.toBe(true);
    await expect(argon2.verify(db.users[0].password_hash, 'wrong')).resolves.toBe(false);
  });

  it('never returns password_hash in the response', async () => {
    const res = await register();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('$argon2id$');
  });

  it('sets a session cookie', async () => {
    const res = await register();
    expect(res.setCookie.join(';')).toMatch(/sid=/);
    expect(res.setCookie.join(';')).toMatch(/HttpOnly/i);
  });

  it('rejects an invalid email (real Zod validator)', async () => {
    const res = await register({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBeTruthy();
  });

  it('rejects a short password', async () => {
    const res = await register({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects a short display name', async () => {
    const res = await register({ displayName: 'A' });
    expect(res.status).toBe(400);
  });

  it('normalizes email case before storing', async () => {
    await register({ email: '  MiXeD@Example.COM ' });
    expect(db.users[0].email).toBe('mixed@example.com');
  });

  it('rejects a duplicate email → 409', async () => {
    expect((await register()).status).toBe(201);
    const second = await register({ email: EMAIL.toUpperCase() });
    expect(second.status).toBe(409);
    expect(db.users).toHaveLength(1);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
    client.clearCookies();
  });

  it('logs in with the correct password', async () => {
    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { user: Record<string, unknown> }).user.email).toBe(EMAIL);
    expect(res.setCookie.join(';')).toMatch(/sid=/);
  });

  it('never returns password_hash on login', async () => {
    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('records last_login_at', async () => {
    expect(db.users[0].last_login_at).toBeNull();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(db.users[0].last_login_at).toBeInstanceOf(Date);
  });

  it('rejects a wrong password → 401 generic message', async () => {
    const res = await client.post('/api/auth/login', { email: EMAIL, password: 'nope-nope-nope' });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('Неверный email или пароль');
  });

  it('rejects an unknown email with the SAME generic message (no user enumeration)', async () => {
    const res = await client.post('/api/auth/login', { email: 'ghost@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('Неверный email или пароль');
  });

  it('accepts an email with different casing', async () => {
    const res = await client.post('/api/auth/login', { email: 'ALICE@EXAMPLE.COM', password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('cookie / session flow (item 6)', () => {
  it('register → Set-Cookie → next request with cookie is authenticated', async () => {
    const reg = await register();
    expect(reg.setCookie.join(';')).toMatch(/sid=/);

    const me = await client.get('/api/me');
    expect(me.status).toBe(200);
    expect((me.body as { user: Record<string, unknown> }).user.email).toBe(EMAIL);
  });

  it('login → Set-Cookie → GET /api/auth/session restores the session', async () => {
    await register();
    client.clearCookies();

    const login = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);

    const session = await client.get('/api/auth/session');
    expect(session.status).toBe(200);
    expect((session.body as { user: Record<string, unknown> }).user.displayName).toBe('Alice');
  });

  it('session survives across separate requests (server-side store, not the client)', async () => {
    await register();
    for (let i = 0; i < 3; i += 1) {
      const res = await client.get('/api/me');
      expect(res.status).toBe(200);
    }
  });

  it('without the cookie the session is not recognised', async () => {
    await register();
    client.clearCookies();
    const res = await client.get('/api/me');
    expect(res.status).toBe(401);
  });

  it('logout destroys the session server-side', async () => {
    await register();
    expect((await client.get('/api/me')).status).toBe(200);

    const out = await client.post('/api/auth/logout');
    expect(out.status).toBe(204);

    // Re-presenting the old cookie must not work.
    const me = await client.get('/api/me');
    expect(me.status).toBe(401);
  });

  it('logout is idempotent when not authenticated', async () => {
    client.clearCookies();
    const res = await client.post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('GET/PATCH /api/me', () => {
  beforeEach(async () => {
    await register();
  });

  it('returns the profile without password_hash', async () => {
    const res = await client.get('/api/me');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
  });

  it('updates the display name', async () => {
    const res = await client.patch('/api/me', { displayName: 'Alicia' });
    expect(res.status).toBe(200);
    expect((res.body as { user: Record<string, unknown> }).user.displayName).toBe('Alicia');
    expect(db.users[0].display_name).toBe('Alicia');
  });

  it('rejects an invalid display name via the real validator', async () => {
    const res = await client.patch('/api/me', { displayName: 'x' });
    expect(res.status).toBe(400);
    expect(db.users[0].display_name).toBe('Alice');
  });

  it('cannot change role through PATCH /api/me (privilege escalation blocked)', async () => {
    const res = await client.patch('/api/me', { displayName: 'Alice', role: 'admin' });
    expect(res.status).toBe(200);
    expect(db.users[0].role).toBe('user');
  });

  it('cannot change email through PATCH /api/me', async () => {
    const res = await client.patch('/api/me', { displayName: 'Alice', email: 'evil@example.com' });
    expect(res.status).toBe(200);
    expect(db.users[0].email).toBe(EMAIL);
  });
});

describe('blocked user (item 7)', () => {
  it('a blocked user cannot log in → 403', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: EMAIL, display_name: 'Alice', password_hash: hash, is_active: false });

    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('Аккаунт заблокирован');
  });

  it('an EXISTING session of a blocked user stops granting access', async () => {
    await register();
    expect((await client.get('/api/me')).status).toBe(200);

    // Block the user out-of-band (simulating an admin action / direct DB edit).
    db.users[0].is_active = false;

    const res = await client.get('/api/me');
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('Аккаунт заблокирован');
  });

  it('GET /api/auth/session also rejects a blocked user', async () => {
    await register();
    db.users[0].is_active = false;

    const res = await client.get('/api/auth/session');
    expect(res.status).toBe(401);
  });
});

describe('Argon2id (item 10)', () => {
  it('hash/verify round-trip with the configured parameters', async () => {
    const hash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(argon2.verify(hash, PASSWORD)).resolves.toBe(true);
    await expect(argon2.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('config exposes Argon2id parameters', async () => {
    const { config } = await import('../../server/config.js');
    expect(config.ARGON2_MEMORY_COST).toBe(65536);
    expect(config.ARGON2_TIME_COST).toBe(3);
    expect(config.ARGON2_PARALLELISM).toBe(1);
  });
});

describe('REGISTRATION_ENABLED=false', () => {
  it('closes registration with 403', async () => {
    const prev = process.env.REGISTRATION_ENABLED;
    process.env.REGISTRATION_ENABLED = 'false';
    try {
      vi.resetModules();
      const freshApp = (await import('../../server/app.js')).createApp({ sessionStore: 'memory' });
      const fresh = await listen(freshApp);
      try {
        const res = await fresh.client.post('/api/auth/register', {
          email: 'bob@example.com',
          displayName: 'Bob',
          password: PASSWORD,
        });
        expect(res.status).toBe(403);
        expect((res.body as { error: string }).error).toMatch(/закрыта/i);
      } finally {
        await fresh.close();
      }
    } finally {
      process.env.REGISTRATION_ENABLED = prev;
      vi.resetModules();
    }
  });
});
