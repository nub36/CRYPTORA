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
   * Single source of truth for CSRF origin checks, OAuth redirect URIs and
   * links embedded in outgoing mail. Never hardcode the domain in middleware
   * or services. Production: https://cryptora.duckdns.org
   * APP_BASE_URL is accepted as an alias for deployments documented that way.
   */
  APP_ORIGIN: (process.env.APP_ORIGIN || process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),

  // Email verification LINK lifetime (legacy links already in mailboxes)
  EMAIL_VERIFY_TOKEN_TTL_MINUTES: parseInt(process.env.EMAIL_VERIFY_TOKEN_TTL_MINUTES || '60', 10),

  // ── Email verification CODE (6 digits) ─────────────────────────────────
  // Lifetime of a code in minutes (spec: 10) and the guess budget per code.
  EMAIL_VERIFY_CODE_TTL_MINUTES: parseInt(process.env.EMAIL_VERIFY_CODE_TTL_MINUTES || '10', 10),
  EMAIL_VERIFY_CODE_MAX_ATTEMPTS: parseInt(process.env.EMAIL_VERIFY_CODE_MAX_ATTEMPTS || '5', 10),
  /**
   * HMAC key for hashing verification codes at rest. A 6-digit code has only
   * 10^6 states, so a plain digest would be trivially brute-forceable from a
   * DB dump — a keyed HMAC is required. Falls back to SESSION_SECRET so a
   * correctly configured production deployment is always keyed.
   */
  EMAIL_CODE_HMAC_SECRET: process.env.EMAIL_CODE_HMAC_SECRET || process.env.SESSION_SECRET || 'dev-secret-change-in-production',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora',

  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  // Dedicated 32-byte key (base64 or 64-char hex) for AES-256-GCM encryption
  // of user-owned notification secrets. There is deliberately no fallback to
  // SESSION_SECRET: missing configuration must fail closed, never weaken storage.
  NOTIFICATION_ENCRYPTION_KEY: process.env.NOTIFICATION_ENCRYPTION_KEY || '',
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

  // OAuth initiation/callback: per-IP budget (window is 5 minutes)
  OAUTH_RATE_LIMIT: parseInt(process.env.OAUTH_RATE_LIMIT || '30', 10),

  // Sensitive account operations (link/unlink providers) require a session
  // whose last interactive authentication is at most this old.
  FRESH_AUTH_MAX_AGE_MINUTES: parseInt(process.env.FRESH_AUTH_MAX_AGE_MINUTES || '30', 10),

  // Outbound HTTP timeout for OAuth token/userinfo exchanges (ms).
  OAUTH_HTTP_TIMEOUT_MS: parseInt(process.env.OAUTH_HTTP_TIMEOUT_MS || '10000', 10),

  // Telegram Login Widget payloads older than this are rejected (seconds).
  TELEGRAM_AUTH_MAX_AGE_SECONDS: parseInt(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300', 10),

  // ── Social login providers (secrets: env only, never committed) ────────
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID || '',
  YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET || '',
  VK_CLIENT_ID: process.env.VK_CLIENT_ID || '',
  VK_CLIENT_SECRET: process.env.VK_CLIENT_SECRET || '',
  // Telegram Login Widget: the bot token signs payloads; the bot username is
  // public (it is embedded in the widget markup).
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',

  // ── SMTP / mail ────────────────────────────────────────────────────────
  // Provider-agnostic: any standard SMTP server works.
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  // NEVER logged. Never returned by any API.
  SMTP_PASS: process.env.SMTP_PASS || '',
  // Sender identity. SMTP_FROM_EMAIL / SMTP_FROM_NAME are preferred;
  // MAIL_FROM ("Name <addr>") is still accepted for existing deployments.
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL || '',
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || '',
  MAIL_FROM: process.env.MAIL_FROM || 'CRYPTORA <noreply@example.com>',
  // SMTP connection/greeting/socket timeout (ms) — a hung relay must not hang requests.
  SMTP_TIMEOUT_MS: parseInt(process.env.SMTP_TIMEOUT_MS || '10000', 10),
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