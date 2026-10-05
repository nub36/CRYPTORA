/**
 * CRYPTORA — Инварианты сигнала: provenance, время, монотонность.
 *
 * Эти правила решают один вопрос: может ли такая строка существовать.
 * Торговая математика здесь не проверяется и не меняется.
 */

import { describe, it, expect } from 'vitest';

import {
  validateNewSignal,
  validateLifecycleTimestamps,
  provenanceCompleteness,
  isMonotonicTransition,
  timeframeDurationMs,
  SIGNAL_INVARIANTS,
  HARD_INVARIANTS,
  MAX_SETUP_AGE_BARS,
} from '../../server/services/signalInvariants.js';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const HOUR = 3_600_000;

/** Валидный кандидат: свежая закрытая часовая свеча, полный provenance. */
function candidate(overrides: Record<string, any> = {}) {
  return {
    strategyId: 'V3_4_LIQUIDITY_SWEEP',
    strategyVersion: '3.4.0',
    engineSetupId: 'V3_4_LIQUIDITY_SWEEP-BTCUSDT-1759665600000',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: new Date(NOW - HOUR),
    ...overrides,
  };
}

describe('validateNewSignal', () => {
  it('валидный свежий сигнал проходит', () => {
    expect(validateNewSignal(candidate(), { nowMs: NOW }).ok).toBe(true);
  });

  it('1. production-сигнал из demo-провайдера невозможен', () => {
    const verdict = validateNewSignal(candidate(), { nowMs: NOW, providerIsDemo: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.DEMO_PROVIDER);
  });

  it('2. свеча из будущего отвергается (look-ahead)', () => {
    const verdict = validateNewSignal(
      candidate({ signalCandleTs: new Date(NOW + 2 * HOUR) }), { nowMs: NOW }
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.FUTURE_CANDLE);
  });

  it('2a. расхождение часов в пределах минуты «будущим» не считается', () => {
    const verdict = validateNewSignal(
      candidate({ signalCandleTs: new Date(NOW + 30_000) }), { nowMs: NOW }
    );
    expect(verdict.violations.map((v) => v.code)).not.toContain(SIGNAL_INVARIANTS.FUTURE_CANDLE);
  });

  it('3. просроченная свеча сверх допустимого порога отвергается', () => {
    const verdict = validateNewSignal(
      candidate({ signalCandleTs: new Date(NOW - (MAX_SETUP_AGE_BARS + 5) * HOUR) }), { nowMs: NOW }
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.STALE_CANDLE);
  });

  it('7. strategyVersion обязателен: без него строку не соотнести с кодом', () => {
    const verdict = validateNewSignal(candidate({ strategyVersion: null }), { nowMs: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.MISSING_PROVENANCE);
  });

  it('жёсткий набор (граница записи) содержит только то, что не может быть легитимным', () => {
    expect([...HARD_INVARIANTS].sort()).toEqual([
      SIGNAL_INVARIANTS.DEMO_PROVIDER, SIGNAL_INVARIANTS.FUTURE_CANDLE,
    ].sort());

    // Старый бар при восстановлении архива — законный сценарий записи,
    // поэтому жёсткий набор его не отвергает.
    const verdict = validateNewSignal(
      candidate({ signalCandleTs: new Date(NOW - 400 * HOUR) }),
      { nowMs: NOW, only: HARD_INVARIANTS }
    );
    expect(verdict.ok).toBe(true);
  });

  it('timeframeDurationMs понимает продуктовые таймфреймы', () => {
    expect(timeframeDurationMs('15m')).toBe(900_000);
    expect(timeframeDurationMs('1h')).toBe(HOUR);
    expect(timeframeDurationMs('1D')).toBe(86_400_000);
    expect(timeframeDurationMs('нечто')).toBe(0);
  });
});

describe('validateLifecycleTimestamps (инвариант 6)', () => {
  it('корректный порядок проходит', () => {
    expect(validateLifecycleTimestamps({
      signalCandleTs: new Date(NOW - 3 * HOUR),
      filledAt: new Date(NOW - 2 * HOUR),
      closedAt: new Date(NOW - HOUR),
    }).ok).toBe(true);
  });

  it('вход раньше бара сетапа — нарушение', () => {
    const verdict = validateLifecycleTimestamps({
      signalCandleTs: new Date(NOW - HOUR),
      filledAt: new Date(NOW - 3 * HOUR),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.FILL_BEFORE_SETUP);
  });

  it('выход раньше входа — нарушение', () => {
    const verdict = validateLifecycleTimestamps({
      signalCandleTs: new Date(NOW - 5 * HOUR),
      filledAt: new Date(NOW - 2 * HOUR),
      closedAt: new Date(NOW - 3 * HOUR),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.CLOSE_BEFORE_FILL);
  });

  it('частично заполненные времена проверяются по тому, что есть', () => {
    expect(validateLifecycleTimestamps({ signalCandleTs: new Date(NOW), filledAt: null, closedAt: null }).ok).toBe(true);
    expect(validateLifecycleTimestamps({}).ok).toBe(true);
  });

  it('читает и snake_case (строка БД), и camelCase (форма репозитория)', () => {
    const verdict = validateLifecycleTimestamps({
      signal_candle_ts: new Date(NOW - HOUR),
      closed_at: new Date(NOW - 5 * HOUR),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain(SIGNAL_INVARIANTS.CLOSE_BEFORE_SETUP);
  });
});

describe('isMonotonicTransition (инвариант 5)', () => {
  it('вперёд — можно', () => {
    expect(isMonotonicTransition('ACTIVE', 'FILLED')).toBe(true);
    expect(isMonotonicTransition('FILLED', 'TARGET_REACHED')).toBe(true);
    expect(isMonotonicTransition('ACTIVE', 'EXPIRED')).toBe(true);
  });

  it('назад — нельзя', () => {
    expect(isMonotonicTransition('FILLED', 'ACTIVE')).toBe(false);
    expect(isMonotonicTransition('TARGET_REACHED', 'FILLED')).toBe(false);
    expect(isMonotonicTransition('CLOSED', 'ACTIVE')).toBe(false);
  });

  it('переход между двумя терминальными статусами запрещён (append-only)', () => {
    expect(isMonotonicTransition('TARGET_REACHED', 'INVALIDATED')).toBe(false);
    expect(isMonotonicTransition('EXPIRED', 'CANCELLED')).toBe(false);
  });

  it('тот же статус — не изменение', () => {
    expect(isMonotonicTransition('FILLED', 'FILLED')).toBe(true);
  });
});

describe('provenanceCompleteness (инвариант 8)', () => {
  it('полная строка', () => {
    const verdict = provenanceCompleteness({
      ...candidate(),
      createdAt: new Date(NOW),
      status: 'ACTIVE',
      provenanceStatus: 'VERIFIED',
    });
    expect(verdict.complete).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  it('перечисляет, чего именно не хватает', () => {
    const verdict = provenanceCompleteness({
      strategyId: 'V3_4_LIQUIDITY_SWEEP',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      createdAt: new Date(NOW),
      status: 'ACTIVE',
      provenanceStatus: 'UNKNOWN',
      signalCandleTs: new Date(NOW - HOUR),
    });
    expect(verdict.complete).toBe(false);
    expect(verdict.missing.sort()).toEqual(['engineSetupId', 'strategyVersion']);
  });
});
