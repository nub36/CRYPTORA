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
 *   - The ID-token claims are trusted because the token is obtained directly
 *     from the issuer's token endpoint over TLS (OIDC Core §3.1.3.7 allows
 *     skipping signature validation exactly in this case).
 *   - Every outbound HTTP call is bounded by OAUTH_HTTP_TIMEOUT_MS.
 */

import crypto from 'node:crypto';
import { config } from '../../config.js';

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

/** Decode a JWT payload WITHOUT trusting it yet — claims are validated below. */
function decodeJwtPayload(jwt) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) throw new OAuthExchangeError('malformed id_token');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new OAuthExchangeError('undecodable id_token payload');
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

  const claims = decodeJwtPayload(body.id_token);

  // OIDC claim validation: issuer, audience, expiry, nonce (replay).
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new OAuthExchangeError('google: unexpected issuer');
  }
  if (claims.aud !== config.GOOGLE_CLIENT_ID) {
    throw new OAuthExchangeError('google: audience mismatch');
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    throw new OAuthExchangeError('google: id_token expired');
  }
  if (nonce && claims.nonce !== nonce) {
    throw new OAuthExchangeError('google: nonce mismatch');
  }
  if (!claims.sub) throw new OAuthExchangeError('google: no subject');

  return {
    provider: 'google',
    subject: String(claims.sub),
    email: claims.email ? String(claims.email).toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    displayName: claims.name || (claims.email ? String(claims.email).split('@')[0] : 'Google user'),
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
    // Yandex only exposes mailbox addresses it hosts/verified for the account.
    emailVerified: Boolean(info.default_email),
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
    email: user.email ? String(user.email).toLowerCase() : null,
    emailVerified: Boolean(user.email), // VK returns only confirmed addresses
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
