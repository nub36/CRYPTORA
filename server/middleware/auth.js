/**
 * CRYPTORA — Auth Middleware
 *
 * requireAuth:  Rejects if no valid session or user is not active.
 * requireAdmin: Rejects if user role is not 'admin'.
 *
 * Admin status is determined ONLY by the server-side session + DB lookup.
 * Never trust: React state, localStorage, query params, request body, URL.
 */

import { query } from '../db/pool.js';
import { config } from '../config.js';

/**
 * Reject if no valid session or user is blocked/missing.
 *
 * Attaches `req.user` on success:
 *   { id, email, displayName, role, isActive }
 */
export async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  // Look up user from DB — session alone is not enough if user was blocked
  try {
    const result = await query(
      `SELECT id, email, display_name, role, is_active, email_verified, email_verified_at,
              created_at, last_login_at
       FROM users WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      // User deleted — destroy session
      req.session.destroy(() => {
        res.clearCookie('sid');
        res.status(401).json({ error: 'Пользователь не найден' });
      });
      return;
    }

    const user = result.rows[0];

    if (!user.is_active) {
      // Blocked user — destroy session immediately
      req.session.destroy(() => {
        res.clearCookie('sid');
        res.status(403).json({ error: 'Аккаунт заблокирован' });
      });
      return;
    }

    // Attach sanitized user (no password_hash, no token hashes)
    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      isActive: user.is_active,
      emailVerified: user.email_verified ?? false,
      emailVerifiedAt: user.email_verified_at ?? null,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    };

    next();
  } catch (err) {
    console.error('[requireAuth] DB lookup failed:', err.message);
    res.status(503).json({ error: 'Сервис временно недоступен' });
  }
}

/**
 * Require a RECENT interactive authentication (login / OAuth sign-in).
 *
 * Sensitive account operations (linking/unlinking login providers) must not
 * be possible with a week-old ambient session cookie alone. The login and
 * OAuth handlers stamp `req.session.authAt`; this middleware enforces that
 * the stamp is younger than FRESH_AUTH_MAX_AGE_MINUTES.
 *
 * Must be used AFTER requireAuth.
 */
export function requireFreshAuth(req, res, next) {
  const authAt = req.session?.authAt;
  const maxAgeMs = config.FRESH_AUTH_MAX_AGE_MINUTES * 60 * 1000;
  if (typeof authAt !== 'number' || Date.now() - authAt > maxAgeMs) {
    return res.status(401).json({
      error: 'REAUTH_REQUIRED',
      message: 'Для этого действия войдите в аккаунт заново',
    });
  }
  next();
}

/**
 * Require admin role. Must be used AFTER requireAuth.
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  next();
}