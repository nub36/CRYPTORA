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

/* RNTL 14 работает асинхронно, а findBy* и waitFor по умолчанию ждут 1000 мс.
 * На загруженных CI-раннерах этого не хватает, и тесты падали «на времени», а
 * не на логике. Увеличиваем окно ожидания: проверки остаются теми же. */
try {
  const { configure } = require('@testing-library/react-native');
  configure({ asyncUtilTimeout: 5000 });
} catch {
  // Если библиотеки нет, тесты упадут явно — молча подменять нечего.
}
