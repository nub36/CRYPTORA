/**
 * CRYPTORA — Телеметрия циклов, привязка health-alert'ов и read-only контракт
 * диагностического скрипта.
 *
 * Два свойства, которые здесь важнее формы:
 *  • health НЕ создаёт собственного таймера — он питается уже существующими
 *    циклами, и хук не может прервать работу монитора;
 *  • `npm run audit:production-health` физически не способен выполнить
 *    изменяющий запрос.
 */

import { describe, it, expect } from 'vitest';

import {
  CycleTelemetry,
  HealthTelemetryRegistry,
} from '../../server/services/health/telemetry.js';
import {
  registerHealthAlertHook,
  notifyHealthCycle,
  createThrottledHealthAlertHook,
} from '../../server/services/health/healthAlertHook.js';
import { assertReadOnlySql, maskDsn } from '../../scripts/audit-production-health.mjs';
import {
  classifyFreshness,
  aggregateFreshness,
} from '../../server/services/health/marketDataFreshness.js';

describe('CycleTelemetry', () => {
  it('публикует полный набор полей, требуемых health', () => {
    let now = 1_000_000;
    const cycle = new CycleTelemetry('signalMonitor', () => now);

    cycle.markStarted();
    cycle.beginCycle();
    now += 250;
    const snapshot = cycle.completeCycle({ ok: true, inspected: 12, updated: 3, errors: 0 });

    expect(snapshot.lastCycleStartedAt).toBeTruthy();
    expect(snapshot.lastCycleCompletedAt).toBeTruthy();
    expect(snapshot.lastSuccessfulCycleAt).toBeTruthy();
    expect(snapshot.durationMs).toBe(250);
    expect(snapshot.inspected).toBe(12);
    expect(snapshot.updated).toBe(3);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.consecutiveFailures).toBe(0);
  });

  it('неуспешный цикл НЕ двигает lastSuccessfulCycleAt', () => {
    let now = 1_000_000;
    const cycle = new CycleTelemetry('strategyScheduler', () => now);

    cycle.beginCycle();
    cycle.completeCycle({ ok: true });
    const good = cycle.snapshot().lastSuccessfulCycleAt;

    now += 600_000;
    cycle.beginCycle();
    cycle.completeCycle({ ok: false, error: new Error('db down') });

    expect(cycle.snapshot().lastSuccessfulCycleAt).toBe(good);
    expect(cycle.snapshot().consecutiveFailures).toBe(1);
    expect(cycle.snapshot().lastCycleCompletedAt).not.toBe(good);
  });

  it('текст ошибки обрезается — телеметрия не становится свалкой', () => {
    const cycle = new CycleTelemetry('x', () => 0);
    cycle.beginCycle();
    cycle.completeCycle({ ok: false, error: new Error('e'.repeat(5000)) });
    expect(cycle.snapshot().lastError!.length).toBeLessThanOrEqual(200);
  });
});

describe('HealthTelemetryRegistry', () => {
  it('неизвестный поток игнорируется и не роняет горячий путь', () => {
    const registry = new HealthTelemetryRegistry(() => 0);
    expect(() => registry.recordMarketData('не-существует', { receivedAtMs: 0 })).not.toThrow();
  });

  it('хранит оба времени свежести отдельно', () => {
    const registry = new HealthTelemetryRegistry(() => 5_000_000);
    registry.recordMarketData('binance-spot-candles', {
      sourceTimestampMs: 4_000_000, receivedAtMs: 4_999_000, intervalSeconds: 3600,
    });
    const observation = registry.marketDataObservations()['binance-spot-candles'];
    expect(observation.sourceTimestampMs).toBe(4_000_000);
    expect(observation.receivedAtMs).toBe(4_999_000);
    expect(observation.observed).toBe(true);
  });
});

