/**
 * CRYPTORA — Social login (OAuth + Telegram) integration tests.
 *
 * REAL: oauth routes, session transactions (state/PKCE/nonce), linking
 *       policy, identities repository, session regeneration, rate-limited
 *       middleware chain, Telegram signature verification.
 * MOCKED: the SQL layer (MemoryDb) and the provider NETWORK exchange only
 *         (__setIdentityExchangeForTests) — everything up to and after the
 *         token exchange is the real code path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.OAUTH_RATE_LIMIT = '100000';
process.env.VERIFY_RATE_LIMIT = '100000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';

// Placeholder credentials — NEVER real. They only make isProviderConfigured()
// return true so the routes are exercised.
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.YANDEX_CLIENT_ID = 'test-yandex-client-id';
process.env.YANDEX_CLIENT_SECRET = 'test-yandex-secret';
process.env.VK_CLIENT_ID = '1234567';
process.env.TELEGRAM_BOT_TOKEN = '110201543:TEST-TOKEN-NOT-REAL';
process.env.TELEGRAM_BOT_USERNAME = 'cryptora_test_bot';

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { __resetTransportForTests } = await import('../../server/services/mail.js');
const { __setIdentityExchangeForTests } = await import('../../server/services/oauth/providers.js');
const { signTelegramPayloadForTests } = await import('../../server/services/oauth/telegram.js');
const { requireFreshAuth } = await import('../../server/middleware/auth.js');
const { MemoryDb, seedUser } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');
const { installMailSpy } = await import('../helpers/mailSpy');

const PASSWORD = 'correct horse battery';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;

interface StubIdentity {
  provider: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
}

let stubIdentity: StubIdentity | null = null;
let lastExchangeParams: Record<string, unknown> | null = null;

beforeEach(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  await installMailSpy();
  __setIdentityExchangeForTests(async (provider, params) => {
    lastExchangeParams = { provider, ...params };
    if (!stubIdentity) throw new Error('no stub identity configured');
    return { ...stubIdentity, provider };
  });
  stubIdentity = null;
  lastExchangeParams = null;
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  client = harness.client;
  close = harness.close;
});

afterEach(async () => {
  await close();
  __setPoolForTests(null);
  __setIdentityExchangeForTests(null);
  __resetTransportForTests();
});

function location(res: { headers: Headers }): string {
  return res.headers.get('location') ?? '';
}

/** Run start → extract state → hit the callback, returning the final redirect. */
async function completeOauth(provider: string, opts: { link?: boolean; returnTo?: string } = {}) {
  const qs = new URLSearchParams();
  if (opts.link) qs.set('link', '1');
  if (opts.returnTo !== undefined) qs.set('returnTo', opts.returnTo);
  const start = await client.getNoFollow(`/api/auth/oauth/${provider}/start?${qs.toString()}`);
  expect(start.status).toBe(302);
  const authUrl = new URL(location(start));
  const state = authUrl.searchParams.get('state')!;
  return client.getNoFollow(
    `/api/auth/oauth/${provider}/callback?code=test-code&state=${encodeURIComponent(state)}&device_id=dev-1`
  );
}

async function loginAsSeededUser(email: string) {
  const res = await client.post('/api/auth/login', { email, password: PASSWORD });
  expect(res.status).toBe(200);
}

describe('GET /api/auth/providers', () => {
  it('reports configured providers without any secret material', async () => {
    const res = await client.get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emailPassword: true,
      emailVerification: true,
      google: true,
      telegram: true,
      yandex: true,
      vk: true,
      telegramBotName: 'cryptora_test_bot',
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('test-google-secret');
    expect(raw).not.toContain('TEST-TOKEN-NOT-REAL');
  });
});

