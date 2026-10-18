/**
 * CRYPTORA — READ-ONLY проекция lifecycle-прогресса для отображения (Signals UI V1).
 *
 * Проверяется новый контракт `SignalDto.lifecycleEvents` + `SignalDto.progress`:
 *
 *   1. ПРОЕКЦИЯ (`projectSignalLifecycleProgress` — чистая функция): флаги
 *      TP1/TP2/BE/стопа и доказуемый действующий стоп выводятся ТОЛЬКО из
 *      persisted-фактов (строка + журнал). Ничего не replay'ится, цена не
 *      смотрится, уровень не выдумывается.
 *   2. BATCH-ЗАГРУЗКА (`listSignalLifecycleEvents`): весь журнал страницы —
 *      ОДНИМ запросом (`signal_id = ANY($1)`). N+1 запрещён и проверяется
 *      счётчиком запросов.
 *   3. ПРИСОЕДИНЕНИЕ (`listSignals` / `getSignalById`): DTO несёт факты +
 *      проекцию; события одного сигнала не попадают в другой; легаси-поля
 *      не меняются (backward compatibility); путь только читает (SELECT).
 *
 * Что НЕ проверяется здесь (и не должно меняться): переходы lifecycle,
 * запись журнала, математика стратегий, статистика, Telegram.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

const poolModule = await import('../../server/db/pool.js');
const repo = await import('../../server/services/signalRepository.js');
const events = await import('../../server/services/signalLifecycleEvents.js');
const redelivery = await import('../../server/services/notificationRedelivery.js');
const channels = await import('../../server/services/notificationChannels.js');

afterAll(() => {
  poolModule.__setPoolForTests(null);
});

/* ─────────────────────────── Проекция: TP1 ─────────────────────────── */

describe('projectSignalLifecycleProgress — TP1', () => {
  const open = {
    status: 'FILLED',
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    closeReason: null,
    fillPrice: 4.857,
    closedAt: null,
  };

  it('событие TP1 открытой позиции → tp1Hit со временем факта', () => {
    const p = events.projectSignalLifecycleProgress(open, [
      { eventType: 'NEW_SIGNAL', occurredAt: null },
      { eventType: 'FILL', occurredAt: '2026-10-18T00:59:00.000Z' },
      { eventType: 'TP1', occurredAt: '2026-10-18T01:59:00.000Z' },
    ]);
    expect(p.tp1Hit).toBe(true);
    expect(p.tp1HitAt).toBe('2026-10-18T01:59:00.000Z');
    expect(p.tp2Hit).toBe(false);
    expect(p.breakevenArmed).toBe(false);
    expect(p.currentStop).toBe(null);
  });

  it('нет события TP1 → отметки нет (даже при других событиях)', () => {
    const p = events.projectSignalLifecycleProgress(open, [
      { eventType: 'FILL', occurredAt: '2026-10-18T00:59:00.000Z' },
    ]);
    expect(p.tp1Hit).toBe(false);
    expect(p.tp1HitAt).toBe(null);
  });

  it('терминальный исход с TP1-доказанной причиной → tp1Hit без выдуманного времени', () => {
    // Строки, закрытые до журнала 018: события нет, но closeReason доказывает TP1.
    for (const closeReason of ['TP2', 'TP1_THEN_BE', 'TP1_THEN_SL', 'TP1_THEN_TIMEOUT']) {
      const p = events.projectSignalLifecycleProgress({ ...open, status: 'CLOSED', closeReason }, []);
      expect(p.tp1Hit).toBe(true);
      expect(p.tp1HitAt).toBe(null);
    }
  });

  it('TP1-причина у НЕторгового статуса TP1 не доказывает', () => {
    const p = events.projectSignalLifecycleProgress(
      { ...open, status: 'CANCELLED', closeReason: 'TP1_THEN_BE' },
      []
    );
    expect(p.tp1Hit).toBe(false);
  });

  it('V2.8 не получает TP1 из трейлинг-причин (TP-класса у неё нет)', () => {
    const p = events.projectSignalLifecycleProgress(
      {
        status: 'CLOSED',
        strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
        closeReason: 'TRAIL',
        fillPrice: 100,
        closedAt: '2026-10-18T05:00:00.000Z',
      },
      []
    );
    expect(p.tp1Hit).toBe(false);
    expect(p.tp2Hit).toBe(false);
  });
});

