/**
 * CRYPTORA — Auth Routes
 *
 * POST /api/auth/register             — Create account (Argon2id hash, unverified)
 * POST /api/auth/login                — Authenticate, create server-side session
 * POST /api/auth/logout               — Destroy session
 * GET  /api/auth/session              — Return current session user (or 401)
 * POST /api/auth/verify-email         — Consume a one-time verification token
 * POST /api/auth/resend-verification  — Re-send the verification email
 */

import { Router } from 'express';
import argon2 from 'argon2';
import { registerSchema, loginSchema, verifyEmailSchema, resendSchema } from '../validators/auth.js';
import { query } from '../db/pool.js';
import {
  loginLimiter,
  registerLimiter,
  resendLimiter,
  verifyLimiter,
} from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { createVerificationToken, verifyRawToken, secondsSinceLastToken, VERIFY_RESULT } from '../services/emailVerification.js';
import { sendVerificationEmail, getMailStatus, MailUnavailableError, maskEmail } from '../services/mail.js';

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

  // Insert user — created UNVERIFIED. An unverified user never receives an
  // authenticated session; login is refused until the mailbox is confirmed.
  const result = await query(
    `INSERT INTO users (email, display_name, password_hash, role, email_verified)
     VALUES ($1, $2, $3, 'user', FALSE)
     RETURNING id, email, display_name, role, is_active, email_verified, created_at`,
    [email, displayName, passwordHash]
  );

  const user = result.rows[0];

  // Issue a one-time token (only its SHA-256 hash is persisted).
  const { rawToken } = await createVerificationToken(user.id);

  // Deliver the email. A mail outage must NOT break the registration: the user
  // row stays (unverified) and the resend endpoint can recover later.
  let delivery = 'sent';
  try {
    await sendVerificationEmail({
      to: user.email,
      displayName: user.display_name,
      token: rawToken,
    });
  } catch (err) {
    delivery = 'unavailable';
    // No secrets, no token, no stack trace.
    console.warn(
      `[register] verification email not delivered to=${user.email}: ${
        err instanceof MailUnavailableError ? err.message : 'mail error'
      }`
    );
  }

  // Deliberately NO session here.
  res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      emailVerified: user.email_verified ?? false,
      emailVerifiedAt: user.email_verified_at ?? null,
      createdAt: user.created_at,
    },
    verification: {
      required: true,
      emailMasked: maskEmail(user.email),
      delivery,
      ttlMinutes: config.EMAIL_VERIFY_TOKEN_TTL_MINUTES,
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
    `SELECT id, email, display_name, password_hash, role, is_active,
            email_verified, email_verified_at, last_login_at
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
    // Generic 401 — the verification state is never revealed for a wrong password.
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  // Check if blocked
  if (!user.is_active) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }

  // Password is correct, so it is now safe to disclose that the mailbox is
  // still unverified. No authenticated session is created.
  if (!user.email_verified) {
    return res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Подтвердите адрес электронной почты',
    });
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
      emailVerified: user.email_verified ?? false,
      emailVerifiedAt: user.email_verified_at ?? null,
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
    `SELECT id, email, display_name, role, is_active, email_verified, email_verified_at,
            created_at, last_login_at
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
      emailVerified: user.email_verified ?? false,
      emailVerifiedAt: user.email_verified_at ?? null,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    },
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/verify-email                                        */
/* ------------------------------------------------------------------ */
router.post('/verify-email', verifyLimiter, async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID', message: 'Некорректная ссылка' });
  }

  const { token } = parsed.data;

  const outcome = await verifyRawToken(token);

  switch (outcome.result) {
    case VERIFY_RESULT.OK:
      // Deliberately NO session is created here: the user logs in normally.
      return res.json({ status: 'ok', message: 'Email подтверждён' });

    case VERIFY_RESULT.EXPIRED:
      return res.status(410).json({ error: 'EXPIRED', message: 'Срок действия ссылки истёк' });

    case VERIFY_RESULT.USED:
      // A consumed token is a replay attempt — same shape as invalid, no detail.
      return res.status(400).json({ error: 'INVALID', message: 'Ссылка уже использована' });

    default:
      return res.status(400).json({ error: 'INVALID', message: 'Ссылка недействительна' });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/resend-verification                                 */
/* ------------------------------------------------------------------ */
router.post('/resend-verification', resendLimiter, async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  const { email } = parsed.data;

  // One generic answer regardless of whether the account exists, is verified,
  // or is throttled — the endpoint must not enumerate accounts.
  const generic = () =>
    res.json({
      status: 'ok',
      message: 'Если аккаунт существует и email не подтверждён, письмо отправлено повторно',
    });

  const found = await query(
    `SELECT id, email, display_name, is_active, email_verified
       FROM users WHERE lower(email) = lower($1)`,
    [email]
  );

  if (found.rows.length === 0) return generic();

  const user = found.rows[0];

  // Already verified, or blocked: send nothing, reveal nothing.
  if (user.email_verified || !user.is_active) return generic();

  // Per-email throttle on top of the per-IP rate limit (SMTP flood protection).
  const sinceLast = await secondsSinceLastToken(user.id);
  if (sinceLast !== null && sinceLast < config.RESEND_MIN_INTERVAL_SECONDS) {
    return generic();
  }

  if (!getMailStatus().configured) {
    console.warn(`[resend] mail unavailable, nothing sent for=${user.email}`);
    return res.status(503).json({
      error: 'MAIL_UNAVAILABLE',
      message: 'Почтовый сервис временно недоступен, попробуйте позже',
    });
  }

  const { rawToken } = await createVerificationToken(user.id);

  try {
    await sendVerificationEmail({
      to: user.email,
      displayName: user.display_name,
      token: rawToken,
    });
  } catch (err) {
    console.warn(
      `[resend] delivery failed for=${user.email}: ${
        err instanceof MailUnavailableError ? err.message : 'mail error'
      }`
    );
    return res.status(503).json({
      error: 'MAIL_UNAVAILABLE',
      message: 'Почтовый сервис временно недоступен, попробуйте позже',
    });
  }

  return generic();
});

export default router;