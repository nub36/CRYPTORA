import {
  apiBaseUrlError, checkApiBaseUrl, DEFAULT_APP_VERSION, resolveApiBaseUrl, resolveAppVersion,
} from '../src/config';

describe('конфигурация сборки', () => {
  it('адрес из app.config.js имеет приоритет над переменной окружения', () => {
    expect(resolveApiBaseUrl(
      { extra: { apiBaseUrl: 'https://from-config.mydomain.fi' } },
      { EXPO_PUBLIC_API_BASE_URL: 'https://from-env.mydomain.fi' },
    )).toBe('https://from-config.mydomain.fi');
  });

  it('пустой extra не блокирует переменную окружения', () => {
    expect(resolveApiBaseUrl({ extra: { apiBaseUrl: '  ' } }, { EXPO_PUBLIC_API_BASE_URL: 'https://from-env.mydomain.fi' }))
      .toBe('https://from-env.mydomain.fi');
  });

  it('без адреса возвращается пустая строка — приложение покажет ошибку конфигурации', () => {
    expect(resolveApiBaseUrl(null, {})).toBe('');
    expect(resolveApiBaseUrl({ extra: null }, { EXPO_PUBLIC_API_BASE_URL: '   ' })).toBe('');
    expect(resolveApiBaseUrl(undefined)).toBe('');
  });

  it('заглушка signals.example.com не считается рабочим адресом', () => {
    expect(resolveApiBaseUrl(null, { EXPO_PUBLIC_API_BASE_URL: 'https://signals.example.com' })).toBe('');
    expect(apiBaseUrlError(null, { EXPO_PUBLIC_API_BASE_URL: 'https://signals.example.com' }))
      .toMatch(/заглушка/);
    expect(resolveApiBaseUrl({ extra: { apiBaseUrl: 'https://example.org' } }, {})).toBe('');
  });

  it('http разрешён только для локального эмулятора, путь и параметры — нет', () => {
    expect(resolveApiBaseUrl({ extra: { apiBaseUrl: 'https://signals.mydomain.fi' } }, {}))
      .toBe('https://signals.mydomain.fi');
    expect(resolveApiBaseUrl({ extra: { apiBaseUrl: 'https://signals.mydomain.fi/' } }, {}))
      .toBe('https://signals.mydomain.fi');
    expect(checkApiBaseUrl('http://10.0.2.2:8080')).toEqual({ url: 'http://10.0.2.2:8080', error: null });
    expect(checkApiBaseUrl('http://signals.mydomain.fi').url).toBe('');
    expect(checkApiBaseUrl('http://signals.mydomain.fi').error).toMatch(/HTTPS/);
    expect(checkApiBaseUrl('https://signals.mydomain.fi/api').url).toBe('');
    expect(checkApiBaseUrl('не-url').error).toMatch(/не является URL/);
    expect(checkApiBaseUrl('ftp://signals.mydomain.fi').error).toMatch(/схема/);
  });

  it('версия берётся из конфигурации Expo, иначе — из пакета', () => {
    expect(resolveAppVersion({ version: '1.2.3' })).toBe('1.2.3');
    expect(resolveAppVersion({ version: '' })).toBe(DEFAULT_APP_VERSION);
    expect(resolveAppVersion(undefined)).toBe(DEFAULT_APP_VERSION);
  });
});
