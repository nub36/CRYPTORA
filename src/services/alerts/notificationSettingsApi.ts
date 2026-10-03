import type { AlertChannelsConfig } from './deliveryChannels';

export class NotificationSettingsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'NotificationSettingsError';
  }
}

async function jsonResponse(res: Response): Promise<Record<string, unknown>> {
  try { return await res.json() as Record<string, unknown>; }
  catch { return {}; }
}

export async function loadNotificationChannels(): Promise<AlertChannelsConfig> {
  const res = await fetch('/api/notifications/channels', { credentials: 'include' });
  const body = await jsonResponse(res);
  if (!res.ok) throw new NotificationSettingsError(String(body.code ?? res.status), String(body.message ?? body.error ?? 'Не удалось загрузить настройки'));
  return body.channels as unknown as AlertChannelsConfig;
}

export async function saveNotificationChannels(channels: AlertChannelsConfig): Promise<AlertChannelsConfig> {
  const res = await fetch('/api/notifications/channels', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(channels),
  });
  const body = await jsonResponse(res);
  if (!res.ok || body.ok !== true) throw new NotificationSettingsError(String(body.code ?? res.status), String(body.message ?? 'Не удалось сохранить'));
  return body.channels as unknown as AlertChannelsConfig;
}

export async function testTelegramChannel(): Promise<string> {
  const res = await fetch('/api/notifications/telegram/test', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await jsonResponse(res);
  if (!res.ok || body.ok !== true) throw new NotificationSettingsError(String(body.code ?? res.status), String(body.message ?? 'Ошибка Telegram'));
  return String(body.message ?? 'Уведомление отправлено');
}
