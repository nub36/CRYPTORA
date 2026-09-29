/**
 * CRYPTORA — OAuth / OIDC provider adapters
 *
 * Current OFFICIAL flows (verified against provider documentation):
 *   - Google : OpenID Connect authorization-code flow + PKCE (S256) + nonce.
 *              authz  https://accounts.google.com/o/oauth2/v2/auth
 *              token  https://oauth2.googleapis.com/token
 *              Identity from the ID token (iss/aud/exp/nonce validated).
 *   - Yandex : OAuth 2.0 authorization-code flow + PKCE (S256).
 *              authz  https://oauth.yandex.ru/authorize
 *              token  https://oauth.yandex.ru/token
 *              user   https://login.yandex.ru/info?format=json
 *   - VK ID  : OAuth 2.1 authorization-code flow, PKCE (S256) MANDATORY,
 *              plus the VK-specific device_id round-trip.
 *              authz  https://id.vk.com/authorize
 *              token  POST https://id.vk.com/oauth2/auth
 *              user   POST https://id.vk.com/oauth2/user_info
 *              (The legacy oauth.vk.com flow is deprecated for new apps and
 *               is deliberately NOT implemented.)
 *   - Telegram uses the Login Widget, not OAuth — see ./telegram.js.
 *
 * SECURITY
 *   - Token exchange is strictly server-side; client secrets never reach the
 *     frontend and never appear in logs.
 *   - Redirect URIs are computed from APP_ORIGIN only (exact allowlist).
 *   - Google ID tokens get FULL local OIDC verification (googleIdToken.js):
 *     RS256 signature against Google's JWKS via official discovery, kid
 *     selection with rotation-aware caching, iss/aud/exp/iat/nonce checks;
 *     alg:none / foreign-key / malformed tokens are rejected.
 *   - Yandex/VK identity (subject + email) comes ONLY from server-to-server
 *     userinfo calls authenticated by the access token we just exchanged —
 *     never from anything the browser sent.
 *   - Every outbound HTTP call is bounded by OAUTH_HTTP_TIMEOUT_MS.
 */

import crypto from 'node:crypto';
import { config } from '../../config.js';
import { verifyGoogleIdToken } from './googleIdToken.js';

/** Providers using the OAuth redirect dance (Telegram is widget-based). */
export const OAUTH_PROVIDERS = ['google', 'yandex', 'vk'];

export function isProviderConfigured(provider) {
  switch (provider) {
    case 'google':
      return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
    case 'yandex':
      return Boolean(config.YANDEX_CLIENT_ID && config.YANDEX_CLIENT_SECRET);
    case 'vk':
      return Boolean(config.VK_CLIENT_ID);
    case 'telegram':
      return Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_BOT_USERNAME);
    default:
      return false;
  }
}

/** Exact, server-computed redirect URI — the only value ever registered. */
export function redirectUriFor(provider) {
  return `${config.APP_ORIGIN}/api/auth/oauth/${provider}/callback`;
}

/* ── PKCE helpers ──────────────────────────────────────────────────────── */

export function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateState() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/* ── Authorization URL ─────────────────────────────────────────────────── */

/**
 * @param {'google'|'yandex'|'vk'} provider
 * @param {{ state: string, codeChallenge: string, nonce?: string }} params
 * @returns {string} full authorization URL to redirect the browser to
 */
