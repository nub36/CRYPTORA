/**
 * CRYPTORA — Auth integration tests.
 *
 * REAL: route handlers, middleware, Zod validators, express-session cookie
 *       flow, Argon2id hashing/verification, token hashing, audit service.
 * MOCKED: the SQL layer (MemoryDb via __setPoolForTests) and the SMTP
 *         transport (spy — nothing is ever sent over the network).
 *
 * Flow under test: register (unverified) → verification email → verify token
 * → login. An unverified user must never obtain an authenticated session.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';
import type { MailSpy } from '../helpers/mailSpy';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { __resetTransportForTests } = await import('../../server/services/mail.js');
const { hashToken } = await import('../../server/services/emailVerification.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');
const { installMailSpy } = await import('../helpers/mailSpy');

const PASSWORD = 'correct horse battery';
const EMAIL = 'alice@example.com';

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;
let mail: MailSpy;

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  mail = await installMailSpy();
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  client = harness.client;
  close = harness.close;
});

afterEach(async () => {
  await close();
  __setPoolForTests(null);
  __resetTransportForTests();
});

const register = (over: Partial<{ email: string; displayName: string; password: string }> = {}) =>
  client.post('/api/auth/register', {
    email: over.email ?? EMAIL,
    displayName: over.displayName ?? 'Alice',
    password: over.password ?? PASSWORD,
  });

/** Register, then consume the real verification token via the real endpoint. */
async function registerAndVerify(
  over: Partial<{ email: string; displayName: string; password: string }> = {}
) {
  const reg = await register(over);
  expect(reg.status).toBe(201);
  const token = mail.lastRawToken();
  expect(token, 'verification email must carry a raw token').toBeTruthy();

  // Verifying must not sign the user in.
  const ver = await client.post('/api/auth/verify-email', { token });
  expect(ver.status).toBe(200);
  client.clearCookies();
  return reg;
}

