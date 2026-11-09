/**
 * Push-уведомления (Firebase Cloud Messaging через expo-notifications).
 *
 * ЧЕСТНОСТЬ ВАЖНЕЕ КРАСОТЫ: функция возвращает статус, а не «успех по
 * умолчанию». Если Firebase-конфигурации нет (нет google-services.json /
 * FCM в приложении), статус будет `unavailable` с объяснением, что настроить.
 * Приложение не утверждает, что push работает, пока сервер не подтвердил
 * регистрацию токена и не сообщил `pushConfigured: true`.
 *
 * Секреты (google-services.json, ключ сервисного аккаунта) в репозиторий не
 * попадают: файл Firebase подкладывается при сборке из безопасного хранилища.
 */
import type { ApiClient } from './api/client';

export type PushStatus =
  | { status: 'registered'; message: string; token: string; serverPushConfigured: boolean }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }
  | { status: 'disabled'; message: string };

export interface PushSetupDeps {
  client: ApiClient;
  /** Подмена модуля уведомлений (тесты). */
  notifications?: NotificationsLike;
  enabled?: boolean;
}

/** Минимальный контракт expo-notifications, который нам реально нужен. */
export interface NotificationsLike {
  setNotificationHandler(handler: {
    handleNotification: () => Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }): void;
  setNotificationChannelAsync(id: string, channel: {
    name: string;
    importance: number;
    vibrationPattern?: number[];
    lightColor?: string;
  }): Promise<unknown>;
  getPermissionsAsync(): Promise<{ status: string; canAskAgain?: boolean }>;
  requestPermissionsAsync(): Promise<{ status: string }>;
  getDevicePushTokenAsync(): Promise<{ type: string; data: string }>;
}

export async function setupPushNotifications(deps: PushSetupDeps): Promise<PushStatus> {
  const { client, enabled = true } = deps;
  if (!enabled) return { status: 'disabled', message: 'push отключён в настройках сборки' };

  let mod: NotificationsLike | null = deps.notifications ?? null;
  if (!mod) {
    try {
      // Динамический импорт: приложение остаётся работоспособным, даже если
      // модуль уведомлений недоступен (например, в Expo Go без нативного слоя).
      mod = (await import('expo-notifications')) as unknown as NotificationsLike;
    } catch {
      return {
        status: 'unavailable',
        message: 'модуль уведомлений недоступен в этой сборке (нужен development/release build с expo-notifications)',
      };
    }
  }

  try {
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    await mod.setNotificationChannelAsync('v34_signals', {
      name: 'Сигналы V3.4',
      importance: 4,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4ade80',
    });

    const current = await mod.getPermissionsAsync();
    let permission = current.status;
    if (permission !== 'granted') {
      if (current.canAskAgain === false) {
        return { status: 'denied', message: 'уведомления запрещены в настройках Android' };
      }
      const asked = await mod.requestPermissionsAsync();
      permission = asked.status;
    }
    if (permission !== 'granted') {
      return { status: 'denied', message: 'пользователь не разрешил уведомления' };
    }

    let token: string;
    try {
      const deviceToken = await mod.getDevicePushTokenAsync();
      token = deviceToken.data;
    } catch (e) {
      return {
        status: 'unavailable',
        message:
          'FCM-токен не получен: в сборке нет Firebase-конфигурации (google-services.json). '
          + 'Нужен Firebase-проект и файл конфигурации при сборке APK. '
          + `Причина: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (!token) return { status: 'unavailable', message: 'FCM вернул пустой токен' };

    try {
      const reg = await client.registerDevice(token, 'android');
      return {
        status: 'registered',
        message: reg.pushConfigured
          ? 'токен зарегистрирован, серверный push настроен'
          : 'токен зарегистрирован, но серверный push не настроен — уведомления не придут',
        token,
        serverPushConfigured: reg.pushConfigured,
      };
    } catch (e) {
      return {
        status: 'error',
        message: `не удалось зарегистрировать токен на сервере: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } catch (e) {
    return { status: 'error', message: `ошибка настройки уведомлений: ${e instanceof Error ? e.message : String(e)}` };
  }
}
