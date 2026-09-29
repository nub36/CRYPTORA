/**
 * CRYPTORA — Auth Routes
 *
 * POST /api/auth/register             — Create account (Argon2id hash, unverified) + send 6-digit code
 * POST /api/auth/login                — Authenticate, regenerate + create server-side session
 * POST /api/auth/logout               — Destroy session
 * GET  /api/auth/session              — Return current session user (or 401)
 * POST /api/auth/verify-code          — Consume a 6-digit verification code
 * POST /api/auth/verify-email         — Consume a legacy one-time verification LINK token
 * POST /api/auth/resend-verification  — Re-send the verification code
 * GET  /api/auth/registration-status  — Public: is sign-up currently open?
 * GET  /api/auth/providers            — Public: which login providers are configured?
 *
 * Social login (Google / Telegram / Yandex / VK ID) lives in routes/oauth.js
 * and shares the SAME session mechanism (establishSession).
 */

import { Router } from 'express';
import argon2 from 'argon2';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendSchema,
  verifyCodeSchema,
} from '../validators/auth.js';
import { query } from '../db/pool.js';
import {
  loginLimiter,
  registerLimiter,
  resendLimiter,
  verifyLimiter,
  verifyCodeLimiter,
} from '../middleware/rateLimit.js';
import { config } from '../config.js';
import {
  createVerificationCode,
  verifyCodeForUser,
  verifyRawToken,
  secondsSinceLastToken,
  VERIFY_RESULT,
} from '../services/emailVerification.js';
import {
  sendVerificationCodeEmail,
  getMailStatus,
  MailUnavailableError,
  maskEmail,
} from '../services/mail.js';
import { isProviderConfigured } from '../services/oauth/providers.js';
import { establishSession } from '../services/sessionAuth.js';

const router = Router();

/**
 * Derive a display name when the 2-step registration form did not collect
 * one: the email local part, clamped to the validator's bounds.
 */
function deriveDisplayName(email) {
  const local = String(email).split('@')[0] ?? '';
  const cleaned = local.replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 50);
  return cleaned.length >= 2 ? cleaned : 'Пользователь';
}

/* ------------------------------------------------------------------ */
/* GET /api/auth/registration-status                                  */
/*                                                                    */
/* Public (no session required). Lets the sign-up page render an       */
/* honest closed state instead of a form that always 403s.             */
/* ------------------------------------------------------------------ */
router.get('/registration-status', (req, res) => {
  res.json({ registrationOpen: config.REGISTRATION_ENABLED === true });
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/providers                                            */
/*                                                                    */
/* Public capability map so the frontend can render exactly the        */
/* buttons that will work. NO secrets: only booleans plus the public   */
/* Telegram bot username (it is embedded in the widget markup anyway). */
/* ------------------------------------------------------------------ */
router.get('/providers', (req, res) => {
  res.json({
    emailPassword: true,
    emailVerification: true,
    google: isProviderConfigured('google'),
    telegram: isProviderConfigured('telegram'),
    yandex: isProviderConfigured('yandex'),
    vk: isProviderConfigured('vk'),
    telegramBotName: isProviderConfigured('telegram') ? config.TELEGRAM_BOT_USERNAME : null,
  });
});

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

  const { email, password } = parsed.data;
  const displayName = parsed.data.displayName || deriveDisplayName(email);

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

  // Issue a one-time 6-digit code (only its HMAC is persisted).
  const { code } = await createVerificationCode(user.id);

  // Deliver the email. A mail outage must NOT break the registration: the user
  // row stays (unverified) and the resend endpoint can recover later.
  let delivery = 'sent';
  try {
    await sendVerificationCodeEmail({ to: user.email, code });
  } catch (err) {
    delivery = 'unavailable';
    // No secrets, no code, no stack trace.
    console.warn(
      `[register] verification code not delivered to=${user.email}: ${
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
      method: 'code',
      emailMasked: maskEmail(user.email),
      delivery,
      ttlMinutes: config.EMAIL_VERIFY_CODE_TTL_MINUTES,
      resendCooldownSeconds: config.RESEND_MIN_INTERVAL_SECONDS,
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

  // Social-only accounts have no password hash; answer with the same generic
  // 401 so the endpoint reveals nothing about the account's existence/type.
  let valid = false;
  if (user.password_hash) {
    try {
      valid = await argon2.verify(user.password_hash, password);
    } catch {
      valid = false;
    }
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

  // Create session. The ID is REGENERATED inside (session-fixation defence).
  await establishSession(req, user);

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
/* POST /api/auth/verify-code                                         */
/*                                                                    */
/* Consumes a 6-digit code. ANTI-ENUMERATION: an unknown email, an     */
/* already-verified account and a wrong code all produce the exact     */
/* same INVALID response — the endpoint never confirms that an         */
/* account exists.                                                     */
/* ------------------------------------------------------------------ */
router.post('/verify-code', verifyCodeLimiter, async (req, res) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID', message: 'Неверный код' });
  }

  const { email, code } = parsed.data;

  const found = await query(
    `SELECT id, email_verified, is_active FROM users WHERE lower(email) = lower($1)`,
    [email]
  );

  // Unknown account / already verified / blocked → indistinguishable INVALID.
  if (
    found.rows.length === 0 ||
    found.rows[0].email_verified ||
    !found.rows[0].is_active
  ) {
    return res.status(400).json({ error: 'INVALID', message: 'Неверный код' });
  }

  const outcome = await verifyCodeForUser(found.rows[0].id, code);

  switch (outcome.result) {
    case VERIFY_RESULT.OK:
      // Deliberately NO session is created here: the user logs in normally.
      return res.json({ status: 'ok', message: 'Email подтверждён' });

    case VERIFY_RESULT.EXPIRED:
      return res.status(410).json({ error: 'EXPIRED', message: 'Срок действия кода истёк' });

    case VERIFY_RESULT.TOO_MANY:
      return res.status(429).json({
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Слишком много попыток. Запросите новый код.',
      });

    case VERIFY_RESULT.USED:
      // A consumed code is a replay attempt — same shape as invalid.
      return res.status(400).json({ error: 'INVALID', message: 'Неверный код' });

    default:
      return res.status(400).json({ error: 'INVALID', message: 'Неверный код' });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/verify-email  (legacy link tokens)                  */
/*                                                                    */
/* Kept so links that were already delivered to mailboxes before the   */
/* code-based flow keep working until they expire.                     */
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
      message: 'Если аккаунт существует и email не подтверждён, код отправлен повторно',
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

  // Per-email cooldown on top of the per-IP rate limit (SMTP flood protection).
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

  // Issuing a fresh code INVALIDATES every previous code/link for this user.
  const { code } = await createVerificationCode(user.id);

  try {
    await sendVerificationCodeEmail({ to: user.email, code });
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
