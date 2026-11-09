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
    expect(c.host).toBe('0.0.0.0');
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