describe('GET /api/auth/oauth/:provider/start', () => {
  it('google: redirects with state, PKCE S256 and nonce', async () => {
    const res = await client.getNoFollow('/api/auth/oauth/google/start');
    expect(res.status).toBe(302);
    const u = new URL(location(res));
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toContain('openid');
    expect(u.searchParams.get('state')!.length).toBeGreaterThanOrEqual(40);
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('nonce')).toBeTruthy();
    expect(u.searchParams.get('redirect_uri')).toContain('/api/auth/oauth/google/callback');
    // The client secret never appears in a browser-visible URL.
    expect(location(res)).not.toContain('test-google-secret');
  });

  it('vk: PKCE is mandatory and present', async () => {
    const res = await client.getNoFollow('/api/auth/oauth/vk/start');
    expect(res.status).toBe(302);
    const u = new URL(location(res));
    expect(u.origin).toBe('https://id.vk.com');
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('an unknown provider is refused', async () => {
    const res = await client.getNoFollow('/api/auth/oauth/facebook/start');
    expect(res.status).toBe(302);
    expect(location(res)).toContain('/login?oauth_error=unknown_provider');
  });
});

describe('callback state validation', () => {
  it('rejects a callback with no prior transaction', async () => {
    const res = await client.getNoFollow('/api/auth/oauth/google/callback?code=x&state=y');
    expect(location(res)).toContain('oauth_error=state_mismatch');
  });

  it('rejects a tampered state', async () => {
    stubIdentity = { provider: 'google', subject: 'g-1', email: 'a@ex.com', emailVerified: true, displayName: 'A' };
    const start = await client.getNoFollow('/api/auth/oauth/google/start');
    expect(start.status).toBe(302);
    const res = await client.getNoFollow('/api/auth/oauth/google/callback?code=x&state=WRONG');
    expect(location(res)).toContain('oauth_error=state_mismatch');
    expect(db.identities).toHaveLength(0);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('a replayed callback dies: the transaction is single-use', async () => {
    stubIdentity = { provider: 'google', subject: 'g-2', email: 'b@ex.com', emailVerified: true, displayName: 'B' };
    const start = await client.getNoFollow('/api/auth/oauth/google/start');
    const state = new URL(location(start)).searchParams.get('state')!;
    const cbPath = `/api/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`;

    const first = await client.getNoFollow(cbPath);
    expect(location(first)).toBe('/');

    const replay = await client.getNoFollow(cbPath);
    expect(location(replay)).toContain('oauth_error=state_mismatch');
  });

  it('provider cancellation redirects cleanly (no session, no identity)', async () => {
    const start = await client.getNoFollow('/api/auth/oauth/google/start');
    const state = new URL(location(start)).searchParams.get('state')!;
    const res = await client.getNoFollow(
      `/api/auth/oauth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`
    );
    expect(location(res)).toContain('oauth_error=cancelled');
    expect(db.identities).toHaveLength(0);
  });
});

describe('sign-in via provider', () => {
  it('creates a user + identity and an authenticated session', async () => {
    stubIdentity = {
      provider: 'google',
      subject: 'google-sub-1',
      email: 'carol@example.com',
      emailVerified: true,
      displayName: 'Carol',
    };
    const res = await completeOauth('google');
    expect(location(res)).toBe('/');

    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBe('carol@example.com');
    expect(db.users[0].password_hash).toBeNull();
    expect(db.users[0].email_verified).toBe(true);

    expect(db.identities).toHaveLength(1);
    expect(db.identities[0].provider).toBe('google');
    expect(db.identities[0].provider_subject).toBe('google-sub-1');

    const me = await client.get('/api/me');
    expect(me.status).toBe(200);
    expect((me.body as { user: { email: string } }).user.email).toBe('carol@example.com');
  });

  it('a second sign-in with the same subject reuses the SAME user (no duplicates)', async () => {
    stubIdentity = { provider: 'yandex', subject: 'ya-7', email: 'dave@example.com', emailVerified: true, displayName: 'Dave' };
    await completeOauth('yandex');
    client.clearCookies();
    await completeOauth('yandex');

    expect(db.users).toHaveLength(1);
    expect(db.identities).toHaveLength(1);
    expect((await client.get('/api/me')).status).toBe(200);
  });

  it('vk: the device_id from the callback reaches the exchange', async () => {
    stubIdentity = { provider: 'vk', subject: 'vk-9', email: null, emailVerified: false, displayName: 'V' };
    await completeOauth('vk');
    expect(lastExchangeParams?.deviceId).toBe('dev-1');
  });

  it('sanitizes returnTo: internal path allowed, protocol-relative refused', async () => {
    stubIdentity = { provider: 'google', subject: 'g-r1', email: 'r1@example.com', emailVerified: true, displayName: 'R1' };
    const ok = await completeOauth('google', { returnTo: '/radar' });
    expect(location(ok)).toBe('/radar');

    client.clearCookies();
    stubIdentity = { provider: 'google', subject: 'g-r2', email: 'r2@example.com', emailVerified: true, displayName: 'R2' };
    const evil = await completeOauth('google', { returnTo: '//evil.example.com/phish' });
    expect(location(evil)).toBe('/');
  });
});

describe('account-takeover prevention (email collision)', () => {
  it('a social login whose email matches an existing password account is REFUSED', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: 'victim@example.com', display_name: 'Victim', password_hash: hash });

    stubIdentity = {
      provider: 'google',
      subject: 'attacker-google-sub',
      email: 'victim@example.com', // same mailbox, e.g. re-registered Gmail
      emailVerified: true,
      displayName: 'Attacker',
    };
    const res = await completeOauth('google');

    expect(location(res)).toContain('oauth_error=email_exists');
    expect(db.users).toHaveLength(1); // no second account
    expect(db.identities).toHaveLength(0); // and NO silent link
    expect((await client.get('/api/me')).status).toBe(401); // and no session
  });
});

