/**
 * CRYPTORA — Надёжная доставка Telegram lifecycle-уведомлений (PR #56).
 *
 * Две линии защиты, обе тестируются здесь на моках (PostgreSQL-сквозной
 * путь — tests/integration/signalLifecycleEventsPostgres.test.ts):
 *
 *   1. IMMEDIATE RETRY в deliverSavedTelegram: только transient-коды,
 *      ≤ 1 + TELEGRAM_IMMEDIATE_RETRIES попыток, bounded backoff, 429 —
 *      с уважением retry_after (длиннее CAP — не ждём, отдаём worker-у);
 *      permanent-коды не ретраятся.
 *   2. DURABLE REDELIVERY WORKER: политика (TTL / max attempts / backoff /
 *      permanent-suppression / ordering) — чистые функции; sweep — на
 *      инъецированном query/deliver; in-process guard и graceful stop.
 *
 * Гарантия доставки — durable at-least-once attempt с per-user SUCCESS
 * suppression (exactly-once НЕ обещается: у sendMessage нет idempotency key).
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const poolModule = await import('../../server/db/pool.js');
const notifications = await import('../../server/services/notificationChannels.js');
const redelivery = await import('../../server/services/notificationRedelivery.js');
const telemetryModule = await import('../../server/services/health/telemetry.js');

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

/** Мок пула: канал пользователя + захват строк delivery_log. */
function makePool(channelRow: Record<string, unknown> | null) {
  const logParams: unknown[][] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM notification_channels')) return { rows: channelRow ? [channelRow] : [] };
      if (sql.includes('INSERT INTO notification_delivery_log')) {
        logParams.push(params);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
    __logParams: logParams,
  };
  return pool;
}

function channelPool() {
  return makePool({
    user_id: 'user-1',
    telegram_enabled: true,
    telegram_chat_id: '-1001',
    telegram_token_ciphertext: notifications.encryptTelegramToken(TOKEN, process.env.NOTIFICATION_ENCRYPTION_KEY),
  });
}

beforeAll(() => {});
afterAll(() => {
  poolModule.__setPoolForTests(null);
  redelivery.resetNotificationRedeliveryWorker();
});

/* ─────────────── Immediate retry: политика задержек ─────────────── */

describe('immediateTelegramRetryDelayMs — bounded in-flight backoff', () => {
  it('экспоненциально от базы, с потолком', () => {
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: null }, 1)).toBe(1_000);
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: null }, 2)).toBe(2_000);
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: null }, 3)).toBe(4_000);
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: null }, 10)).toBe(5_000);
  });

  it('429 retry_after расширяет задержку до значения Telegram', () => {
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: 3_000 }, 1)).toBe(3_000);
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: 2_000 }, 2)).toBe(2_000);
  });

  it('retry_after длиннее CAP — null: in-flight не спит, событие уходит worker-у', () => {
    expect(notifications.immediateTelegramRetryDelayMs({ retryAfterMs: 40_000 }, 1)).toBeNull();
  });
});

/* ─────────────── Immediate retry: deliverSavedTelegram ─────────────── */

