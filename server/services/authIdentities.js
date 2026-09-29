/**
 * CRYPTORA — Auth identities repository
 *
 * One `users` row per person; one `auth_identities` row per linked social
 * provider account. Passwords stay in users.password_hash (their existing,
 * audited location) and are NOT modeled as an identity row.
 *
 * INVARIANTS (enforced by schema + this module):
 *   - UNIQUE(provider, provider_subject): a provider account belongs to at
 *     most one CRYPTORA user — duplicate identities are impossible.
 *   - provider_email is informational only. Account matching NEVER uses it;
 *     matching is by provider_subject exclusively (emails can be recycled).
 */

import { query } from '../db/pool.js';

export const SOCIAL_PROVIDERS = ['google', 'telegram', 'yandex', 'vk'];

/** Find the identity row for a provider account, or null. */
export async function findIdentity(provider, providerSubject) {
  const res = await query(
    `SELECT id, user_id, provider, provider_subject, provider_email, created_at
       FROM auth_identities
      WHERE provider = $1 AND provider_subject = $2`,
    [provider, String(providerSubject)]
  );
  return res.rows[0] ?? null;
}

/** All identities linked to a user (for the profile page / unlink guard). */
export async function listIdentitiesForUser(userId) {
  const res = await query(
    `SELECT provider, provider_email, created_at
       FROM auth_identities
      WHERE user_id = $1
      ORDER BY created_at ASC`,
    [userId]
  );
  return res.rows;
}

/** Link a provider account to a user. Throws on (provider, subject) conflict. */
export async function createIdentity({ userId, provider, providerSubject, providerEmail }) {
  const res = await query(
    `INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, provider, provider_subject, provider_email, created_at`,
    [userId, provider, String(providerSubject), providerEmail ?? null]
  );
  return res.rows[0];
}

/** Unlink a provider from a user. Returns true when a row was removed. */
export async function deleteIdentity(userId, provider) {
  const res = await query(
    `DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * How many independent ways this user has to sign in:
 * password (if set) + each linked identity. The unlink endpoint refuses to
 * drop below 1 so nobody can lock themselves out.
 */
export async function countLoginMethods(userId) {
  const res = await query(
    `SELECT (u.password_hash IS NOT NULL) AS has_password,
            (SELECT COUNT(*)::int FROM auth_identities ai WHERE ai.user_id = u.id) AS identities
       FROM users u
      WHERE u.id = $1`,
    [userId]
  );
  const row = res.rows[0];
  if (!row) return { hasPassword: false, identities: 0, total: 0 };
  const hasPassword = row.has_password === true;
  const identities = Number(row.identities) || 0;
  return { hasPassword, identities, total: (hasPassword ? 1 : 0) + identities };
}

/**
 * Create a NEW user for a social sign-in (no password, possibly no email).
 *
 * `email` may be null (Telegram). `emailVerified` is set only when the
 * PROVIDER attested the address (e.g. Google's email_verified claim) AND the
 * address did not belong to any existing account — the caller checks that.
 */
export async function createUserFromProvider({ email, displayName, emailVerified }) {
  const res = await query(
    `INSERT INTO users (email, display_name, password_hash, role, email_verified, email_verified_at)
     VALUES ($1, $2, NULL, 'user', $3, $4)
     RETURNING id, email, display_name, role, is_active, email_verified, email_verified_at, created_at`,
    [
      email ?? null,
      displayName,
      emailVerified === true,
      emailVerified === true ? new Date() : null,
    ]
  );
  return res.rows[0];
}
