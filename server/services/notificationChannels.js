import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID_RE = /^-?[1-9]\d*$/;
const TELEGRAM_TIMEOUT_MS = 10_000;

/*
 * ── IMMEDIATE RETRY (2026-10-05, PR #56: надёжная доставка lifecycle-событий) ──
 *
 * Гарантия доставки — durable at-least-once attempt с per-user SUCCESS
 * suppression (см. notificationRedelivery.js): сбой доставки НЕ теряет
 * событие навсегда. Здесь — первая линия: ограниченный in-flight retry для
 * TRANSIENT-ошибок прямо в вызове доставки; долговременный redelivery
 * делает отдельный worker по журналу delivery_log.
 *
 * Политика именована и экспортирована: тесты и worker читают те же константы.
 * Более длинные паузы (retry_after > CAP) in-flight НЕ ждут — их забирает
 * worker с экспоненциальным backoff, чтобы не подвешивать процесс.
 */

/** Дополнительные попытки после первой (итого ≤ 1 + N вызовов sendMessage). */
export const TELEGRAM_IMMEDIATE_RETRIES = 2;
/** База backoff между in-flight попытками. */
export const TELEGRAM_RETRY_BASE_DELAY_MS = 1_000;
/** Потолок in-flight backoff. */
export const TELEGRAM_RETRY_MAX_DELAY_MS = 5_000;
/**
 * Потолок in-flight ожидания для 429 retry_after: Telegram просит больше —
 * отдаём событие worker-у (durable backoff), а не спим в горячем пути.
 */
export const TELEGRAM_RETRY_AFTER_CAP_MS = 30_000;

/** Коды, для которых повтор имеет смысл (сеть/провайдер временно недоступен). */
export const TRANSIENT_TELEGRAM_ERROR_CODES = Object.freeze([
  'TIMEOUT',
  'NETWORK_ERROR',
  'TELEGRAM_UNAVAILABLE',
  'RATE_LIMITED',
]);

/**
 * Коды, при которых повтор бессмыслен до изменения конфигурации пользователем
 * (токен/чат/секрет) или самого сообщения: повтор дал бы тот же результат.
 */
export const PERMANENT_TELEGRAM_ERROR_CODES = Object.freeze([
  'INVALID_TOKEN',
  'CHAT_NOT_FOUND',
  'BOT_CANNOT_MESSAGE',
  'SECRET_UNAVAILABLE',
  'NOT_CONFIGURED',
  'TELEGRAM_REJECTED',
]);

export function isTransientTelegramErrorCode(code) {
  return TRANSIENT_TELEGRAM_ERROR_CODES.includes(String(code ?? ''));
}

export function isPermanentTelegramErrorCode(code) {
  return PERMANENT_TELEGRAM_ERROR_CODES.includes(String(code ?? ''));
}

/**
 * Задержка перед следующей in-flight попыткой (ms) или null — «не ждать»:
 * retry_after Telegram длиннее CAP — событие уходит в durable redelivery.
 * Экспортировано для юнит-тестов политики.
 */
export function immediateTelegramRetryDelayMs(result, attempt) {
  let delay = Math.min(
    TELEGRAM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    TELEGRAM_RETRY_MAX_DELAY_MS,
  );
  const retryAfterMs = Number(result?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    if (retryAfterMs > TELEGRAM_RETRY_AFTER_CAP_MS) return null;
    delay = Math.max(delay, retryAfterMs);
  }
  return delay;
}

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