describe('deliverSavedTelegram — in-flight retry', () => {
  it('transient-сбой один раз → вторая попытка успешна: 2 вызова, один sleep, одна строка лога SUCCESS', async () => {
    poolModule.__setPoolForTests(channelPool() as never);
    const responses = [
      Response.json({ ok: false, error_code: 502, description: 'Bad Gateway' }, { status: 502 }),
      Response.json({ ok: true, result: { message_id: 1 } }),
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => { sleeps.push(ms); });

    const result = await notifications.deliverSavedTelegram(
      'user-1', { eventType: 'FILL', eventId: 'sig-1', text: 'текст' }, fetchFn, sleepFn,
    );

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_000]);
  });

  it('429 с retry_after=3s: пауза 3 секунды, затем успех', async () => {
    poolModule.__setPoolForTests(channelPool() as never);
    const responses = [
      Response.json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } }, { status: 429 }),
      Response.json({ ok: true, result: { message_id: 2 } }),
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => { sleeps.push(ms); });

    const result = await notifications.deliverSavedTelegram(
      'user-1', { eventType: 'TP1', eventId: 'sig-1', text: 'текст' }, fetchFn, sleepFn,
    );

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([3_000]);
  });

  it('429 с retry_after=40s (> CAP): НЕ спим и НЕ ретраим — событие заберёт durable worker', async () => {
    poolModule.__setPoolForTests(channelPool() as never);
    const fetchFn = vi.fn(async () => Response.json(
      { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 40 } }, { status: 429 },
    ));
    const sleepFn = vi.fn(async () => {});

    const result = await notifications.deliverSavedTelegram(
      'user-1', { eventType: 'BREAKEVEN', eventId: 'sig-1', text: 'текст' }, fetchFn, sleepFn,
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.retryAfterMs).toBe(40_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('permanent-ошибка (401 Unauthorized): ровно один вызов, без sleep', async () => {
    poolModule.__setPoolForTests(channelPool() as never);
    const fetchFn = vi.fn(async () => Response.json(
      { ok: false, error_code: 401, description: 'Unauthorized' }, { status: 401 },
    ));
    const sleepFn = vi.fn(async () => {});

    const result = await notifications.deliverSavedTelegram(
      'user-1', { eventType: 'STOP_LOSS', eventId: 'sig-1', text: 'текст' }, fetchFn, sleepFn,
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_TOKEN');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('все попытки transient-неудачны: максимум 1+RETRIES вызовов, итог FAILURE в журнале', async () => {
    poolModule.__setPoolForTests(channelPool() as never);
    const fetchFn = vi.fn(async () => Response.json(
      { ok: false, error_code: 500, description: 'Internal Server Error' }, { status: 500 },
    ));
    const sleeps: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => { sleeps.push(ms); });

    const result = await notifications.deliverSavedTelegram(
      'user-1', { eventType: 'FILL', eventId: 'sig-1', text: 'текст' }, fetchFn, sleepFn,
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('TELEGRAM_UNAVAILABLE');
    expect(fetchFn).toHaveBeenCalledTimes(1 + notifications.TELEGRAM_IMMEDIATE_RETRIES);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it('одна строка delivery_log на вызов (итог попытки), без токена в журнале', async () => {
    const pool = channelPool();
    poolModule.__setPoolForTests(pool as never);
    const responses = [
      Response.json({ ok: false, error_code: 502, description: 'Bad Gateway' }, { status: 502 }),
      Response.json({ ok: true, result: { message_id: 3 } }),
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);

    await notifications.deliverSavedTelegram(
      'user-1', { eventType: 'FILL', eventId: 'sig-1', text: 'текст' }, fetchFn, vi.fn(async () => {}),
    );

    expect(pool.__logParams).toHaveLength(1);
    expect(pool.__logParams[0]).toEqual(['user-1', 'FILL', 'sig-1', 'SUCCESS', 200, null, null]);
    expect(JSON.stringify(pool.__logParams)).not.toContain(TOKEN);
  });
});

/* ─────────────── Политика redelivery: чистые функции ─────────────── */

describe('lifecycleEventRank — причинный ранг события', () => {
  it('NEW_SIGNAL < FILL < TP1 < BREAKEVEN < терминалы; TPn≥2 — терминальные', () => {
    expect(redelivery.lifecycleEventRank('NEW_SIGNAL')).toBe(0);
    expect(redelivery.lifecycleEventRank('FILL')).toBe(1);
    expect(redelivery.lifecycleEventRank('TP1')).toBe(2);
    expect(redelivery.lifecycleEventRank('BREAKEVEN')).toBe(3);
    expect(redelivery.lifecycleEventRank('TP2')).toBe(4);
    expect(redelivery.lifecycleEventRank('TP10')).toBe(4);
    expect(redelivery.lifecycleEventRank('STOP_LOSS')).toBe(4);
    expect(redelivery.lifecycleEventRank('CANCELLED')).toBe(4);
    expect(redelivery.lifecycleEventRank('CLOSED')).toBe(4);
  });

  it('неизвестный тип — null: worker его не трогает', () => {
    expect(redelivery.lifecycleEventRank('GARBAGE')).toBeNull();
    expect(redelivery.lifecycleEventRank(null)).toBeNull();
  });
});

describe('redeliveryBackoffMs — экспоненциальный, с потолком', () => {
  it('60s → 120s → 240s → … capped 15min', () => {
    expect(redelivery.redeliveryBackoffMs(1)).toBe(60_000);
    expect(redelivery.redeliveryBackoffMs(2)).toBe(120_000);
    expect(redelivery.redeliveryBackoffMs(3)).toBe(240_000);
    expect(redelivery.redeliveryBackoffMs(10)).toBe(15 * 60_000);
  });
});

describe('redeliveryDecision — политика повтора пары (event, user)', () => {
  const NOW = 1_800_000_000_000;
  const base = {
    signalId: 'sig-1', userId: 'user-1', eventType: 'FILL',
    attempts: 0, lastAttemptAt: null, lastErrorCode: null,
  };

  it('попыток не было (crash после INSERT) → DELIVER немедленно', () => {
    expect(redelivery.redeliveryDecision(base, new Set(), NOW)).toEqual({ action: 'DELIVER' });
  });

  it('достигнут MAX_ATTEMPTS → SKIP', () => {
    expect(redelivery.redeliveryDecision(
      { ...base, attempts: redelivery.REDELIVERY_MAX_ATTEMPTS, lastAttemptAt: NOW - 1_000_000 },
      new Set(), NOW,
    )).toEqual({ action: 'SKIP', reason: 'MAX_ATTEMPTS' });
  });

  it('backoff не истёк → SKIP; истёк → DELIVER', () => {
    const attempts = 1; // backoff 60s
    const justNow = { ...base, attempts, lastAttemptAt: NOW - 30_000, lastErrorCode: 'TIMEOUT' };
    expect(redelivery.redeliveryDecision(justNow, new Set(), NOW)).toEqual({ action: 'SKIP', reason: 'BACKOFF' });
    const ago = { ...base, attempts, lastAttemptAt: NOW - 61_000, lastErrorCode: 'TIMEOUT' };
    expect(redelivery.redeliveryDecision(ago, new Set(), NOW)).toEqual({ action: 'DELIVER' });
  });

  it('backoff растёт экспоненциально по числу попыток', () => {
    // attempts=2 → backoff 120s: 119s назад — ещё рано, 121s назад — можно.
    const two = { ...base, attempts: 2, lastAttemptAt: NOW - 119_000, lastErrorCode: 'NETWORK_ERROR' };
    expect(redelivery.redeliveryDecision(two, new Set(), NOW)).toEqual({ action: 'SKIP', reason: 'BACKOFF' });
    const twoReady = { ...base, attempts: 2, lastAttemptAt: NOW - 121_000, lastErrorCode: 'NETWORK_ERROR' };
    expect(redelivery.redeliveryDecision(twoReady, new Set(), NOW)).toEqual({ action: 'DELIVER' });
  });

  it('permanent-код: подавлено в окне suppression, после окна — одна проверка (токен могли починить)', () => {
    const fresh = { ...base, attempts: 1, lastAttemptAt: NOW - 60 * 60_000, lastErrorCode: 'INVALID_TOKEN' };
    expect(redelivery.redeliveryDecision(fresh, new Set(), NOW)).toEqual({ action: 'SKIP', reason: 'PERMANENT_SUPPRESSED' });
    const old = { ...base, attempts: 1, lastAttemptAt: NOW - 7 * 60 * 60_000, lastErrorCode: 'INVALID_TOKEN' };
    expect(redelivery.redeliveryDecision(old, new Set(), NOW)).toEqual({ action: 'DELIVER' });
  });

  it('неизвестный тип события → SKIP UNKNOWN_EVENT_TYPE', () => {
    expect(redelivery.redeliveryDecision({ ...base, eventType: 'WEIRD' }, new Set(), NOW))
      .toEqual({ action: 'SKIP', reason: 'UNKNOWN_EVENT_TYPE' });
  });

  it('ordering: более позднее событие уже доставлено — старшее SKIP STALE_ORDER', () => {
    // TP1 и BREAKEVEN не приходят после доставленного TP2/STOP_LOSS/CLOSED
    expect(redelivery.redeliveryDecision(
      { ...base, eventType: 'TP1' }, new Set(['sig-1|user-1|TP2']), NOW,
    )).toEqual({ action: 'SKIP', reason: 'STALE_ORDER' });
    expect(redelivery.redeliveryDecision(
      { ...base, eventType: 'BREAKEVEN' }, new Set(['sig-1|user-1|CLOSED']), NOW,
    )).toEqual({ action: 'SKIP', reason: 'STALE_ORDER' });
    // FILL не приходит после доставленного терминала
    expect(redelivery.redeliveryDecision(
      base, new Set(['sig-1|user-1|STOP_LOSS']), NOW,
    )).toEqual({ action: 'SKIP', reason: 'STALE_ORDER' });
    // NEW_SIGNAL не приходит после входа
    expect(redelivery.redeliveryDecision(
      { ...base, eventType: 'NEW_SIGNAL' }, new Set(['sig-1|user-1|FILL']), NOW,
    )).toEqual({ action: 'SKIP', reason: 'STALE_ORDER' });
    // TP1 не приходит после безубытка (BE в нарративе позже TP1)
    expect(redelivery.redeliveryDecision(
      { ...base, eventType: 'TP1' }, new Set(['sig-1|user-1|BREAKEVEN']), NOW,
    )).toEqual({ action: 'SKIP', reason: 'STALE_ORDER' });
  });

  it('ordering не мешает чужим сигналам и пользователям', () => {
    expect(redelivery.redeliveryDecision(
      { ...base, eventType: 'TP1' }, new Set(['sig-2|user-1|TP2', 'sig-1|user-2|TP2']), NOW,
    )).toEqual({ action: 'DELIVER' });
  });

  it('более раннее доставленное событие НЕ подавляет позднее', () => {
    expect(redelivery.redeliveryDecision(
      { ...base, eventType: 'TP2' }, new Set(['sig-1|user-1|TP1', 'sig-1|user-1|FILL']), NOW,
    )).toEqual({ action: 'DELIVER' });
  });
});

describe('buildRedeliveryPayload — исходное время факта, не время retry', () => {
  const signal = { id: 'sig-1', symbol: 'BTC/USDT', status: 'FILLED', fillPrice: 101 };

  it('TP1/BREAKEVEN: progressAt = occurred_at события из журнала', () => {
    const at = new Date('2026-10-01T15:00:00.000Z');
    const payload = redelivery.buildRedeliveryPayload(signal, 'TP1', at);
    expect(payload.progressAt).toBe('2026-10-01T15:00:00.000Z');
    expect(payload.symbol).toBe('BTC/USDT');
    const be = redelivery.buildRedeliveryPayload(signal, 'BREAKEVEN', '2026-10-01T16:00:00.000Z');
    expect(be.progressAt).toBe('2026-10-01T16:00:00.000Z');
  });

  it('остальные события — строка без прогресс-поля', () => {
    const payload = redelivery.buildRedeliveryPayload(signal, 'FILL', new Date());
    expect('progressAt' in payload).toBe(false);
    expect(payload).toEqual(signal);
  });
});

/* ─────────────── Worker: sweep на инъекциях ─────────────── */

/** Форма строк CANDIDATES_SQL. */
function candidateRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    signal_id: 'sig-1',
    event_type: 'FILL',
    occurred_at: new Date('2026-10-01T13:00:00.000Z'),
    event_created_at: new Date('2026-10-01T13:00:01.000Z'),
    user_id: 'user-1',
    attempts: 0,
    last_attempt_at: null,
    last_error_code: null,
    ...over,
  };
}

function makeWorker(opts: {
  candidateRows?: Array<Record<string, unknown>>;
  successRows?: Array<Record<string, unknown>>;
  signals?: Record<string, Record<string, unknown>>;
  deliverResult?: { ok: boolean };
} = {}) {
  const deliverCalls: Array<{ userId: string; payload: { eventType: string; eventId: string; text: string } }> = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let NOW = 1_800_000_000_000;
  const signals: Record<string, Record<string, unknown>> = opts.signals ?? {};
  const worker = new redelivery.NotificationRedeliveryWorker({
    now: () => NOW,
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM signal_lifecycle_events')) {
        return { rows: opts.candidateRows ?? [] };
      }
      if (sql.includes('FROM notification_delivery_log')) {
        return { rows: opts.successRows ?? [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    loadSignal: async (id: string) => signals[id] ?? null,
    deliver: async (userId: string, payload: { eventType: string; eventId: string; text: string }) => {
      deliverCalls.push({ userId, payload });
      return opts.deliverResult ?? { ok: true };
    },
    telemetry: new telemetryModule.CycleTelemetry('test-redelivery'),
  });
  return { worker, deliverCalls, queries, advanceNow: (ms: number) => { NOW += ms; } };
}

describe('NotificationRedeliveryWorker.sweep — доставка и порядок', () => {
  it('доставляет кандидатов в причинном порядке рангов, тем же форматтером', async () => {
    const signal = {
      id: 'sig-1', symbol: 'BTC/USDT', strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      status: 'FILLED', fillPrice: 64600, filledAt: '2026-10-01T13:00:00.000Z',
      fillTargets: [65500, 66200], stopLoss: 63800, targets: [65500, 66200], direction: 'LONG',
    };
    // Кандидаты даны в ОБРАТНОМ порядке (terminal раньше progress) — sweep обязан
    // отсортировать по рангу: TP1(2) → BREAKEVEN(3) → TP2(4).
    const { worker, deliverCalls } = makeWorker({
      candidateRows: [
        candidateRow({ event_type: 'TP2', user_id: 'user-1' }),
        candidateRow({ event_type: 'BREAKEVEN', user_id: 'user-1' }),
        candidateRow({ event_type: 'TP1', user_id: 'user-1', occurred_at: new Date('2026-10-01T15:00:00.000Z') }),
      ],
      signals: { 'sig-1': signal },
    });

    const summary = await worker.sweep();

    expect(summary).toMatchObject({ considered: 3, deliverable: 3, attempted: 3, delivered: 3, failed: 0 });
    expect(deliverCalls.map((c) => c.payload.eventType)).toEqual(['TP1', 'BREAKEVEN', 'TP2']);
    // Тот же форматтер, что первичная доставка: текст сообщения узнаваем.
    expect(deliverCalls[0]!.payload.text).toContain('TP1');
    expect(deliverCalls[0]!.payload.text).toContain('BTC/USDT');
    expect(deliverCalls[1]!.payload.text).toContain('Безубыток');
    // eventId = signal_id (ключ per-user SUCCESS-дедупа).
    expect(deliverCalls.every((c) => c.payload.eventId === 'sig-1')).toBe(true);
  });

  it('счётчики пропусков: backoff / max attempts / permanent / stale', async () => {
    const { worker, deliverCalls } = makeWorker({
      candidateRows: [
        candidateRow({ event_type: 'FILL', attempts: 1, last_attempt_at: new Date(1_799_999_999_000), last_error_code: 'TIMEOUT' }),
        candidateRow({ event_type: 'TP1', attempts: 99, last_attempt_at: new Date(1_799_999_999_000) }),
        candidateRow({ event_type: 'TP2', attempts: 1, last_attempt_at: new Date(1_799_999_970_000), last_error_code: 'CHAT_NOT_FOUND' }),
        candidateRow({ event_type: 'BREAKEVEN', attempts: 0 }),
      ],
      successRows: [{ signal_id: 'sig-1', user_id: 'user-1', event_type: 'TP2' }],
    });

    const summary = await worker.sweep();

    // BACKOFF (30s назад < 60s) + MAX_ATTEMPTS + PERMANENT_SUPPRESSED + STALE_ORDER(BREAKEVEN после TP2)
    expect(summary).toMatchObject({
      considered: 4, deliverable: 0, attempted: 0, delivered: 0,
      skippedBackoff: 1, skippedMaxAttempts: 1, suppressedPermanent: 1, suppressedStaleOrder: 1,
    });
    expect(deliverCalls).toHaveLength(0);
  });

  it('строка сигнала исчезла (временно) — попытка не тратится, событие не выдумывается', async () => {
    const { worker, deliverCalls } = makeWorker({
      candidateRows: [candidateRow({ event_type: 'FILL' })],
      signals: {},
    });
    const summary = await worker.sweep();
    expect(summary.missingSignals).toBe(1);
    expect(summary.attempted).toBe(0);
    expect(deliverCalls).toHaveLength(0);
  });

  it('доставка падает → failed, sweep не бросает', async () => {
    const { worker } = makeWorker({
      candidateRows: [candidateRow({ event_type: 'FILL' })],
      signals: { 'sig-1': { id: 'sig-1', symbol: 'BTC/USDT', status: 'FILLED' } },
      deliverResult: { ok: false },
    });
    const summary = await worker.sweep();
    expect(summary).toMatchObject({ attempted: 1, delivered: 0, failed: 1 });
  });

  it('инъекция deliver бросается → counted as failed, sweep завершается', async () => {
    let NOW = 1_800_000_000_000;
    const worker = new redelivery.NotificationRedeliveryWorker({
      now: () => NOW,
      query: async (sql: string) => {
        if (sql.includes('FROM signal_lifecycle_events')) return { rows: [candidateRow()] };
        if (sql.includes('FROM notification_delivery_log')) return { rows: [] };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      loadSignal: async () => ({ id: 'sig-1', symbol: 'BTC/USDT', status: 'FILLED' }),
      deliver: async () => { throw new Error('boom'); },
    });
    const summary = await worker.sweep();
    expect(summary.failed).toBe(1);
    expect(summary.delivered).toBe(0);
  });
});

describe('NotificationRedeliveryWorker — конкурентность и lifecycle', () => {
  it('in-process guard: параллельные sweep() — одна эффективная доставка', async () => {
    const { worker, deliverCalls } = makeWorker({
      candidateRows: [candidateRow({ event_type: 'FILL' })],
      signals: { 'sig-1': { id: 'sig-1', symbol: 'BTC/USDT', status: 'FILLED' } },
    });
    const [a, b] = await Promise.all([worker.sweep(), worker.sweep()]);
    expect(a).toBe(b); // тот же promise
    expect(deliverCalls).toHaveLength(1);
  });

  it('graceful stop: start→stop дожидается bounded sweep и гасит таймер', async () => {
    const { worker, deliverCalls } = makeWorker({
      candidateRows: [candidateRow({ event_type: 'FILL' })],
      signals: { 'sig-1': { id: 'sig-1', symbol: 'BTC/USDT', status: 'FILLED' } },
    });
    worker.start();
    expect(worker.isRunning()).toBe(true);
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
    expect(worker.timer).toBeNull();
    expect(deliverCalls.length).toBe(1); // первый (немедленный) sweep успел
  });

  it('stats несёт телеметрию sweep-а: pending/summary/времена', async () => {
    const { worker } = makeWorker({
      candidateRows: [candidateRow({ event_type: 'FILL' })],
      signals: { 'sig-1': { id: 'sig-1', symbol: 'BTC/USDT', status: 'FILLED' } },
      deliverResult: { ok: false },
    });
    await worker.sweep();
    const stats = worker.stats;
    expect(stats.running).toBe(false);
    expect(stats.lastSweepStartedAt).toBeTruthy();
    expect(stats.lastSweepFinishedAt).toBeTruthy();
    expect(stats.pendingCount).toBe(1); // considered 1 − delivered 0
    expect(stats.lastSummary).toMatchObject({ considered: 1, attempted: 1, failed: 1 });
  });

  it('синглтон: getNotificationRedeliveryWorker идемпотентен, reset пересоздаёт', () => {
    redelivery.resetNotificationRedeliveryWorker();
    const a = redelivery.getNotificationRedeliveryWorker();
    const b = redelivery.getNotificationRedeliveryWorker();
    expect(a).toBe(b);
    redelivery.resetNotificationRedeliveryWorker();
    const c = redelivery.getNotificationRedeliveryWorker();
    expect(c).not.toBe(a);
    // Продакшен-инвариант: ОДИН инстанс на процесс + in-process guard.
    expect(typeof redelivery.notificationRedeliveryStatus().running).toBe('boolean');
  });
});
