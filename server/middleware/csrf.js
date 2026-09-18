/**
 * CRYPTORA — CSRF Protection
 *
 * Cookie-based auth with SameSite=Lax provides baseline CSRF protection.
 * This middleware adds Origin/Referer validation for state-changing methods.
 *
 * PRODUCTION POLICY (HTTPS-only)
 *   The single allowed origin is the canonical `config.APP_ORIGIN`
 *   (https://cryptora.duckdns.org). Matched as an exact origin — scheme,
 *   host and port must all agree. Therefore:
 *     https://cryptora.duckdns.org            → allowed
 *     http://cryptora.duckdns.org             → 403 (scheme downgrade)
 *     https://evil.cryptora.duckdns.org       → 403 (subdomain)
 *     https://cryptora.duckdns.org.evil.com   → 403 (suffix attack)
 *   The domain is never hardcoded here; it comes from APP_ORIGIN.
 *
 * DEVELOPMENT POLICY
 *   Same-origin http://localhost / 127.0.0.1 development keeps working, and
 *   requests with neither Origin nor Referer (curl, backend-to-backend) are
 *   allowed. In production a missing Origin AND Referer is rejected.
 */

import { config } from '../config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Dev-only origins that may issue state-changing requests. */
const DEV_ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

/** Dev-only hosts accepted when only a Referer is present. */
const DEV_ALLOWED_HOSTS = new Set([
  'localhost:5173',
  '127.0.0.1:5173',
  'localhost:3000',
  '127.0.0.1:3000',
]);

/** Parse a header value into a URL, or null if it is absent/malformed. */
function parseUrl(value) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null; // malformed header → never trusted
  }
}

/**
 * Is `candidateUrl` acceptable for the current environment?
 * Production: exact match against the canonical APP_ORIGIN.
 * Development: canonical origin, the dev allowlist, or the same host.
 */
function isAllowedOrigin(candidateUrl, host) {
  const canonical = parseUrl(config.APP_ORIGIN);

  if (config.NODE_ENV === 'production') {
    // Exact origin equality — no scheme relaxation, no host substring matching.
    return !!canonical && candidateUrl.origin === canonical.origin;
  }

  if (canonical && candidateUrl.origin === canonical.origin) return true;
  if (DEV_ALLOWED_ORIGINS.has(candidateUrl.origin)) return true;
  // Local same-host development (e.g. an ephemeral test port).
  return !!host && candidateUrl.host === host;
}

function isAllowedReferer(refererUrl, host) {
  const canonical = parseUrl(config.APP_ORIGIN);

  if (config.NODE_ENV === 'production') {
    return !!canonical && refererUrl.origin === canonical.origin;
  }

  if (canonical && refererUrl.origin === canonical.origin) return true;
  if (DEV_ALLOWED_HOSTS.has(refererUrl.host)) return true;
  return !!host && refererUrl.host === host;
}

export function csrfProtection(req, res, next) {
  // Safe methods are not CSRF-vulnerable
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const reject = () => res.status(403).json({ error: 'Запрос отклонён (CSRF)' });

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;

  // Neither Origin nor Referer: reject in production, allow in development.
  if (!origin && !referer) {
    return config.NODE_ENV === 'production' ? reject() : next();
  }

  // Origin takes precedence when present.
  if (origin) {
    const originUrl = parseUrl(origin);
    if (!originUrl) return reject();
    return isAllowedOrigin(originUrl, host) ? next() : reject();
  }

  // Otherwise fall back to Referer.
  const refererUrl = parseUrl(referer);
  if (!refererUrl) return reject();
  return isAllowedReferer(refererUrl, host) ? next() : reject();
}
