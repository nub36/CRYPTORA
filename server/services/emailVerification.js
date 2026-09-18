/**
 * CRYPTORA — Email Verification Token Service
 *
 * TOKEN SECURITY
 *   - Raw token: crypto.randomBytes(32) → base64url (256 bits of entropy).
 *   - Only the SHA-256 hex digest is persisted. The raw token exists in the
 *     outbound email and in memory during a single request; it is never
 *     stored, logged, or returned by an API.
 *   - One-time use: `used_at` is set on success, and every other outstanding
 *     token for the user is invalidated in the same transaction.
 *   - TTL is configurable via EMAIL_VERIFY_TOKEN_TTL_MINUTES.
 */

import crypto from 'node:crypto';
import { query, getClient } from '../db/pool.js';
import { config } from '../config.js';

/** Result codes returned to the route layer (no internals leak). */
export const VERIFY_RESULT = {
  OK: 'OK',
  INVALID: 'INVALID', // unknown or malformed token
  EXPIRED: 'EXPIRED',
  USED: 'USED', // replay of a consumed token
};

/** Generate a raw one-time token (256 bits) — sent to the mailbox. */
export function generateRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a raw token — the only form that touches PostgreSQL. */
export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

/** A token is only plausible if it decodes to 32 bytes of base64url. */
export function isPlausibleToken(rawToken) {
  if (typeof rawToken !== 'string') return false;
  if (rawToken.length < 32 || rawToken.length > 128) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(rawToken)) return false;
  try {
    return Buffer.from(rawToken, 'base64url').length === 32;
  } catch {
    return false;
  }
}

/**
 * Invalidate every outstanding token for a user and insert a fresh one.
 *
 * @param {string} userId
 * @returns {Promise<{ rawToken: string, expiresAt: Date }>}
 */
export async function createVerificationToken(userId) {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const ttlMs = config.EMAIL_VERIFY_TOKEN_TTL_MINUTES * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await query(
    `UPDATE email_verification_tokens
        SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  await query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { rawToken, expiresAt };
}

/**
 * Seconds since the user's most recent token was issued, or null if none.
 * Used to throttle resends per email (not just per IP).
 */
export async function secondsSinceLastToken(userId) {
  const res = await query(
    `SELECT MAX(created_at) AS last_created
       FROM email_verification_tokens
      WHERE user_id = $1`,
    [userId]
  );
  const last = res.rows[0]?.last_created;
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 1000);
}

/**
 * Verify a raw token inside a transaction.
 *
 * @param {string} rawToken
 * @returns {Promise<{ result: string, userId?: string }>}
 */
export async function verifyRawToken(rawToken) {
  if (!isPlausibleToken(rawToken)) {
    return { result: VERIFY_RESULT.INVALID };
  }

  const tokenHash = hashToken(rawToken);
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT t.id, t.user_id, t.expires_at, t.used_at
         FROM email_verification_tokens t
        WHERE t.token_hash = $1`,
      [tokenHash]
    );

    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return { result: VERIFY_RESULT.INVALID };
    }

    const token = found.rows[0];

    if (token.used_at) {
      await client.query('ROLLBACK');
      return { result: VERIFY_RESULT.USED };
    }

    if (new Date(token.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return { result: VERIFY_RESULT.EXPIRED };
    }

    // Mark the mailbox as verified.
    await client.query(
      `UPDATE users
          SET email_verified = TRUE,
              email_verified_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [token.user_id]
    );

    // Consume this token…
    await client.query(
      `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`,
      [token.id]
    );

    // …and invalidate any sibling tokens so an older link cannot be replayed.
    await client.query(
      `UPDATE email_verification_tokens
          SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL AND id <> $2`,
      [token.user_id, token.id]
    );

    await client.query('COMMIT');
    return { result: VERIFY_RESULT.OK, userId: token.user_id };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback is best-effort */
    }
    throw err;
  } finally {
    client.release();
  }
}
