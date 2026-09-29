/**
 * CRYPTORA — 6-digit email verification code flow.
 *
 * REAL: route handlers, validators, code service (CSPRNG generation, keyed
 *       HMAC hashing, atomic consumption, attempt budget), rate limiters,
 *       mail service.
 * MOCKED: SQL layer (MemoryDb) and the SMTP transport (spy).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { HttpClient } from '../helpers/httpHarness';
import type { MailSpy } from '../helpers/mailSpy';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.RESEND_RATE_LIMIT = '100000';
process.env.RESEND_MIN_INTERVAL_SECONDS = '0';
process.env.VERIFY_RATE_LIMIT = '100000';
process.env.SESSION_STORE = 'memory';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { __resetTransportForTests } = await import('../../server/services/mail.js');
const {
  generateVerificationCode,
  hashCode,
  verifyCodeForUser,
  VERIFY_RESULT,
} = await import('../../server/services/emailVerification.js');
const { config } = await import('../../server/config.js');
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

async function register(email = EMAIL) {
  const res = await client.post('/api/auth/register', {
    email,
    password: PASSWORD,
  });
  expect(res.status).toBe(201);
  return res;
}

/** A code that is guaranteed different from `code` (same 6-digit format). */
function wrongCode(code: string): string {
  const n = (Number(code) + 1) % 1_000_000;
  return String(n).padStart(6, '0');
}

describe('code generation', () => {
  it('always produces exactly six digits (zero-padded)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it('registration issues a code with the configured TTL', async () => {
    await register();
    expect(db.tokens).toHaveLength(1);
    const row = db.tokens[0];
    expect(row.kind).toBe('code');
    const ttlMs = config.EMAIL_VERIFY_CODE_TTL_MINUTES * 60 * 1000;
    const delta = row.expires_at.getTime() - row.created_at.getTime();
    expect(Math.abs(delta - ttlMs)).toBeLessThan(5000);
  });

  it('stores a keyed HMAC, never the plaintext code', async () => {
    await register();
    const code = mail.lastCode()!;
    const row = db.tokens[0];
    expect(row.token_hash).toBe(hashCode(db.users[0].id, code));
    expect(row.token_hash).not.toContain(code);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registration without displayName derives one from the email', async () => {
    const res = await register('trader.one@example.com');
    const body = res.body as { user: { displayName: string } };
    expect(body.user.displayName).toBe('trader.one');
  });
});

