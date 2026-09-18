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
  LOGIN_RATE_LIMIT: number;
  REGISTER_RATE_LIMIT: number;
  API_RATE_LIMIT: number;
  PASSWORD_MIN_LENGTH: number;
  PASSWORD_MAX_LENGTH: number;
  DISPLAY_NAME_MIN_LENGTH: number;
  DISPLAY_NAME_MAX_LENGTH: number;
  ARGON2_MEMORY_COST: number;
  ARGON2_TIME_COST: number;
  ARGON2_PARALLELISM: number;
}

export declare const config: ServerConfig;
