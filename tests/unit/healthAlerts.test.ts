/**
 * CRYPTORA — Health → Telegram: дедупликация, cooldown, восстановление.
 *
 * Главное свойство, которое здесь доказывается: ОДНА проблема не порождает
 * поток сообщений, а восстановление сообщается ровно один раз.
 */

import { describe, it, expect } from 'vitest';

import {
  HealthAlerter,
  detectHealthProblems,
  formatAlertText,
  formatRecoveryText,
  formatAge,
} from '../../server/services/health/healthAlerts.js';
import { DEFAULT_HEALTH_THRESHOLDS } from '../../server/services/health/healthThresholds.js';

const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS, alertMinConsecutiveObservations: 2, alertCooldownSeconds: 1800 };

function report(overrides: Record<string, any> = {}) {
  return {
    status: 'ok',
    database: { status: 'ok', latencyMs: 2, errorCode: null },
    marketData: { status: 'ok', ageSeconds: 10 },
    signalMonitor: { status: 'ok', ageSeconds: 15 },
    radarMonitor: { status: 'ok', ageSeconds: 20 },
    strategyScheduler: { status: 'ok', ageSeconds: 5 },
    ...overrides,
  };
}

/** Собирает отправленные тексты, имитируя доставку. */
function spy(result: any = { ok: true }) {
  const sentTexts: string[] = [];
  const codes: string[] = [];
  return {
    sentTexts,
    codes,
    send: async (text: string, code: string) => {
      sentTexts.push(text);
      codes.push(code);
      return result;
    },
  };
}

describe('detectHealthProblems', () => {
  it('здоровый отчёт не даёт проблем', () => {
    expect(detectHealthProblems(report())).toEqual([]);
  });

  it('распознаёт все обязательные коды', () => {
    const problems = detectHealthProblems(report({
      database: { status: 'error', errorCode: 'UNAVAILABLE' },
      marketData: { status: 'stale', ageSeconds: 1200 },
      signalMonitor: { status: 'stale', ageSeconds: 522 },
      radarMonitor: { status: 'error', ageSeconds: 4000 },
      strategyScheduler: { status: 'stale', ageSeconds: 700 },
    }));
    expect(problems.map((p) => p.code).sort()).toEqual([
      'DATABASE_DOWN', 'MARKET_DATA_STALE', 'RADAR_MONITOR_STALE',
      'SIGNAL_MONITOR_STALE', 'STRATEGY_SCHEDULER_STALE',
    ]);
  });

  it('статус starting проблемой не считается: рестарт — не авария', () => {
    expect(detectHealthProblems(report({ signalMonitor: { status: 'starting' } }))).toEqual([]);
  });
});

describe('формат сообщений', () => {
  it('alert читается человеком и содержит возраст цикла', () => {
    const text = formatAlertText({ code: 'SIGNAL_MONITOR_STALE', detail: 'status: stale', ageSeconds: 522 });
    expect(text).toContain('🔴 CRYPTORA HEALTH');
    expect(text).toContain('Signal monitor stale');
    expect(text).toContain('Last cycle: 8m 42s ago');
  });

  it('recovery читается человеком', () => {
    const text = formatRecoveryText('SIGNAL_MONITOR_STALE', 900);
    expect(text).toContain('🟢 CRYPTORA RECOVERED');
    expect(text).toContain('Signal monitor healthy again');
  });

  it('formatAge', () => {
    expect(formatAge(522)).toBe('8m 42s');
    expect(formatAge(45)).toBe('45s');
    expect(formatAge(7200)).toBe('2h 0m');
  });
});

