/**
 * Firebase Cloud Messaging.
 *
 * ВАЖНО: это НЕ доказательство доставки на устройство. Firebase-проекта нет,
 * поэтому проверяется код отправки на моках: сборка сообщения, OAuth-обмен,
 * классификация ошибок, кэш токена и честный статус «не настроено».
 * Сквозная проверка требует проекта Firebase, сервисного аккаунта и собранного
 * APK с google-services.json.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportPKCS8 } from 'jose';
import {
  classifyFcmError, createPushSender, DisabledPushSender, FcmPushSender,
  type PushMessage,
} from '../src/push/fcm';

const MESSAGE: PushMessage = {
  title: 'Новый сигнал: ASSETA/USDT LONG · V3.4',
  body: 'Вход 100–100.5, SL 98, TP1 101, TP2 103',
  data: { type: 'NEW_SIGNAL', signalId: 'sig-1', event: 'NEW_SIGNAL' },
};

async function serviceAccountFile(projectId = 'demo-project'): Promise<{ file: string; dir: string }> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-fcm-'));
  const file = path.join(dir, 'service-account.json');
  fs.writeFileSync(file, JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: 'pusher@demo-project.iam.gserviceaccount.com',
    private_key: pem,
    token_uri: 'https://oauth2.googleapis.com/token',
  }));
  return { file, dir };
}

describe('состояние интеграции', () => {
  it('без конфигурации push выключен и причина названа', async () => {
    const sender = createPushSender({ projectId: null, serviceAccountFile: null, enabled: false });
    expect(sender).toBeInstanceOf(DisabledPushSender);
    expect(sender.state.configured).toBe(false);
    expect(sender.state.missing).toEqual(
      expect.arrayContaining(['V34_PUSH_ENABLED=true', 'V34_FCM_PROJECT_ID', 'V34_FCM_SERVICE_ACCOUNT_FILE']),
    );
    expect(await sender.send('token-aaaaaaaaaaaaaaaaaaaa', MESSAGE)).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
  });

  it('нечитаемый сервисный аккаунт — явная ошибка, а не «push работает»', () => {
    const sender = createPushSender({
      projectId: 'demo-project', serviceAccountFile: '/nonexistent/fcm.json', enabled: true,
    });
    expect(sender.state.configured).toBe(false);
    expect(sender.state.reason).toContain('не удалось прочитать');
  });

  it('несовпадение project_id в ключе и окружении ловится', async () => {
    const acc = await serviceAccountFile('other-project');
    const sender = createPushSender({
      projectId: 'demo-project', serviceAccountFile: acc.file, enabled: true,
    });
    expect(sender.state.configured).toBe(false);
    expect(sender.state.reason).toContain('не совпадает');
    fs.rmSync(acc.dir, { recursive: true, force: true });
  });
});

describe('FcmPushSender', () => {
  it('обменивает JWT на access token и отправляет сообщение в HTTP v1', async () => {
    const acc = await serviceAccountFile();
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: 'projects/demo-project/messages/1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const sender = createPushSender({
      projectId: 'demo-project', serviceAccountFile: acc.file, enabled: true,
      fetchImpl, now: () => Date.UTC(2024, 5, 1),
    }) as FcmPushSender;
    expect(sender.state.configured).toBe(true);

    const token1 = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(await sender.send(token1, MESSAGE)).toEqual({ ok: true });
    expect(await sender.send(token1, MESSAGE)).toEqual({ ok: true });

    // Токен OAuth запрошен один раз (кэш), сообщений — два.
    const tokenCalls = calls.filter((c) => c.url.includes('oauth2.googleapis.com'));
    const sendCalls = calls.filter((c) => c.url.includes('fcm.googleapis.com'));
    expect(tokenCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0]!.url).toBe('https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
    expect((sendCalls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer ya29.test');

    const payload = JSON.parse(String(sendCalls[0]!.init?.body)) as {
      message: { token: string; notification: { title: string; body: string }; data: Record<string, string> };
    };
    expect(payload.message.token).toBe(token1);
    expect(payload.message.notification.title).toContain('V3.4');
    expect(payload.message.data.signalId).toBe('sig-1');

    fs.rmSync(acc.dir, { recursive: true, force: true });
  });

  it('мёртвый токен устройства распознаётся как UNREGISTERED', async () => {
    const acc = await serviceAccountFile();
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      return new Response(JSON.stringify({
        error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
      }), { status: 404 });
    }) as unknown as typeof fetch;
    const sender = createPushSender({
      projectId: 'demo-project', serviceAccountFile: acc.file, enabled: true, fetchImpl, now: () => 0,
    });
    const res = await sender.send('fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbb', MESSAGE);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('UNREGISTERED');
    fs.rmSync(acc.dir, { recursive: true, force: true });
  });

  it('ошибки OAuth и сети не бросают исключение наружу', async () => {
    const acc = await serviceAccountFile();
    const authFail = (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    const sender = createPushSender({
      projectId: 'demo-project', serviceAccountFile: acc.file, enabled: true, fetchImpl: authFail, now: () => 0,
    });
    expect(await sender.send('fcm-token-cccccccccccccccccccccccccc', MESSAGE)).toMatchObject({ ok: false, code: 'AUTH' });

    const netFail = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const sender2 = createPushSender({
      projectId: 'demo-project', serviceAccountFile: acc.file, enabled: true, fetchImpl: netFail, now: () => 0,
    });
    const res = await sender2.send('fcm-token-dddddddddddddddddddddddddd', MESSAGE);
    expect(res.ok).toBe(false);

    // Пустой/короткий токен отсекается без сети.
    const sender3 = createPushSender({
      projectId: 'demo-project', serviceAccountFile: acc.file, enabled: true,
      fetchImpl: (async () => { throw new Error('не должно вызываться'); }) as unknown as typeof fetch, now: () => 0,
    });
    expect(await sender3.send('short', MESSAGE)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    fs.rmSync(acc.dir, { recursive: true, force: true });
  });
});

describe('classifyFcmError', () => {
  it('различает мёртвый токен, авторизацию и прочие HTTP-ошибки', () => {
    expect(classifyFcmError(404, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe('UNREGISTERED');
    expect(classifyFcmError(400, 'The registration token is not a valid FCM registration token')).toBe('UNREGISTERED');
    expect(classifyFcmError(400, '{"error":"bad payload"}')).toBe('INVALID_ARGUMENT');
    expect(classifyFcmError(401, '')).toBe('AUTH');
    expect(classifyFcmError(403, '')).toBe('AUTH');
    expect(classifyFcmError(503, '')).toBe('HTTP');
  });
});
