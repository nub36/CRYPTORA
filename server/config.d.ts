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
  MAIL_FROM: string;
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