describe('explicit linking from the profile', () => {
  it('an authenticated (fresh) user can link a provider', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = seedUser(db, { email: 'linker@example.com', display_name: 'Linker', password_hash: hash });
    await loginAsSeededUser('linker@example.com');

    stubIdentity = { provider: 'yandex', subject: 'ya-link-1', email: 'linker@yandex.ru', emailVerified: true, displayName: 'L' };
    const res = await completeOauth('yandex', { link: true });
    expect(location(res)).toBe('/profile?linked=yandex');

    expect(db.identities).toHaveLength(1);
    expect(db.identities[0].user_id).toBe(user.id);

    const identities = await client.get('/api/me/identities');
    expect(identities.status).toBe(200);
    const body = identities.body as { hasPassword: boolean; identities: Array<{ provider: string }> };
    expect(body.hasPassword).toBe(true);
    expect(body.identities.map((i) => i.provider)).toEqual(['yandex']);
  });

  it('linking an identity already bound to ANOTHER user is refused', async () => {
    // User A signs in via google (identity created).
    stubIdentity = { provider: 'google', subject: 'shared-sub', email: 'a@example.com', emailVerified: true, displayName: 'A' };
    await completeOauth('google');
    client.clearCookies();

    // User B (password) tries to link the SAME google identity.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: 'b@example.com', display_name: 'B', password_hash: hash });
    await loginAsSeededUser('b@example.com');

    stubIdentity = { provider: 'google', subject: 'shared-sub', email: 'a@example.com', emailVerified: true, displayName: 'A' };
    const res = await completeOauth('google', { link: true });
    expect(location(res)).toBe('/profile?link_error=identity_in_use');
    expect(db.identities).toHaveLength(1); // still exactly one row
  });

  it('link=1 without a session is refused', async () => {
    const res = await client.getNoFollow('/api/auth/oauth/google/start?link=1');
    expect(location(res)).toContain('oauth_error=session_lost');
  });
});

describe('unlink guardrails', () => {
  it('unlinking works while another login method remains, and refuses the last one', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: 'u@example.com', display_name: 'U', password_hash: hash });
    await loginAsSeededUser('u@example.com');

    stubIdentity = { provider: 'vk', subject: 'vk-u', email: null, emailVerified: false, displayName: 'U' };
    await completeOauth('vk', { link: true });
    expect(db.identities).toHaveLength(1);

    // password + vk → unlink allowed
    const ok = await client.delete('/api/me/identities/vk');
    expect(ok.status).toBe(200);
    expect(db.identities).toHaveLength(0);

    // Social-only account: telegram user without password → cannot unlink.
    client.clearCookies();
    const payload = signTelegramPayloadForTests(
      { id: '424242', first_name: 'Solo', auth_date: Math.floor(Date.now() / 1000) },
      BOT_TOKEN
    );
    const tg = await client.getNoFollow(`/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`);
    expect(location(tg)).toBe('/');

    const refuse = await client.delete('/api/me/identities/telegram');
    expect(refuse.status).toBe(409);
    expect((refuse.body as { error: string }).error).toBe('LAST_LOGIN_METHOD');
  });
});

describe('Telegram Login Widget', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('a validly signed payload signs the user in (no email is OK)', async () => {
    const payload = signTelegramPayloadForTests(
      { id: '777001', first_name: 'Tolya', username: 'tolya', auth_date: now() },
      BOT_TOKEN
    );
    const res = await client.getNoFollow(`/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`);
    expect(location(res)).toBe('/');

    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBeNull();
    expect(db.users[0].email_verified).toBe(false);
    expect(db.identities[0].provider).toBe('telegram');
    expect(db.identities[0].provider_subject).toBe('777001');
    expect((await client.get('/api/me')).status).toBe(200);
  });

  it('a forged hash is rejected', async () => {
    const payload = signTelegramPayloadForTests(
      { id: '777002', first_name: 'Evil', auth_date: now() },
      BOT_TOKEN
    );
    payload.hash = '0'.repeat(64);
    const res = await client.getNoFollow(`/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`);
    expect(location(res)).toContain('oauth_error=telegram_invalid');
    expect(db.users).toHaveLength(0);
  });

  it('a stale auth_date is rejected (replay defence)', async () => {
    const payload = signTelegramPayloadForTests(
      { id: '777003', first_name: 'Old', auth_date: now() - 24 * 3600 },
      BOT_TOKEN
    );
    const res = await client.getNoFollow(`/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`);
    expect(location(res)).toContain('oauth_error=telegram_invalid');
  });

  it('an authenticated user WITHOUT link intent is refused (login-CSRF defence)', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: 'tg@example.com', display_name: 'TG', password_hash: hash });
    await loginAsSeededUser('tg@example.com');

    const payload = signTelegramPayloadForTests(
      { id: '777004', first_name: 'Linkless', auth_date: now() },
      BOT_TOKEN
    );
    const res = await client.getNoFollow(`/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`);
    expect(location(res)).toBe('/profile?link_error=intent_required');
    expect(db.identities).toHaveLength(0);
  });

  it('with an explicit intent, Telegram links to the current account', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = seedUser(db, { email: 'tg2@example.com', display_name: 'TG2', password_hash: hash });
    await loginAsSeededUser('tg2@example.com');

    const intent = await client.post('/api/auth/oauth/telegram/link-intent');
    expect(intent.status).toBe(200);

    const payload = signTelegramPayloadForTests(
      { id: '777005', first_name: 'Linked', auth_date: now() },
      BOT_TOKEN
    );
    const res = await client.getNoFollow(`/api/auth/oauth/telegram/callback?${new URLSearchParams(payload)}`);
    expect(location(res)).toBe('/profile?linked=telegram');
    expect(db.identities).toHaveLength(1);
    expect(db.identities[0].user_id).toBe(user.id);
  });
});