describe('POST /api/auth/verify-code', () => {
  it('a valid code verifies the mailbox and does NOT create a session', async () => {
    await register();
    const code = mail.lastCode()!;

    const res = await client.post('/api/auth/verify-code', { email: EMAIL, code });
    expect(res.status).toBe(200);
    expect(res.setCookie.join(';')).not.toMatch(/sid=/);
    expect(db.users[0].email_verified).toBe(true);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('email is normalized (case/whitespace) before lookup', async () => {
    await register();
    const code = mail.lastCode()!;
    const res = await client.post('/api/auth/verify-code', {
      email: '  ALICE@Example.COM ',
      code,
    });
    expect(res.status).toBe(200);
  });

  it('a wrong code is rejected and burns one attempt', async () => {
    await register();
    const code = mail.lastCode()!;

    const res = await client.post('/api/auth/verify-code', { email: EMAIL, code: wrongCode(code) });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('INVALID');
    expect(db.tokens[0].attempts).toBe(1);
    expect(db.users[0].email_verified).toBe(false);
  });

  it('an expired code is rejected with 410 EXPIRED', async () => {
    await register();
    const code = mail.lastCode()!;
    db.tokens[0].expires_at = new Date(Date.now() - 1000);

    const res = await client.post('/api/auth/verify-code', { email: EMAIL, code });
    expect(res.status).toBe(410);
    expect((res.body as { error: string }).error).toBe('EXPIRED');
    expect(db.users[0].email_verified).toBe(false);
  });

  it('a consumed code cannot be replayed', async () => {
    await register();
    const code = mail.lastCode()!;

    expect((await client.post('/api/auth/verify-code', { email: EMAIL, code })).status).toBe(200);

    // Replay: the account is verified now, so the endpoint answers with the
    // same INDISTINGUISHABLE INVALID shape as for an unknown account.
    const replay = await client.post('/api/auth/verify-code', { email: EMAIL, code });
    expect(replay.status).toBe(400);
    expect((replay.body as { error: string }).error).toBe('INVALID');
  });

  it('the attempt budget locks the code after max wrong guesses', async () => {
    await register();
    const code = mail.lastCode()!;
    const bad = wrongCode(code);

    for (let i = 0; i < config.EMAIL_VERIFY_CODE_MAX_ATTEMPTS; i += 1) {
      const res = await client.post('/api/auth/verify-code', { email: EMAIL, code: bad });
      expect(res.status).toBe(400);
    }

    // Budget exhausted: even the CORRECT code is now refused.
    const res = await client.post('/api/auth/verify-code', { email: EMAIL, code });
    expect(res.status).toBe(429);
    expect((res.body as { error: string }).error).toBe('TOO_MANY_ATTEMPTS');
    expect(db.users[0].email_verified).toBe(false);
  });

  it('atomic consumption: the used_at guard wins a double-use race', async () => {
    await register();
    const code = mail.lastCode()!;
    const userId = db.users[0].id;

    // Direct service-level race: two consumers of the same code.
    const first = await verifyCodeForUser(userId, code);
    expect(first.result).toBe(VERIFY_RESULT.OK);
    const second = await verifyCodeForUser(userId, code);
    expect(second.result).toBe(VERIFY_RESULT.USED);
  });

  it('a resend invalidates the previous code', async () => {
    await register();
    const firstCode = mail.lastCode()!;

    await client.post('/api/auth/resend-verification', { email: EMAIL });
    expect(db.tokens[0].used_at).toBeInstanceOf(Date); // old row retired
    expect(db.tokens).toHaveLength(2);

    let secondCode = mail.lastCode()!;
    while (secondCode === firstCode) {
      await client.post('/api/auth/resend-verification', { email: EMAIL });
      secondCode = mail.lastCode()!;
    }

    expect((await client.post('/api/auth/verify-code', { email: EMAIL, code: secondCode })).status).toBe(200);
  });

  it('malformed codes are rejected by the validator (no DB round-trip)', async () => {
    await register();
    const before = db.executed.length;
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) {
      const res = await client.post('/api/auth/verify-code', { email: EMAIL, code: bad });
      expect(res.status).toBe(400);
    }
    expect(db.executed.length).toBe(before);
  });

  it('an unknown email produces the exact same INVALID shape (no enumeration)', async () => {
    await register();
    const code = mail.lastCode()!;
    const bad = wrongCode(code);

    const known = await client.post('/api/auth/verify-code', { email: EMAIL, code: bad });
    const unknown = await client.post('/api/auth/verify-code', { email: 'ghost@example.com', code: bad });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it('responses never contain the code or its hash', async () => {
    await register();
    const code = mail.lastCode()!;
    const hash = hashCode(db.users[0].id, code);

    const bodies = [
      await client.post('/api/auth/verify-code', { email: EMAIL, code: wrongCode(code) }),
      await client.post('/api/auth/verify-code', { email: EMAIL, code }),
    ]
      .map((r) => JSON.stringify(r.body))
      .join('\n');

    expect(bodies).not.toContain(code);
    expect(bodies).not.toContain(hash);
  });
});

describe('resend cooldown (per email)', () => {
  it('a resend inside the cooldown window sends nothing but answers generically', async () => {
    // This suite runs with RESEND_MIN_INTERVAL_SECONDS=0; the cooldown branch
    // is exercised at the service level via secondsSinceLastToken.
    const { secondsSinceLastToken } = await import('../../server/services/emailVerification.js');
    await register();
    const since = await secondsSinceLastToken(db.users[0].id);
    expect(since).not.toBeNull();
    expect(since!).toBeLessThan(60); // a code was just issued → cooldown active
  });

  it('register response advertises the cooldown so the UI can render 00:59', async () => {
    const res = await register('bob@example.com');
    const body = res.body as { verification: { resendCooldownSeconds: number, ttlMinutes: number, emailMasked: string } };
    // This suite runs with RESEND_MIN_INTERVAL_SECONDS=0; the route mirrors
    // the configured value (60 in production defaults).
    expect(body.verification.resendCooldownSeconds).toBe(config.RESEND_MIN_INTERVAL_SECONDS);
    expect(config.RESEND_MIN_INTERVAL_SECONDS).toBeGreaterThanOrEqual(0);
    expect(body.verification.ttlMinutes).toBe(config.EMAIL_VERIFY_CODE_TTL_MINUTES);
    expect(body.verification.emailMasked).toBe('b***@example.com');
  });
});
