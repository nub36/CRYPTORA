/**
 * CRYPTORA — Audit Log Service
 *
 * Append-only audit trail. NEVER logs passwords, tokens, or secrets.
 */

import { query } from '../db/pool.js';

/**
 * Record an admin mutation.
 *
 * @param {object} params
 * @param {string} params.actorUserId — UUID of the acting admin
 * @param {string} params.action — e.g. 'USER_BLOCK', 'USER_UNBLOCK'
 * @param {string} params.targetType — e.g. 'user'
 * @param {string|null} params.targetId — e.g. UUID of the target
 * @param {object} params.metadata — additional context (no secrets!)
 */
export async function recordAudit({ actorUserId, action, targetType, targetId, metadata }) {
  // Strip any sensitive fields from metadata before persisting
  const safeMetadata = sanitizeMetadata(metadata || {});

  await query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorUserId, action, targetType, targetId, JSON.stringify(safeMetadata)]
  );
}

/**
 * Remove sensitive keys from metadata before persisting.
 */
function sanitizeMetadata(meta) {
  const BLOCKED = new Set([
    'password', 'passwordHash', 'password_hash', 'hash',
    'sessionToken', 'session_token', 'token', 'secret',
    'cookie', 'setCookie', 'set-cookie',
    'apiKey', 'api_key', 'privateKey', 'private_key',
  ]);

  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!BLOCKED.has(key) && !BLOCKED.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Fetch audit log entries (paginated, newest first).
 */
export async function getAuditLog({ limit = 50, offset = 0, actorUserId = null, action = null } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (actorUserId) {
    conditions.push(`actor_user_id = $${paramIndex++}`);
    params.push(actorUserId);
  }
  if (action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(action);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT al.*, u.email AS actor_email, u.display_name AS actor_name
     FROM audit_log al
     JOIN users u ON u.id = al.actor_user_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows;
}