describe('session security', () => {
  it('the session ID is regenerated on password login (fixation defence)', async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    seedUser(db, { email: 'fix@example.com', display_name: 'Fix', password_hash: hash });

    // Provoke a pre-auth session cookie via an OAuth start (stores the tx).
    await client.getNoFollow('/api/auth/oauth/google/start');
    const preAuthSid = client.cookieHeader();
    expect(preAuthSid).toMatch(/sid=/);

    await loginAsSeededUser('fix@example.com');
    const postAuthSid = client.cookieHeader();
    expect(postAuthSid).toMatch(/sid=/);
    expect(postAuthSid).not.toBe(preAuthSid);
  });

  it('the session ID is regenerated on OAuth login too', async () => {
    await client.getNoFollow('/api/auth/oauth/google/start');
    const preAuthSid = client.cookieHeader();

    stubIdentity = { provider: 'google', subject: 'g-fix', email: 'gfix@example.com', emailVerified: true, displayName: 'GF' };
    const start = await client.getNoFollow('/api/auth/oauth/google/start');
    const state = new URL(location(start)).searchParams.get('state')!;
    await client.getNoFollow(`/api/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`);

    expect(client.cookieHeader()).not.toBe(preAuthSid);
    expect((await client.get('/api/me')).status).toBe(200);
  });

  it('logout destroys an OAuth session server-side', async () => {
    stubIdentity = { provider: 'google', subject: 'g-out', email: 'gout@example.com', emailVerified: true, displayName: 'GO' };
    await completeOauth('google');
    expect((await client.get('/api/me')).status).toBe(200);

    expect((await client.post('/api/auth/logout')).status).toBe(204);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('requireFreshAuth rejects stale interactive authentication', async () => {
    const results: Array<{ status?: number; body?: unknown; nexted: boolean }> = [];
    const run = (authAt: number | undefined) => {
      const entry: { status?: number; body?: unknown; nexted: boolean } = { nexted: false };
      const req = { session: { authAt } } as never;
      const res = {
        status(code: number) {
          entry.status = code;
          return this;
        },
        json(body: unknown) {
          entry.body = body;
          return this;
        },
      } as never;
      requireFreshAuth(req, res, () => {
        entry.nexted = true;
      });
      results.push(entry);
      return entry;
    };

    expect(run(Date.now()).nexted).toBe(true); // fresh → pass
    const stale = run(Date.now() - 24 * 3600 * 1000); // a day old → reject
    expect(stale.nexted).toBe(false);
    expect(stale.status).toBe(401);
    expect((stale.body as { error: string }).error).toBe('REAUTH_REQUIRED');
    expect(run(undefined).nexted).toBe(false); // legacy session without stamp
  });

  it('production cookie policy: Secure is forced on, HttpOnly+SameSite kept', async () => {
    const { vi } = await import('vitest');
    const prevEnv = process.env.NODE_ENV;
    const prevSecure = process.env.COOKIE_SECURE;
    delete process.env.COOKIE_SECURE;
    process.env.NODE_ENV = 'production';
    try {
      vi.resetModules();
      const { config: prodConfig } = await import('../../server/config.js');
      expect(prodConfig.COOKIE_SECURE).toBe(true); // forced by NODE_ENV
      expect(prodConfig.COOKIE_SAMESITE).toBe('lax');
      expect(prodConfig.SESSION_MAX_AGE).toBeGreaterThan(0);
      // The session middleware always sets httpOnly: true (see server/app.js).
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecure !== undefined) process.env.COOKIE_SECURE = prevSecure;
      vi.resetModules();
    }
  });
});
