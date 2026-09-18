/**
 * CRYPTORA — Auth Routes
 *
 * POST /api/auth/register — Create account (Argon2id hash)
 * POST /api/auth/login    — Authenticate, create server-side session
 * POST /api/auth/logout   — Destroy session
 * GET  /api/auth/session  — Return current session user (or 401)
 */

import { Router } from 'express';
import argon2 from 'argon2';
import { registerSchema, loginSchema } from '../validators/auth.js';
import { query } from '../db/pool.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { config } from '../config.js';

const router = Router();

/* ------------------------------------------------------------------ */
/* POST /api/auth/register                                            */
/* ------------------------------------------------------------------ */
router.post('/register', registerLimiter, async (req, res) => {
  // Check if registration is open
  if (!config.REGISTRATION_ENABLED) {
    return res.status(403).json({ error: 'Регистрация временно закрыта' });
  }

  // Validate input
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return res.status(400).json({
      error: firstIssue?.message || 'Некорректные данные',
      field: firstIssue?.path?.[0],
    });
  }

  const { email, displayName, password } = parsed.data;

  // Check duplicate email
  const existing = await query(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [email]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email уже зарегистрирован' });
  }

  // Hash password with Argon2id
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.ARGON2_MEMORY_COST,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  });

  // Insert user
  const result = await query(
    `INSERT INTO users (email, display_name, password_hash, role)
     VALUES ($1, $2, $3, 'user')
     RETURNING id, email, display_name, role, is_active, created_at`,
    [email, displayName, passwordHash]
  );

  const user = result.rows[0];

  // Create session
  req.session.userId = user.id;
  req.session.role = user.role;

  // Save session
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      createdAt: user.created_at,
    },
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/login                                               */
/* ------------------------------------------------------------------ */
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return res.status(400).json({
      error: firstIssue?.message || 'Некорректные данные',
      field: firstIssue?.path?.[0],
    });
  }

  const { email, password } = parsed.data;

  // Look up user by normalized email
  const result = await query(
    `SELECT id, email, display_name, password_hash, role, is_active, last_login_at
     FROM users WHERE lower(email) = lower($1)`,
    [email]
  );

  if (result.rows.length === 0) {
    // Generic response — don't reveal whether email exists
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const user = result.rows[0];

  // Verify password
  let valid = false;
  try {
    valid = await argon2.verify(user.password_hash, password);
  } catch {
    valid = false;
  }

  if (!valid) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  // Check if blocked
  if (!user.is_active) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }

  // Update last_login_at
  await query(
    'UPDATE users SET last_login_at = now() WHERE id = $1',
    [user.id]
  );

  // Create session
  req.session.userId = user.id;
  req.session.role = user.role;

  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      lastLoginAt: user.last_login_at,
    },
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/logout                                              */
/* ------------------------------------------------------------------ */
router.post('/logout', (req, res) => {
  if (!req.session) {
    return res.status(204).end();
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('[logout] Session destroy error:', err.message);
    }
    res.clearCookie('sid');
    res.status(204).end();
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/session                                              */
/* ------------------------------------------------------------------ */
router.get('/session', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  // Look up user from DB (ensures blocked users can't use stale sessions)
  const result = await query(
    `SELECT id, email, display_name, role, is_active, created_at, last_login_at
     FROM users WHERE id = $1`,
    [req.session.userId]
  );

  if (result.rows.length === 0 || !result.rows[0].is_active) {
    // User deleted or blocked — destroy session
    req.session.destroy(() => {
      res.clearCookie('sid');
      res.status(401).json({ error: 'Сессия недействительна' });
    });
    return;
  }

  const user = result.rows[0];

  res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    },
  });
});

export default router;