/* ─────────────────────────── Проекция: BE и стоп ─────────────────────────── */

describe('projectSignalLifecycleProgress — BREAKEVEN и действующий стоп', () => {
  const v3Open = {
    status: 'FILLED',
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    closeReason: null,
    fillPrice: 4.857,
    closedAt: null,
  };

  it('V3.x + BE-событие + вход → armed + currentStop = fillPrice (BE_AT_ENTRY)', () => {
    for (const strategyId of [
      'V3_0_HTF_LIQUIDATION_TRAP',
      'V3_3_HTF_ZONE_MITIGATION',
      'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    ]) {
      const p = events.projectSignalLifecycleProgress(
        { ...v3Open, strategyId, fillPrice: 101.5 },
        [{ eventType: 'BREAKEVEN', occurredAt: '2026-10-18T02:59:00.000Z' }]
      );
      expect(p.breakevenArmed).toBe(true);
      expect(p.breakevenArmedAt).toBe('2026-10-18T02:59:00.000Z');
      expect(p.currentStop).toBe(101.5);
      expect(p.currentStopBasis).toBe('BE_AT_ENTRY');
    }
  });

  it('V2.8 + BE-событие → armed, но БЕЗ выдуманного стопа (трейлинг ≠ вход)', () => {
    const p = events.projectSignalLifecycleProgress(
      { ...v3Open, strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING', fillPrice: 100 },
      [{ eventType: 'BREAKEVEN', occurredAt: '2026-10-18T02:59:00.000Z' }]
    );
    expect(p.breakevenArmed).toBe(true);
    expect(p.currentStop).toBe(null);
    expect(p.currentStopBasis).toBe(null);
  });

  it('неизвестная стратегия + BE-событие → armed, но стопа нет (fail-closed)', () => {
    const p = events.projectSignalLifecycleProgress(
      { ...v3Open, strategyId: 'V9_9_SOMETHING_NEW', fillPrice: 100 },
      [{ eventType: 'BREAKEVEN', occurredAt: '2026-10-18T02:59:00.000Z' }]
    );
    expect(p.breakevenArmed).toBe(true);
    expect(p.currentStop).toBe(null);
  });

  it('BE-событие без входа → стопа нет (нечему стоять на входе)', () => {
    const p = events.projectSignalLifecycleProgress(
      { ...v3Open, fillPrice: null },
      [{ eventType: 'BREAKEVEN', occurredAt: '2026-10-18T02:59:00.000Z' }]
    );
    expect(p.breakevenArmed).toBe(true);
    expect(p.currentStop).toBe(null);
  });

  it('терминальная TP1_THEN_BE-строка: armed=false, стопа нет (позиция закрыта)', () => {
    // Журнал терминального пути содержит BREAKEVEN — но armed-стоп уже прошлое.
    const p = events.projectSignalLifecycleProgress(
      { ...v3Open, status: 'CLOSED', closeReason: 'TP1_THEN_BE', closedAt: '2026-10-18T05:00:00.000Z' },
      [{ eventType: 'TP1', occurredAt: '2026-10-18T01:59:00.000Z' }, { eventType: 'BREAKEVEN', occurredAt: '2026-10-18T05:00:00.000Z' }]
    );
    expect(p.breakevenArmed).toBe(false);
    expect(p.breakevenArmedAt).toBe(null);
    expect(p.currentStop).toBe(null);
    expect(p.tp1Hit).toBe(true);
  });

  it('промежуточный BE НЕ считается завершением: флаги исхода не выставляются', () => {
    const p = events.projectSignalLifecycleProgress(v3Open, [
      { eventType: 'TP1', occurredAt: '2026-10-18T01:59:00.000Z' },
      { eventType: 'BREAKEVEN', occurredAt: '2026-10-18T02:59:00.000Z' },
    ]);
    expect(p.tp2Hit).toBe(false);
    expect(p.stopHit).toBe(false);
  });
});

/* ─────────────────────────── Проекция: TP2 / стоп ─────────────────────────── */

describe('projectSignalLifecycleProgress — TP2 и стоп', () => {
  it('TARGET_REACHED без журнального TP2 → tp2Hit, время из closedAt', () => {
    const p = events.projectSignalLifecycleProgress(
      {
        status: 'TARGET_REACHED',
        strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
        closeReason: 'TP2',
        fillPrice: 100,
        closedAt: '2026-10-18T06:00:00.000Z',
      },
      []
    );
    expect(p.tp2Hit).toBe(true);
    expect(p.tp2HitAt).toBe('2026-10-18T06:00:00.000Z');
    expect(p.tp1Hit).toBe(true);
    expect(p.currentStop).toBe(null);
  });

  it('событие TP2 имеет приоритет по времени над closedAt', () => {
    const p = events.projectSignalLifecycleProgress(
      {
        status: 'TARGET_REACHED',
        strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
        closeReason: 'TP2',
        fillPrice: 100,
        closedAt: '2026-10-18T06:00:00.000Z',
      },
      [{ eventType: 'TP2', occurredAt: '2026-10-18T05:59:00.000Z' }]
    );
    expect(p.tp2HitAt).toBe('2026-10-18T05:59:00.000Z');
  });

  it('INVALIDATED → stopHit, время из closedAt при отсутствии события', () => {
    const p = events.projectSignalLifecycleProgress(
      {
        status: 'INVALIDATED',
        strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
        closeReason: 'SL',
        fillPrice: 100,
        closedAt: '2026-10-18T04:00:00.000Z',
      },
      []
    );
    expect(p.stopHit).toBe(true);
    expect(p.stopHitAt).toBe('2026-10-18T04:00:00.000Z');
    expect(p.tp1Hit).toBe(false);
  });

  it('CANCELLED / EXPIRED / UNRESOLVED → все флаги ложны, стопа нет', () => {
    for (const status of ['CANCELLED', 'EXPIRED', 'UNRESOLVED']) {
      const p = events.projectSignalLifecycleProgress(
        { status, strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', closeReason: status, fillPrice: null, closedAt: null },
        []
      );
      expect({ ...p, currentStopBasis: undefined }).toEqual({
        tp1Hit: false,
        tp1HitAt: null,
        tp2Hit: false,
        tp2HitAt: null,
        breakevenArmed: false,
        breakevenArmedAt: null,
        stopHit: false,
        stopHitAt: null,
        currentStop: null,
        currentStopBasis: undefined,
      });
    }
  });

  it('мусор на входе → безопасные дефолты, исключений нет', () => {
    expect(events.projectSignalLifecycleProgress(null, null)).toEqual({
      tp1Hit: false,
      tp1HitAt: null,
      tp2Hit: false,
      tp2HitAt: null,
      breakevenArmed: false,
      breakevenArmedAt: null,
      stopHit: false,
      stopHitAt: null,
      currentStop: null,
      currentStopBasis: null,
    });
    const p = events.projectSignalLifecycleProgress(
      { status: 'FILLED' },
      [null, 42, { eventType: '' }, { eventType: 'TP1', occurredAt: 'not-a-date' }] as never
    );
    expect(p.tp1Hit).toBe(true);
    expect(p.tp1HitAt).toBe(null);
  });

  it('Date от pg-драйвера нормализуется в ISO', () => {
    const p = events.projectSignalLifecycleProgress(
      { status: 'FILLED', strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', fillPrice: 1, closeReason: null, closedAt: null },
      [{ eventType: 'TP1', occurredAt: new Date('2026-10-18T01:59:00.000Z') }]
    );
    expect(p.tp1HitAt).toBe('2026-10-18T01:59:00.000Z');
  });
});

/* ─────────────────────────── Batch-загрузка (N+1) ─────────────────────────── */

describe('listSignalLifecycleEvents — один запрос на набор (N+1 нет)', () => {
  function makePool(eventRows: Array<Record<string, unknown>>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM signal_lifecycle_events')) {
          const ids = new Set((params[0] as string[]) ?? []);
          return { rows: eventRows.filter((r) => ids.has(String(r.signal_id))) };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      __calls: calls,
    };
    return pool;
  }

  it('весь набор — одним запросом с ANY, группировка по сигналам', async () => {
    const pool = makePool([
      { signal_id: 'a', event_type: 'FILL', occurred_at: null },
      { signal_id: 'a', event_type: 'TP1', occurred_at: new Date('2026-10-18T01:59:00.000Z') },
      { signal_id: 'b', event_type: 'NEW_SIGNAL', occurred_at: null },
    ]);
    poolModule.__setPoolForTests(pool as never);

    const bySignal = await repo.listSignalLifecycleEvents(['a', 'b']);
    expect(pool.__calls).toHaveLength(1);
    expect(pool.__calls[0]!.sql).toContain('signal_id = ANY($1)');
    expect(pool.__calls[0]!.params).toEqual([['a', 'b']]);
    expect(bySignal.get('a')).toEqual([
      { eventType: 'FILL', occurredAt: null },
      { eventType: 'TP1', occurredAt: new Date('2026-10-18T01:59:00.000Z') },
    ]);
    expect(bySignal.get('b')).toEqual([{ eventType: 'NEW_SIGNAL', occurredAt: null }]);
  });

  it('события одного сигнала не попадают в другой', async () => {
    const pool = makePool([
      { signal_id: 'a', event_type: 'TP1', occurred_at: null },
      { signal_id: 'b', event_type: 'STOP_LOSS', occurred_at: null },
    ]);
    poolModule.__setPoolForTests(pool as never);

    const bySignal = await repo.listSignalLifecycleEvents(['a', 'b']);
    expect(bySignal.get('a')!.map((e) => e.eventType)).toEqual(['TP1']);
    expect(bySignal.get('b')!.map((e) => e.eventType)).toEqual(['STOP_LOSS']);
  });

  it('пустой набор и дубли — без запроса / с дедупом', async () => {
    const pool = makePool([]);
    poolModule.__setPoolForTests(pool as never);

    expect(await repo.listSignalLifecycleEvents([])).toEqual(new Map());
    expect(pool.__calls).toHaveLength(0);

    await repo.listSignalLifecycleEvents(['a', 'a', '', null as never]);
    expect(pool.__calls).toHaveLength(1);
    expect(pool.__calls[0]!.params).toEqual([['a']]);
  });
});

/* ─────────────── Присоединение к DTO: контракт и чтение ─────────────── */

describe('listSignals/getSignalWithProgressById — lifecycle-факты в DTO', () => {
  const DB_DEFAULTS = {
    strategy_id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    strategy_version: '3.4',
    engine_setup_id: 'engine-1',
    symbol: 'NEAR/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signal_candle_ts: new Date('2026-10-17T22:00:00.000Z'),
    entry_type: 'LIMIT_CORRIDOR',
    valid_for_bars: 3,
    exit_rule: 'TP2 или стоп',
    entry_min: '4.8400',
    entry_max: '4.8700',
    stop_loss: '4.7000',
    tp1: '4.9835',
    tp2: '5.4400',
    targets: ['4.9835', '5.4400'],
    created_at: new Date('2026-10-17T22:05:00.000Z'),
    updated_at: new Date('2026-10-18T03:00:00.000Z'),
    fill_price: '4.8570',
    filled_at: new Date('2026-10-18T00:59:00.000Z'),
    fill_stop: '4.7000',
    fill_targets: ['4.9835', '5.4400'],
    closed_at: null,
    close_price: null,
    close_reason: null,
    result_r: null,
    net_result_r: null,
    pnl_result_pct: null,
    bars_held: null,
    metadata: null,
    hash: 'sha256-aaa',
    previous_hash: 'GENESIS',
    outcome_hash: null,
    chain_version: 2,
    monitor_check_count: 10,
    monitor_last_check_at: new Date('2026-10-18T03:00:00.000Z'),
    monitor_last_result: 'FILLED',
    monitor_last_error: null,
    provenance_status: 'VERIFIED',
    test_run_id: null,
  };

  function dbRow(overrides: Record<string, unknown> = {}) {
    return { id: '11111111-1111-1111-1111-111111111111', status: 'FILLED', ...DB_DEFAULTS, ...overrides };
  }

  function makePool(signalRows: Array<Record<string, unknown>>, eventRows: Array<Record<string, unknown>>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM signal_lifecycle_events')) {
          const ids = new Set((params[0] as string[]) ?? []);
          return { rows: eventRows.filter((r) => ids.has(String(r.signal_id))) };
        }
        if (sql.includes('FROM signals WHERE id = $1')) {
          return { rows: signalRows.filter((r) => String(r.id) === String(params[0])) };
        }
        if (sql.includes('FROM signals')) {
          return { rows: signalRows };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      __calls: calls,
    };
    return pool;
  }

  it('лента: N строк → ровно 2 запроса (строки + один batch журнала)', async () => {
    const pool = makePool(
      [dbRow({ id: 'a' }), dbRow({ id: 'b', status: 'ACTIVE', fill_price: null, filled_at: null })],
      [{ signal_id: 'a', event_type: 'TP1', occurred_at: new Date('2026-10-18T01:59:00.000Z') }]
    );
    poolModule.__setPoolForTests(pool as never);

    const signals = await repo.listSignals({ limit: 50 });
    expect(pool.__calls).toHaveLength(2);
    expect(pool.__calls[1]!.sql).toContain('FROM signal_lifecycle_events');

    const a = signals.find((s) => s.id === 'a')!;
    const b = signals.find((s) => s.id === 'b')!;
    expect(a.lifecycleEvents!.map((e) => e.eventType)).toEqual(['TP1']);
    expect(a.progress!.tp1Hit).toBe(true);
    expect(b.lifecycleEvents).toEqual([]);
    expect(b.progress!.tp1Hit).toBe(false);
  });

  it('getSignalWithProgressById: тот же прогресс, что у ленты (deep-link не слепой)', async () => {
    const pool = makePool(
      [dbRow({ id: 'a' })],
      [
        { signal_id: 'a', event_type: 'TP1', occurred_at: new Date('2026-10-18T01:59:00.000Z') },
        { signal_id: 'a', event_type: 'BREAKEVEN', occurred_at: new Date('2026-10-18T02:59:00.000Z') },
      ]
    );
    poolModule.__setPoolForTests(pool as never);

    const s = await repo.getSignalWithProgressById('a');
    expect(pool.__calls).toHaveLength(2);
    expect(s!.lifecycleEvents!.map((e) => e.eventType)).toEqual(['TP1', 'BREAKEVEN']);
    expect(s!.progress).toMatchObject({
      tp1Hit: true,
      tp1HitAt: '2026-10-18T01:59:00.000Z',
      breakevenArmed: true,
      breakevenArmedAt: '2026-10-18T02:59:00.000Z',
      currentStop: 4.857,
      currentStopBasis: 'BE_AT_ENTRY',
    });
  });

  it('getSignalWithProgressById: нет строки → null без журнального запроса', async () => {
    const pool = makePool([], []);
    poolModule.__setPoolForTests(pool as never);
    expect(await repo.getSignalWithProgressById('missing')).toBe(null);
    expect(pool.__calls).toHaveLength(1);
  });

  it('backward compatibility: легаси-поля DTO не меняются', async () => {
    const pool = makePool([dbRow({ id: 'a' })], []);
    poolModule.__setPoolForTests(pool as never);

    const [s] = await repo.listSignals({ limit: 1 });
    expect(s).toMatchObject({
      id: 'a',
      strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      symbol: 'NEAR/USDT',
      timeframe: '1h',
      direction: 'LONG',
      entryMin: 4.84,
      entryMax: 4.87,
      stopLoss: 4.7,
      tp1: 4.9835,
      tp2: 5.44,
      targets: [4.9835, 5.44],
      status: 'FILLED',
      fillPrice: 4.857,
      fillStop: 4.7,
      fillTargets: [4.9835, 5.44],
      closeReason: null,
      resultR: null,
      hash: 'sha256-aaa',
      previousHash: 'GENESIS',
      chainVersion: 2,
      provenanceStatus: 'VERIFIED',
      testRunId: null,
      monitorLastResult: 'FILLED',
    });
    // Новые поля присутствуют и пусты (событий нет).
    expect(s!.lifecycleEvents).toEqual([]);
    expect(s!.progress!.tp1Hit).toBe(false);
    expect(s!.progress!.currentStop).toBe(null);
  });

  it('путь только читает: ни одного INSERT/UPDATE/DELETE', async () => {
    const pool = makePool(
      [dbRow({ id: 'a' }), dbRow({ id: 'b' })],
      [{ signal_id: 'a', event_type: 'TP1', occurred_at: null }]
    );
    poolModule.__setPoolForTests(pool as never);

    await repo.listSignals({ limit: 10 });
    await repo.getSignalById('a');
    await repo.getSignalWithProgressById('a');
    for (const c of pool.__calls) {
      const head = c.sql.trim().toUpperCase().slice(0, 6);
      expect(head).toBe('SELECT');
    }
    expect(pool.__calls.length).toBeGreaterThan(0);
  });

  it('мониторный путь не тронут: listOpenSignals без журнального запроса', async () => {
    const pool = makePool([dbRow({ id: 'a' })], [
      { signal_id: 'a', event_type: 'TP1', occurred_at: null },
    ]);
    poolModule.__setPoolForTests(pool as never);

    const rows = await repo.listOpenSignals(null, 10);
    expect(pool.__calls).toHaveLength(1);
    expect(pool.__calls[0]!.sql).toContain('FROM signals');
    expect(rows).toHaveLength(1);
    expect('progress' in rows[0]!).toBe(false);
  });
});

/* ─── Изоляция: Telegram Redelivery не зависит от UI-прогресса ─── */

describe('Isolation — Telegram Redelivery independent of UI progress loading', () => {
  function signalRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a',
      strategy_id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      strategy_version: '3.4',
      symbol: 'NEAR/USDT',
      timeframe: '1h',
      direction: 'LONG',
      signal_candle_ts: new Date('2026-10-17T22:00:00.000Z'),
      entry_min: '4.8400',
      entry_max: '4.8700',
      stop_loss: '4.7000',
      tp1: '4.9835',
      tp2: '5.4400',
      targets: ['4.9835', '5.4400'],
      status: 'FILLED',
      created_at: new Date('2026-10-17T22:05:00.000Z'),
      updated_at: new Date('2026-10-18T03:00:00.000Z'),
      fill_price: '4.8570',
      filled_at: new Date('2026-10-18T00:59:00.000Z'),
      hash: 'sha256-aaa',
      previous_hash: 'GENESIS',
      provenance_status: 'VERIFIED',
      ...overrides,
    };
  }

  /** Пул репозитория: точечный SELECT — строка; журнальный SELECT — по сценарию. */
  function repoPool(onJournal: (ids: string[]) => unknown[] | Promise<unknown[]>) {
    const calls: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push(sql);
        if (sql.includes('FROM signal_lifecycle_events')) {
          return { rows: await onJournal((params[0] as string[]) ?? []) };
        }
        if (sql.includes('FROM signals WHERE id = $1')) {
          const row = signalRow();
          return { rows: String(params[0]) === row.id ? [row] : [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      __calls: calls,
    };
    return pool;
  }

  it('getSignalById: ровно один запрос, журнал не читается, ключей прогресса нет', async () => {
    const pool = repoPool(() => { throw new Error('journal must not be read'); });
    poolModule.__setPoolForTests(pool as never);

    const s = await repo.getSignalById('a');
    expect(pool.__calls).toHaveLength(1);
    expect(pool.__calls[0]).toContain('FROM signals WHERE id = $1');
    expect(pool.__calls[0]).not.toContain('signal_lifecycle_events');
    expect(s).toMatchObject({ id: 'a', status: 'FILLED', symbol: 'NEAR/USDT' });
    expect('lifecycleEvents' in s!).toBe(false);
    expect('progress' in s!).toBe(false);
  });

  it('журнал недоступен → getSignalById отдаёт строку (redelivery-safe), withProgress честно ошибается', async () => {
    const pool = repoPool(() => { throw new Error('journal unavailable'); });
    poolModule.__setPoolForTests(pool as never);

    // Путь доставки: строка цела, lifecycle-данные не потеряны и не изменены.
    const plain = await repo.getSignalById('a');
    expect(plain).toMatchObject({ id: 'a', status: 'FILLED', fillPrice: 4.857 });

    // Путь UI: вместо выдуманного пустого прогресса — явная ошибка.
    await expect(repo.getSignalWithProgressById('a')).rejects.toThrow('journal unavailable');
  });

  it('sweep redelivery при мёртвом журнале доставляет (строка из mapRow, не из прогресса)', async () => {
    const pool = repoPool(() => { throw new Error('journal unavailable'); });
    poolModule.__setPoolForTests(pool as never);

    const NOW = Date.now();
    let workerQueries = 0;
    const delivered: unknown[] = [];
    const worker = new redelivery.NotificationRedeliveryWorker({
      now: () => NOW,
      query: async () => {
        workerQueries += 1;
        // Первый запрос sweep — кандидаты; второй — SUCCESS-ключи (пусто).
        if (workerQueries === 1) {
          return { rows: [{
            signal_id: 'a',
            user_id: 'user-1',
            event_type: 'FILL',
            attempts: 0,
            last_attempt_at: null,
            last_error_code: null,
            occurred_at: new Date(NOW - 1000),
            event_created_at: new Date(NOW - 1000),
          }] };
        }
        return { rows: [] };
      },
      loadSignal: async (id: string) =>
        ((await repo.getSignalById(id)) as unknown as Record<string, unknown> | null),
      deliver: async (_userId: string, payload: unknown) => {
        delivered.push(payload);
        return { ok: true };
      },
    });

    const summary = await worker.sweep();
    expect(summary).toMatchObject({ considered: 1, attempted: 1, delivered: 1, failed: 0 });
    expect(delivered).toHaveLength(1);
    // Доставка собрана из plain-строки: журнальный SELECT репозитория не вызывался.
    expect(pool.__calls).toHaveLength(1);
    expect(pool.__calls[0]).toContain('FROM signals WHERE id = $1');
  });

  it('Telegram-контракт без прогресс-поля: TP1-payload + форматтер рендерятся на plain-строке', async () => {
    const pool = repoPool(() => []);
    poolModule.__setPoolForTests(pool as never);
    const s = await repo.getSignalById('a');
    expect(s).not.toBe(null);

    const payload = redelivery.buildRedeliveryPayload(
      s as unknown as Record<string, unknown>,
      'TP1',
      '2026-10-18T01:59:00.000Z'
    );
    expect(payload.progressAt).toBe('2026-10-18T01:59:00.000Z');
    const text = channels.formatSignalTelegramText(payload, 'TP1');
    expect(text).toContain('Первая цель достигнута');
    expect(text).toContain('NEAR/USDT');
  });

  it('CLOSED + TP1_THEN_BE: история TP1 доступна, текущего SL нет, позиция не открыта', () => {
    const p = events.projectSignalLifecycleProgress(
      {
        status: 'CLOSED',
        strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
        closeReason: 'TP1_THEN_BE',
        fillPrice: 4.857,
        closedAt: '2026-10-18T05:00:00.000Z',
      },
      [
        { eventType: 'FILL', occurredAt: '2026-10-18T00:59:00.000Z' },
        { eventType: 'TP1', occurredAt: '2026-10-18T01:59:00.000Z' },
        { eventType: 'BREAKEVEN', occurredAt: '2026-10-18T05:00:00.000Z' },
      ]
    );
    // История: TP1-факт с честным временем — доступен для UI.
    expect(p.tp1Hit).toBe(true);
    expect(p.tp1HitAt).toBe('2026-10-18T01:59:00.000Z');
    // Позиция закрыта: armed-стоп — прошлое, текущего SL нет.
    expect(p.breakevenArmed).toBe(false);
    expect(p.breakevenArmedAt).toBe(null);
    expect(p.currentStop).toBe(null);
    expect(p.currentStopBasis).toBe(null);
  });

  it('FILLED + BREAKEVEN: текущий стоп — только при доказанных условиях', () => {
    const be = [{ eventType: 'BREAKEVEN', occurredAt: '2026-10-18T02:59:00.000Z' }];
    // Доказано: V3-коридор + конечная цена входа → стоп на входе.
    const proven = events.projectSignalLifecycleProgress(
      { status: 'FILLED', strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', closeReason: null, fillPrice: 4.857, closedAt: null },
      be
    );
    expect(proven.breakevenArmed).toBe(true);
    expect(proven.currentStop).toBe(4.857);
    expect(proven.currentStopBasis).toBe('BE_AT_ENTRY');
    // Не доказано: V2.8 (трейлинг ≠ вход) → armed есть, стопа нет.
    const trailing = events.projectSignalLifecycleProgress(
      { status: 'FILLED', strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING', closeReason: null, fillPrice: 100, closedAt: null },
      be
    );
    expect(trailing.breakevenArmed).toBe(true);
    expect(trailing.currentStop).toBe(null);
    // Не доказано: входа нет → стопа нет.
    const noFill = events.projectSignalLifecycleProgress(
      { status: 'FILLED', strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', closeReason: null, fillPrice: null, closedAt: null },
      be
    );
    expect(noFill.currentStop).toBe(null);
  });
});
