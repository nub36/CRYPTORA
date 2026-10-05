/**
 * CRYPTORA — События жизненного цикла сигнала (Telegram).
 *
 * Проверяется новый модуль `server/services/signalLifecycleEvents.js`:
 *
 *   1. КЛАССИФИКАЦИЯ: каждый реальный переход строки `signals` даёт ровно
 *      тот набор событий, который произошёл на сервере, — без искусственных
 *      событий и без потери фактов (в т.ч. «прямой» ACTIVE → терминал,
 *      когда вход и исход записаны одной транзакцией).
 *   2. ДЕДУПЛИКАЦИЯ: повторная запись того же (signal_id, event_type) не
 *      вставляется (ON CONFLICT DO NOTHING) и НЕ отправляет второе
 *      уведомление — это переживает рестарт, потому что живёт в PostgreSQL,
 *      а не в памяти процесса.
 *   3. ФОРМАТ: сообщения понятны человеку (пара/уровни/цены/время),
 *      содержат обязательный дисклеймер проекта и не показывают только
 *      сырые технические состояния.
 *   4. ВРЕМЯ: пользовательский текст рендерится в часовом поясе процесса
 *      (существующая настройка окружения TZ), UTC-таймстемпы не меняются.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const poolModule = await import('../../server/db/pool.js');
const events = await import('../../server/services/signalLifecycleEvents.js');
const notifications = await import('../../server/services/notificationChannels.js');
const notificationBus = await import('../../server/services/notificationEvents.js');

/** Строка signals в форме mapRow — как её отдают репозиторий и монитор. */
function signalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0.0',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-10-01T12:00:00.000Z',
    entryMin: 100,
    entryMax: 101,
    stopLoss: 90,
    tp1: 110,
    tp2: 120,
    targets: [110, 120],
    status: 'ACTIVE',
    createdAt: '2026-10-01T12:00:01.000Z',
    updatedAt: '2026-10-01T12:00:01.000Z',
    fillPrice: null,
    filledAt: null,
    fillStop: null,
    fillTargets: null,
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    ...overrides,
  };
}

beforeAll(() => {
  notificationBus.registerSignalNotificationListener(() => undefined);
});

afterAll(() => {
  notificationBus.registerSignalNotificationListener(null);
  poolModule.__setPoolForTests(null);
});

/* ─────────────────────────── Классификация ─────────────────────────── */

