/**
 * Конфигурация Expo. Адрес сервера приходит из окружения сборки:
 *   EXPO_PUBLIC_API_BASE_URL=https://<домен-или-IP>/ npx eas build -p android --profile preview
 *
 * Иконки/сплэш сознательно не заданы: в репозитории нет бинарных ассетов,
 * поэтому используется штатная иконка Expo. Заменить — положить файлы в
 * assets/ и добавить пути в android.adaptiveIcon / icon.
 */
const pkg = require('./package.json');

module.exports = ({ config }) => ({
  ...config,
  name: 'CRYPTORA V3.4',
  slug: 'cryptora-v34',
  version: pkg.version,
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#07090d',
  scheme: 'cryptora-v34',
  assetBundlePatterns: ['**/*'],
  android: {
    package: 'com.nub36.cryptora.v34',
    versionCode: 1,
    // POST_NOTIFICATIONS обязателен для Android 13+.
    permissions: ['POST_NOTIFICATIONS'],
    blockedPermissions: [
      // Приложение не торгует и не читает устройство: лишние разрешения вырезаны.
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
    ],
  },
  plugins: ['expo-notifications'],
  extra: {
    // Реальный адрес подставляет CI/владелец при сборке. Пустая строка — это
    // честное «не настроено», приложение покажет ошибку конфигурации.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || '',
    eas: {
      projectId: process.env.EAS_PROJECT_ID || undefined,
    },
  },
});
