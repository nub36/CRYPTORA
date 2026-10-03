import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID_RE = /^-?[1-9]\d*$/;
const TELEGRAM_TIMEOUT_MS = 10_000;

export function isValidTelegramToken(value) {
  return TOKEN_RE.test(String(value ?? '').trim());
}

export function isValidTelegramChatId(value) {
  return CHAT_ID_RE.test(String(value ?? '').trim());
}

function encryptionKey(raw = config.NOTIFICATION_ENCRYPTION_KEY) {
  const value = String(raw ?? '').trim();
  let key;
  if (/^[a-fA-F0-9]{64}$/.test(value)) key = Buffer.from(value, 'hex');
  else {
    try { key = Buffer.from(value, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    const error = new Error('NOTIFICATION_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex characters');
    error.code = 'ENCRYPTION_NOT_CONFIGURED';
    throw error;
  }
  return key;
}

export function encryptTelegramToken(token, keyValue) {
  const key = encryptionKey(keyValue);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token).trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptTelegramToken(envelope, keyValue) {
  const [version, ivRaw, tagRaw, ciphertextRaw] = String(envelope ?? '').split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error('Invalid encrypted token envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(keyValue), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8');
}

function publicConfig(row) {
  return {
    browser: { enabled: Boolean(row?.browser_enabled) },
    telegram: {
      enabled: Boolean(row?.telegram_enabled),
      chatId: row?.telegram_chat_id ?? '',
      tokenConfigured: Boolean(row?.telegram_token_ciphertext),
      botToken: '',
    },
    webhook: { enabled: Boolean(row?.webhook_enabled), url: row?.webhook_url ?? '' },
  };
}

export async function getNotificationChannels(userId) {
  const { rows } = await query('SELECT * FROM notification_channels WHERE user_id = $1', [userId]);
  return publicConfig(rows[0]);
}

export async function saveNotificationChannels(userId, input) {
  const browserEnabled = Boolean(input?.browser?.enabled);
  const telegramEnabled = Boolean(input?.telegram?.enabled);
  const chatId = String(input?.telegram?.chatId ?? '').trim();
  const token = typeof input?.telegram?.botToken === 'string' ? input.telegram.botToken.trim() : '';
  const webhookEnabled = Boolean(input?.webhook?.enabled);
  const webhookUrl = String(input?.webhook?.url ?? '').trim();

  if (telegramEnabled && !isValidTelegramChatId(chatId)) {
    const error = new Error('Некорректный Chat ID'); error.code = 'INVALID_CHAT_ID'; throw error;
  }
  if (token && !isValidTelegramToken(token)) {
    const error = new Error('Некорректный токен'); error.code = 'INVALID_TOKEN'; throw error;
  }
  if (webhookEnabled) {
    let parsed;
    try { parsed = new URL(webhookUrl); } catch { /* handled below */ }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      const error = new Error('Некорректный Webhook URL'); error.code = 'INVALID_WEBHOOK'; throw error;
    }
  }

  const existing = await query('SELECT telegram_token_ciphertext FROM notification_channels WHERE user_id = $1', [userId]);
  const encrypted = token ? encryptTelegramToken(token) : (existing.rows[0]?.telegram_token_ciphertext ?? null);
  if (telegramEnabled && !encrypted) {
    const error = new Error('Токен Telegram не задан'); error.code = 'TOKEN_REQUIRED'; throw error;
  }

  const { rows } = await query(
    `INSERT INTO notification_channels
       (user_id, browser_enabled, telegram_enabled, telegram_chat_id, telegram_token_ciphertext, webhook_enabled, webhook_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET
       browser_enabled=EXCLUDED.browser_enabled,
       telegram_enabled=EXCLUDED.telegram_enabled,
       telegram_chat_id=EXCLUDED.telegram_chat_id,
       telegram_token_ciphertext=EXCLUDED.telegram_token_ciphertext,
       webhook_enabled=EXCLUDED.webhook_enabled,
       webhook_url=EXCLUDED.webhook_url,
       updated_at=now()
     RETURNING *`,
    [userId, browserEnabled, telegramEnabled, chatId, encrypted, webhookEnabled, webhookUrl]
  );
  return publicConfig(rows[0]);
}

function mapTelegramFailure(status, body) {
  const description = String(body?.description ?? '').toLowerCase();
  if (status === 401 || description.includes('unauthorized')) return 'INVALID_TOKEN';
  if (status === 429) return 'RATE_LIMITED';
  if (description.includes('chat not found')) return 'CHAT_NOT_FOUND';
  if (description.includes('bot was blocked') || description.includes('forbidden') || description.includes("can't initiate")) return 'BOT_CANNOT_MESSAGE';
  return status >= 500 ? 'TELEGRAM_UNAVAILABLE' : 'TELEGRAM_REJECTED';
}

export async function sendTelegram(token, chatId, text, fetchFn = fetch, timeoutMs = TELEGRAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    let body = null;
    try { body = await response.json(); } catch { /* invalid provider body */ }
    if (!response.ok || body?.ok !== true) {
      return { ok: false, status: response.status, providerErrorCode: Number(body?.error_code) || null, code: mapTelegramFailure(response.status, body) };
    }
    return { ok: true, status: response.status, providerErrorCode: null, code: null };
  } catch (error) {
    return { ok: false, status: null, providerErrorCode: null, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

async function recordDelivery({ userId, eventType, eventId, result }) {
  await query(
    `INSERT INTO notification_delivery_log
       (user_id, channel, event_type, event_id, result, provider_status, provider_error_code, error_code)
     VALUES ($1,'TELEGRAM',$2,$3,$4,$5,$6,$7)`,
    [userId, eventType, eventId ?? null, result.ok ? 'SUCCESS' : 'FAILURE', result.status, result.providerErrorCode, result.code]
  );
  console.info('[notification-delivery]', JSON.stringify({ channel: 'telegram', eventType, eventId: eventId ?? null, timestamp: new Date().toISOString(), result: result.ok ? 'success' : 'failure', providerStatus: result.status, providerErrorCode: result.providerErrorCode, errorCode: result.code }));
}

export async function deliverSavedTelegram(userId, { eventType, eventId = null, text }, fetchFn = fetch) {
  const { rows } = await query('SELECT * FROM notification_channels WHERE user_id = $1', [userId]);
  const channel = rows[0];
  if (!channel?.telegram_enabled) {
    const result = { ok: false, code: 'NOT_CONFIGURED', status: null, providerErrorCode: null };
    await recordDelivery({ userId, eventType, eventId, result }).catch(() => {});
    return result;
  }
  let result;
  try {
    const token = decryptTelegramToken(channel.telegram_token_ciphertext);
    result = await sendTelegram(token, channel.telegram_chat_id, text, fetchFn);
  } catch {
    result = { ok: false, code: 'SECRET_UNAVAILABLE', status: null, providerErrorCode: null };
  }
  await recordDelivery({ userId, eventType, eventId, result }).catch((error) => {
    console.error('[notification-delivery-log]', JSON.stringify({ channel: 'telegram', eventType, result: 'failure', errorCode: 'LOG_WRITE_FAILED', message: error?.message }));
  });
  return result;
}

export function formatSignalTelegramText(signal, eventType) {
  const labels = { NEW_SIGNAL: 'Новый сигнал', FILL: 'Вход исполнен', OUTCOME: 'Сигнал завершён' };
  return [`CRYPTORA · ${labels[eventType] ?? eventType}`, `${signal.symbol} · ${signal.strategyId} · ${signal.status}`, `Время: ${new Date().toISOString()}`, 'Информационное уведомление. Не является рекомендацией.'].join('\n');
}

export async function dispatchSignalEvent(signal, eventType, fetchFn = fetch) {
  const { rows } = await query('SELECT user_id FROM notification_channels WHERE telegram_enabled = true');
  const settled = await Promise.allSettled(rows.map(({ user_id: userId }) => deliverSavedTelegram(userId, {
    eventType,
    eventId: signal.id,
    text: formatSignalTelegramText(signal, eventType),
  }, fetchFn)));
  return settled;
}
