import { DEFAULT_APP_VERSION, resolveApiBaseUrl, resolveAppVersion } from '../src/config';

describe('конфигурация сборки', () => {
  it('адрес из app.config.js имеет приоритет над переменной окружения', () => {
    expect(resolveApiBaseUrl(
      { extra: { apiBaseUrl: 'https://from-config.example' } },
      { EXPO_PUBLIC_API_BASE_URL: 'https://from-env.example' },
    )).toBe('https://from-config.example');
  });

  it('пустой extra не блокирует переменную окружения', () => {
    expect(resolveApiBaseUrl({ extra: { apiBaseUrl: '  ' } }, { EXPO_PUBLIC_API_BASE_URL: 'https://from-env.example' }))
      .toBe('https://from-env.example');
  });

  it('без адреса возвращается пустая строка — приложение покажет ошибку конфигурации', () => {
    expect(resolveApiBaseUrl(null, {})).toBe('');
    expect(resolveApiBaseUrl({ extra: null }, { EXPO_PUBLIC_API_BASE_URL: '   ' })).toBe('');
    expect(resolveApiBaseUrl(undefined)).toBe('');
  });

  it('версия берётся из конфигурации Expo, иначе — из пакета', () => {
    expect(resolveAppVersion({ version: '1.2.3' })).toBe('1.2.3');
    expect(resolveAppVersion({ version: '' })).toBe(DEFAULT_APP_VERSION);
    expect(resolveAppVersion(undefined)).toBe(DEFAULT_APP_VERSION);
  });
});