export function buildAuthorizationUrl(provider, { state, codeChallenge, nonce }) {
  const redirectUri = redirectUriFor(provider);

  if (provider === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', config.GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    if (nonce) u.searchParams.set('nonce', nonce);
    return u.toString();
  }

  if (provider === 'yandex') {
    const u = new URL('https://oauth.yandex.ru/authorize');
    u.searchParams.set('client_id', config.YANDEX_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  if (provider === 'vk') {
    const u = new URL('https://id.vk.com/authorize');
    u.searchParams.set('client_id', config.VK_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'email');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  throw new Error(`Unknown OAuth provider: ${provider}`);
}

/* ── HTTP with timeout ─────────────────────────────────────────────────── */

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.OAUTH_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ── Identity exchange (code → verified identity) ──────────────────────── */

/** Raised for any provider-side failure. Message is log-safe (no secrets). */
export class OAuthExchangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OAuthExchangeError';
  }
}

async function exchangeGoogle({ code, codeVerifier, nonce }) {
  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUriFor('google'),
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new OAuthExchangeError(`google token endpoint HTTP ${res.status}`);
  const body = await res.json();
  if (!body.id_token) throw new OAuthExchangeError('google: no id_token');

  // FULL OIDC verification (services/oauth/googleIdToken.js): RS256 signature
  // against Google's JWKS (via official discovery, kid-selected, rotation-
  // aware cache) + iss / aud / exp / iat (clock tolerance) / nonce / sub.
  // Malformed, unsigned (alg:none) and foreign-key tokens are all rejected.
  let verified;
  try {
    verified = await verifyGoogleIdToken(body.id_token, { nonce });
  } catch (err) {
    throw new OAuthExchangeError(
      `google: ${err instanceof Error ? err.message : 'id_token verification failed'}`
    );
  }

  return {
    provider: 'google',
    subject: verified.sub,
    // email is only trusted downstream when emailVerified === true.
    email: verified.email,
    emailVerified: verified.emailVerified,
    displayName:
      verified.name || (verified.email ? verified.email.split('@')[0] : 'Google user'),
  };
}

async function exchangeYandex({ code, codeVerifier }) {
  const res = await fetchWithTimeout('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.YANDEX_CLIENT_ID,
      client_secret: config.YANDEX_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new OAuthExchangeError(`yandex token endpoint HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new OAuthExchangeError('yandex: no access_token');

  const infoRes = await fetchWithTimeout('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${body.access_token}` },
  });
  if (!infoRes.ok) throw new OAuthExchangeError(`yandex userinfo HTTP ${infoRes.status}`);
  const info = await infoRes.json();
  if (!info.id) throw new OAuthExchangeError('yandex: no subject');

  return {
    provider: 'yandex',
    subject: String(info.id),
    email: info.default_email ? String(info.default_email).toLowerCase() : null,
    // `default_email` comes from the server-to-server /info call and is the
    // Yandex-account mailbox (Yandex ID docs: the emails array only contains
    // addresses attached to the account itself) — not client-supplied input.
    // If Yandex ever adds an explicit verification flag we honour it.
    emailVerified: Boolean(info.default_email) && info.email_verified !== false,
    displayName: info.display_name || info.real_name || info.login || 'Yandex user',
  };
}

async function exchangeVk({ code, codeVerifier, deviceId, state }) {
  const res = await fetchWithTimeout('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: config.VK_CLIENT_ID,
      device_id: deviceId ?? '',
      redirect_uri: redirectUriFor('vk'),
      state: state ?? '',
      ...(config.VK_CLIENT_SECRET ? { service_token: config.VK_CLIENT_SECRET } : {}),
    }).toString(),
  });
  if (!res.ok) throw new OAuthExchangeError(`vk token endpoint HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new OAuthExchangeError('vk: no access_token');

  const infoRes = await fetchWithTimeout('https://id.vk.com/oauth2/user_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      access_token: body.access_token,
      client_id: config.VK_CLIENT_ID,
    }).toString(),
  });
  if (!infoRes.ok) throw new OAuthExchangeError(`vk user_info HTTP ${infoRes.status}`);
  const info = await infoRes.json();
  const user = info.user ?? info;
  const subject = user.user_id ?? body.user_id;
  if (!subject) throw new OAuthExchangeError('vk: no subject');

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return {
    provider: 'vk',
    subject: String(subject),
    // Email is taken ONLY from the server-to-server user_info response (the
    // VK ID login mailbox), never from the token response or the browser.
    email: user.email ? String(user.email).toLowerCase() : null,
    // Trust the explicit claim when VK sends one; when absent, the address is
    // the confirmed VK ID login email returned by user_info. An explicit
    // `email_verified: false` always wins → treated as unverified.
    emailVerified: Boolean(user.email) && user.email_verified !== false,
    displayName: name || 'VK user',
  };
}

let identityExchange = null;

/**
 * Test seam — replace the network exchange with a stub.
 * @param {null | ((provider: string, params: object) => Promise<object>)} fn
 */
export function __setIdentityExchangeForTests(fn) {
  identityExchange = fn;
}

/**
 * Exchange an authorization code for a SERVER-VERIFIED identity.
 * Never trusts anything the frontend supplied beyond the opaque code itself.
 *
 * @param {'google'|'yandex'|'vk'} provider
 * @param {{ code: string, codeVerifier: string, nonce?: string, deviceId?: string, state?: string }} params
 * @returns {Promise<{ provider: string, subject: string, email: string|null, emailVerified: boolean, displayName: string }>}
 */
export async function exchangeCodeForIdentity(provider, params) {
  if (identityExchange) return identityExchange(provider, params);

  switch (provider) {
    case 'google':
      return exchangeGoogle(params);
    case 'yandex':
      return exchangeYandex(params);
    case 'vk':
      return exchangeVk(params);
    default:
      throw new OAuthExchangeError(`unknown provider ${provider}`);
  }
}