describe('classifyFreshness (контракт свежести)', () => {
  const base = {
    nowMs: 10_000_000,
    staleAfterSeconds: 900,
    errorAfterSeconds: 3600,
    sourceLagAllowanceSeconds: 600,
    intervalSeconds: 3600,
  };

  it('свежие данные', () => {
    expect(classifyFreshness({
      ...base, sourceTimestampMs: base.nowMs - 120_000, receivedAtMs: base.nowMs - 10_000,
    }).status).toBe('ok');
  });

  it('«HTTP прошёл» не делает старый источник свежим', () => {
    const verdict = classifyFreshness({
      ...base, sourceTimestampMs: base.nowMs - 6 * 3_600_000, receivedAtMs: base.nowMs,
    });
    expect(verdict.status).toBe('stale');
    expect(verdict.reason).toBe('SOURCE_AGE_EXCEEDED');
  });

  it('отсутствие наблюдений — не «ok» (fail-closed)', () => {
    expect(classifyFreshness({ ...base, sourceTimestampMs: null, receivedAtMs: null }).status).toBe('stale');
  });

  it('последний запрос упал — stale даже при свежем приёме', () => {
    expect(classifyFreshness({
      ...base, sourceTimestampMs: base.nowMs - 60_000, receivedAtMs: base.nowMs - 1000, lastError: 'HTTP 500',
    }).status).toBe('stale');
  });

  it('агрегация ориентируется на критические потоки', () => {
    expect(aggregateFreshness({
      a: { observed: true, critical: true, status: 'ok' },
      b: { observed: true, critical: false, status: 'stale' },
    })).toBe('ok');
    expect(aggregateFreshness({
      a: { observed: true, critical: true, status: 'stale' },
      b: { observed: true, critical: false, status: 'ok' },
    })).toBe('stale');
  });
});

describe('health alert hook', () => {
  it('без регистрации вызов из цикла — no-op', () => {
    registerHealthAlertHook(null);
    expect(() => notifyHealthCycle()).not.toThrow();
  });

  it('исключение внутри хука не выходит в вызывающий цикл', () => {
    registerHealthAlertHook(() => { throw new Error('boom'); });
    expect(() => notifyHealthCycle()).not.toThrow();
    registerHealthAlertHook(null);
  });

  it('троттлинг: частый цикл не превращается в частую проверку', async () => {
    let now = 0;
    let built = 0;
    const hook = createThrottledHealthAlertHook({
      buildReport: async () => { built += 1; return { body: {} }; },
      alerter: { evaluate: async () => ({ sent: [], suppressed: [], recovered: [] }) },
      minIntervalMs: 60_000,
      now: () => now,
    });

    // 20 тиков монитора по 30 секунд = 10 минут.
    for (let i = 0; i < 20; i++) {
      await hook();
      now += 30_000;
    }

    // Не 20 проверок, а примерно одна в минуту.
    expect(built).toBeLessThanOrEqual(11);
    expect(built).toBeGreaterThan(0);
  });
});

describe('audit:production-health — read-only контракт', () => {
  it('пропускает только читающие запросы', () => {
    for (const sql of ['SELECT 1', '  select * from signals', 'WITH x AS (SELECT 1) SELECT * FROM x', 'SHOW transaction_read_only']) {
      expect(() => assertReadOnlySql(sql)).not.toThrow();
    }
  });

  it('отвергает любой изменяющий запрос ДО отправки на сервер', () => {
    for (const sql of [
      'DELETE FROM signals',
      'UPDATE signals SET status = $1',
      'INSERT INTO signals (id) VALUES ($1)',
      'TRUNCATE signals',
      'DROP TABLE signals',
      'ALTER TABLE signals ADD COLUMN x int',
      'CREATE INDEX i ON signals (id)',
      'GRANT ALL ON signals TO public',
      'COPY signals FROM STDIN',
    ]) {
      expect(() => assertReadOnlySql(sql)).toThrow(/non-read-only/);
    }
  });

  it('маскирует DSN: пароль никогда не печатается', () => {
    const masked = maskDsn('postgresql://cryptora:SuperSecret123@10.0.0.5:5432/cryptora');
    expect(masked).not.toContain('SuperSecret123');
    expect(masked).not.toContain('cryptora:');
    expect(masked).toContain('10.0.0.5');
  });
});