describe('classifyLifecycleTransition — события из реальных переходов', () => {
  const classify = events.classifyLifecycleTransition;

  it('ACTIVE без изменений: событий нет', () => {
    expect(classify(null, signalRow({ status: 'ACTIVE' }))).toEqual([]);
    expect(classify({ status: 'ACTIVE', fillPrice: null }, signalRow({ status: 'ACTIVE' }))).toEqual([]);
  });

  it('ACTIVE → FILLED: ровно одно событие FILL', () => {
    const next = signalRow({ status: 'FILLED', fillPrice: 101, filledAt: '2026-10-01T13:00:00.000Z' });
    expect(classify({ status: 'ACTIVE', fillPrice: null }, next)).toEqual(['FILL']);
  });

  it('повторная синхронизация уже исполненной строки не повторяет FILL', () => {
    const next = signalRow({ status: 'FILLED', fillPrice: 101, filledAt: '2026-10-01T13:00:00.000Z' });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual([]);
  });

  it('FILLED → TARGET_REACHED (TP2): TP1 (доказан правилом R2) + TP2', () => {
    const next = signalRow({
      status: 'TARGET_REACHED', fillPrice: 101, closeReason: 'TP2', closePrice: 120,
      closedAt: '2026-10-01T15:00:00.000Z', resultR: 1.9, netResultR: 1.84,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['TP1', 'TP2']);
  });

  it('FILLED → CLOSED (TP1_THEN_BE): TP1 + BREAKEVEN, без третьего «закрыто»', () => {
    const next = signalRow({
      status: 'CLOSED', fillPrice: 101, closeReason: 'TP1_THEN_BE', closePrice: 101,
      closedAt: '2026-10-01T16:00:00.000Z', resultR: 0.48,
    });
    // «Финальное закрытие» здесь НЕ отдельно: выход по BE уже несёт информацию.
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['TP1', 'BREAKEVEN']);
  });

  it('V2.8 BE-выход: BREAKEVEN без TP-событий (лестница трейлингом не отслеживается)', () => {
    const next = signalRow({
      strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
      status: 'CLOSED', fillPrice: 101, closeReason: 'BE', closePrice: 101,
      closedAt: '2026-10-01T16:00:00.000Z', resultR: 0,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['BREAKEVEN']);
  });

  it('FILLED → INVALIDATED (SL): ровно STOP_LOSS', () => {
    const next = signalRow({
      status: 'INVALIDATED', fillPrice: 101, closeReason: 'SL', closePrice: 90,
      closedAt: '2026-10-01T14:00:00.000Z', resultR: -1, netResultR: -1.05,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['STOP_LOSS']);
  });

  it('FILLED → INVALIDATED (TP1_THEN_SL): TP1 + STOP_LOSS', () => {
    const next = signalRow({
      status: 'INVALIDATED', fillPrice: 101, closeReason: 'TP1_THEN_SL', closePrice: 90,
      resultR: -0.26,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['TP1', 'STOP_LOSS']);
  });

  it('FILLED → CLOSED (TIMEOUT): ровно CLOSED', () => {
    const next = signalRow({
      status: 'CLOSED', fillPrice: 101, closeReason: 'TIMEOUT', closePrice: 105, resultR: 0.24,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['CLOSED']);
  });

  it('FILLED → CLOSED (TP1_THEN_TIMEOUT): TP1 + CLOSED', () => {
    const next = signalRow({
      status: 'CLOSED', fillPrice: 101, closeReason: 'TP1_THEN_TIMEOUT', closePrice: 108, resultR: 0.4,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['TP1', 'CLOSED']);
  });

  it('V2.8 TRAIL-выход: CLOSED (безубыток уже в прошлом — событие не выдумывается)', () => {
    const next = signalRow({
      strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
      status: 'CLOSED', fillPrice: 101, closeReason: 'TRAIL', closePrice: 115, resultR: 1.4,
    });
    expect(classify({ status: 'FILLED', fillPrice: 101 }, next)).toEqual(['CLOSED']);
  });

  it('отмена до входа (нет fill): ровно CANCELLED — не Stop Loss', () => {
    for (const status of ['CANCELLED', 'EXPIRED', 'UNRESOLVED']) {
      const next = signalRow({ status, closeReason: status === 'CANCELLED' ? 'CANCELLED' : null });
      expect(classify({ status: 'ACTIVE', fillPrice: null }, next)).toEqual(['CANCELLED']);
    }
  });

  it('«прямой» ACTIVE → терминал с входом одной записью: FILL не теряется', () => {
    const next = signalRow({
      status: 'TARGET_REACHED', fillPrice: 101, filledAt: '2026-10-01T13:00:00.000Z',
      closeReason: 'TP2', closePrice: 120, resultR: 1.9,
    });
    expect(classify({ status: 'ACTIVE', fillPrice: null }, next)).toEqual(['FILL', 'TP1', 'TP2']);
  });

  it('next отсутствует — событий нет', () => {
    expect(classify({ status: 'ACTIVE', fillPrice: null }, null)).toEqual([]);
  });
});

/* ─────────────────────────── Домен типов ─────────────────────────── */

describe('домен event_type', () => {
  it('фиксированные события распознаются', () => {
    for (const t of ['NEW_SIGNAL', 'FILL', 'BREAKEVEN', 'STOP_LOSS', 'CANCELLED', 'CLOSED']) {
      expect(events.isSignalLifecycleEventType(t)).toBe(true);
    }
  });

  it('лестница TPn распознаётся шаблоном (TP1, TP2, TP10), TP0/TP — нет', () => {
    expect(events.isSignalTargetEventType('TP1')).toBe(true);
    expect(events.isSignalTargetEventType('TP2')).toBe(true);
    expect(events.isSignalTargetEventType('TP10')).toBe(true);
    expect(events.isSignalTargetEventType('TP0')).toBe(false);
    expect(events.isSignalTargetEventType('TP')).toBe(false);
    expect(events.isSignalTargetEventType('OUTCOME')).toBe(false);
  });
});

/* ───────────────────── Дедупликация (журнал событий) ───────────────────── */

describe('recordSignalLifecycleEvent — персистентный дедуп', () => {
  function makePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const inserted = new Set<string>();
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO signal_lifecycle_events')) {
          // Имитация ON CONFLICT (signal_id, event_type) DO NOTHING:
          // RETURNING пуст ⇔ ключ уже вставлен.
          const [signalId, eventType] = params as [string, string];
          const key = `${signalId}|${eventType}`;
          if (inserted.has(key)) return { rows: [] };
          inserted.add(key);
          return { rows: [{ signal_id: signalId, event_type: eventType }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      __inserted: inserted,
      __calls: calls,
    };
    return pool;
  }

  it('неизвестный тип события отклоняется, а не молча пишется', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    await expect(
      events.recordSignalLifecycleEvent('sig-1', { eventType: 'NONSENSE' })
    ).rejects.toThrow(/Unknown signal lifecycle event type/);
  });

  it('dispatchSignalLifecycleEvents отправляет каждое событие один раз', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    const emitted: Array<{ id: unknown; type: string }> = [];
    notificationBus.registerSignalNotificationListener((signal: any, type: string) => {
      emitted.push({ id: signal?.id, type });
    });

    const next = signalRow({
      status: 'TARGET_REACHED', fillPrice: 101, closeReason: 'TP2', closePrice: 120, resultR: 1.9,
    });
    const previous = { status: 'ACTIVE', fillPrice: null };

    const first = await events.dispatchSignalLifecycleEvents(next, previous);
    expect(first).toEqual(['FILL', 'TP1', 'TP2']);
    expect(emitted.map((e) => e.type)).toEqual(['FILL', 'TP1', 'TP2']);

    // Повторный вызов с теми же данными (рестарт/повторный тик): все ключи
    // уже в журнале — отправки нет.
    const second = await events.dispatchSignalLifecycleEvents(next, previous);
    expect(second).toEqual([]);
    expect(emitted).toHaveLength(3);
  });

  it('dispatchNewSignalEvent отправляет NEW_SIGNAL один раз', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    const emitted: string[] = [];
    notificationBus.registerSignalNotificationListener((_s: any, type: string) => emitted.push(type));

    const row = signalRow({ status: 'ACTIVE' });
    expect((await events.dispatchNewSignalEvent(row)).recorded).toBe(true);
    expect((await events.dispatchNewSignalEvent(row)).recorded).toBe(false);
    expect(emitted).toEqual(['NEW_SIGNAL']);
  });

  it('сбой записи журнала не бросается наружу и не отправляет уведомление', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('relation "signal_lifecycle_events" does not exist');
      }),
    };
    poolModule.__setPoolForTests(pool as never);
    const emitted: string[] = [];
    notificationBus.registerSignalNotificationListener((_s: any, type: string) => emitted.push(type));

    const next = signalRow({ status: 'INVALIDATED', fillPrice: 101, closeReason: 'SL', closePrice: 90 });
    await expect(
      events.dispatchSignalLifecycleEvents(next, { status: 'FILLED', fillPrice: 101 })
    ).resolves.toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('отсутствует id строки — нет ни записи, ни отправки', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    expect(await events.dispatchSignalLifecycleEvents({ status: 'FILLED' }, null)).toEqual([]);
    expect(pool.__calls).toHaveLength(0);
    expect((await events.dispatchNewSignalEvent(null)).recorded).toBe(false);
  });
});

