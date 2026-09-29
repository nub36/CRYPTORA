/**
 * CRYPTORA — Social login routes (Google / Yandex / VK ID / Telegram)
 *
 * GET  /api/auth/oauth/:provider/start      — begin the redirect dance
 *                                             (?link=1 to attach to the
 *                                             current account, ?returnTo=/x)
 * GET  /api/auth/oauth/:provider/callback   — provider redirect target
 * POST /api/auth/oauth/telegram/link-intent — CSRF-protected, fresh-auth
 *                                             gate before linking Telegram
 * GET  /api/auth/oauth/telegram/callback    — Telegram Login Widget target
 *
 * SECURITY MODEL
 *   - state (256-bit) + PKCE S256 + OIDC nonce, stored in a SHORT-LIVED
 *     server-side session transaction, deleted BEFORE the code exchange —
 *     a replayed callback finds no transaction and dies (replay protection).
 *   - state comparison is constant-time.
 *   - Exact redirect-URI allowlist: URIs are computed from APP_ORIGIN only.
 *   - Token exchange is server-side; secrets never reach the frontend.
 *   - providerUserId/email/name are taken ONLY from the provider's verified
 *     server-side response — never from anything the browser sent.
 *   - returnTo is sanitized to an internal path (no open redirect).
 *
 * ACCOUNT LINKING POLICY (takeover-safe)
 *   - identity known → sign that user in.
 *   - identity unknown + provider email matches an EXISTING account →
 *     REFUSED. No silent merge: the user must sign in with their password
 *     and link the provider explicitly from the profile page.
 *   - identity unknown + no email collision → a new account is created.
 *   - explicit linking requires an authenticated session WITH fresh
 *     authentication (requireFreshAuth semantics).
 *   - Telegram gives no email — accounts created from Telegram simply have
 *     none until the user adds one (email-dependent features check that).
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { oauthLimiter } from '../middleware/rateLimit.js';
import {
  OAUTH_PROVIDERS,
  isProviderConfigured,
  buildAuthorizationUrl,
  generatePkcePair,
  generateState,
  generateNonce,
  exchangeCodeForIdentity,
  OAuthExchangeError,
} from '../services/oauth/providers.js';
import { verifyTelegramLogin } from '../services/oauth/telegram.js';
import {
  findIdentity,
  createIdentity,
  createUserFromProvider,
} from '../services/authIdentities.js';
import { establishSession } from '../services/sessionAuth.js';

const router = Router();

/** Auth transactions older than this are dead (short-lived by design). */
const TX_MAX_AGE_MS = 10 * 60 * 1000;
/** A Telegram link intent is valid this long after the profile click. */
const TELEGRAM_LINK_INTENT_MAX_AGE_MS = 10 * 60 * 1000;

/* ── helpers ───────────────────────────────────────────────────────────── */

/**
 * Only internal paths may be redirect targets after login.
 * Rejects absolute URLs, protocol-relative URLs ("//evil"), backslash
 * tricks and anything not starting with a single "/".
 */
export function sanitizeReturnTo(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  if (/[\u0000-\u001f]/.test(raw)) return '/';
  return raw;
}

function timingSafeStringEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function loginErrorRedirect(res, code) {
  return res.redirect(302, `/login?oauth_error=${encodeURIComponent(code)}`);
}

function linkErrorRedirect(res, code) {
  return res.redirect(302, `/profile?link_error=${encodeURIComponent(code)}`);
}

