export interface TelegramResult { ok: boolean; status: number | null; providerErrorCode: number | null; code: string | null }
export type NotificationFetch = (input: string, init?: RequestInit) => Promise<Response>;
export function isValidTelegramToken(value: unknown): boolean;
export function isValidTelegramChatId(value: unknown): boolean;
export function encryptTelegramToken(token: string, keyValue?: string): string;
export function decryptTelegramToken(envelope: string, keyValue?: string): string;
export function getNotificationChannels(userId: string): Promise<Record<string, unknown>>;
export function saveNotificationChannels(userId: string, input: unknown): Promise<Record<string, unknown>>;
export function sendTelegram(token: string, chatId: string, text: string, fetchFn?: NotificationFetch, timeoutMs?: number): Promise<TelegramResult>;
export function deliverSavedTelegram(userId: string, event: { eventType: string; eventId?: string | null; text: string }, fetchFn?: NotificationFetch): Promise<TelegramResult>;
export function formatSignalTelegramText(signal: Record<string, unknown>, eventType: string): string;
export function dispatchSignalEvent(signal: Record<string, unknown>, eventType: string, fetchFn?: NotificationFetch): Promise<PromiseSettledResult<TelegramResult>[]>;