/* ───────────── Прогресс ОТКРЫТОЙ позиции (§6, 2026-10-05) ───────────── */

describe('classifyProgressEvents — прогресс открытой позиции из frozen-ядра', () => {
  it('null/undefined/не-объект → событий нет', () => {
    expect(events.classifyProgressEvents(null)).toEqual([]);
    expect(events.classifyProgressEvents(undefined)).toEqual([]);
    expect(events.classifyProgressEvents('TP1' as never)).toEqual([]);
  });

  it('пустой прогресс открытой позиции → событий нет', () => {
    expect(events.classifyProgressEvents({ tp1Booked: false, tp1At: null, beArmed: false, beArmedAt: null })).toEqual([]);
  });

  it('TP1 забронирован, BE ещё не взведён → ровно TP1 (допустимое состояние V3.x)', () => {
    expect(
      events.classifyProgressEvents({ tp1Booked: true, tp1At: 1_800_000_000_000, beArmed: false, beArmedAt: null })
    ).toEqual(['TP1']);
  });

  it('TP1 + BE → причинный порядок [TP1, BREAKEVEN]', () => {
    expect(
      events.classifyProgressEvents({ tp1Booked: true, tp1At: 1, beArmed: true, beArmedAt: 2 })
    ).toEqual(['TP1', 'BREAKEVEN']);
  });

  it('V2.8-форма: beArmed без TP1 → ровно BREAKEVEN (TP1 у трейлинга не выдумывается)', () => {
    expect(
      events.classifyProgressEvents({ tp1Booked: false, tp1At: null, beArmed: true, beArmedAt: 1_800_000_360_000 })
    ).toEqual(['BREAKEVEN']);
  });
});

