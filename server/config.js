/**
 * CRYPTORA — Server Configuration
 *
 * All environment-dependent settings in one place.
 * Never commit real secrets — use .env (gitignored).
 */

const NODE_ENV = process.env.NODE_ENV || 'development';

export const config = {
  NODE_ENV,

  // Server
  HOST: process.env.HOST || '127.0.0.1',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora',

  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE || '604800000', 10), // 7 days

  // Cookie
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true' || NODE_ENV === 'production',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'lax',

  // Registration
  REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED !== 'false', // default: true

  // Rate limits (per minute per IP)
  LOGIN_RATE_LIMIT: parseInt(process.env.LOGIN_RATE_LIMIT || '10', 10),
  REGISTER_RATE_LIMIT: parseInt(process.env.REGISTER_RATE_LIMIT || '5', 10),
  API_RATE_LIMIT: parseInt(process.env.API_RATE_LIMIT || '100', 10),

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