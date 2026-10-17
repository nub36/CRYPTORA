/**
 * CRYPTORA — Контракт `/api/health`: статусы, пороги, отсутствие секретов.
 *
 * Эти тесты проверяют ПОВЕДЕНИЕ отчёта, а не форму ради формы:
 *  • здоровая система — ok / HTTP 200;
 *  • БД недоступна — error / HTTP 503 (единственный случай 503);
 *  • устаревшие рыночные данные и устаревший монитор — degraded / HTTP 200;
 *  • в ответе нет ни одного секрета.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  buildHealthReport,
  buildReadinessReport,
  classifyCycle,
  checkDatabaseHealth,
} from '../../server/services/health/healthService.js';
import {
  HealthTelemetryRegistry,
  CYCLE_SIGNAL_MONITOR,
  CYCLE_RADAR_MONITOR,
  CYCLE_STRATEGY_SCHEDULER,
  CYCLE_NOTIFICATION_REDELIVERY,
} from '../../server/services/health/telemetry.js';
import { resolveHealthThresholds, DEFAULT_HEALTH_THRESHOLDS } from '../../server/services/health/healthThresholds.js';

const T0 = Date.parse('2026-10-05T12:00:00.000Z');

/** Телеметрия «всё только что отработало успешно». */
function healthyTelemetry(nowRef: { value: number }) {
  const registry = new HealthTelemetryRegistry(() => nowRef.value);
  // Процесс стартовал давно — грейс-период стартапа не маскирует проблемы.
  registry.processStartedAtMs = nowRef.value - 3_600_000;
  for (const name of [CYCLE_SIGNAL_MONITOR, CYCLE_RADAR_MONITOR, CYCLE_STRATEGY_SCHEDULER]) {
    const cycle = registry.cycle(name);
    cycle.markStarted();
    cycle.beginCycle();
    cycle.completeCycle({ ok: true, inspected: 3, updated: 1, errors: 0 });
  }
  registry.recordMarketData('binance-spot-candles', {
    sourceTimestampMs: nowRef.value - 60_000,
    receivedAtMs: nowRef.value - 30_000,
    intervalSeconds: 3600,
  });
  registry.recordMarketData('binance-spot-ticker', {
    sourceTimestampMs: nowRef.value - 5_000,
    receivedAtMs: nowRef.value - 5_000,
  });
  return registry;
}

const dbOk = async () => ({ status: 'ok' as const, latencyMs: 3, errorCode: null });
const dbDown = async () => ({ status: 'error' as const, latencyMs: 2000, errorCode: 'UNAVAILABLE' as const });

