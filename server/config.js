/**
 * CRYPTORA — Server Configuration
 *
 * All environment-dependent settings in one place.
 * Never commit real secrets — use .env (gitignored).
 */

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Radar retention is a storage-policy switch, not detector math. `0` means an
 * owner explicitly disabled automatic expiry; otherwise only positive whole
 * days are accepted so a typo cannot silently disable bounded cleanup.
 */
function parseRadarRetentionDays(raw = process.env.RADAR_EVENT_RETENTION_DAYS || '30') {
  const value = String(raw).trim();
  if (value === '0') return null;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('RADAR_EVENT_RETENTION_DAYS must be 0 (disabled) or a positive integer number of days');
  }
  return Number(value);
}

export const config = {
  NODE_ENV,

  // Server
  HOST: process.env.HOST || '127.0.0.1',
  PORT: parseInt(process.env.PORT || '3000', 10),

  /**
   * Canonical public origin of the application.
   *
   * Single source of truth for CSRF origin checks and for links embedded in
   * outgoing mail. Never hardcode the domain in middleware or services.
   * Production: https://cryptora.duckdns.org
   */
  APP_ORIGIN: (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, ''),

  // Email verification token lifetime
  EMAIL_VERIFY_TOKEN_TTL_MINUTES: parseInt(process.env.EMAIL_VERIFY_TOKEN_TTL_MINUTES || '60', 10),

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora',

  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE || '604800000', 10), // 7 days
  // Session store backend. 'postgres' is the only production-legal value.
  // 'memory' exists solely for the test suite and is refused under NODE_ENV=production.
  SESSION_STORE: process.env.SESSION_STORE || 'postgres',

  // Cookie
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true' || NODE_ENV === 'production',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'lax',

  // Registration
  REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED !== 'false', // default: true

  // Rate limits (per minute per IP)
  LOGIN_RATE_LIMIT: parseInt(process.env.LOGIN_RATE_LIMIT || '10', 10),
  REGISTER_RATE_LIMIT: parseInt(process.env.REGISTER_RATE_LIMIT || '5', 10),
  API_RATE_LIMIT: parseInt(process.env.API_RATE_LIMIT || '100', 10),

  // Proposed default operational retention policy, not anomaly math. `0` is
  // an explicit owner choice to disable automatic expiry; other values must be
  // positive whole days and are validated at startup.
  RADAR_EVENT_RETENTION_DAYS: parseRadarRetentionDays(),

  // Resend verification email: 3 requests / 15 minutes per IP
  RESEND_RATE_LIMIT: parseInt(process.env.RESEND_RATE_LIMIT || '3', 10),
  RESEND_RATE_WINDOW_MINUTES: parseInt(process.env.RESEND_RATE_WINDOW_MINUTES || '15', 10),
  // Minimum seconds between resends for the same email (SMTP flood protection)
  RESEND_MIN_INTERVAL_SECONDS: parseInt(process.env.RESEND_MIN_INTERVAL_SECONDS || '60', 10),

  // Verify-email attempts: 20 / 15 minutes per IP (token-guessing protection)
  VERIFY_RATE_LIMIT: parseInt(process.env.VERIFY_RATE_LIMIT || '20', 10),
  VERIFY_RATE_WINDOW_MINUTES: parseInt(process.env.VERIFY_RATE_WINDOW_MINUTES || '15', 10),

  // ── SMTP / mail ────────────────────────────────────────────────────────
  // Provider-agnostic: any standard SMTP server works.
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  // NEVER logged. Never returned by any API.
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'CRYPTORA <noreply@example.com>',
  /**
   * 'smtp'  — real transport (required in production)
   * 'json'  — dev/test only; renders the message and does not send anything
   * ''      — auto: smtp when SMTP_HOST is set, otherwise json (dev only)
   */
  MAIL_TRANSPORT: process.env.MAIL_TRANSPORT || '',

  // Password policy
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,

  // Display name
  DISPLAY_NAME_MIN_LENGTH: 2,
  DISPLAY_NAME_MAX_LENGTH: 50,

  // Argon2id
  ARGON2_MEMORY_COST: 65536,  // 64 MB
  ARGON2_TIME_COST: 3,
  ARGON2_PARALLELISM: 1,
};