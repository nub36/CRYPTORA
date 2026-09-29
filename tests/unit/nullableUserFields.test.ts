/**
 * CRYPTORA — Regression suite for nullable users.email / users.password_hash.
 *
 * Migration 013 relaxed both columns to NULL for social-only accounts
 * (Telegram has no email; social sign-ins have no password). Every code path
 * that previously assumed the columns were NOT NULL must keep working:
 * login, session serialization, /api/me, admin (list/search/block/audit),
 * mail (resend), and the login-method guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.VERIFY_RATE_LIMIT = '100000';
process.env.RESEND_RATE_LIMIT = '100000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';
process.env.OAUTH_RATE_LIMIT = '100000';
process.env.TELEGRAM_BOT_TOKEN = '110201543:TEST-TOKEN-NOT-REAL';
process.env.TELEGRAM_BOT_USERNAME = 'cryptora_test_bot';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { __resetTransportForTests } = await import('../../server/services/mail.js');
const { signTelegramPayloadForTests } = await import('../../server/services/oauth/telegram.js');
const { MemoryDb, seedUser } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');
const { installMailSpy } = await import('../helpers/mailSpy');

const PASSWORD = 'correct horse battery';

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;
let mail: Awaited<ReturnType<typeof installMailSpy>>;

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  __resetTransportForTests();
  mail = await installMailSpy();
  const app = createApp();
  ({ client, close } = await listen(app));
});

afterEach(async () => {
  await close();
  __setPoolForTests(null);
  mail.reset();
});

/** Telegram-style account: no email, no password. */
function seedTelegramOnlyUser() {
  const user = seedUser(db, {
    email: null,
    password_hash: null,
    display_name: 'TG Only',
    email_verified: false,
    email_verified_at: null,
  });
  db.identities.push({
    id: `ident-${user.id}`,
    user_id: user.id,
    provider: 'telegram',
    provider_subject: '424242',
    provider_email: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return user;
}

/** Google-style account: email present + verified, but NO password hash. */
function seedSocialUserWithEmail(email = 'social@example.com') {
  const user = seedUser(db, {
    email,
    password_hash: null,
    display_name: 'Social User',
    email_verified: true,
  });
  db.identities.push({
    id: `ident-${user.id}`,
    user_id: user.id,
    provider: 'google',
    provider_subject: 'g-123',
    provider_email: email,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return user;
}

/** Authenticate the client AS the seeded telegram-only user via the real widget callback. */
async function loginTelegramOnlyUser(): Promise<ReturnType<typeof seedTelegramOnlyUser>> {
  const user = seedTelegramOnlyUser();
  const payload = signTelegramPayloadForTests(
    { id: '424242', first_name: 'TG', auth_date: Math.floor(Date.now() / 1000) },
    process.env.TELEGRAM_BOT_TOKEN!
  );
  const res = await client.getNoFollow(
    `/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`
  );
  expect(res.status).toBe(302); // logged in, redirected home
  return user;
}

async function loginAsAdmin(): Promise<void> {
  seedUser(db, {
    email: 'admin@example.com',
    display_name: 'Admin',
    password_hash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    role: 'admin',
  });
  const res = await client.post('/api/auth/login', {
    email: 'admin@example.com',
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
}

describe('login — password_hash NULL never crashes or authenticates', () => {
  it('password login against a social-only account (email set, hash NULL) → generic 401', async () => {
    seedSocialUserWithEmail();
    const res = await client.post('/api/auth/login', {
      email: 'social@example.com',
      password: 'whatever-password',
    });
    expect(res.status).toBe(401); // NOT 500, and no type disclosure
    expect((res.body as { error: string }).error).toBe('Неверный email или пароль');
  });

  it('the generic 401 is byte-identical to the unknown-email 401 (no enumeration)', async () => {
    seedSocialUserWithEmail();
    const social = await client.post('/api/auth/login', {
      email: 'social@example.com',
      password: 'x'.repeat(12),
    });
    const unknown = await client.post('/api/auth/login', {
      email: 'ghost@example.com',
      password: 'x'.repeat(12),
    });
    expect(social.status).toBe(unknown.status);
    expect(social.body).toEqual(unknown.body);
  });

  it('email NULL accounts are unreachable via password login (lookup by email)', async () => {
    seedTelegramOnlyUser();
    const res = await client.post('/api/auth/login', {
      email: 'tg-only@example.com',
      password: 'irrelevant-pass',
    });
    expect(res.status).toBe(401);
  });
});

describe('serialization — email NULL flows through as null, never crashes', () => {
  it('GET /api/me returns email: null for a Telegram-only session', async () => {
    await loginTelegramOnlyUser();
    const res = await client.get('/api/me');
    expect(res.status).toBe(200);
    const body = res.body as { user: { email: string | null; displayName: string } };
    expect(body.user.email).toBeNull();
    expect(body.user.displayName).toBe('TG Only');
  });

  it('GET /api/auth/session serializes the null email', async () => {
    await loginTelegramOnlyUser();
    const res = await client.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect((res.body as { user: { email: string | null } }).user.email).toBeNull();
  });

  it('GET /api/me/identities works for a password-less account', async () => {
    await loginTelegramOnlyUser();
    const res = await client.get('/api/me/identities');
    expect(res.status).toBe(200);
    const body = res.body as { hasPassword: boolean; identities: Array<{ provider: string }> };
    expect(body.hasPassword).toBe(false);
    expect(body.identities.map((i) => i.provider)).toEqual(['telegram']);
  });
});

describe('admin — user list, search, block and audit tolerate NULL fields', () => {
  it('admin user list includes NULL-email users without crashing', async () => {
    seedTelegramOnlyUser();
    await loginAsAdmin();
    const res = await client.get('/api/admin/users');
    expect(res.status).toBe(200);
    const body = res.body as { users: Array<{ email: string | null; displayName: string }> };
    const tg = body.users.find((u) => u.displayName === 'TG Only');
    expect(tg).toBeDefined();
    expect(tg!.email).toBeNull();
  });

  it('admin search by email does not crash on NULL-email rows', async () => {
    seedTelegramOnlyUser();
    seedSocialUserWithEmail();
    await loginAsAdmin();
    const res = await client.get('/api/admin/users?search=social');
    expect(res.status).toBe(200);
    const body = res.body as { users: Array<{ email: string | null }> };
    expect(body.users.some((u) => u.email === 'social@example.com')).toBe(true);
  });

  it('blocking a NULL-email user writes an audit row with null target email', async () => {
    const user = seedTelegramOnlyUser();
    await loginAsAdmin();
    const res = await client.patch(`/api/admin/users/${user.id}/block`, {});
    expect(res.status).toBe(200);
    const entry = db.audit.find((a) => a.action === 'USER_BLOCK');
    expect(entry).toBeDefined();
    // metadata.targetEmail is null — JSON-serializable, no crash.
    expect((entry!.metadata as { targetEmail: string | null }).targetEmail).toBeNull();
  });
});

describe('mail — NULL-email accounts never reach the transport', () => {
  it('resend-verification cannot target a NULL-email account and stays generic', async () => {
    seedTelegramOnlyUser();
    const res = await client.post('/api/auth/resend-verification', {
      email: 'someone-else@example.com',
    });
    expect(res.status).toBe(200); // anti-enumeration generic answer
    expect(mail.sent.length).toBe(0); // nothing was ever handed to the transport
  });
});
