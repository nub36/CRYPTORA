import { ApiError, createApiClient } from '../src/api/client';
import { makeList, makeMeta, makeSignal } from './support/fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('api client', () => {
  it('не создаётся без корректного адреса сервера', () => {
    expect(() => createApiClient({ baseUrl: '' })).toThrow(ApiError);
    expect(() => createApiClient({ baseUrl: 'signals.example.com' })).toThrow(ApiError);
    try {
      createApiClient({ baseUrl: 'ftp://x' });
    } catch (e) {
      expect((e as ApiError).kind).toBe('config');
    }
  });

  it('собирает параметры ленты и проверяет форму ответа', async () => {
    const calls: string[] = [];
    const client = createApiClient({
      baseUrl: 'https://signals.test.local/',
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return jsonResponse(makeList([makeSignal()]));
      }) as unknown as typeof fetch,
    });

    const data = await client.getSignals({ limit: 20, status: ['ACTIVE', 'FILLED'], direction: 'LONG', symbol: 'BTCUSDT', cursor: 'abc' });
    expect(data.items).toHaveLength(1);
    expect(calls[0]).toContain('https://signals.test.local/api/v1/signals?');
    expect(calls[0]).toContain('limit=20');
    expect(calls[0]).toContain('status=ACTIVE%2CFILLED');
    expect(calls[0]).toContain('direction=LONG');
    expect(calls[0]).toContain('symbol=BTCUSDT');
    expect(calls[0]).toContain('cursor=abc');
  });

  it('мусорный ответ — ошибка parse, а не «пустой список»', async () => {
    const client = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async () => jsonResponse({ hello: 'world' })) as unknown as typeof fetch,
    });
    await expect(client.getSignals()).rejects.toMatchObject({ kind: 'parse' });
  });

  it('HTTP-ошибка передаёт статус и сообщение сервера', async () => {
    const client = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async () => jsonResponse({ error: 'bad_request', message: 'неверный курсор' }, 400)) as unknown as typeof fetch,
    });
    await expect(client.getSignals()).rejects.toMatchObject({ kind: 'http', status: 400, message: 'неверный курсор' });
  });

  it('сетевая ошибка отличается от таймаута', async () => {
    const network = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch,
    });
    await expect(network.getSignals()).rejects.toMatchObject({ kind: 'network' });

    const timeout = createApiClient({
      baseUrl: 'https://signals.test.local',
      timeoutMs: 5,
      fetchImpl: ((_url: string, init?: RequestInit) => new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          rej(err);
        });
      })) as unknown as typeof fetch,
    });
    await expect(timeout.getSignals()).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('детальный ответ разворачивает поле signal', async () => {
    const signal = makeSignal({ id: 'SIG-1' });
    const client = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async (url: string) => {
        expect(url).toBe('https://signals.test.local/api/v1/signals/SIG-1');
        return jsonResponse({ signal });
      }) as unknown as typeof fetch,
    });
    const got = await client.getSignal('SIG-1');
    expect(got.id).toBe('SIG-1');
    expect(got.initialStopLoss).toBe(60901.53);
  });

  it('без поля signal детальный ответ не принимается за сигнал', async () => {
    const client = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
    });
    await expect(client.getSignal('x')).rejects.toMatchObject({ kind: 'parse' });
  });

  it('meta требует блок strategy', async () => {
    const okClient = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async () => jsonResponse(makeMeta())) as unknown as typeof fetch,
    });
    expect((await okClient.getMeta()).strategy.version).toBe('3.4');

    const badClient = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async () => jsonResponse({ apiVersion: 'v1' })) as unknown as typeof fetch,
    });
    await expect(badClient.getMeta()).rejects.toMatchObject({ kind: 'parse' });
  });

  it('регистрация устройства отправляет токен и платформу POST-ом', async () => {
    let seen: { method?: string; body?: unknown; url?: string } = {};
    const client = createApiClient({
      baseUrl: 'https://signals.test.local',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen = { method: init?.method, body: JSON.parse(String(init?.body)), url };
        return jsonResponse({ ok: true, registered: true, pushConfigured: false, note: null });
      }) as unknown as typeof fetch,
    });
    const res = await client.registerDevice('fcm-token', 'android');
    expect(seen.url).toBe('https://signals.test.local/api/v1/devices');
    expect(seen.method).toBe('POST');
    expect(seen.body).toEqual({ token: 'fcm-token', platform: 'android' });
    expect(res.pushConfigured ?? false).toBe(false);
  });
});
