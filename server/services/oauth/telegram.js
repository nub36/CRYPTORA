/**
 * CRYPTORA — Telegram Login Widget verification
 *
 * Official algorithm (https://core.telegram.org/widgets/login):
 *   secret_key        = SHA256(bot_token)                      (raw bytes)
 *   data_check_string = "k1=v1\nk2=v2\n…" over all received fields except
 *                       `hash`, sorted alphabetically by key
 *   valid             ⇔ hex(HMAC_SHA256(data_check_string, secret_key)) == hash
 *
 * Additionally `auth_date` must be fresh (TELEGRAM_AUTH_MAX_AGE_SECONDS) so a
 * captured payload cannot be replayed later. The comparison is constant-time.
 *
 * Telegram never provides an email address — callers must treat email as
 * absent for this provider.
 */

import crypto from 'node:crypto';

/** Fields the widget may send. Anything else is ignored (not signed by us). */
const ALLOWED_FIELDS = new Set([
  'id',
  'first_name',
  'last_name',
  'username',
  'photo_url',
  'auth_date',
  'hash',
]);

/**
 * @param {Record<string, unknown>} params  query params from the widget
 * @param {string} botToken
 * @param {number} maxAgeSeconds
 * @returns {{ ok: true, user: { id: string, firstName: string, lastName: string, username: string } }
 *         | { ok: false, reason: 'missing_hash'|'bad_signature'|'stale'|'missing_fields' }}
 */
export function verifyTelegramLogin(params, botToken, maxAgeSeconds) {
  const data = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (ALLOWED_FIELDS.has(k) && typeof v === 'string') data[k] = v;
  }

  const receivedHash = data.hash;
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) {
    return { ok: false, reason: 'missing_hash' };
  }
  if (!data.id || !data.auth_date) {
    return { ok: false, reason: 'missing_fields' };
  }

  const checkString = Object.keys(data)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(String(botToken)).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(checkString).digest();
  const received = Buffer.from(receivedHash, 'hex');

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) {
    return { ok: false, reason: 'stale' };
  }

  return {
    ok: true,
    user: {
      id: String(data.id),
      firstName: data.first_name ?? '',
      lastName: data.last_name ?? '',
      username: data.username ?? '',
    },
  };
}

/**
 * Build a signed widget-style payload — TEST HELPER ONLY (lets the suite
 * produce valid signatures without contacting Telegram).
 */
export function signTelegramPayloadForTests(fields, botToken) {
  const data = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k !== 'hash' && v !== undefined && v !== null) data[k] = String(v);
  }
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(String(botToken)).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  return { ...data, hash };
}