export async function sendTelegram(token, chatId, text, fetchFn = fetch, timeoutMs = TELEGRAM_TIMEOUT_MS, parseMode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(parseMode ? { parse_mode: parseMode } : {}) }),
      signal: controller.signal,
    });
    let body = null;
    try { body = await response.json(); } catch { /* invalid provider body */ }
    if (!response.ok || body?.ok !== true) {
      // 429: Telegram отдаёт parameters.retry_after (секунды) — его читает
      // retry-политика (immediateTelegramRetryDelayMs), in-flight sleep
      // ограничен CAP, долгие паузы уходят в durable redelivery worker.
      const retryAfterSec = Number(body?.parameters?.retry_after);
      return {
        ok: false,
        status: response.status,
        providerErrorCode: Number(body?.error_code) || null,
        code: mapTelegramFailure(response.status, body),
        retryAfterMs: Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : null,
      };
    }
    return { ok: true, status: response.status, providerErrorCode: null, code: null, retryAfterMs: null };
  } catch (error) {
    return { ok: false, status: null, providerErrorCode: null, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', retryAfterMs: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * sendMessage с ограниченным in-flight retry: ТОЛЬКО transient-коды,
 * ≤ TELEGRAM_IMMEDIATE_RETRIES дополнительных попыток, bounded backoff,
 * 429 — с уважением retry_after (в пределах CAP). Permanent-коды и «просит
 * слишком долго» возвращаются сразу — их дорешает durable worker.
 * Каждый вызов = самостоятельная попытка sendMessage со своим таймаутом.
 */
async function sendTelegramWithRetry(token, chatId, text, fetchFn, sleepFn, parseMode) {
  let attempt = 0;
  let result = null;
  for (;;) {
    result = await sendTelegram(token, chatId, text, fetchFn, TELEGRAM_TIMEOUT_MS, parseMode);
    attempt += 1;
    if (result.ok) return result;
    if (!isTransientTelegramErrorCode(result.code)) return result;
    if (attempt > TELEGRAM_IMMEDIATE_RETRIES) return result;
    const delay = immediateTelegramRetryDelayMs(result, attempt);
    if (delay === null) return result;
    await sleepFn(delay);
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

export async function deliverSavedTelegram(
  userId,
  { eventType, eventId = null, text, parseMode },
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const { rows } = await query('SELECT * FROM notification_channels WHERE user_id = $1', [userId]);
  const channel = rows[0];
  if (!channel?.telegram_enabled) {
    const result = { ok: false, code: 'NOT_CONFIGURED', status: null, providerErrorCode: null, retryAfterMs: null };
    await recordDelivery({ userId, eventType, eventId, result }).catch(() => {});
    return result;
  }
  let result;
  try {
    const token = decryptTelegramToken(channel.telegram_token_ciphertext);
    result = await sendTelegramWithRetry(token, channel.telegram_chat_id, text, fetchFn, sleepFn, parseMode);
  } catch {
    result = { ok: false, code: 'SECRET_UNAVAILABLE', status: null, providerErrorCode: null, retryAfterMs: null };
  }
  // Одна строка журнала на вызов доставки (итог попытки после in-flight retry):
  // счётчик попыток redelivery-политики = число вызовов, а не число HTTP-пингов.
  await recordDelivery({ userId, eventType, eventId, result }).catch((error) => {
    console.error('[notification-delivery-log]', JSON.stringify({ channel: 'telegram', eventType, result: 'failure', errorCode: 'LOG_WRITE_FAILED', message: error?.message }));
  });
  return result;
}

/* -------------------------------------------------------------------------- */
/* Формат Telegram-сообщений о событиях сигнала                               */
/* -------------------------------------------------------------------------- */
/*
 * ЕДИНЫЙ форматтер (расширен, а не продублирован): все события жизненного
 * цикла сигнала собираются здесь. Правила:
 *   • показываются только факты из строки `signals` (mapRow) — ничего не
 *     пересчитывается и не выдумывается; отсутствующее значение = «—»;
 *   • время — в часовом поясе ПРОЦЕССА (Intl-resolved, т.е. существующая
 *     настройка окружения TZ; без хардкода зоны), UTC-таймстемпы в БД и
 *     API не затрагиваются;
 *   • дисклеймер проекта обязателен в каждом сообщении.
 */

/** Обязательный дисклеймер проекта. */
export const SIGNAL_TELEGRAM_DISCLAIMER = 'Информационное уведомление. Не является рекомендацией.';

/** Часовой пояс процесса — существующая настройка окружения (TZ), не хардкод. */
export function signalEventTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    // Движки без Intl-резолвера — честный UTC.
  }
  return 'UTC';
}

/** Время события для пользовательского текста: dd.MM.yyyy, HH:mm (GMT+X). */
export function formatSignalEventTime(value) {
  // «Нет времени» ≠ «эпоха Unix»: null/undefined/пустая строка — честное «—».
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  try {
    const zone = signalEventTimeZone();
    const text = new Intl.DateTimeFormat('ru-RU', {
      timeZone: zone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    let offset = 'UTC';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(date);
      offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
    } catch {
      // Короткое имя зоны недоступно (старый движок) — показываем без смещения.
    }
    return offset ? `${text} (${offset})` : text;
  } catch {
    return date.toISOString();
  }
}

/** Цена с точностью по масштабу (PEPE-класс не теряет значащие цифры). */
export function formatSignalPrice(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let digits;
  if (abs >= 1000) digits = 1;
  else if (abs >= 100) digits = 2;
  else if (abs >= 1) digits = 4;
  else if (abs === 0) digits = 2;
  else digits = Math.min(10, Math.max(4, Math.ceil(-Math.log10(abs)) + 3));
  return n.toFixed(digits);
}

/** R с явным знаком: «+2.05 R» / «-1.00 R»; null → null (не выдумываем). */
function formatR(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return null;
  return `${n > 0 ? '+' : ''}${n.toFixed(2)} R`;
}

function line(label, value) {
  return `${label}: ${value}`;
}

function directionText(direction) {
  if (direction === 'LONG') return 'LONG (покупка)';
  if (direction === 'SHORT') return 'SHORT (продажа)';
  return String(direction ?? '—');
}

/** Человекочитаемая причина безсделкового терминала (до входа). */
function noTradeStatusText(status, closeReason) {
  if (status === 'EXPIRED') return 'истёк без входа (коридор не исполнен)';
  if (status === 'UNRESOLVED') return 'исход не определён (вышел за окно данных)';
  // CANCELLED — причина уточняется по exitReason frozen-ядра.
  switch (closeReason) {
    case 'REJECTED_GEOMETRY':
      return 'отменён до входа (геометрия коридора отклонена)';
    case 'NO_CONTIGUOUS_NEXT_BAR':
      return 'отменён до входа (нет смежного бара данных)';
    case 'LADDER_INVALID_AT_FILL':
      return 'отменён до входа (лестница целей неисполнима)';
    default:
      return 'отменён до входа (стоп задет до исполнения)';
  }
}

/** Человекочитаемая причина закрытия сделки по правилам стратегии. */
function closeReasonText(closeReason) {
  switch (closeReason) {
    case 'TIMEOUT':
      return 'таймаут стратегии';
    case 'TP1_THEN_TIMEOUT':
      return 'таймаут стратегии после TP1';
    case 'TRAIL':
      return 'трейлинг-стоп';
    case 'TP1_THEN_BE':
      return 'выход по безубытку после TP1';
    case 'BE':
      return 'выход по безубытку (трейлинг)';
    case 'TP1_THEN_SL':
      return 'стоп-лосс после TP1';
    default:
      return closeReason ? String(closeReason) : 'правило стратегии';
  }
}

/** Эффективные уровни после исполнения (V2.8 сдвигает стоп/цели на дельту). */
function effectiveLevels(signal) {
  // null/undefined ≠ 0: «сдвига не было» означает уровни публикации.
  const shifted = signal?.fillStop !== null && signal?.fillStop !== undefined
    && Number.isFinite(Number(signal.fillStop));
  const stop = shifted ? Number(signal.fillStop) : signal?.stopLoss;
  const targets = Array.isArray(signal?.fillTargets) && signal.fillTargets.length > 0
    ? signal.fillTargets
    : (Array.isArray(signal?.targets) ? signal.targets : []);
  return { stop, targets };
}

/** Лестница целей компактными строками TP1/TP2/… (не более 6 уровней). */
function targetLines(targets, prefix = '') {
  const list = Array.isArray(targets) ? targets : [];
  const shown = list.slice(0, 6).map((t, i) => line(`${prefix}TP${i + 1}`, formatSignalPrice(t)));
  if (list.length > 6) shown.push(`TP… (всего целей: ${list.length})`);
  return shown;
}

function resultLines(signal) {
  const gross = formatR(signal?.resultR);
  const net = formatR(signal?.netResultR);
  if (gross === null) return [];
  return [line('Результат', net !== null ? `${gross} (net ${net})` : gross)];
}

/**
 * Собирает текст Telegram-сообщения о событии сигнала.
 *
 * @param {object} signal строка signals в форме mapRow (недостающие поля — «—»)
 * @param {string} eventType NEW_SIGNAL | FILL | TP1..TPn | BREAKEVEN |
 *        STOP_LOSS | CANCELLED | CLOSED | OUTCOME (легаси) | прочее
 */
export function escapeTelegramHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function expandScientificNotation(text) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, integer, fraction = '', exponentText] = match;
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + Number(exponentText);
  if (decimalPosition <= 0) return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function exactSignalPrice(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return expandScientificNotation(String(value));
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const numericPrice = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  return numericPrice.test(text) ? text : null;
}

function readableStrategy(id) {
  if (!id) return null;
  if (id === 'V3_4_HTF_ZONE_MITIGATION_QUALITY') return 'V3.4 · HTF Zone';
  return String(id).replace(/^V(\d+)_(\d+)_/, 'V$1.$2 · ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Compact HTML formatter shared by primary delivery and durable redelivery. */
export function formatSignalTelegramText(signal, eventType) {
  const s = signal ?? {};
  const titles = {
    NEW_SIGNAL: '🟢 Новый сигнал', FILL: '✅ Вход в сделку', TP1: '🎯 Первая цель достигнута',
    BREAKEVEN: '🛡️ Безубыток', TP2: '🏆 Вторая цель достигнута', STOP_LOSS: '🔴 Stop Loss',
    CANCELLED: '⚪ Сигнал отменён', CLOSED: '🏁 Сделка закрыта',
  };
  const header = titles[eventType] ?? `CRYPTORA · ${eventType === 'OUTCOME' ? 'Сигнал завершён' : eventType}`;
  const rows = [`<b>${escapeTelegramHtml(header)}</b>`];
  const add = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    rows.push(`<b>${escapeTelegramHtml(label)}:</b> <code>${escapeTelegramHtml(value)}</code>`);
  };
  const pair = s.symbol;
  const strategy = readableStrategy(s.strategyId);
  add('Пара', pair);
  add('Стратегия', strategy ? (s.strategyId === 'V3_4_HTF_ZONE_MITIGATION_QUALITY' ? strategy : `${strategy}${s.strategyVersion ? ` · ${s.strategyVersion}` : ''}`) : null);

  if (eventType === 'NEW_SIGNAL') {
    const min = exactSignalPrice(s.entryMin), max = exactSignalPrice(s.entryMax);
    add('Направление', s.direction);
    add('Вход', min && max && min !== max ? `${min} – ${max}` : (min ?? max));
    add('SL', exactSignalPrice(s.stopLoss));
    const targets = Array.isArray(s.targets) ? s.targets : [];
    add('TP1', exactSignalPrice(targets[0])); add('TP2', exactSignalPrice(targets[1]));
    if (s.status) add('Статус', s.status === 'ACTIVE' ? 'Активен — ожидание входа' : s.status);
    add('Время', formatSignalEventTime(s.createdAt ?? s.signalCandleTs));
  } else if (eventType === 'FILL') {
    add('Цена входа', exactSignalPrice(s.fillPrice));
    add('SL', exactSignalPrice(s.fillStop ?? s.stopLoss));
    const targets = Array.isArray(s.fillTargets) && s.fillTargets.length ? s.fillTargets : s.targets;
    add('TP1', exactSignalPrice(targets?.[0])); add('TP2', exactSignalPrice(targets?.[1]));
    if (s.status) add('Статус', s.status);
    add('Время', formatSignalEventTime(s.filledAt));
  } else if (/^TP\d+$/.test(String(eventType))) {
    const isFinal = s.status === 'TARGET_REACHED' && s.closeReason === eventType;
    const isOpen = !isFinal && s.status === 'FILLED';
    const index = Number(String(eventType).slice(2)) - 1;
    const level = isFinal ? (s.closePrice ?? s.fillTargets?.[index] ?? s.targets?.[index])
      : (s.fillTargets?.[index] ?? s.targets?.[index]);
    add('Событие', eventType);
    if (isFinal) add('Результат события', 'финальная цель');
    add('Цена', exactSignalPrice(level));
    if (isFinal) { add('Сделка завершена', 'цель достигнута'); resultLines(s).forEach((x) => rows.push(`<code>${escapeTelegramHtml(x)}</code>`)); }
    if (isOpen) add('Позиция', 'остаётся открытой');
    if (s.status && !isOpen && !isFinal) add('Статус', s.status);
    add('Время', formatSignalEventTime(s.progressAt ?? s.closedAt ?? s.filledAt));
  } else if (eventType === 'BREAKEVEN') {
    rows.push('<code>Стоп переведён в безубыток</code>');
    add('Новый SL', s.fillPrice !== null && s.fillPrice !== undefined ? `${exactSignalPrice(s.fillPrice)} (уровень входа)` : null);
    if (s.status === 'FILLED') add('Позиция', 'остаётся открытой');
    else {
      add('Сделка закрыта', closeReasonText(s.closeReason));
      resultLines(s).forEach((x) => rows.push(`<code>${escapeTelegramHtml(x)}</code>`));
    }
    add('Время', formatSignalEventTime(s.status === 'FILLED' ? (s.progressAt ?? s.filledAt) : s.closedAt));
  } else if (eventType === 'STOP_LOSS') {
    add('Цена выхода', exactSignalPrice(s.closePrice));
    add('Причина', s.closeReason === 'TP1_THEN_SL' ? 'стоп после TP1' : 'стоп-лосс');
    resultLines(s).forEach((x) => rows.push(`<code>${escapeTelegramHtml(x)}</code>`));
    add('Время', formatSignalEventTime(s.closedAt));
  } else if (eventType === 'CANCELLED') {
    const reason = s.status === 'EXPIRED' || s.status === 'UNRESOLVED'
      ? noTradeStatusText(s.status, s.closeReason)
      : (s.closeReason && s.closeReason !== 'CANCELLED' ? noTradeStatusText(s.status, s.closeReason) : null);
    add('Причина', reason ?? (s.status === 'CANCELLED' ? 'отменён до входа (причина не указана)' : null));
    add('Статус', s.status);
    add('Время', formatSignalEventTime(s.closedAt));
  } else if (eventType === 'CLOSED') {
    add('Причина', closeReasonText(s.closeReason));
    add('Цена закрытия', exactSignalPrice(s.closePrice));
    resultLines(s).forEach((x) => rows.push(`<code>${escapeTelegramHtml(x)}</code>`));
    add('Время', formatSignalEventTime(s.closedAt));
  } else {
    add('Статус', s.status);
    add('Время', formatSignalEventTime(s.closedAt ?? s.updatedAt));
  }
  rows.push(escapeTelegramHtml(SIGNAL_TELEGRAM_DISCLAIMER));
  return rows.join('\n');
}

export async function dispatchSignalEvent(signal, eventType, fetchFn = fetch) {
  const { rows } = await query('SELECT user_id FROM notification_channels WHERE telegram_enabled = true');
  const settled = await Promise.allSettled(rows.map(({ user_id: userId }) => deliverSavedTelegram(userId, {
    eventType,
    eventId: signal.id,
    text: formatSignalTelegramText(signal, eventType),
    parseMode: 'HTML',
  }, fetchFn)));
  return settled;
}