describe('dispatchSignalProgressEvents — запись, дедуп, время факта', () => {
  function makePool() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const inserted = new Set<string>();
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO signal_lifecycle_events')) {
          const [signalId, eventType] = params as [string, string];
          const key = `${signalId}|${eventType}`;
          if (inserted.has(key)) return { rows: [] };
          inserted.add(key);
          return { rows: [{ signal_id: signalId, event_type: eventType }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      __inserted: inserted,
      __calls: calls,
    };
    return pool;
  }

  it('отправляет TP1 и BREAKEVEN по одному разу; время факта — из прогресса, не «сейчас»', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    const emitted: Array<{ signal: Record<string, unknown>; type: string }> = [];
    notificationBus.registerSignalNotificationListener((signal: any, type: string) => {
      emitted.push({ signal, type });
    });

    const row = signalRow({ status: 'FILLED', fillPrice: 101, filledAt: '2026-10-01T13:00:00.000Z' });
    const progress = {
      tp1Booked: true,
      tp1At: Date.parse('2026-10-01T15:00:00.000Z'),
      beArmed: true,
      beArmedAt: Date.parse('2026-10-01T16:00:00.000Z'),
    };

    const first = await events.dispatchSignalProgressEvents(row, progress);
    expect(first).toEqual(['TP1', 'BREAKEVEN']);
    expect(emitted.map((e) => e.type)).toEqual(['TP1', 'BREAKEVEN']);
    // occurred_at = closeTime подтверждающего бара (tp1At/beArmedAt).
    const tp1Insert = pool.__calls.find((c) => (c.params as string[])[1] === 'TP1')!;
    expect((tp1Insert.params[2] as Date).toISOString()).toBe('2026-10-01T15:00:00.000Z');
    const beInsert = pool.__calls.find((c) => (c.params as string[])[1] === 'BREAKEVEN')!;
    expect((beInsert.params[2] as Date).toISOString()).toBe('2026-10-01T16:00:00.000Z');
    // Полезная нагрузка уведомления несёт время факта для открытой строки.
    expect(emitted[0]!.signal.progressAt).toBe('2026-10-01T15:00:00.000Z');
    expect(emitted[1]!.signal.progressAt).toBe('2026-10-01T16:00:00.000Z');

    // Повторный тик с тем же прогрессом: PK гасит оба события.
    const second = await events.dispatchSignalProgressEvents(row, progress);
    expect(second).toEqual([]);
    expect(emitted).toHaveLength(2);
  });

  it('нет id или нет прогресса — ни записи, ни отправки', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    expect(await events.dispatchSignalProgressEvents({ status: 'FILLED' }, { tp1Booked: true, beArmed: false })).toEqual([]);
    expect(await events.dispatchSignalProgressEvents(signalRow(), null)).toEqual([]);
    expect(await events.dispatchSignalProgressEvents(signalRow(), { tp1Booked: false, beArmed: false, tp1At: null, beArmedAt: null })).toEqual([]);
    expect(pool.__calls).toHaveLength(0);
  });

  it('сбой записи журнала не бросается и не отправляет уведомление', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('db is down');
      }),
    };
    poolModule.__setPoolForTests(pool as never);
    const emitted: string[] = [];
    notificationBus.registerSignalNotificationListener((_s: any, type: string) => emitted.push(type));

    await expect(
      events.dispatchSignalProgressEvents(signalRow(), { tp1Booked: true, tp1At: 1, beArmed: false, beArmedAt: null })
    ).resolves.toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('отсутствует время факта → occurred_at NULL, время не выдумывается', async () => {
    const pool = makePool();
    poolModule.__setPoolForTests(pool as never);
    notificationBus.registerSignalNotificationListener(() => undefined);

    await events.dispatchSignalProgressEvents(signalRow(), { tp1Booked: true, tp1At: null, beArmed: false, beArmedAt: null });
    const insert = pool.__calls.find((c) => (c.params as string[])[1] === 'TP1')!;
    expect(insert.params[2]).toBeNull();
  });
});

