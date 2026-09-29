/**
 * Type declarations for server/config.js (plain-JS module).
 */

export interface ServerConfig {
  NODE_ENV: string;
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  SESSION_MAX_AGE: number;
  /** 'postgres' in production; 'memory' only for tests. */
  SESSION_STORE: 'postgres' | 'memory' | string;
  COOKIE_SECURE: boolean;
  COOKIE_SAMESITE: string;
  REGISTRATION_ENABLED: boolean;

  /** Canonical public origin — the only origin CSRF accepts in production. */
  APP_ORIGIN: string;

  /** Minutes a verification link stays valid. */
  EMAIL_VERIFY_TOKEN_TTL_MINUTES: number;

  /** Minutes a 6-digit verification code stays valid. */
  EMAIL_VERIFY_CODE_TTL_MINUTES: number;
  /** Wrong-guess budget per code. */
  EMAIL_VERIFY_CODE_MAX_ATTEMPTS: number;
  /** HMAC key used to hash codes at rest. */
  EMAIL_CODE_HMAC_SECRET: string;

  /** OAuth initiation/callback per-IP budget (per 5 minutes). */
  OAUTH_RATE_LIMIT: number;
  /** Max age of the last interactive authentication for sensitive ops. */
  FRESH_AUTH_MAX_AGE_MINUTES: number;
  /** Outbound HTTP timeout for OAuth exchanges (ms). */
  OAUTH_HTTP_TIMEOUT_MS: number;
  /** Telegram widget payload freshness bound (seconds). */
  TELEGRAM_AUTH_MAX_AGE_SECONDS: number;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  YANDEX_CLIENT_ID: string;
  YANDEX_CLIENT_SECRET: string;
  VK_CLIENT_ID: string;
  VK_CLIENT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;

  LOGIN_RATE_LIMIT: number;
  REGISTER_RATE_LIMIT: number;
  API_RATE_LIMIT: number;
  /** resend-verification: requests per window per IP. */
  RESEND_RATE_LIMIT: number;
  RESEND_RATE_WINDOW_MINUTES: number;
  /** Per-email resend throttle, seconds. */
  RESEND_MIN_INTERVAL_SECONDS: number;
  /** verify-email attempts per window per IP. */
  VERIFY_RATE_LIMIT: number;
  VERIFY_RATE_WINDOW_MINUTES: number;

  // ── SMTP / mail ─────────────────────────────────────────────
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM_EMAIL: string;
  SMTP_FROM_NAME: string;
  MAIL_FROM: string;
  SMTP_TIMEOUT_MS: number;
  /** 'smtp' | 'json' | '' (auto). */
  MAIL_TRANSPORT: 'smtp' | 'json' | '';

  PASSWORD_MIN_LENGTH: number;
  PASSWORD_MAX_LENGTH: number;
  DISPLAY_NAME_MIN_LENGTH: number;
  DISPLAY_NAME_MAX_LENGTH: number;
  ARGON2_MEMORY_COST: number;
  ARGON2_TIME_COST: number;
  ARGON2_PARALLELISM: number;
}

export declare const config: ServerConfig;
