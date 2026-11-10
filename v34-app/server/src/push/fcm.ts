/**
 * Push-уведомления через Firebase Cloud Messaging (HTTP v1).
 *
 * ВАЖНО О ЧЕСТНОСТИ СТАТУСА. Firebase-проекта у продукта пока нет, поэтому
 * сервер:
 *   • не требует конфигурации для работы (без неё push просто выключен и
 *     API отвечает `configured: false` с перечнем недостающих переменных);
 *   • никогда не сообщает «доставлено», если отправка не удалась;
 *   • результат каждой попытки пишется в `push_delivery`.
 *
 * Секретов в репозитории нет и быть не может: путь к JSON сервисного аккаунта
 * задаётся переменной окружения `V34_FCM_SERVICE_ACCOUNT_FILE` и лежит ВНЕ Git.
 *
 * Проверено автотестами только на моках (`fetch` внедряется): сквозная доставка
 * на реальное устройство невозможна без Firebase-проекта и Android-сборки.
 */
import fs from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

export type PushErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNREGISTERED'
  | 'INVALID_ARGUMENT'
  | 'AUTH'
  | 'HTTP'
  | 'NETWORK';

export interface PushResult {
  ok: boolean;
  code?: PushErrorCode;
  status?: number;
  message?: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushState {
  /** Включён ли push конфигурацией окружения. */
  enabled: boolean;
  /** Реально ли можно отправлять (все настройки на месте и ключ прочитан). */
  configured: boolean;
  /** Чего не хватает — списком переменных окружения. */
  missing: string[];
  /** Причина, почему push не работает (если есть). */
  reason: string | null;
  projectId: string | null;
}

export interface PushSender {
  readonly state: PushState;
  send(token: string, message: PushMessage): Promise<PushResult>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export interface FcmOptions {
  projectId: string | null;
  serviceAccountFile: string | null;
  enabled: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_BASE = 'https://fcm.googleapis.com/v1/projects';

/** Sender-заглушка: push выключен, статус объясняет почему. */
export class DisabledPushSender implements PushSender {
  readonly state: PushState;
  constructor(missing: string[], reason = 'push не настроен') {
    this.state = {
      enabled: false,
      configured: false,
      missing,
      reason,
      projectId: null,
    };
  }
  async send(): Promise<PushResult> {
    return { ok: false, code: 'NOT_CONFIGURED', message: this.state.reason ?? 'push не настроен' };
  }
}

/**
 * Попытка собрать боевой sender из окружения.
 *
 * Все ошибки конфигурации возвращаются как DisabledPushSender с явной причиной:
 * сервер обязан стартовать и отдавать сигналы даже без push.
 */
export function createPushSender(opts: FcmOptions): PushSender {
  const missing: string[] = [];
  if (!opts.enabled) missing.push('V34_PUSH_ENABLED=true');
  if (!opts.projectId) missing.push('V34_FCM_PROJECT_ID');
  if (!opts.serviceAccountFile) missing.push('V34_FCM_SERVICE_ACCOUNT_FILE');
  if (missing.length > 0) {
    return new DisabledPushSender(missing, 'Firebase Cloud Messaging не настроен: push выключен');
  }
  let account: ServiceAccount;
  try {
    const raw = fs.readFileSync(opts.serviceAccountFile!, 'utf8');
    account = JSON.parse(raw) as ServiceAccount;
  } catch (e) {
    return new DisabledPushSender(missing, `не удалось прочитать сервисный аккаунт: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!account.client_email || !account.private_key) {
    return new DisabledPushSender(missing, 'в сервисном аккаунте нет client_email/private_key');
  }
  if (account.project_id && opts.projectId && account.project_id !== opts.projectId) {
    return new DisabledPushSender(
      missing,
      `project_id в ключе (${account.project_id}) не совпадает с V34_FCM_PROJECT_ID (${opts.projectId})`,
    );
  }
  return new FcmPushSender(opts.projectId!, account, opts.fetchImpl ?? globalThis.fetch, opts.now ?? Date.now);
}

export class FcmPushSender implements PushSender {
  readonly state: PushState;
  private cachedToken: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number,
  ) {
    this.state = {
      enabled: true,
      configured: true,
      missing: [],
      reason: null,
      projectId,
    };
  }

  async send(token: string, message: PushMessage): Promise<PushResult> {
    if (!token || token.length < 10) return { ok: false, code: 'INVALID_ARGUMENT', message: 'пустой токен устройства' };
    let accessToken: string;
    try {
      accessToken = await this.accessToken();
    } catch (e) {
      return { ok: false, code: 'AUTH', message: e instanceof Error ? e.message : String(e) };
    }
    const url = `${FCM_BASE}/${encodeURIComponent(this.projectId)}/messages:send`;
    const body = {
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'HIGH', notification: { channel_id: 'v34_signals' } },
      },
    };
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      const text = await safeText(res);
      const code = classifyFcmError(res.status, text);
      return { ok: false, code, status: res.status, message: text.slice(0, 400) };
    } catch (e) {
      return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) };
    }
  }

  private async accessToken(): Promise<string> {
    const now = this.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - 60_000 > now) return this.cachedToken.value;

    const key = await importPKCS8(this.account.private_key.replace(/\\n/g, '\n'), 'RS256');
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(this.account.token_uri ?? DEFAULT_TOKEN_URI)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + 3600)
      .sign(key);

    const res = await this.fetchImpl(this.account.token_uri ?? DEFAULT_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`токен OAuth не получен (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('в ответе OAuth нет access_token');
    this.cachedToken = {
      value: json.access_token,
      expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Классификация ошибки FCM: «токен мёртв» отделяем от «сервис сломан». */
export function classifyFcmError(status: number, bodyText: string): PushErrorCode {
  if (status === 404 || status === 400) {
    if (/UNREGISTERED|INVALID_ARGUMENT|registration token is not a valid FCM/i.test(bodyText)) return 'UNREGISTERED';
    return 'INVALID_ARGUMENT';
  }
  if (status === 401 || status === 403) return 'AUTH';
  return 'HTTP';
}
