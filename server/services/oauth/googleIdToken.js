/**
 * CRYPTORA — Google OIDC ID-token verification (full, local signature check)
 *
 * Verifies Google ID tokens the standard OIDC way with the `jose` library:
 *
 *   1. Discovery  : the JWKS URI is taken from Google's official OIDC
 *                   discovery document (https://accounts.google.com/
 *                   .well-known/openid-configuration), cached for 24 h with a
 *                   pinned fallback to the documented URI
 *                   (https://www.googleapis.com/oauth2/v3/certs).
 *   2. Signature  : RS256 ONLY — the single algorithm Google's metadata
 *                   advertises (`id_token_signing_alg_values_supported`).
 *                   `alg: none`, HS*, ES*, PS* and malformed tokens are all
 *                   rejected before any claim is looked at. The signing key is
 *                   selected by `kid`; an unknown `kid` triggers one JWKS
 *                   refetch (key rotation) and otherwise fails closed.
 *   3. Claims     : iss ∈ {https://accounts.google.com, accounts.google.com},
 *                   aud === GOOGLE_CLIENT_ID, exp (with CLOCK_TOLERANCE_SEC),
 *                   iat present + not in the future beyond tolerance,
 *                   nonce === the value bound to this login transaction,
 *                   sub present.
 *   4. Email      : `email` is surfaced only alongside `email_verified`;
 *                   callers must treat the address as unverified unless
 *                   `email_verified === true`.
 *
 * Key caching / rotation: `createRemoteJWKSet` caches keys in-process
 * (JWKS_CACHE_MAX_AGE_MS) and, when a token arrives with a `kid` that is not
 * in the cache, refetches the JWKS once (rate-limited by
 * JWKS_COOLDOWN_MS) — the standard behaviour for Google's rotating keys.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import { config } from '../../config.js';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const GOOGLE_DISCOVERY_URL =
  'https://accounts.google.com/.well-known/openid-configuration';
/** Documented fallback if discovery is unreachable (same keys). */
export const GOOGLE_JWKS_FALLBACK_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** The only signing algorithm Google's OIDC metadata advertises. */
export const GOOGLE_ID_TOKEN_ALGS = ['RS256'];

/** ±60 s clock tolerance for exp / iat / nbf. */
export const CLOCK_TOLERANCE_SEC = 60;

const DISCOVERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // re-discover daily
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000; // jose default-ish key cache
const JWKS_COOLDOWN_MS = 30 * 1000; // min gap between rotation refetches

export class GoogleIdTokenError extends Error {
  /** @param {string} message log-safe reason (never contains the token) */
  constructor(message) {
    super(message);
    this.name = 'GoogleIdTokenError';
  }
}

/* ── JWKS resolution (discovery → remote JWKS, cached) ─────────────────── */

let discoveredAt = 0;
let jwks = null; // resolver returned by createRemoteJWKSet
let jwksOverride = null; // test seam: local JWKS resolver

/**
 * Test seam — inject a local key resolver (e.g. jose.createLocalJWKSet) so
 * the suite can sign tokens with its own keys. Pass null to restore.
 * @param {null | import('jose').JWTVerifyGetKey} resolver
 */
export function __setGoogleJwksForTests(resolver) {
  jwksOverride = resolver;
}

async function discoverJwksUri() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.OAUTH_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(GOOGLE_DISCOVERY_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`);
    const meta = await res.json();
    if (typeof meta.jwks_uri === 'string' && meta.jwks_uri.startsWith('https://')) {
      return meta.jwks_uri;
    }
    throw new Error('discovery document without jwks_uri');
  } catch {
    // Discovery being briefly unreachable must not lock every user out:
    // fall back to the JWKS URI Google documents (identical key set).
    return GOOGLE_JWKS_FALLBACK_URL;
  } finally {
    clearTimeout(timer);
  }
}

async function getKeyResolver() {
  if (jwksOverride) return jwksOverride;
  const now = Date.now();
  if (!jwks || now - discoveredAt > DISCOVERY_CACHE_MAX_AGE_MS) {
    const uri = await discoverJwksUri();
    jwks = createRemoteJWKSet(new URL(uri), {
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      timeoutDuration: config.OAUTH_HTTP_TIMEOUT_MS,
    });
    discoveredAt = now;
  }
  return jwks;
}

/* ── Verification ──────────────────────────────────────────────────────── */

/**
 * Fully verify a Google ID token: signature (RS256 against Google's JWKS,
 * kid-selected) + iss / aud / exp / iat / nonce / sub.
 *
 * @param {string} idToken raw compact JWT from Google's token endpoint
 * @param {{ nonce: string, clientId?: string }} expected
 *        nonce is REQUIRED — CRYPTORA always sends one; clientId defaults to
 *        config.GOOGLE_CLIENT_ID.
 * @returns {Promise<{ sub: string, email: string|null, emailVerified: boolean, name: string|null }>}
 * @throws {GoogleIdTokenError} on ANY verification failure (log-safe message)
 */
export async function verifyGoogleIdToken(idToken, { nonce, clientId } = {}) {
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new GoogleIdTokenError('malformed id_token');
  }
  if (!nonce) {
    // Fail closed: a login transaction without a bound nonce is a bug.
    throw new GoogleIdTokenError('missing expected nonce');
  }

  const audience = clientId || config.GOOGLE_CLIENT_ID;
  const resolver = await getKeyResolver();

  let payload;
  try {
    // jose enforces: signature validity, algorithm allowlist (rejects
    // `alg: none` and any non-RS256 header), kid-based key lookup with one
    // rotation refetch, issuer, audience, exp/nbf with clock tolerance.
    ({ payload } = await jwtVerify(idToken, resolver, {
      issuer: GOOGLE_ISSUERS,
      audience,
      algorithms: GOOGLE_ID_TOKEN_ALGS,
      clockTolerance: CLOCK_TOLERANCE_SEC,
    }));
  } catch (err) {
    // Never echo the token; jose error codes are safe and useful.
    const code = err && typeof err === 'object' && 'code' in err ? err.code : 'ERR_JWT_INVALID';
    throw new GoogleIdTokenError(`id_token verification failed (${code})`);
  }

  // iat: must exist and must not lie in the future beyond clock tolerance.
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number') {
    throw new GoogleIdTokenError('id_token without iat');
  }
  if (payload.iat > nowSec + CLOCK_TOLERANCE_SEC) {
    throw new GoogleIdTokenError('id_token iat in the future');
  }

  // nonce: binds the token to THIS login transaction (replay defence).
  if (payload.nonce !== nonce) {
    throw new GoogleIdTokenError('nonce mismatch');
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new GoogleIdTokenError('id_token without sub');
  }

  const emailVerified = payload.email_verified === true;
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerified,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}
