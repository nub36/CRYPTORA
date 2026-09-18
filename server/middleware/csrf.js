/**
 * CRYPTORA — CSRF Protection
 *
 * Cookie-based auth with SameSite=Lax provides baseline CSRF protection.
 * This middleware adds Origin/Referer validation for state-changing methods.
 *
 * For same-origin requests (frontend → API), Origin matches Host.
 * For cross-origin requests (potential CSRF), Origin will differ → rejected.
 */

import { config } from '../config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, res, next) {
  // Safe methods are not CSRF-vulnerable
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;

  // If neither Origin nor Referer is present, and it's not a same-origin request,
  // reject. This blocks cross-origin form submissions without Origin header.
  if (!origin && !referer) {
    // Allow requests without Origin/Referer (e.g., curl, backend-to-backend)
    // in development. In production, require at least one.
    if (config.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Запрос отклонён (CSRF)' });
    }
    return next();
  }

  // Validate Origin
  if (origin) {
    const originUrl = new URL(origin);
    const expectedOrigin = `https://${host}`;
    const expectedOriginHttp = `http://${host}`;

    if (originUrl.origin === expectedOrigin || originUrl.origin === expectedOriginHttp) {
      return next();
    }

    // Allow localhost in development
    if (config.NODE_ENV !== 'production') {
      const allowedDev = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];
      if (allowedDev.includes(originUrl.origin)) {
        return next();
      }
    }

    return res.status(403).json({ error: 'Запрос отклонён (CSRF)' });
  }

  // Validate Referer
  if (referer) {
    const refererUrl = new URL(referer);
    if (refererUrl.host === host) {
      return next();
    }

    // Allow localhost in development
    if (config.NODE_ENV !== 'production') {
      const allowedDevHosts = ['localhost:5173', '127.0.0.1:5173', 'localhost:3000'];
      if (allowedDevHosts.includes(refererUrl.host)) {
        return next();
      }
    }

    return res.status(403).json({ error: 'Запрос отклонён (CSRF)' });
  }

  return res.status(403).json({ error: 'Запрос отклонён (CSRF)' });
}