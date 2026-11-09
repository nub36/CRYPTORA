/**
 * Классификация событий и проекция прогресса.
 *
 * Правила проверяются на всех значимых переходах: вход, TP1, TP2, безубыток,
 * стоп, отмена. Отдельно — запрет выдумывать действующий стоп.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyProgress, classifyTransition, occurredAtFor, projectSignalProgress,
  progressOccurredAt, type SignalSnapshot,
} from '../src/events';

const FILLED: SignalSnapshot = { status: 'FILLED', fillPrice: 100.4, filledAt: '2024-06-01T12:00:00.000Z' };
const ACTIVE: SignalSnapshot = { status: 'ACTIVE', fillPrice: null, createdAt: '2024-06-01T11:00:00.000Z' };

describe('classifyTransition', () => {
  it('вход фиксируется один раз', () => {
    expect(classifyTransition(ACTIVE, FILLED)).toEqual(['FILL']);
    expect(classifyTransition(FILLED, { ...FILLED, status: 'TARGET_REACHED', closeReason: 'TP2' })).not.toContain('FILL');
  });

  it('прямой ACTIVE → терминал даёт вход и терминальный класс', () => {
    expect(classifyTransition(ACTIVE, {
      status: 'TARGET_REACHED', fillPrice: 100.4, closeReason: 'TP2', closedAt: '2024-06-01T15:00:00.000Z',
    })).toEqual(['FILL', 'TP1', 'TP2']);

    expect(classifyTransition(ACTIVE, {
      status: 'INVALIDATED', fillPrice: 100.4, closeReason: 'SL', closedAt: '2024-06-01T15:00:00.000Z',
    })).toEqual(['FILL', 'STOP_LOSS']);

    expect(classifyTransition(ACTIVE, {
      status: 'EXPIRED', fillPrice: null, closeReason: 'EXPIRED', closedAt: '2024-06-01T15:00:00.000Z',
    })).toEqual(['CANCELLED']);
  });

  it('закрытие по безубытку даёт TP1 + BREAKEVEN, по таймауту — CLOSED', () => {
    expect(classifyTransition(FILLED, {
      status: 'CLOSED', fillPrice: 100.4, closeReason: 'TP1_THEN_BE', closedAt: '2024-06-01T15:00:00.000Z',
    })).toEqual(['TP1', 'BREAKEVEN']);

    expect(classifyTransition(FILLED, {
      status: 'CLOSED', fillPrice: 100.4, closeReason: 'TP1_THEN_TIMEOUT', closedAt: '2024-06-01T15:00:00.000Z',
    })).toEqual(['TP1', 'CLOSED']);

    expect(classifyTransition(FILLED, {
      status: 'CLOSED', fillPrice: 100.4, closeReason: 'TIMEOUT', closedAt: '2024-06-01T15:00:00.000Z',
    })).toEqual(['CLOSED']);
  });

  it('нет перехода — нет событий', () => {
    expect(classifyTransition(ACTIVE, null)).toEqual([]);
    expect(classifyTransition(ACTIVE, ACTIVE)).toEqual([]);
  });

  it('время факта берётся из строки, а не «сейчас»', () => {
    expect(occurredAtFor({ ...FILLED, filledAt: '2024-06-01T12:00:00.000Z' }, 'FILL')).toBe('2024-06-01T12:00:00.000Z');
    expect(occurredAtFor({ ...FILLED, createdAt: null }, 'NEW_SIGNAL')).toBeNull();
    expect(occurredAtFor(FILLED, 'TP2')).toBeNull();
  });
});

describe('classifyProgress / progressOccurredAt', () => {
  it('TP1 и BREAKEVEN — только из подтверждённого прогресса ядра', () => {
    expect(classifyProgress(null)).toEqual([]);
    expect(classifyProgress({ tp1Booked: false, tp1At: null, beArmed: false, beArmedAt: null })).toEqual([]);
    expect(classifyProgress({ tp1Booked: true, tp1At: 1, beArmed: false, beArmedAt: null })).toEqual(['TP1']);
    expect(classifyProgress({ tp1Booked: true, tp1At: 1, beArmed: true, beArmedAt: 2 })).toEqual(['TP1', 'BREAKEVEN']);
  });

  it('время прогресс-события — closeTime подтверждающего бара', () => {
    const p = { tp1Booked: true, tp1At: Date.UTC(2024, 5, 1, 12), beArmed: true, beArmedAt: Date.UTC(2024, 5, 1, 13) };
    expect(progressOccurredAt(p, 'TP1')).toBe('2024-06-01T12:00:00.000Z');
    expect(progressOccurredAt(p, 'BREAKEVEN')).toBe('2024-06-01T13:00:00.000Z');
    expect(progressOccurredAt(null, 'TP1')).toBeNull();
  });
});

describe('projectSignalProgress', () => {
  it('действующий стоп существует только для открытой позиции с armed-стопом', () => {
    const p = projectSignalProgress(
      { status: 'FILLED', fillPrice: 100.4 },
      [
        { eventType: 'TP1', occurredAt: '2024-06-01T12:00:00.000Z' },
        { eventType: 'BREAKEVEN', occurredAt: '2024-06-01T13:00:00.000Z' },
      ],
    );
    expect(p.tp1Hit).toBe(true);
    expect(p.breakevenArmed).toBe(true);
    expect(p.currentStop).toBe(100.4);
    expect(p.currentStopBasis).toBe('BE_AT_ENTRY');

    // Нет входа — нет доказанного стопа, даже если событие есть.
    const noFill = projectSignalProgress({ status: 'FILLED', fillPrice: null }, [{ eventType: 'BREAKEVEN', occurredAt: null }]);
    expect(noFill.currentStop).toBeNull();
    expect(noFill.currentStopBasis).toBeNull();
  });

  it('закрытая сделка: TP1/TP2/стоп читаются из статуса и причины', () => {
    const tp2 = projectSignalProgress(
      { status: 'TARGET_REACHED', fillPrice: 100.4, closeReason: 'TP2', closedAt: '2024-06-01T15:00:00.000Z' },
      [],
    );
    expect(tp2.tp1Hit).toBe(true);
    expect(tp2.tp2Hit).toBe(true);
    expect(tp2.tp2HitAt).toBe('2024-06-01T15:00:00.000Z');
    expect(tp2.breakevenArmed).toBe(false); // закрытая позиция — факт из close_reason
    expect(tp2.currentStop).toBeNull();

    const sl = projectSignalProgress(
      { status: 'INVALIDATED', fillPrice: 100.4, closeReason: 'SL', closedAt: '2024-06-01T15:00:00.000Z' },
      [],
    );
    expect(sl.stopHit).toBe(true);
    expect(sl.stopHitAt).toBe('2024-06-01T15:00:00.000Z');
    expect(sl.tp1Hit).toBe(false);

    const be = projectSignalProgress(
      { status: 'CLOSED', fillPrice: 100.4, closeReason: 'TP1_THEN_BE', closedAt: '2024-06-01T15:00:00.000Z' },
      [],
    );
    expect(be.tp1Hit).toBe(true);
    expect(be.stopHit).toBe(false);
    expect(be.currentStop).toBeNull();
  });

  it('без событий и без статуса ничего не выдумывается', () => {
    const p = projectSignalProgress({ status: 'ACTIVE', fillPrice: null }, []);
    expect(p).toEqual({
      tp1Hit: false, tp1HitAt: null, tp2Hit: false, tp2HitAt: null,
      breakevenArmed: false, breakevenArmedAt: null,
      stopHit: false, stopHitAt: null, currentStop: null, currentStopBasis: null,
    });
  });

  it('невалидное время события → null, а не «сейчас»', () => {
    const p = projectSignalProgress({ status: 'FILLED', fillPrice: 100 }, [{ eventType: 'TP1', occurredAt: 'не дата' }]);
    expect(p.tp1Hit).toBe(true);
    expect(p.tp1HitAt).toBeNull();
  });
});
