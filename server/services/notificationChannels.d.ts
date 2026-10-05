/** Результат попытки sendMessage: коды классифицирует mapTelegramFailure. */
export interface TelegramResult {
  ok: boolean;
  status: number | null;
  providerErrorCode: number | null;
  code: string | null;
  /** Telegram 429 parameters.retry_after (ms) или null. */
  retryAfterMs: number | null;
}

export type NotificationFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type NotificationSleep = (ms: number) => Promise<void>;

export function isValidTelegramToken(value: unknown): boolean;
export function isValidTelegramChatId(value: unknown): boolean;
export function encryptTelegramToken(token: string, keyValue?: string): string;
export function decryptTelegramToken(envelope: string, keyValue?: string): string;
export function getNotificationChannels(userId: string): Promise<Record<string, unknown>>;
export function saveNotificationChannels(userId: string, input: unknown): Promise<Record<string, unknown>>;

/** Дополнительные in-flight попытки после первой (transient-коды only). */
export const TELEGRAM_IMMEDIATE_RETRIES: number;
export const TELEGRAM_RETRY_BASE_DELAY_MS: number;
export const TELEGRAM_RETRY_MAX_DELAY_MS: number;
/** Потолок in-flight ожидания 429 retry_after (дольше — durable worker). */
export const TELEGRAM_RETRY_AFTER_CAP_MS: number;

/** Коды, для которых повтор доставки имеет смысл. */
export const TRANSIENT_TELEGRAM_ERROR_CODES: readonly string[];
/** Коды, при которых повтор бессмыслен до изменения конфигурации. */
export const PERMANENT_TELEGRAM_ERROR_CODES: readonly string[];

export function isTransientTelegramErrorCode(code: unknown): boolean;
export function isPermanentTelegramErrorCode(code: unknown): boolean;
/** Задержка перед следующей in-flight попыткой (ms) или null — отдать worker-у. */
export function immediateTelegramRetryDelayMs(result: { retryAfterMs: number | null }, attempt: number): number | null;

export function sendTelegram(
  token: string,
  chatId: string,
  text: string,
  fetchFn?: NotificationFetch,
  timeoutMs?: number,
): Promise<TelegramResult>;

/**
 * Доставка сохранённого Telegram-канала пользователя: до
 * 1 + TELEGRAM_IMMEDIATE_RETRIES попыток для transient-ошибок; одна строка
 * notification_delivery_log на вызов (итог попытки). sleepFn — инъекция
 * для тестов.
 */
export function deliverSavedTelegram(
  userId: string,
  event: { eventType: string; eventId?: string | null; text: string },
  fetchFn?: NotificationFetch,
  sleepFn?: NotificationSleep,
): Promise<TelegramResult>;

export const SIGNAL_TELEGRAM_DISCLAIMER: string;
export function signalEventTimeZone(): string;
export function formatSignalEventTime(value: unknown): string;
export function formatSignalPrice(value: unknown): string;
export function formatSignalTelegramText(signal: Record<string, unknown>, eventType: string): string;
export function dispatchSignalEvent(
  signal: Record<string, unknown>,
  eventType: string,
  fetchFn?: NotificationFetch,
): Promise<PromiseSettledResult<TelegramResult>[]>;
