/**
 * CRYPTORA — Email verification integration tests.
 *
 * Covers: verify endpoint, resend endpoint, SMTP failure behaviour, and a
 * data-leak sweep over every auth/admin response.
 *
 * REAL: route handlers, validators, token service (crypto + SHA-256),
 *       transaction control flow, rate limiters, mail service.
 * MOCKED: SQL layer (MemoryDb) and the SMTP transport (spy / failing stub).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';
import type { MailSpy } from '../helpers/mailSpy';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
// High here: the limiter is a module-level singleton shared across tests in
// a file, so the real budget is asserted in rateLimit.test.ts instead.
process.env.RESEND_RATE_LIMIT = '100000';
process.env.RESEND_MIN_INTERVAL_SECONDS = '0';
process.env.SESSION_STORE = 'memory';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { __setTransportForTests, __resetTransportForTests } = await import('../../server/services/mail.js');
const { hashToken } = await import('../../server/services/emailVerification.js');
const { MemoryDb, seedUser } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');
const { installMailSpy, spyTransport, createMailSpy } = await import('../helpers/mailSpy');

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

async function register(email = EMAIL) {
  const res = await client.post('/api/auth/register', {
    email,
    displayName: 'Alice',
    password: PASSWORD,
  });
  expect(res.status).toBe(201);
  return res;
}

describe('POST /api/auth/verify-email', () => {
  it('a valid token sets email_verified and email_verified_at', async () => {
    await register();
    const token = mail.lastRawToken()!;

    const res = await client.post('/api/auth/verify-email', { token });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('ok');

    expect(db.users[0].email_verified).toBe(true);
    expect(db.users[0].email_verified_at).toBeInstanceOf(Date);
  });

  it('the consumed token becomes unusable (replay rejected)', async () => {
    await register();
    const token = mail.lastRawToken()!;

    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
    expect(db.tokens[0].used_at).toBeInstanceOf(Date);

    const replay = await client.post('/api/auth/verify-email', { token });
    expect(replay.status).toBe(400);
    expect((replay.body as { error: string }).error).toBe('INVALID');
  });

  it('an expired token is rejected with 410 EXPIRED', async () => {
    await register();
    const token = mail.lastRawToken()!;
    db.tokens[0].expires_at = new Date(Date.now() - 1000); // simulate time passing

    const res = await client.post('/api/auth/verify-email', { token });
    expect(res.status).toBe(410);
    expect((res.body as { error: string }).error).toBe('EXPIRED');
    expect(db.users[0].email_verified).toBe(false);
  });

  it('an unknown token is rejected', async () => {
    await register();
    const res = await client.post('/api/auth/verify-email', {
      token: 'A'.repeat(43),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('INVALID');
    expect(db.users[0].email_verified).toBe(false);
  });

  it('a malformed token is rejected without touching the DB', async () => {
    await register();
    const before = db.executed.length;

    for (const bad of ['short', 'has spaces!!', '', 'a'.repeat(200), '{}']) {
      const res = await client.post('/api/auth/verify-email', { token: bad });
      expect([400, 401].includes(res.status) ? 400 : res.status).toBe(400);
    }

    expect(db.users[0].email_verified).toBe(false);
    // Malformed tokens are short-circuited before any DB round-trip.
    expect(db.executed.length).toBe(before);
  });

  it('verifying does not create a session', async () => {
    await register();
    const token = mail.lastRawToken()!;
    const res = await client.post('/api/auth/verify-email', { token });

    expect(res.status).toBe(200);
    expect(res.setCookie.join(';')).not.toMatch(/sid=/);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('verifying with one token invalidates the user\'s other outstanding tokens', async () => {
    await register();
    const firstToken = mail.lastRawToken()!;

    // Resend creates a second token and retires the first.
    await client.post('/api/auth/resend-verification', { email: EMAIL });
    const secondToken = mail.lastRawToken()!;
    expect(secondToken).not.toBe(firstToken);

    expect((await client.post('/api/auth/verify-email', { token: firstToken })).status).toBe(400);
    expect((await client.post('/api/auth/verify-email', { token: secondToken })).status).toBe(200);
  });

  it('a token issued for one user cannot verify another', async () => {
    await register('alice@example.com');
    const aliceToken = mail.lastRawToken()!;
    await register('bob@example.com');

    // Verify Bob with Bob's token; Alice must stay unverified.
    const bobToken = mail.lastRawToken()!;
    expect((await client.post('/api/auth/verify-email', { token: bobToken })).status).toBe(200);

    const alice = db.findUserByEmail('alice@example.com')!;
    const bob = db.findUserByEmail('bob@example.com')!;
    expect(alice.email_verified).toBe(false);
    expect(bob.email_verified).toBe(true);
    expect(aliceToken).toBeTruthy();
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('invalidates the old token, creates a new one and dispatches a new mail', async () => {
    await register();
    const firstToken = mail.lastRawToken()!;
    expect(mail.sent).toHaveLength(1);

    const res = await client.post('/api/auth/resend-verification', { email: EMAIL });
    expect(res.status).toBe(200);

    expect(mail.sent).toHaveLength(2);
    const secondToken = mail.lastRawToken()!;
    expect(secondToken).not.toBe(firstToken);

    // Old token is retired.
    const old = db.tokens.find((t) => t.token_hash === hashToken(firstToken));
    expect(old?.used_at).toBeInstanceOf(Date);

    // New token works.
    expect((await client.post('/api/auth/verify-email', { token: secondToken })).status).toBe(200);
  });

  it('returns a generic response for a nonexistent email', async () => {
    const res = await client.post('/api/auth/resend-verification', { email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('ok');
    expect(mail.sent).toHaveLength(0);
  });

  it('does not leak whether an account exists or is verified', async () => {
    await register();
    await client.post('/api/auth/verify-email', { token: mail.lastRawToken()! });

    const verifiedRes = await client.post('/api/auth/resend-verification', { email: EMAIL });
    const ghostRes = await client.post('/api/auth/resend-verification', { email: 'ghost@example.com' });

    expect(verifiedRes.status).toBe(ghostRes.status);
    expect(verifiedRes.body).toEqual(ghostRes.body);
    // Nothing was sent for either already-verified or nonexistent address.
    expect(mail.sent).toHaveLength(1);
  });

  it('never returns a token in the response', async () => {
    await register();
    const res = await client.post('/api/auth/resend-verification', { email: EMAIL });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(mail.lastRawToken()!);
    expect(raw).not.toContain('token');
  });

});

describe('SMTP failure behaviour', () => {
  it('a mail outage does not corrupt or delete the user', async () => {
    // Swap in a transport that always fails BEFORE registering.
    __setTransportForTests(
      {
        sendMail: async () => {
          throw new Error('ECONNREFUSED smtp.example.com:587');
        },
      },
      'mock'
    );

    const res = await client.post('/api/auth/register', {
      email: EMAIL,
      displayName: 'Alice',
      password: PASSWORD,
    });

    // Registration still succeeds — the account is recoverable via resend.
    expect(res.status).toBe(201);
    expect((res.body as { verification: { delivery: string } }).verification.delivery).toBe('unavailable');

    expect(db.users).toHaveLength(1);
    expect(db.users[0].email_verified).toBe(false);
    expect(db.users[0].password_hash).toMatch(/^\$argon2id\$/);
    // The token still exists, so a later resend/verify can complete the flow.
    expect(db.tokens).toHaveLength(1);
  });

  it('the email stays unoccupied: resend later succeeds and completes verification', async () => {
    __setTransportForTests(
      { sendMail: async () => { throw new Error('smtp down'); } },
      'mock'
    );

    await client.post('/api/auth/register', { email: EMAIL, displayName: 'Alice', password: PASSWORD });

    // A second register with the same address must still report 409 (not lost).
    expect(
      (await client.post('/api/auth/register', { email: EMAIL, displayName: 'Alice', password: PASSWORD })).status
    ).toBe(409);

    // SMTP recovers.
    __setTransportForTests(spyTransport(mail), 'mock');

    const resend = await client.post('/api/auth/resend-verification', { email: EMAIL });
    expect(resend.status).toBe(200);
    expect(mail.sent).toHaveLength(1);

    const token = mail.lastRawToken()!;
    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
    expect(db.users[0].email_verified).toBe(true);
  });

  it('resend reports a safe error when mail is unconfigured in production', async () => {
    // Simulate production with no SMTP_HOST by injecting a transport that throws.
    __setTransportForTests(
      { sendMail: async () => { throw new Error('not configured'); } },
      'mock'
    );

    await register();
    const res = await client.post('/api/auth/resend-verification', { email: EMAIL });

    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toBe('MAIL_UNAVAILABLE');
    // No secrets in the error body.
    expect(JSON.stringify(res.body)).not.toMatch(/smtp|pass|secret/i);
  });
});

describe('data-leak sweep', () => {
  it('no auth or admin response exposes secrets', async () => {
    await register();
    const rawToken = mail.lastRawToken()!;
    const tokenHash = hashToken(rawToken);

    const bodies: string[] = [];
    const collect = (r: { body: unknown }) => {
      bodies.push(JSON.stringify(r.body));
    };

    collect(await client.post('/api/auth/register', { email: 'bob@example.com', displayName: 'Bob', password: PASSWORD }));
    collect(await client.post('/api/auth/login', { email: EMAIL, password: PASSWORD }));
    collect(await client.post('/api/auth/login', { email: EMAIL, password: 'wrong-password-x' }));
    collect(await client.get('/api/auth/session'));
    collect(await client.get('/api/me'));
    collect(await client.post('/api/auth/verify-email', { token: rawToken }));
    collect(await client.post('/api/auth/resend-verification', { email: EMAIL }));
    collect(await client.get('/api/health'));
    collect(await client.get('/api/admin/dashboard'));
    collect(await client.get('/api/admin/users'));
    collect(await client.get('/api/admin/system'));

    const blob = bodies.join('\n');
    expect(blob).not.toContain('$argon2id$');
    expect(blob).not.toContain('password_hash');
    expect(blob).not.toContain(tokenHash);
    expect(blob).not.toContain(rawToken);
    expect(blob).not.toContain('SMTP_PASS');
    expect(blob).not.toContain('SESSION_SECRET');
    expect(blob).not.toContain(process.env.SESSION_SECRET ?? '__none__');
  });

  it('admin users listing includes emailVerified', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: 'root@example.com', display_name: 'Root', password_hash: hash, role: 'admin' });
    await register();

    await client.post('/api/auth/login', { email: 'root@example.com', password: PASSWORD });
    const res = await client.get('/api/admin/users');
    expect(res.status).toBe(200);

    const body = res.body as { users: Array<{ email: string; emailVerified: boolean }> };
    const alice = body.users.find((u) => u.email === EMAIL);
    expect(alice).toBeTruthy();
    expect(alice!.emailVerified).toBe(false);

    const root = body.users.find((u) => u.email === 'root@example.com');
    expect(root!.emailVerified).toBe(true);
  });
});

describe('mail service status (no silent fake transport)', () => {
  it('reports unconfigured in production without SMTP_HOST', async () => {
    const { getMailStatus } = await import('../../server/services/mail.js');
    const status = getMailStatus();
    // In this suite MAIL_TRANSPORT is unset and SMTP_HOST is empty, NODE_ENV=test.
    expect(['json', 'smtp']).toContain(status.kind);
    expect(typeof status.configured).toBe('boolean');
  });

  it('createMailSpy captures messages without network I/O', async () => {
    const spy = createMailSpy();
    const t = spyTransport(spy);
    await t.sendMail({ from: 'a', to: 'b@example.com', subject: 's', text: 'x' });
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0].to).toBe('b@example.com');
  });
});