/* ─────────────────────────── Формат сообщений ─────────────────────────── */

describe('formatSignalTelegramText — понятные сообщения полного цикла', () => {
  const fmt = notifications.formatSignalTelegramText;

  it('новый сигнал: уровни, стратегия, статус, время, дисклеймер', () => {
    const text = fmt(signalRow(), 'NEW_SIGNAL');
    expect(text).toContain('🟢 CRYPTORA — Новый сигнал');
    expect(text).toContain('BTC/USDT');
    expect(text).toContain('V3_0_HTF_LIQUIDATION_TRAP');
    expect(text).toContain('Активен');
    expect(text).toContain('SL: 90.0000');
    expect(text).toContain('TP1: 110.00');
    expect(text).toContain('TP2: 120.00');
    expect(text).toContain('Вход: 100.00 – 101.00');
    expect(text).toContain('Время:');
    expect(text).toContain('Информационное уведомление. Не является рекомендацией.');
  });

  it('вход: цена входа, эффективные уровни и время бара входа', () => {
    const text = fmt(
      signalRow({ status: 'FILLED', fillPrice: 101, filledAt: '2026-10-01T13:00:00.000Z' }),
      'FILL'
    );
    expect(text).toContain('🎯 CRYPTORA — Вход');
    expect(text).toContain('Цена входа: 101.00');
    expect(text).toContain('SL: 90.0000');
    expect(text).toContain('Время:');
    expect(text).toContain('Информационное уведомление. Не является рекомендацией.');
  });

  it('вход V2.8 показывает сдвинутые уровни исполнения (fillStop/fillTargets)', () => {
    const text = fmt(
      signalRow({
        strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
        status: 'FILLED',
        fillPrice: 202,
        fillStop: 190,
        fillTargets: [215, 230],
      }),
      'FILL'
    );
    expect(text).toContain('SL: 190.00');
    expect(text).toContain('TP1: 215.00');
    expect(text).not.toContain('TP1: 110');
  });

  it('TP2 (финальная цель): цена, завершение сделки и результат в R', () => {
    const text = fmt(
      signalRow({
        status: 'TARGET_REACHED', fillPrice: 101, closeReason: 'TP2', closePrice: 120,
        resultR: 1.9, netResultR: 1.84,
      }),
      'TP2'
    );
    expect(text).toContain('✅ CRYPTORA — TP2');
    expect(text).toContain('финальная цель');
    expect(text).toContain('Цена: 120.00');
    expect(text).toContain('+1.90 R');
    expect(text).toContain('net +1.84 R');
  });

  it('TP1: цена первой цели', () => {
    const text = fmt(
      signalRow({ status: 'TARGET_REACHED', fillPrice: 101, closeReason: 'TP2', closePrice: 120 }),
      'TP1'
    );
    expect(text).toContain('✅ CRYPTORA — TP1');
    expect(text).toContain('110.00');
  });

  it('безубыток ОТКРЫТОЙ позиции (§6): стоп на входе, позиция жива, время — бар арминга', () => {
    const text = notifications.formatSignalTelegramText(
      signalRow({
        status: 'FILLED',
        fillPrice: 101,
        filledAt: '2026-10-01T13:00:00.000Z',
        progressAt: '2026-10-01T16:00:00.000Z',
      }),
      'BREAKEVEN'
    );
    expect(text).toContain('Безубыток');
    expect(text).toContain('Стоп переведён в безубыток');
    expect(text).toContain('101.00 (уровень входа)');
    expect(text).toContain('Позиция: остаётся открытой');
    // Открытая сделка не выдаётся за закрытую: строки исхода отсутствуют.
    expect(text).not.toContain('Сделка закрыта');
    expect(text).not.toContain('Результат:');
  });

  it('TP1 ОТКРЫТОЙ позиции (§6): цена первой цели, позиция жива, время — бар подтверждения', () => {
    const text = notifications.formatSignalTelegramText(
      signalRow({
        status: 'FILLED',
        fillPrice: 101,
        filledAt: '2026-10-01T13:00:00.000Z',
        fillTargets: [110, 120],
        progressAt: '2026-10-01T15:00:00.000Z',
      }),
      'TP1'
    );
    expect(text).toContain('TP1');
    expect(text).toContain('110.0');
    expect(text).toContain('Позиция: остаётся открытой');
    expect(text).not.toContain('финальная цель');
    expect(text).not.toContain('Сделка завершена');
  });

  it('безубыток: новый SL на уровне входа', () => {
    const text = fmt(
      signalRow({
        status: 'CLOSED', fillPrice: 101, closeReason: 'TP1_THEN_BE', closePrice: 101, resultR: 0.48,
      }),
      'BREAKEVEN'
    );
    expect(text).toContain('🛡 CRYPTORA — Безубыток');
    expect(text).toContain('Стоп переведён в безубыток');
    expect(text).toContain('Новый SL: 101.00 (уровень входа)');
    expect(text).toContain('+0.48 R');
  });

  it('stop loss: цена выхода и отрицательный результат', () => {
    const text = fmt(
      signalRow({
        status: 'INVALIDATED', fillPrice: 101, closeReason: 'SL', closePrice: 90,
        resultR: -1, netResultR: -1.05,
      }),
      'STOP_LOSS'
    );
    expect(text).toContain('❌ CRYPTORA — Stop Loss');
    expect(text).toContain('Цена выхода: 90.0000');
    expect(text).toContain('-1.00 R');
    expect(text).toContain('net -1.05 R');
  });

  it('отмена до входа: причина и статус безсделкового терминала', () => {
    const text = fmt(signalRow({ status: 'CANCELLED', closeReason: 'CANCELLED' }), 'CANCELLED');
    expect(text).toContain('🚫 CRYPTORA — Сигнал отменён');
    expect(text).toContain('отменён до входа');
    expect(text).toContain('CANCELLED');
    expect(text).not.toContain('Stop Loss');

    const expired = fmt(signalRow({ status: 'EXPIRED', closeReason: 'EXPIRED' }), 'CANCELLED');
    expect(expired).toContain('истёк без входа');
  });

  it('V2.8-причины отмены до входа объяснены по-человечески', () => {
    const ladder = fmt(
      signalRow({ status: 'CANCELLED', closeReason: 'LADDER_INVALID_AT_FILL' }),
      'CANCELLED'
    );
    expect(ladder).toContain('отменён до входа (лестница целей неисполнима)');

    const noBar = fmt(
      signalRow({ status: 'CANCELLED', closeReason: 'NO_CONTIGUOUS_NEXT_BAR' }),
      'CANCELLED'
    );
    expect(noBar).toContain('отменён до входа (нет смежного бара данных)');

    const geometry = fmt(
      signalRow({ status: 'CANCELLED', closeReason: 'REJECTED_GEOMETRY' }),
      'CANCELLED'
    );
    expect(geometry).toContain('отменён до входа (геометрия коридора отклонена)');
  });

  it('закрытие по правилам стратегии (таймаут/трейлинг) — отдельное событие', () => {
    const text = fmt(
      signalRow({ status: 'CLOSED', fillPrice: 101, closeReason: 'TIMEOUT', closePrice: 105, resultR: 0.24 }),
      'CLOSED'
    );
    expect(text).toContain('🏁 CRYPTORA — Сигнал закрыт');
    expect(text).toContain('таймаут стратегии');
    expect(text).toContain('Цена закрытия: 105.00');

    const trail = fmt(
      signalRow({ status: 'CLOSED', closeReason: 'TRAIL', closePrice: 115, resultR: 1.4 }),
      'CLOSED'
    );
    expect(trail).toContain('трейлинг-стоп');
  });

  it('легаси OUTCOME и неизвестные типы не ломают форматтер', () => {
    const outcome = fmt(signalRow({ status: 'INVALIDATED', closeReason: 'SL' }), 'OUTCOME');
    expect(outcome).toContain('CRYPTORA');
    expect(outcome).toContain('BTC/USDT');
    expect(outcome).toContain('Информационное уведомление. Не является рекомендацией.');

    const unknown = fmt(signalRow(), 'SOMETHING_ELSE');
    expect(unknown).toContain('SOMETHING_ELSE');
  });

  it('отсутствующие поля показываются как «—», а не как NaN/undefined', () => {
    const text = fmt({ id: 'sig-1', symbol: 'BTC/USDT' }, 'NEW_SIGNAL');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('PEPE-масштаб цен не теряет значащие цифры', () => {
    const text = fmt(
      signalRow({ entryMin: 0.00000446, entryMax: 0.00000446, stopLoss: 0.0000041, targets: [0.0000051, 0.0000059] }),
      'NEW_SIGNAL'
    );
    expect(text).toContain('0.000004460');
    expect(text).toContain('0.000005100');
  });
});

/* ─────────────────────────── Время и timezone ─────────────────────────── */

describe('formatSignalEventTime — часовой пояс процесса, без хардкода', () => {
  it('один момент времени рендерится одинаково детерминированно', () => {
    const iso = '2026-10-01T12:34:00.000Z';
    const a = notifications.formatSignalEventTime(iso);
    const b = notifications.formatSignalEventTime(new Date(iso));
    expect(a).toBe(b);
    expect(a).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  it('zone из окружения процесса, а не захардкоженная константа', () => {
    const zone = notifications.signalEventTimeZone();
    // Валидная IANA-зона или UTC — но никогда не «своё» смещение в коде.
    expect(zone).toMatch(/^[A-Za-z_]+\/[A-Za-z_+0-9-]+$|^UTC$/);
  });

  it('отсутствующее время — «—», выдуманное время не подставляется', () => {
    expect(notifications.formatSignalEventTime(null)).toBe('—');
    expect(notifications.formatSignalEventTime(undefined)).toBe('—');
    expect(notifications.formatSignalEventTime('not-a-date')).toBe('—');
  });

  it('внутренние UTC-таймстемпы не переформатируются: форматтер не трогает вход', () => {
    const iso = '2026-10-01T12:34:00.000Z';
    notifications.formatSignalEventTime(iso);
    expect(iso).toBe('2026-10-01T12:34:00.000Z');
  });
});
