/* Окружение тестов: нативные модули Expo заменяются детерминированными моками.
 * Секретов здесь нет и быть не может. */

// expo-notifications: тесты не должны требовать Firebase/нативного слоя.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(() => Promise.resolve({ type: 'android', data: 'fcm-test-token' })),
}));

// expo-constants: конфигурация сборки, которую видит приложение.
jest.mock('expo-constants', () => {
  const expoConfig = { version: '0.1.0', extra: { apiBaseUrl: 'https://signals.test.local' } };
  return { __esModule: true, default: { expoConfig }, expoConfig };
});
