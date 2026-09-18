import type { AlertChannelId, TriggeredUserAlert } from './alertEvaluator';

/**
 * Каналы доставки алертов: Telegram Bot API и произвольный Webhook.
 * ---------------------------------------------------------------------------
 * Настройки (bot token / chat id / URL) хранятся ТОЛЬКО в localStorage браузера
 * пользователя: у CRYPTORA нет серверной части, секреты никуда не пересылаются,
 * кроме самого Telegram / указанного webhook. Это НЕ торговые ключи бирж
 * (инвариант ROADMAP) — только токен бота-уведомителя, созданного пользователем.
 *
 * Результат доставки честно фиксируется: DELIVERED (ответ 2xx прочитан),
 * SENT_UNCONFIRMED (запрос ушёл в режиме no-cors, ответ непрозрачен),
 * FAILED (сеть/HTTP/конфигурация) — с причиной.
 */
export interface TelegramChannelConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}
export interface WebhookChannelConfig {
  enabled: boolean;
  url: string;
}
export interface AlertChannelsConfig {
  browser: { enabled: boolean };
  telegram: TelegramChannelConfig;
  webhook: WebhookChannelConfig;
}

export const ALERT_CHANNELS_STORAGE_KEY = 'cryptora_alert_channels';
export const ALERT_DELIVERY_LOG_KEY = 'cryptora_alert_delivery_log';

export const DEFAULT_CHANNELS_CONFIG: AlertChannelsConfig = {
  browser: { enabled: false },
  telegram: { enabled: false, botToken: '', chatId: '' },
  webhook: { enabled: false, url: '' },
};

export type DeliveryStatus = 'DELIVERED' | 'SENT_UNCONFIRMED' | 'FAILED' | 'SKIPPED';

export interface DeliveryRecord {
  id: string;
  eventId: string;
  channel: AlertChannelId;
  status: DeliveryStatus;
  detail: string;
  timestamp: string;
}

export function parseChannelsConfig(raw: string | null | undefined): AlertChannelsConfig {
  if (!raw) return structuredCloneSafe(DEFAULT_CHANNELS_CONFIG);
  try {
    const p = JSON.parse(raw) as Partial<AlertChannelsConfig>;
    return {
      browser: { enabled: Boolean(p.browser?.enabled) },
      telegram: {
        enabled: Boolean(p.telegram?.enabled),
        botToken: typeof p.telegram?.botToken === 'string' ? p.telegram.botToken : '',
        chatId: typeof p.telegram?.chatId === 'string' ? p.telegram.chatId : '',
      },
      webhook: {
        enabled: Boolean(p.webhook?.enabled),
        url: typeof p.webhook?.url === 'string' ? p.webhook.url : '',
      },
    };
  } catch {
    return structuredCloneSafe(DEFAULT_CHANNELS_CONFIG);
  }
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Валидация токена бота: `<digits>:<35 символов>` — без сетевого вызова. */
export function isPlausibleBotToken(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Маскировка секрета для UI/журнала. */
export function maskToken(token: string): string {
  const t = token.trim();
  if (t.length < 12) return t ? '••••' : '';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export function formatTelegramText(ev: TriggeredUserAlert): string {
  return [
    `CRYPTORA · алерт ${ev.symbol}`,
    ev.message,
    `Время: ${ev.timestamp}`,
    'Информационное уведомление. Не является рекомендацией и не исполняет сделок.',
  ].join('\n');
}

export function buildWebhookPayload(ev: TriggeredUserAlert): Record<string, unknown> {
  return {
    schema: 'cryptora.alert.v1',
    kind: 'INFORMATIONAL',
    event: ev,
    disclaimer: 'CRYPTORA does not execute trades. Informational alert only.',
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function deliverTelegram(
  cfg: TelegramChannelConfig,
  ev: TriggeredUserAlert,
  fetchFn: FetchLike,
): Promise<Omit<DeliveryRecord, 'id' | 'timestamp'>> {
  const base = { eventId: ev.id, channel: 'TELEGRAM' as const };
  if (!cfg.enabled) return { ...base, status: 'SKIPPED', detail: 'канал выключен' };
  if (!isPlausibleBotToken(cfg.botToken) || !cfg.chatId.trim()) {
    return { ...base, status: 'FAILED', detail: 'некорректный bot token или chat id' };
  }
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${cfg.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId.trim(), text: formatTelegramText(ev), disable_web_page_preview: true }),
    });
    if (!res.ok) {
      let desc = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { description?: string };
        if (j.description) desc = `${desc}: ${j.description}`;
      } catch {
        /* тело не JSON */
      }
      return { ...base, status: 'FAILED', detail: desc };
    }
    return { ...base, status: 'DELIVERED', detail: `chat ${cfg.chatId.trim()}` };
  } catch (e) {
    return { ...base, status: 'FAILED', detail: `сеть: ${(e as Error).message}` };
  }
}

export async function deliverWebhook(
  cfg: WebhookChannelConfig,
  ev: TriggeredUserAlert,
  fetchFn: FetchLike,
): Promise<Omit<DeliveryRecord, 'id' | 'timestamp'>> {
  const base = { eventId: ev.id, channel: 'WEBHOOK' as const };
  if (!cfg.enabled) return { ...base, status: 'SKIPPED', detail: 'канал выключен' };
  if (!isValidWebhookUrl(cfg.url)) return { ...base, status: 'FAILED', detail: 'некорректный URL' };
  const body = JSON.stringify(buildWebhookPayload(ev));
  try {
    const res = await fetchFn(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (res.type === 'opaque') return { ...base, status: 'SENT_UNCONFIRMED', detail: 'ответ непрозрачен (CORS)' };
    return res.ok
      ? { ...base, status: 'DELIVERED', detail: `HTTP ${res.status}` }
      : { ...base, status: 'FAILED', detail: `HTTP ${res.status}` };
  } catch {
    // Типичный случай: endpoint без CORS-заголовков. Повторяем в no-cors: запрос уйдёт, ответ не прочитать.
    try {
      const res = await fetchFn(cfg.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body });
      return { ...base, status: res.type === 'opaque' ? 'SENT_UNCONFIRMED' : 'DELIVERED', detail: 'повтор в режиме no-cors' };
    } catch (e) {
      return { ...base, status: 'FAILED', detail: `сеть: ${(e as Error).message}` };
    }
  }
}