describe('POST /api/auth/register', () => {
  it('creates the user with email_verified=false', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const body = res.body as { user: Record<string, unknown>; verification: Record<string, unknown> };
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.displayName).toBe('Alice');
    expect(body.user.role).toBe('user');
    expect(body.user.emailVerified).toBe(false);
    expect(body.verification.required).toBe(true);

    expect(db.users).toHaveLength(1);
    expect(db.users[0].email_verified).toBe(false);
    expect(db.users[0].email_verified_at).toBeNull();
  });

  it('does NOT create an authenticated session', async () => {
    const res = await register();
    expect(res.setCookie.join(';')).not.toMatch(/sid=/);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('stores an Argon2id hash, never the plaintext password', async () => {
    await register();
    expect(db.users[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(db.users[0].password_hash).not.toContain(PASSWORD);
  });

  it('creates a verification token and stores only its SHA-256 hash', async () => {
    await register();
    expect(db.tokens).toHaveLength(1);

    const raw = mail.lastRawToken()!;
    expect(db.tokens[0].token_hash).toBe(hashToken(raw));
    expect(db.tokens[0].token_hash).not.toBe(raw);
    // The plaintext token must not appear anywhere in the stored row.
    expect(JSON.stringify(db.tokens[0])).not.toContain(raw);
  });

  it('the mail service receives the raw token and a link under APP_ORIGIN', async () => {
    await register();
    const msg = mail.last();
    expect(msg).toBeTruthy();
    expect(msg!.to).toBe(EMAIL);
    expect(msg!.subject).toMatch(/Подтвердите email/);
    expect(msg!.text).toContain('/verify-email?token=');
    expect(msg!.html).toContain('/verify-email?token=');
    // Text fallback present, no remote tracking assets in the HTML.
    expect(msg!.html).not.toMatch(/<img[^>]+src=["']https?:/i);
    expect(msg!.html).not.toMatch(/<link[^>]+href=["']https?:/i);
  });

  it('never returns the raw token or its hash through the API', async () => {
    const res = await register();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(mail.lastRawToken()!);
    expect(raw).not.toContain(hashToken(mail.lastRawToken()!));
    expect(raw).not.toContain('token_hash');
  });

  it('never returns password_hash in the response', async () => {
    const res = await register();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('$argon2id$');
  });

  it('rejects an invalid email (real Zod validator)', async () => {
    expect((await register({ email: 'not-an-email' })).status).toBe(400);
  });

  it('rejects a short password', async () => {
    expect((await register({ password: 'short' })).status).toBe(400);
  });

  it('rejects a short display name', async () => {
    expect((await register({ displayName: 'A' })).status).toBe(400);
  });

  it('normalizes email case before storing', async () => {
    await register({ email: '  MiXeD@Example.COM ' });
    expect(db.users[0].email).toBe('mixed@example.com');
  });

  it('rejects a duplicate email → 409', async () => {
    expect((await register()).status).toBe(201);
    expect((await register({ email: EMAIL.toUpperCase() })).status).toBe(409);
    expect(db.users).toHaveLength(1);
  });
});

describe('POST /api/auth/login — verification gate', () => {
  it('unverified user + correct password → 403 EMAIL_NOT_VERIFIED', async () => {
    await register();
    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Подтвердите адрес электронной почты',
    });
  });

  it('unverified user + WRONG password → generic 401 (state not disclosed)', async () => {
    await register();
    const res = await client.post('/api/auth/login', { email: EMAIL, password: 'nope-nope-nope' });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('Неверный email или пароль');
    expect(JSON.stringify(res.body)).not.toContain('EMAIL_NOT_VERIFIED');
  });

  it('unknown email → the same generic 401 (no enumeration)', async () => {
    const res = await client.post('/api/auth/login', { email: 'ghost@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('Неверный email или пароль');
  });

  it('verified user + correct password → session created', async () => {
    await registerAndVerify();
    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { user: Record<string, unknown> }).user.emailVerified).toBe(true);
    expect(res.setCookie.join(';')).toMatch(/sid=/);
  });

  it('records last_login_at only on a successful login', async () => {
    await register();

    // Unverified: login is refused, last_login_at must stay untouched.
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(db.users[0].last_login_at).toBeNull();

    // Verify with the token from that same registration, then log in.
    const token = mail.lastRawToken();
    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);

    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(db.users[0].last_login_at).toBeInstanceOf(Date);
  });

  it('accepts an email with different casing', async () => {
    await registerAndVerify();
    const res = await client.post('/api/auth/login', { email: 'ALICE@EXAMPLE.COM', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('never returns password_hash on login', async () => {
    await registerAndVerify();
    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
  });
});

describe('cookie / session flow', () => {
  it('verify → login → Set-Cookie → next request with cookie is authenticated', async () => {
    await registerAndVerify();
    const login = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.setCookie.join(';')).toMatch(/sid=/);

    const me = await client.get('/api/me');
    expect(me.status).toBe(200);
    expect((me.body as { user: Record<string, unknown> }).user.email).toBe(EMAIL);
  });

  it('login → cookie → GET /api/auth/session restores the session', async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });

    const session = await client.get('/api/auth/session');
    expect(session.status).toBe(200);
    expect((session.body as { user: Record<string, unknown> }).user.displayName).toBe('Alice');
  });

  it('session survives across separate requests (server-side store)', async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    for (let i = 0; i < 3; i += 1) {
      expect((await client.get('/api/me')).status).toBe(200);
    }
  });

  it('without the cookie the session is not recognised', async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    client.clearCookies();
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('logout destroys the session server-side', async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect((await client.get('/api/me')).status).toBe(200);

    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('logout is idempotent when not authenticated', async () => {
    client.clearCookies();
    expect((await client.post('/api/auth/logout')).status).toBe(204);
  });

  it('an unverified user cannot obtain an authenticated session by any path', async () => {
    await register();
    // No cookie from register, no cookie from login.
    expect((await client.get('/api/me')).status).toBe(401);
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect((await client.get('/api/me')).status).toBe(401);
    expect((await client.get('/api/auth/session')).status).toBe(401);
  });
});

describe('GET/PATCH /api/me', () => {
  beforeEach(async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  });

  it('returns the profile with emailVerified and without password_hash', async () => {
    const res = await client.get('/api/me');
    expect(res.status).toBe(200);
    const body = res.body as { user: Record<string, unknown> };
    expect(body.user.emailVerified).toBe(true);
    expect(body.user.emailVerifiedAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
  });

  it('updates the display name', async () => {
    const res = await client.patch('/api/me', { displayName: 'Alicia' });
    expect(res.status).toBe(200);
    expect((res.body as { user: Record<string, unknown> }).user.displayName).toBe('Alicia');
    expect(db.users[0].display_name).toBe('Alicia');
  });

  it('rejects an invalid display name via the real validator', async () => {
    expect((await client.patch('/api/me', { displayName: 'x' })).status).toBe(400);
    expect(db.users[0].display_name).toBe('Alice');
  });

  it('cannot self-assign the admin role', async () => {
    expect((await client.patch('/api/me', { displayName: 'Alice', role: 'admin' })).status).toBe(200);
    expect(db.users[0].role).toBe('user');
  });

  it('cannot change email', async () => {
    expect((await client.patch('/api/me', { displayName: 'Alice', email: 'evil@example.com' })).status).toBe(200);
    expect(db.users[0].email).toBe(EMAIL);
  });

  it('cannot flip email_verified through the profile endpoint', async () => {
    await client.patch('/api/me', { displayName: 'Alice', emailVerified: false });
    expect(db.users[0].email_verified).toBe(true);
  });
});

describe('blocked user', () => {
  it('a blocked user cannot log in → 403', async () => {
    await registerAndVerify();
    db.users[0].is_active = false;

    const res = await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('Аккаунт заблокирован');
  });

  it('an EXISTING session of a blocked user stops granting access', async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect((await client.get('/api/me')).status).toBe(200);

    db.users[0].is_active = false;

    const res = await client.get('/api/me');
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('Аккаунт заблокирован');
  });

  it('GET /api/auth/session also rejects a blocked user', async () => {
    await registerAndVerify();
    await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD });
    db.users[0].is_active = false;

    expect((await client.get('/api/auth/session')).status).toBe(401);
  });
});

describe('Argon2id', () => {
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
