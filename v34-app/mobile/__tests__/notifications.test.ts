import type { NotificationsLike } from '../src/notifications';
import { setupPushNotifications } from '../src/notifications';
import { makeFakeApi } from './support/fixtures';

function makeNotifications(overrides: Partial<Record<keyof NotificationsLike, jest.Mock>> = {}) {
  const mod = {
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
    requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-token-abc' })),
    ...overrides,
  };
  return mod as unknown as NotificationsLike & typeof mod;
}

describe('push-регистрация', () => {
  it('успешная регистрация честно сообщает, настроен ли push на сервере', async () => {
    const notifications = makeNotifications();
    const registered: string[] = [];
    const { api } = makeFakeApi({
      registerDevice: async (token) => {
        registered.push(token);
        return { ok: true, registered: true, pushConfigured: false, note: 'push на сервере не настроен' };
      },
    });

    const status = await setupPushNotifications({ client: api, notifications });
    expect(status).toMatchObject({ status: 'registered', token: 'fcm-token-abc', serverPushConfigured: false });
    expect(registered).toEqual(['fcm-token-abc']);
    // Канал уведомлений создаётся до запроса токена — иначе Android 13+ не покажет push.
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalled();
  });

  it('без Firebase-конфигурации — статус unavailable, а не «всё хорошо»', async () => {
    const notifications = makeNotifications({
      getDevicePushTokenAsync: jest.fn(async () => { throw new Error('No Firebase App initialized'); }),
    });
    const { api } = makeFakeApi();
    const status = await setupPushNotifications({ client: api, notifications });
    expect(status.status).toBe('unavailable');
    if (status.status === 'unavailable') {
      expect(status.message).toContain('Firebase');
      expect(status.message).toContain('google-services.json');
    }
  });

  it('отказ в разрешении уведомлений фиксируется как denied', async () => {
    const notifications = makeNotifications({
      getPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: false })),
    });
    const { api } = makeFakeApi();
    expect((await setupPushNotifications({ client: api, notifications })).status).toBe('denied');
  });

  it('запрос разрешения выполняется, если оно ещё не выдано', async () => {
    const request = jest.fn(async () => ({ status: 'granted' }));
    const notifications = makeNotifications({
      getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
      requestPermissionsAsync: request,
    });
    const { api } = makeFakeApi();
    const status = await setupPushNotifications({ client: api, notifications });
    expect(request).toHaveBeenCalledTimes(1);
    expect(status.status).toBe('registered');
  });

  it('ошибка регистрации токена на сервере поверхностна и не маскируется', async () => {
    const notifications = makeNotifications();
    const { api } = makeFakeApi({
      registerDevice: async () => { throw new Error('HTTP 429'); },
    });
    const status = await setupPushNotifications({ client: api, notifications });
    expect(status.status).toBe('error');
    if (status.status === 'error') expect(status.message).toContain('HTTP 429');
  });

  it('push можно отключить флагом сборки', async () => {
    const notifications = makeNotifications();
    const { api } = makeFakeApi();
    const status = await setupPushNotifications({ client: api, notifications, enabled: false });
    expect(status.status).toBe('disabled');
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });
});