describe('health report', () => {
  let now: { value: number };

  beforeEach(() => {
    now = { value: T0 };
  });

  it('здоровая система: status=ok и HTTP 200', async () => {
    const { httpStatus, body } = await buildHealthReport({
      telemetry: healthyTelemetry(now),
      now: () => now.value,
      checkDatabase: dbOk,
    });

    expect(httpStatus).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.database.status).toBe('ok');
    expect(body.marketData.status).toBe('ok');
    expect(body.signalMonitor.status).toBe('ok');
    expect(body.radarMonitor.status).toBe('ok');
    expect(body.strategyScheduler.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.version).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('БД недоступна: status=error и HTTP 503, без текста ошибки драйвера', async () => {
    const { httpStatus, body } = await buildHealthReport({
      telemetry: healthyTelemetry(now),
      now: () => now.value,
      checkDatabase: dbDown,
    });

    expect(httpStatus).toBe(503);
    expect(body.status).toBe('error');
    expect(body.database.status).toBe('error');
    // Категория, а не сообщение pg (оно содержит хост/порт/имя базы).
    expect(body.database.errorCode).toBe('UNAVAILABLE');
    expect(JSON.stringify(body.database)).not.toMatch(/postgres(ql)?:\/\//i);
  });

  it('устаревшие рыночные данные: marketData=stale, общий статус degraded, HTTP 200', async () => {
    const registry = healthyTelemetry(now);
    // Два часа без единого успешного запроса — выше порога error (3600 с).
    now.value += 2 * 3_600_000;
    // Циклы продолжают работать — проблема именно в рынке.
    for (const name of [CYCLE_SIGNAL_MONITOR, CYCLE_RADAR_MONITOR, CYCLE_STRATEGY_SCHEDULER]) {
      registry.cycle(name).beginCycle();
      registry.cycle(name).completeCycle({ ok: true });
    }

    const { httpStatus, body } = await buildHealthReport({
      telemetry: registry,
      now: () => now.value,
      checkDatabase: dbOk,
    });

    expect(body.marketData.status).toBe('error');
    expect(body.status).toBe('degraded');
    // degraded обслуживает трафик: выводить узел из ротации вредно.
    expect(httpStatus).toBe(200);
  });

  it('свежий HTTP-ответ со СТАРЫМ источником всё равно stale', async () => {
    const registry = healthyTelemetry(now);
    // Запрос прошёл только что, но последняя свеча 1h закрылась 5 часов назад.
    registry.recordMarketData('binance-spot-candles', {
      sourceTimestampMs: now.value - 5 * 3_600_000,
      receivedAtMs: now.value,
      intervalSeconds: 3600,
    });

    const { body } = await buildHealthReport({
      telemetry: registry,
      now: () => now.value,
      checkDatabase: dbOk,
    });

    expect(body.marketData.feeds['binance-spot-candles'].status).toBe('stale');
    expect(body.marketData.feeds['binance-spot-candles'].reason).toBe('SOURCE_AGE_EXCEEDED');
    expect(body.status).toBe('degraded');
  });

  it('монитор сигналов без успешного цикла дольше порога: stale', async () => {
    const registry = healthyTelemetry(now);
    now.value += DEFAULT_HEALTH_THRESHOLDS.signalMonitorStaleSeconds * 1000 + 1000;
    // Рынок продолжает обновляться — проблема именно в мониторе.
    registry.recordMarketData('binance-spot-candles', {
      sourceTimestampMs: now.value - 60_000,
      receivedAtMs: now.value,
      intervalSeconds: 3600,
    });

    const { httpStatus, body } = await buildHealthReport({
      telemetry: registry,
      now: () => now.value,
      checkDatabase: dbOk,
    });

    expect(body.signalMonitor.status).toBe('stale');
    expect(body.signalMonitor.ageSeconds).toBeGreaterThanOrEqual(
      DEFAULT_HEALTH_THRESHOLDS.signalMonitorStaleSeconds
    );
    expect(body.status).toBe('degraded');
    expect(httpStatus).toBe(200);
  });

  it('ответ не содержит секретов', async () => {
    const { body } = await buildHealthReport({
      telemetry: healthyTelemetry(now),
      now: () => now.value,
      checkDatabase: dbOk,
    });
    const serialized = JSON.stringify(body);

    for (const forbidden of [
      /postgres(ql)?:\/\//i,       // DATABASE_URL
      /\bpassword\b/i,
      /\btoken\b/i,
      /\bsecret\b/i,
      /\bchat_?id\b/i,
      /@[\w.-]+\.[a-z]{2,}/i,      // email
      /\bbot\d{6,}:/i,             // telegram bot token
    ]) {
      expect(serialized).not.toMatch(forbidden);
    }
  });

  it('телеметрия циклов публикуется целиком', async () => {
    const { body } = await buildHealthReport({
      telemetry: healthyTelemetry(now),
      now: () => now.value,
      checkDatabase: dbOk,
    });
    for (const key of [
      'lastCycleStartedAt', 'lastCycleCompletedAt', 'lastSuccessfulCycleAt',
      'durationMs', 'inspectedSignals', 'updatedSignals', 'errors', 'consecutiveFailures',
    ]) {
      expect(body.signalMonitor).toHaveProperty(key);
    }
  });
});

describe('classifyCycle', () => {
  it('подсистема без единого цикла в грейс-период после старта — starting, а не stale', () => {
    const verdict = classifyCycle(null, { stale: 300, error: 1800 }, T0, T0 - 10_000, 180);
    expect(verdict.status).toBe('starting');
  });

  it('после грейс-периода отсутствие успешного цикла — stale', () => {
    const verdict = classifyCycle(null, { stale: 300, error: 1800 }, T0, T0 - 3_600_000, 180);
    expect(verdict.status).toBe('stale');
    expect(verdict.reason).toBe('NO_SUCCESSFUL_CYCLE');
  });

  it('подряд идущие отказы дают error даже при свежем успешном цикле', () => {
    const snapshot = {
      lastCycleStartedAt: new Date(T0 - 1000).toISOString(),
      lastCycleCompletedAt: new Date(T0 - 500).toISOString(),
      lastSuccessfulCycleAt: new Date(T0 - 1000).toISOString(),
      durationMs: 10, cycles: 20, inspected: 0, updated: 0, errors: 7, consecutiveFailures: 9,
    };
    const verdict = classifyCycle(
      snapshot, { stale: 300, error: 1800, maxConsecutiveFailures: 5 }, T0, T0 - 3_600_000, 180
    );
    expect(verdict.status).toBe('error');
    expect(verdict.reason).toBe('CONSECUTIVE_FAILURES');
  });
});

describe('readiness', () => {
  it('готов, когда БД доступна и подсистемы подняты', async () => {
    const now = { value: T0 };
    const { httpStatus, body } = await buildReadinessReport({
      telemetry: healthyTelemetry(now),
      now: () => now.value,
      checkDatabase: dbOk,
    });
    expect(httpStatus).toBe(200);
    expect(body.status).toBe('ready');
  });

  it('не готов при недоступной БД', async () => {
    const now = { value: T0 };
    const { httpStatus, body } = await buildReadinessReport({
      telemetry: healthyTelemetry(now),
      now: () => now.value,
      checkDatabase: dbDown,
    });
    expect(httpStatus).toBe(503);
    expect(body.status).toBe('not_ready');
  });

  it('не готов, пока критическая подсистема не инициализирована', async () => {
    const now = { value: T0 };
    const registry = new HealthTelemetryRegistry(() => now.value);
    const { httpStatus, body } = await buildReadinessReport({
      telemetry: registry,
      now: () => now.value,
      checkDatabase: dbOk,
    });
    expect(httpStatus).toBe(503);
    expect(body.subsystems.signalMonitor.initialized).toBe(false);
  });
});

describe('checkDatabaseHealth', () => {
  it('реальный SELECT 1 и измеренная задержка', async () => {
    const calls: string[] = [];
    const result = await checkDatabaseHealth({
      pool: { query: async (sql: string) => { calls.push(sql); return { rows: [{ ok: 1 }] }; } },
      timeoutMs: 1000,
    });
    expect(calls).toEqual(['SELECT 1 AS ok']);
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('зависшая БД отсекается таймаутом, а не висит', async () => {
    const result = await checkDatabaseHealth({
      pool: { query: () => new Promise(() => { /* never resolves */ }) },
      timeoutMs: 20,
    });
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('TIMEOUT');
  });

  it('ошибка БД не выносит наружу текст драйвера', async () => {
    const result = await checkDatabaseHealth({
      pool: {
        query: async () => {
          throw new Error('connection to server at "10.0.0.5", port 5432 failed: password authentication failed for user "cryptora"');
        },
      },
      timeoutMs: 1000,
    });
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toMatch(/password|10\.0\.0\.5|5432/);
  });
});

describe('health thresholds', () => {
  it('по умолчанию — безопасные значения', () => {
    const resolved = resolveHealthThresholds({}, () => {});
    expect(resolved).toEqual(DEFAULT_HEALTH_THRESHOLDS);
  });

  it('переопределяются из окружения', () => {
    const resolved = resolveHealthThresholds({ HEALTH_SIGNAL_MONITOR_STALE_SECONDS: '60' }, () => {});
    expect(resolved.signalMonitorStaleSeconds).toBe(60);
  });

  it('мусор в env игнорируется, а не роняет процесс и не печатается', () => {
    const logged: any[] = [];
    const resolved = resolveHealthThresholds(
      { HEALTH_SIGNAL_MONITOR_STALE_SECONDS: 'привет; DROP TABLE signals' },
      (e) => logged.push(e)
    );
    expect(resolved.signalMonitorStaleSeconds).toBe(DEFAULT_HEALTH_THRESHOLDS.signalMonitorStaleSeconds);
    expect(logged[0].variable).toBe('HEALTH_SIGNAL_MONITOR_STALE_SECONDS');
    expect(JSON.stringify(logged)).not.toMatch(/DROP TABLE/);
  });

  it('ноль запрещён: порог 0 означал бы «всё всегда просрочено»', () => {
    const resolved = resolveHealthThresholds({ HEALTH_ALERT_COOLDOWN_SECONDS: '0' }, () => {});
    expect(resolved.alertCooldownSeconds).toBe(DEFAULT_HEALTH_THRESHOLDS.alertCooldownSeconds);
  });

  it('error-порог не может быть ниже stale-порога', () => {
    const resolved = resolveHealthThresholds(
      { HEALTH_MARKET_DATA_STALE_SECONDS: '900', HEALTH_MARKET_DATA_ERROR_SECONDS: '300' },
      () => {}
    );
    expect(resolved.marketDataErrorSeconds).toBe(900);
  });
});

describe('notificationRedelivery observability (non-critical)', () => {
  const T0 = Date.parse('2026-10-05T12:00:00.000Z');

  function registryWithRedelivery(ok = true, startedAtMs = T0 - 3600_000) {
    const reg = new HealthTelemetryRegistry(() => T0);
    reg.processStartedAtMs = startedAtMs;
    const cycle = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    cycle.markStarted();
    if (ok) {
      cycle.beginCycle();
      cycle.completeCycle({ ok: true, inspected: 5, updated: 2, errors: 0 });
    }
    return reg;
  }

  it('успешный цикл worker: status=ok, cycles>0, lastSuccessfulCycleAt не null', async () => {
    const reg = registryWithRedelivery(true);
    const { body } = await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    expect(body.notificationRedelivery).toBeDefined();
    expect(body.notificationRedelivery.status).toBe('ok');
    expect(body.notificationRedelivery.cycles).toBeGreaterThan(0);
    expect(body.notificationRedelivery.lastSuccessfulCycleAt).not.toBeNull();
    expect(body.notificationRedelivery.inspectedSignals).toBe(5);
    expect(body.notificationRedelivery.updatedSignals).toBe(2);
    expect(body.notificationRedelivery.errors).toBe(0);
  });

  it('во время startup grace без успешного цикла: status=starting', async () => {
    const reg = new HealthTelemetryRegistry(() => T0);
    reg.processStartedAtMs = T0 - 30_000; // 30 с назад
    const cycle = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    cycle.markStarted();
    // нет completeCycle — ещё не выполнил
    const { body } = await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    expect(body.notificationRedelivery.status).toBe('starting');
    expect(body.notificationRedelivery.reason).toBe('STARTING');
  });

  it('после grace нет успешных циклов: status=stale', async () => {
    const reg = new HealthTelemetryRegistry(() => T0);
    reg.processStartedAtMs = T0 - 600_000; // 10 мин назад
    const cycle = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    cycle.markStarted();
    // полный цикл не был завершён успешно
    const { body } = await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    expect(body.notificationRedelivery.status).toBe('stale');
    expect(body.notificationRedelivery.reason).toBe('NO_SUCCESSFUL_CYCLE');
  });

  it('последний успешный цикл слишком старый: status=stale', async () => {
    const reg = registryWithRedelivery(true, T0 - 600_000);
    // перезаписываем lastSuccessfulCycleAt на очень старый
    const cycle = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    cycle.completeCycle({ ok: true, inspected: 0, updated: 0, errors: 0 });
    // но processStartedAt старый — сделаем цикл очень старым через snapshot manipulation
    // Проще: создадим регистр с успешным циклом в прошлом
    const oldReg = new HealthTelemetryRegistry(() => T0);
    oldReg.processStartedAtMs = T0 - 600_000;
    const c = oldReg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    c.markStarted();
    c.completeCycle({ ok: true, inspected: 1, updated: 0, errors: 0 });
    // сдвинем lastSuccessfulCycleAt назад через прямое изменение? Нет — snapshot только для чтения.
    // Вместо этого изменяем now: если сейчас T0 + 400_000, цикл 400_000 мс назад = 400с > stale 180
    const { body } = await buildHealthReport({ telemetry: oldReg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 + 250_000 });
    expect(body.notificationRedelivery.status).toBe('stale');
    expect(body.notificationRedelivery.reason).toBe('CYCLE_AGE_EXCEEDED');
  });

  it('последовательные ошибки отражаются: consecutiveFailures увеличивается', async () => {
    const reg = new HealthTelemetryRegistry(() => T0);
    reg.processStartedAtMs = T0 - 3600_000;
    const c = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    c.markStarted();
    // первоначальный успешный цикл (иначе reference=null => stale, не error)
    c.beginCycle();
    c.completeCycle({ ok: true, inspected: 1, updated: 0, errors: 0 });
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('telegram timeout'), errors: 1 });
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('telegram timeout'), errors: 1 });
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('telegram timeout'), errors: 1 });
    const { body } = await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    expect(body.notificationRedelivery.consecutiveFailures).toBe(3);
    expect(body.notificationRedelivery.errors).toBe(1);
    expect(body.notificationRedelivery.status).toBe('error');
    expect(body.notificationRedelivery.reason).toBe('CONSECUTIVE_FAILURES');
  });

  it('non-critical: ошибка Telegram worker не приводит к health.error или 503', async () => {
    const reg = new HealthTelemetryRegistry(() => T0);
    reg.processStartedAtMs = T0 - 3600_000;
    // критические циклы ок
    for (const name of [CYCLE_SIGNAL_MONITOR, CYCLE_RADAR_MONITOR, CYCLE_STRATEGY_SCHEDULER]) {
      const c = reg.cycle(name);
      c.markStarted();
      c.beginCycle();
      c.completeCycle({ ok: true, inspected: 1, updated: 0, errors: 0 });
    }
    reg.recordMarketData('binance-spot-candles', { sourceTimestampMs: T0 - 60_000, receivedAtMs: T0 - 30_000, intervalSeconds: 3600 });
    reg.recordMarketData('binance-spot-ticker', { sourceTimestampMs: T0 - 60_000, receivedAtMs: T0 - 30_000, intervalSeconds: 30 });
    reg.recordMarketData('binance-futures-snapshot', { sourceTimestampMs: T0 - 60_000, receivedAtMs: T0 - 30_000, intervalSeconds: 300 });
    reg.recordMarketData('binance-futures-open-interest', { sourceTimestampMs: T0 - 60_000, receivedAtMs: T0 - 30_000, intervalSeconds: 300 });
    reg.recordMarketData('binance-futures-funding', { sourceTimestampMs: T0 - 60_000, receivedAtMs: T0 - 30_000, intervalSeconds: 300 });
    reg.recordMarketData('kucoin-spot-candles', { sourceTimestampMs: T0 - 60_000, receivedAtMs: T0 - 30_000, intervalSeconds: 3600 });
    const c = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    c.markStarted();
    c.beginCycle();
    c.completeCycle({ ok: true, inspected: 1, updated: 0, errors: 0 });
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('fail'), errors: 1 });
    // повторные ошибки для error
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('fail'), errors: 1 });
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('fail'), errors: 1 });
    const { httpStatus, body } = await buildHealthReport({
      telemetry: reg,
      thresholds: DEFAULT_HEALTH_THRESHOLDS,
      now: () => T0,
      checkDatabase: async () => ({ status: 'ok', latencyMs: 10, errorCode: null }),
    });
    expect(body.notificationRedelivery.status).toBe('error');
    // notificationRedelivery исключён из worst(): при его error общая ошибка НЕ должна быть только из-за Telegram
    expect(body.status).not.toBe('error');
    expect(httpStatus).toBe(200);
    // readiness не зависит от Telegram (notificationRedelivery не в requiredCycles)
    const ready = await buildReadinessReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    expect(ready.body.subsystems).not.toHaveProperty(CYCLE_NOTIFICATION_REDELIVERY);
  });

  it('безопасность: в ответе нет lastError, токенов, chat id, сигналов, SQL', async () => {
    const reg = new HealthTelemetryRegistry(() => T0);
    reg.processStartedAtMs = T0 - 3600_000;
    const c = reg.cycle(CYCLE_NOTIFICATION_REDELIVERY);
    c.markStarted();
    c.beginCycle();
    c.completeCycle({ ok: false, error: new Error('token=abc123 chat=99998 signal=42'), errors: 1 });
    const { body } = await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    const text = JSON.stringify(body.notificationRedelivery);
    expect(text).not.toContain('token=');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('chat=');
    expect(text).not.toContain('signal=');
    expect(text).not.toContain('lastError'); // classifyCycle фильтрует
  });

  it('backward compatibility: существующие ключи не удалены', async () => {
    const reg = registryWithRedelivery(true);
    const { body } = await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('database');
    expect(body).toHaveProperty('marketData');
    expect(body).toHaveProperty('signalMonitor');
    expect(body).toHaveProperty('radarMonitor');
    expect(body).toHaveProperty('strategyScheduler');
    expect(body).toHaveProperty('thresholds');
    expect(body).toHaveProperty('notificationRedelivery');
  });

  it('no side effects: buildHealthReport не запускает worker / sweep / Telegram', async () => {
    // Просто проверяем, что вызов не выбрасывает
    const reg = registryWithRedelivery(true);
    await buildHealthReport({ telemetry: reg, thresholds: DEFAULT_HEALTH_THRESHOLDS, now: () => T0 });
    // buildHealthReport не изменил регистр (read-only)
    expect(reg.cycle(CYCLE_NOTIFICATION_REDELIVERY).snapshot().cycles).toBe(1);
  });
});
