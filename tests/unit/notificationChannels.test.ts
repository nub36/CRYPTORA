import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const poolModule = await import('../../server/db/pool.js');
const notifications = await import('../../server/services/notificationChannels.js');
const events = await import('../../server/services/notificationEvents.js');

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

beforeAll(() => {});
afterAll(() => {
  events.registerSignalNotificationListener(null);
  poolModule.__setPoolForTests(null);
});

describe('notification secret storage', () => {
  it('encrypts with authenticated AES-256-GCM and never stores plaintext', () => {
    const encrypted = notifications.encryptTelegramToken(TOKEN, process.env.NOTIFICATION_ENCRYPTION_KEY);
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain(TOKEN);
    expect(notifications.decryptTelegramToken(encrypted, process.env.NOTIFICATION_ENCRYPTION_KEY)).toBe(TOKEN);
    const parts = encrypted.split(':');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    expect(() => notifications.decryptTelegramToken(parts.join(':'), process.env.NOTIFICATION_ENCRYPTION_KEY)).toThrow();
  });

  it('accepts positive and negative numeric Telegram chat IDs', () => {
    expect(notifications.isValidTelegramChatId('42')).toBe(true);
    expect(notifications.isValidTelegramChatId('-1001234567890')).toBe(true);
    expect(notifications.isValidTelegramChatId('0')).toBe(false);
    expect(notifications.isValidTelegramChatId('@name')).toBe(false);
  });

  it('starts without a key but fails closed when encryption is requested', () => {
    expect(() => notifications.encryptTelegramToken(TOKEN, '')).toThrow(/32 bytes/);
  });

  it('retains an existing token on unrelated edits and uses a fresh IV on replacement', async () => {
    const oldCiphertext = notifications.encryptTelegramToken(TOKEN, process.env.NOTIFICATION_ENCRYPTION_KEY);
    const persisted: unknown[][] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('SELECT telegram_token_ciphertext')) return { rows: [{ telegram_token_ciphertext: oldCiphertext }] };
        if (sql.includes('INSERT INTO notification_channels')) {
          persisted.push(params);
          return { rows: [{
            browser_enabled: params[1], telegram_enabled: params[2], telegram_chat_id: params[3],
            telegram_token_ciphertext: params[4], webhook_enabled: params[5], webhook_url: params[6],
          }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    poolModule.__setPoolForTests(pool as unknown as Parameters<typeof poolModule.__setPoolForTests>[0]);

    await notifications.saveNotificationChannels('user-a', {
      browser: { enabled: true },
      telegram: { enabled: true, chatId: '42', botToken: '' },
      webhook: { enabled: false, url: '' },
    });
    expect(persisted[0][0]).toBe('user-a');
    expect(persisted[0][4]).toBe(oldCiphertext);

    const replacement = '987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1';
    await notifications.saveNotificationChannels('user-a', {
      browser: { enabled: true },
      telegram: { enabled: true, chatId: '42', botToken: replacement },
      webhook: { enabled: false, url: '' },
    });
    expect(persisted[1][4]).not.toBe(oldCiphertext);
    expect(notifications.decryptTelegramToken(String(persisted[1][4]), process.env.NOTIFICATION_ENCRYPTION_KEY)).toBe(replacement);
  });
});

describe('Telegram Bot API semantics', () => {
  it.each([
    [401, { ok: false, error_code: 401, description: 'Unauthorized' }, 'INVALID_TOKEN'],
    [400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 'CHAT_NOT_FOUND'],
    [403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 'BOT_CANNOT_MESSAGE'],
    [429, { ok: false, error_code: 429, description: 'Too Many Requests' }, 'RATE_LIMITED'],
    [200, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 'CHAT_NOT_FOUND'],
  ])('treats HTTP %s / provider failure as %s', async (status, body, expected) => {
    const fetchFn = vi.fn(async () => Response.json(body, { status }));
    const result = await notifications.sendTelegram(TOKEN, '-1001', 'test', fetchFn);
    expect(result).toMatchObject({ ok: false, code: expected });
  });

  it('requires Telegram ok:true even for 2xx and confirms a valid send', async () => {
    const result = await notifications.sendTelegram(TOKEN, '42', 'test', vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } })));
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it('classifies network errors and timeouts without exposing the token', async () => {
    const network = await notifications.sendTelegram(TOKEN, '42', 'test', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(network.code).toBe('NETWORK_ERROR');
    const timeoutFetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const timeout = await notifications.sendTelegram(TOKEN, '42', 'test', timeoutFetch, 5);
    expect(timeout.code).toBe('TIMEOUT');
    expect(JSON.stringify([network, timeout])).not.toContain(TOKEN);
  });
});

describe('saved config → server signal event → Telegram', () => {
  it('dispatches NEW_SIGNAL with correct sendMessage payload and sanitized delivery log', async () => {
    const encrypted = notifications.encryptTelegramToken(TOKEN, process.env.NOTIFICATION_ENCRYPTION_KEY);
    const logParams: unknown[][] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('SELECT user_id FROM notification_channels')) return { rows: [{ user_id: 'user-1' }] };
        if (sql.includes('SELECT * FROM notification_channels')) return { rows: [{ user_id: 'user-1', telegram_enabled: true, telegram_chat_id: '-1001', telegram_token_ciphertext: encrypted }] };
        if (sql.includes('INSERT INTO notification_delivery_log')) { logParams.push(params); return { rows: [] }; }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    poolModule.__setPoolForTests(pool as unknown as Parameters<typeof poolModule.__setPoolForTests>[0]);
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true, result: { message_id: 9 } }));
    const signal = { id: 'signal-1', symbol: 'BTC/USDT', strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', status: 'ACTIVE' };

    const result = await notifications.dispatchSignalEvent(signal, 'NEW_SIGNAL', fetchFn);

    expect(result[0]).toMatchObject({ status: 'fulfilled', value: { ok: true } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const payload = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({ chat_id: '-1001', disable_web_page_preview: true });
    expect(payload.text).toContain('Новый сигнал');
    expect(payload.text).toContain('BTC/USDT');
    expect(logParams[0]).toEqual(['user-1', 'NEW_SIGNAL', 'signal-1', 'SUCCESS', 200, null, null]);
    expect(JSON.stringify(logParams)).not.toContain(TOKEN);
  });

  it('the production event bridge invokes its registered dispatcher', async () => {
    const listener = vi.fn(async () => undefined);
    events.registerSignalNotificationListener(listener);
    events.emitSignalNotification({ id: 'signal-2' }, 'FILL');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ id: 'signal-2' }, 'FILL'));
  });
});
