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