async function saveSession(req) {
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function isFreshlyAuthenticated(req) {
  const authAt = req.session?.authAt;
  const maxAgeMs = config.FRESH_AUTH_MAX_AGE_MINUTES * 60 * 1000;
  return typeof authAt === 'number' && Date.now() - authAt <= maxAgeMs;
}

async function loadActiveUser(userId) {
  const res = await query(
    `SELECT id, email, display_name, role, is_active, email_verified, email_verified_at,
            created_at, last_login_at
     FROM users WHERE id = $1`,
    [userId]
  );
  const user = res.rows[0];
  if (!user || !user.is_active) return null;
  return user;
}

/**
 * Shared post-verification logic for every provider (OAuth and Telegram):
 * takes a SERVER-VERIFIED identity and either links it, signs the user in,
 * or creates an account — following the takeover-safe policy above.
 *
 * @returns {Promise<{ redirect: string }>}
 */
async function resolveVerifiedIdentity(req, { provider, subject, email, emailVerified, displayName, mode, linkUserId, returnTo }) {
  const existingIdentity = await findIdentity(provider, subject);

  /* ── explicit linking to the current account ── */
  if (mode === 'link') {
    if (!req.session.userId || req.session.userId !== linkUserId) {
      return { redirect: '/login?oauth_error=session_lost' };
    }
    if (existingIdentity) {
      return existingIdentity.user_id === req.session.userId
        ? { redirect: `/profile?linked=${provider}` } // idempotent
        : { redirect: '/profile?link_error=identity_in_use' };
    }
    try {
      await createIdentity({
        userId: req.session.userId,
        provider,
        providerSubject: subject,
        providerEmail: email ?? null,
      });
    } catch {
      // Unique-constraint race: someone linked this identity concurrently.
      return { redirect: '/profile?link_error=identity_in_use' };
    }
    return { redirect: `/profile?linked=${provider}` };
  }

  /* ── sign-in with a known identity ── */
  if (existingIdentity) {
    const user = await loadActiveUser(existingIdentity.user_id);
    if (!user) return { redirect: '/login?oauth_error=blocked' };

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await establishSession(req, user);
    return { redirect: returnTo };
  }

  /* ── unknown identity: account creation, takeover-safe ── */
  if (email) {
    const collision = await query(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [email]
    );
    if (collision.rows.length > 0) {
      // An account with this email already exists. NEVER auto-link on email —
      // require an authenticated, explicit link from the profile page.
      return { redirect: '/login?oauth_error=email_exists' };
    }
  }

  if (!config.REGISTRATION_ENABLED) {
    return { redirect: '/login?oauth_error=registration_closed' };
  }

  const user = await createUserFromProvider({
    email: email ?? null,
    displayName: displayName || 'Пользователь',
    // Trust the provider's attestation ONLY for brand-new accounts (no
    // existing account can be taken over by construction of this branch).
    emailVerified: Boolean(email) && emailVerified === true,
  });

  try {
    await createIdentity({
      userId: user.id,
      provider,
      providerSubject: subject,
      providerEmail: email ?? null,
    });
  } catch {
    return { redirect: '/login?oauth_error=exchange_failed' };
  }

  await establishSession(req, user);
  return { redirect: returnTo };
}

/* ══════════════════════════════════════════════════════════════════════ */
/* Telegram (Login Widget — not an OAuth redirect flow)                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/auth/oauth/telegram/link-intent
 *
 * The widget calls back with a GET, which our CSRF middleware cannot guard.
 * Linking therefore requires this CSRF-protected, fresh-auth POST first —
 * without a recent intent an authenticated Telegram callback refuses to link.
 */
router.post('/telegram/link-intent', oauthLimiter, async (req, res) => {
  if (!isProviderConfigured('telegram')) {
    return res.status(404).json({ error: 'PROVIDER_NOT_CONFIGURED' });
  }
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  if (!isFreshlyAuthenticated(req)) {
    return res.status(401).json({
      error: 'REAUTH_REQUIRED',
      message: 'Для этого действия войдите в аккаунт заново',
    });
  }
  req.session.telegramLinkIntentAt = Date.now();
  await saveSession(req);
  res.json({ status: 'ok' });
});

/** GET /api/auth/oauth/telegram/callback — Login Widget data-auth-url target. */
router.get('/telegram/callback', oauthLimiter, async (req, res, next) => {
  try {
    if (!isProviderConfigured('telegram')) {
      return loginErrorRedirect(res, 'not_configured');
    }

    const verdict = verifyTelegramLogin(
      req.query,
      config.TELEGRAM_BOT_TOKEN,
      config.TELEGRAM_AUTH_MAX_AGE_SECONDS
    );
    if (!verdict.ok) {
      // Signature/freshness failures carry no detail to the browser.
      return loginErrorRedirect(res, 'telegram_invalid');
    }

    const tg = verdict.user;
    const displayName =
      [tg.firstName, tg.lastName].filter(Boolean).join(' ').trim() ||
      (tg.username ? `@${tg.username}` : 'Telegram user');

    let mode = 'login';
    let linkUserId = null;
    if (req.session?.userId) {
      const intentAt = req.session.telegramLinkIntentAt;
      const fresh =
        typeof intentAt === 'number' &&
        Date.now() - intentAt <= TELEGRAM_LINK_INTENT_MAX_AGE_MS;
      if (!fresh) {
        // Authenticated but no explicit intent → refuse (login-CSRF defence).
        return linkErrorRedirect(res, 'intent_required');
      }
      mode = 'link';
      linkUserId = req.session.userId;
      delete req.session.telegramLinkIntentAt; // single-use
      await saveSession(req);
    }

    const { redirect } = await resolveVerifiedIdentity(req, {
      provider: 'telegram',
      subject: tg.id,
      email: null, // Telegram never provides an email — expected case
      emailVerified: false,
      displayName,
      mode,
      linkUserId,
      returnTo: '/',
    });
    return res.redirect(302, redirect);
  } catch (err) {
    next(err);
  }
});

/* ══════════════════════════════════════════════════════════════════════ */
/* OAuth redirect providers: google / yandex / vk                         */
/* ══════════════════════════════════════════════════════════════════════ */

/** GET /api/auth/oauth/:provider/start */
router.get('/:provider/start', oauthLimiter, async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    if (!OAUTH_PROVIDERS.includes(provider)) {
      return loginErrorRedirect(res, 'unknown_provider');
    }
    if (!isProviderConfigured(provider)) {
      return loginErrorRedirect(res, 'not_configured');
    }

    const wantsLink = req.query.link === '1';
    if (wantsLink) {
      if (!req.session?.userId) return loginErrorRedirect(res, 'session_lost');
      if (!isFreshlyAuthenticated(req)) return linkErrorRedirect(res, 'reauth_required');
    }

    const state = generateState();
    const { verifier, challenge } = generatePkcePair();
    const nonce = provider === 'google' ? generateNonce() : undefined;

    // Short-lived, single-use, server-side transaction.
    req.session.oauthTx = {
      provider,
      state,
      verifier,
      nonce: nonce ?? null,
      mode: wantsLink ? 'link' : 'login',
      linkUserId: wantsLink ? req.session.userId : null,
      returnTo: sanitizeReturnTo(req.query.returnTo),
      createdAt: Date.now(),
    };
    await saveSession(req);

    const url = buildAuthorizationUrl(provider, { state, codeChallenge: challenge, nonce });
    return res.redirect(302, url);
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/oauth/:provider/callback */
router.get('/:provider/callback', oauthLimiter, async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    if (!OAUTH_PROVIDERS.includes(provider)) {
      return loginErrorRedirect(res, 'unknown_provider');
    }
    if (!isProviderConfigured(provider)) {
      return loginErrorRedirect(res, 'not_configured');
    }

    // The transaction is consumed FIRST — a replayed callback finds nothing.
    const tx = req.session?.oauthTx;
    delete req.session.oauthTx;
    await saveSession(req);

    if (!tx || tx.provider !== provider) {
      return loginErrorRedirect(res, 'state_mismatch');
    }
    if (typeof tx.createdAt !== 'number' || Date.now() - tx.createdAt > TX_MAX_AGE_MS) {
      return loginErrorRedirect(res, 'state_expired');
    }
    if (!timingSafeStringEqual(req.query.state, tx.state)) {
      return loginErrorRedirect(res, 'state_mismatch');
    }

    const failRedirect = (code) =>
      tx.mode === 'link' ? linkErrorRedirect(res, code) : loginErrorRedirect(res, code);

    if (req.query.error || !req.query.code) {
      // User cancelled on the provider screen (or provider-side error).
      return failRedirect('cancelled');
    }

    let identity;
    try {
      identity = await exchangeCodeForIdentity(provider, {
        code: String(req.query.code),
        codeVerifier: tx.verifier,
        nonce: tx.nonce ?? undefined,
        deviceId: req.query.device_id ? String(req.query.device_id) : undefined,
        state: tx.state,
      });
    } catch (err) {
      const reason = err instanceof OAuthExchangeError ? err.message : 'exchange error';
      console.warn(`[oauth] ${provider} exchange failed: ${reason}`);
      return failRedirect('exchange_failed');
    }

    // Defence in depth: the adapter must return the provider we asked for.
    if (identity.provider !== provider || !identity.subject) {
      return failRedirect('exchange_failed');
    }

    const { redirect } = await resolveVerifiedIdentity(req, {
      provider,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
      mode: tx.mode,
      linkUserId: tx.linkUserId,
      returnTo: sanitizeReturnTo(tx.returnTo),
    });
    return res.redirect(302, redirect);
  } catch (err) {
    next(err);
  }
});

export default router;
