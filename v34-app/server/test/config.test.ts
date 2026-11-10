/**
 * Конфигурация backend'а: значения по умолчанию, валидация окружения и
 * честное состояние push-интеграции.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig, pushConfigState } from '../src/config';

describe('loadConfig', () => {
  it('значения по умолчанию соответствуют стратегии', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8080);
    // Наружу backend не смотрит по умолчанию: только loopback + HTTPS-прокси.
    expect(c.host).toBe('127.0.0.1');
    expect(c.publicBind).toBe(false);
    expect(c.scanIntervalMs).toBe(60_000);
    expect(c.symbols).toContain('BTCUSDT');
    expect(c.pushEnabled).toBe(false);
    expect(c.allowedOrigins).toEqual([]);
  });

  it('читает окружение и валидирует значения', () => {
    const c = loadConfig({
      V34_PORT: '9000',
      V34_SCAN_INTERVAL_SECONDS: '120',
      V34_SYMBOLS: 'BTCUSDT, ETHUSDT',
      V34_ALLOWED_ORIGINS: 'https://example.test',
      V34_PUSH_ENABLED: 'true',
      V34_FCM_PROJECT_ID: 'demo-project',
      V34_FCM_SERVICE_ACCOUNT_FILE: '/run/secrets/fcm.json',
    });
    expect(c.port).toBe(9000);
    expect(c.scanIntervalMs).toBe(120_000);
    expect(c.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(c.allowedOrigins).toEqual(['https://example.test']);
    expect(pushConfigState(c)).toEqual({ enabled: true, configured: true, missing: [] });
  });

  it('внешний bind требует явного разрешения', () => {
    // Без флага — понятная ошибка, а не «тихо открытый» порт.
    expect(() => loadConfig({ V34_HOST: '0.0.0.0' })).toThrow(/V34_HOST=0\.0\.0\.0.*V34_ALLOW_PUBLIC_BIND/s);
    expect(() => loadConfig({ V34_HOST: '10.0.0.5' })).toThrow(/V34_ALLOW_PUBLIC_BIND/);

    const explicit = loadConfig({ V34_HOST: '0.0.0.0', V34_ALLOW_PUBLIC_BIND: 'true' });
    expect(explicit.host).toBe('0.0.0.0');
    expect(explicit.publicBind).toBe(true);

    // Loopback разрешён всегда и не считается «публичным».
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      const c = loadConfig({ V34_HOST: host });
      expect(c.host).toBe(host);
      expect(c.publicBind).toBe(false);
    }
  });

  it('отклоняет невалидную конфигурацию до старта', () => {
    expect(() => loadConfig({ V34_PORT: '70000' })).toThrow(/V34_PORT/);
    expect(() => loadConfig({ V34_SCAN_INTERVAL_SECONDS: '5' })).toThrow(/SCAN_INTERVAL/);
    expect(() => loadConfig({ V34_SYMBOLS: 'btc usdt' })).toThrow(/V34_SYMBOLS/);
  });

  it('push-статус перечисляет недостающие переменные, а не притворяется рабочим', () => {
    const state = pushConfigState(loadConfig({}));
    expect(state.configured).toBe(false);
    expect(state.missing).toEqual(
      expect.arrayContaining(['V34_PUSH_ENABLED=true', 'V34_FCM_PROJECT_ID', 'V34_FCM_SERVICE_ACCOUNT_FILE']),
    );
  });
});
