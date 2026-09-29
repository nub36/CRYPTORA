/**
 * Type declarations for server/services/emailVerification.js (plain-JS module).
 */

export type VerifyResult = 'OK' | 'INVALID' | 'EXPIRED' | 'USED' | 'TOO_MANY';

export declare const VERIFY_RESULT: {
  OK: VerifyResult;
  INVALID: VerifyResult;
  EXPIRED: VerifyResult;
  USED: VerifyResult;
  TOO_MANY: VerifyResult;
};

/** 256-bit random one-time token, base64url. Sent to the mailbox only. */
export declare function generateRawToken(): string;

/** SHA-256 hex digest — the only form ever written to PostgreSQL. */
export declare function hashToken(rawToken: string): string;

/** Cheap pre-flight check: 32 bytes of base64url and nothing else. */
export declare function isPlausibleToken(rawToken: unknown): boolean;

/** Retire every outstanding token for the user and insert a fresh one. */
export declare function createVerificationToken(
  userId: string
): Promise<{ rawToken: string; expiresAt: Date }>;

/** Seconds since this user's most recent token, or null if never issued. */
export declare function secondsSinceLastToken(userId: string): Promise<number | null>;

/** Verify a raw token inside a DB transaction. */
export declare function verifyRawToken(
  rawToken: string
): Promise<{ result: VerifyResult; userId?: string }>;

/** Cryptographically secure 6-digit code, zero-padded. */
export declare function generateVerificationCode(): string;

/** HMAC-SHA256(secret, `${userId}:${code}`) hex — the only stored form. */
export declare function hashCode(userId: string, code: string): string;

/** Retire outstanding credentials and issue a fresh 6-digit code. */
export declare function createVerificationCode(
  userId: string
): Promise<{ code: string; expiresAt: Date }>;

/** Verify a 6-digit code atomically (single-use, TTL, attempt budget). */
export declare function verifyCodeForUser(
  userId: string,
  code: string
): Promise<{ result: VerifyResult }>;