describe('HealthAlerter', () => {
  it('одиночное наблюдение не будит человека; подтверждённое — отправляется', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });

    const stale = report({ signalMonitor: { status: 'stale', ageSeconds: 522 } });

    const first = await alerter.evaluate(stale);
    expect(first.sent).toEqual([]);
    expect(sink.sentTexts).toHaveLength(0);

    t.value += 30_000;
    const second = await alerter.evaluate(stale);
    expect(second.sent).toEqual(['SIGNAL_MONITOR_STALE']);
    expect(sink.sentTexts).toHaveLength(1);
  });

  it('дедупликация + cooldown: одна проблема не шлёт сообщение каждую минуту', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });
    const stale = report({ signalMonitor: { status: 'stale', ageSeconds: 522 } });

    // 60 циклов по 30 секунд = 30 минут непрерывной аварии.
    for (let i = 0; i < 60; i++) {
      await alerter.evaluate(stale);
      t.value += 30_000;
    }

    // Первое сообщение + максимум одно по истечении 30-минутного cooldown.
    expect(sink.sentTexts.length).toBeLessThanOrEqual(2);
    expect(sink.sentTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('после cooldown сообщение повторяется — проблема не забывается', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });
    const stale = report({ signalMonitor: { status: 'stale', ageSeconds: 522 } });

    await alerter.evaluate(stale);
    t.value += 30_000;
    await alerter.evaluate(stale);        // 1-е сообщение
    expect(sink.sentTexts).toHaveLength(1);

    t.value += thresholds.alertCooldownSeconds * 1000 + 1000;
    await alerter.evaluate(stale);        // 2-е сообщение после cooldown
    expect(sink.sentTexts).toHaveLength(2);
  });

  it('восстановление сообщается ровно один раз', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });
    const stale = report({ signalMonitor: { status: 'stale', ageSeconds: 522 } });

    await alerter.evaluate(stale);
    t.value += 30_000;
    await alerter.evaluate(stale);
    expect(sink.sentTexts).toHaveLength(1);

    t.value += 30_000;
    const recovery = await alerter.evaluate(report());
    expect(recovery.recovered).toEqual(['SIGNAL_MONITOR_STALE']);
    expect(sink.sentTexts[1]).toContain('🟢 CRYPTORA RECOVERED');

    // Повторные здоровые отчёты молчат.
    t.value += 30_000;
    await alerter.evaluate(report());
    expect(sink.sentTexts).toHaveLength(2);
  });

  it('проблема, о которой НЕ сообщали, не даёт ложного RECOVERED', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });

    await alerter.evaluate(report({ signalMonitor: { status: 'stale', ageSeconds: 400 } }));
    t.value += 30_000;
    await alerter.evaluate(report());

    expect(sink.sentTexts).toHaveLength(0);
  });

  it('отказ Telegram не считается доставкой: cooldown не замалчивает проблему', async () => {
    const t = { value: 0 };
    const failing = spy({ ok: false });
    const alerter = new HealthAlerter({ now: () => t.value, send: failing.send, thresholds });
    const stale = report({ database: { status: 'error', errorCode: 'UNAVAILABLE' } });

    await alerter.evaluate(stale);
    t.value += 30_000;
    const second = await alerter.evaluate(stale);
    expect(second.sent).toEqual([]);

    t.value += 30_000;
    const third = await alerter.evaluate(stale);
    // Попытки продолжаются, а не глохнут на 30 минут.
    expect(failing.sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(third.sent).toEqual([]);
  });

  it('исключение в доставке не пробрасывается наружу: монитор не падает', async () => {
    const t = { value: 0 };
    const alerter = new HealthAlerter({
      now: () => t.value,
      send: async () => { throw new Error('telegram unreachable'); },
      thresholds,
      log: () => {},
    });
    const stale = report({ marketData: { status: 'stale', ageSeconds: 5000 } });

    await alerter.evaluate(stale);
    t.value += 30_000;
    await expect(alerter.evaluate(stale)).resolves.toBeDefined();
  });

  it('разные проблемы дедуплицируются независимо', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });
    const both = report({
      signalMonitor: { status: 'stale', ageSeconds: 522 },
      radarMonitor: { status: 'stale', ageSeconds: 700 },
    });

    await alerter.evaluate(both);
    t.value += 30_000;
    const second = await alerter.evaluate(both);

    expect(second.sent.sort()).toEqual(['RADAR_MONITOR_STALE', 'SIGNAL_MONITOR_STALE']);
  });

  it('текст alert не содержит секретов', async () => {
    const t = { value: 0 };
    const sink = spy();
    const alerter = new HealthAlerter({ now: () => t.value, send: sink.send, thresholds });
    const stale = report({ database: { status: 'error', errorCode: 'UNAVAILABLE' } });
    await alerter.evaluate(stale);
    t.value += 30_000;
    await alerter.evaluate(stale);

    const text = sink.sentTexts.join('\n');
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).not.toMatch(/\btoken\b/i);
    expect(text).not.toMatch(/\bpassword\b/i);
  });
});
