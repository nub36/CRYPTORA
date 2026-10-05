/**
 * CRYPTORA — Durable redelivery Telegram lifecycle-уведомлений.
 *
 * ЗАДАЧА (PR #56, 2026-10-05). Lifecycle-факт фиксируется в
 * `signal_lifecycle_events` (PK — персистентный дедуп: событие отправляется
 * ровно один раз), но ДОСТАВКА в Telegram была fire-and-forget: сбой
 * sendMessage (timeout/429/5xx/сеть), crash между INSERT и отправкой или
 * недоступность канала теряли уведомление НАВСЕГДА. Этот worker закрывает
 * разрыв: находит пары (lifecycle-событие × telegram-пользователь), для
 * которых НЕТ успешной доставки, и доставляет повторно — напрямую конкретному
 * пользователю, НЕ переэмитя lifecycle-факт.
 *
 * ГАРАНТИЯ (формулируется честно, БЕЗ exactly-once):
 *   durable at-least-once attempt с per-user SUCCESS suppression.
 * Telegram sendMessage не поддерживает idempotency key: если провайдер
 * фактически принял сообщение, но HTTP-ответ потерян (ambiguous network
 * failure), повтор МОЖЕТ дать редкий дубль. Это осознанный компромисс:
 * потерянное уведомление хуже редкого дубля.
 *
 * ИСТОЧНИКИ ПРАВДЫ:
 *   • событие — `signal_lifecycle_events` (durable journal, миграция 018);
 *     сюда же записывается NEW_SIGNAL (dispatchNewSignalEvent), поэтому
 *     crash-recovery покрывает и публикацию нового сигнала;
 *   • успешная доставка конкретному пользователю — `notification_delivery_log`
 *     (миграция 017): пара (event, user) считается доставленной ⇔ есть строка
 *     result='SUCCESS' с (event_id=signal_id, event_type, user_id).
 *
 * ПОЛИТИКА (все константы именованы и экспортированы):
 *   • TTL — события старше REDELIVERY_EVENT_TTL_MS не тревожатся (bounded
 *     journal, никаких повторов по древней истории);
 *   • MAX_ATTEMPTS — попыток доставки на пару (event, user) не больше N
 *     (мёртвый token/chat не ретраится бесконечно);
 *   • BACKOFF — экспоненциальный (base * 2^(attempts-1), с потолком) между
 *     попытками; защита от tight loop;
 *   • PERMANENT-suppression — после permanent-кода (INVALID_TOKEN /
 *     CHAT_NOT_FOUND / …) пара подавлена на REDELIVERY_PERMANENT_SUPPRESSION_MS:
 *     мгновенных повторов нет, но после фикса токена пользователем одна
 *     проверка в окне TTL произойдёт;
 *   • ORDERING — причинный порядок событий на пользователя: событие НЕ
 *     доставляется, если пользователю уже успешно доставлено БОЛЕЕ ПОЗДНЕЕ
 *     событие того же сигнала (устаревший progress не приходит после
 *     терминала); внутри sweep пары обрабатываются в порядке ранга.
 *
 * FAN-OUT. Доставка пер-пользовательская: если User A получил SUCCESS, а
 * User B — FAILURE, повторится ТОЛЬКО B (A исключён своим SUCCESS в журнале).
 *
 * КОНКУРЕНЦИЯ. Продакшен — ОДИН процесс (cryptora.service, singleton через
 * getNotificationRedeliveryWorker()); внутри инстанса sweep защищён
 * in-process guard (повторный вызов возвращает тот же promise). Для
 * мультипроцессного деплоя в будущем понадобится DB-claim (advisory lock);
 * сегодня это исключено архитектурой запуска, а worst-case гонки двух
 * процессов — редкий дубль (см. гарантию выше), не потеря и не дубль факта.
 *
 * ФОРМАТИРОВАНИЕ. Тот же `formatSignalTelegramText`, что и первичная
 * доставка (второго форматтера нет). Время факта — occurred_at события из
 * журнала (исходное время), а не время повторной доставки.
 *
 * ОТКАЗ НЕ ПРОРУШИВАЕТ НИЧЕГО: ошибки sweep логируются и съедаются —
 * торговый мониторинг и скан стратегий не зависят от этого модуля.
 */
import { query as defaultPoolQuery } from '../db/pool.js';
import { getSignalById } from './signalRepository.js';
import {
  deliverSavedTelegram,
  formatSignalTelegramText,
  isPermanentTelegramErrorCode,
} from './notificationChannels.js';
import { getHealthTelemetry, CYCLE_NOTIFICATION_REDELIVERY } from './health/telemetry.js';

/** Пауза между sweep-ами фонового worker-а. */
export const REDELIVERY_SWEEP_INTERVAL_MS = 60_000;
/** Событие старше этого возраста не ретраится (bounded journal). */
export const REDELIVERY_EVENT_TTL_MS = 24 * 60 * 60_000;
/** Максимум попыток доставки (строк доставки) на пару (event, user). */
export const REDELIVERY_MAX_ATTEMPTS = 5;
/** База экспоненциального backoff между попытками worker-а. */
export const REDELIVERY_BACKOFF_BASE_MS = 60_000;
/** Потолок backoff между попытками worker-а. */
export const REDELIVERY_BACKOFF_MAX_MS = 15 * 60_000;
/** Подавление пары после permanent-ошибки (токен могут починить). */
export const REDELIVERY_PERMANENT_SUPPRESSION_MS = 6 * 60 * 60_000;
/** Верхний предел пар, рассматриваемых за один sweep. */
export const REDELIVERY_SWEEP_BATCH_LIMIT = 200;

/**
 * Причинный ранг события жизненного цикла (для ordering-политики).
 * Меньше = раньше в нарративе. Ранг НЕ описывает «важность», только порядок.
 */
export const LIFECYCLE_EVENT_RANKS = Object.freeze({
  NEW_SIGNAL: 0,
  FILL: 1,
  TP1: 2,
  BREAKEVEN: 3,
  TP2: 4,
  STOP_LOSS: 4,
  CANCELLED: 4,
  CLOSED: 4,
});

/**
 * Ранг события или null для неизвестного типа (worker неизвестные не трогает:
 * никогда не доставляет то, что не умеет интерпретировать).
 * TPn при n ≥ 2 — терминальная цель (ранг 4); TP1 — промежуточная (ранг 2).
 */
export function lifecycleEventRank(eventType) {
  const t = String(eventType ?? '');
  if (Object.prototype.hasOwnProperty.call(LIFECYCLE_EVENT_RANKS, t)) {
    return LIFECYCLE_EVENT_RANKS[t];
  }
  const tp = /^TP(\d+)$/.exec(t);
  if (tp) {
    const n = Number(tp[1]);
    if (n === 1) return 2;
    if (n >= 2) return 4;
  }
  return null;
}

/** Экспоненциальный backoff после `attempts` состоявшихся попыток (ms). */
export function redeliveryBackoffMs(attempts) {
  const n = Math.max(1, Number(attempts) || 1);
  return Math.min(REDELIVERY_BACKOFF_BASE_MS * 2 ** (n - 1), REDELIVERY_BACKOFF_MAX_MS);
}

/** Ключ пары (signal, user, event) в set успешных доставок. */
function successKey(signalId, userId, eventType) {
  return `${signalId}|${userId}|${eventType}`;
}

/**
 * Решение по одной паре (event, user): доставлять повторно или пропустить.
 * Чистая функция — политика проверяется юнит-тестами без БД.
 *
 * @param {{signalId: string, userId: string, eventType: string, attempts: number,
 *          lastAttemptAt: number|null, lastErrorCode: string|null}} candidate
 * @param {Set<string>} successKeys множество `${signalId}|${userId}|${eventType}` уже доставленного
 * @param {number} nowMs
 * @returns {{action: 'DELIVER'} | {action: 'SKIP', reason: string}}
 */
export function redeliveryDecision(candidate, successKeys, nowMs) {
  const rank = lifecycleEventRank(candidate.eventType);
  if (rank === null) return { action: 'SKIP', reason: 'UNKNOWN_EVENT_TYPE' };

  const attempts = Number(candidate.attempts) || 0;
  if (attempts >= REDELIVERY_MAX_ATTEMPTS) return { action: 'SKIP', reason: 'MAX_ATTEMPTS' };

  const lastAttemptAt = candidate.lastAttemptAt;
  if (attempts > 0 && lastAttemptAt !== null && lastAttemptAt !== undefined) {
    // Permanent-ошибка: повтор бессмыслен до изменения конфигурации; после
    // окна подавления — одна проверка (пользователь мог починить токен).
    if (isPermanentTelegramErrorCode(candidate.lastErrorCode)) {
      if (nowMs - lastAttemptAt < REDELIVERY_PERMANENT_SUPPRESSION_MS) {
        return { action: 'SKIP', reason: 'PERMANENT_SUPPRESSED' };
      }
    } else if (nowMs - lastAttemptAt < redeliveryBackoffMs(attempts)) {
      return { action: 'SKIP', reason: 'BACKOFF' };
    }
  }

  // Ordering: пользователю уже успешно доставлено более позднее событие
  // того же сигнала — старшее по нарративу доставлять позднее нельзя.
  const prefix = `${candidate.signalId}|${candidate.userId}|`;
  for (const key of successKeys) {
    if (!key.startsWith(prefix)) continue;
    const otherType = key.slice(prefix.length);
    if (otherType === candidate.eventType) continue;
    const otherRank = lifecycleEventRank(otherType);
    if (otherRank !== null && otherRank > rank) {
      return { action: 'SKIP', reason: 'STALE_ORDER' };
    }
  }

  return { action: 'DELIVER' };
}

/**
 * Полезная нагрузка для повторной доставки: та же строка signals (mapRow),
 * с исходным временем факта из журнала (occurred_at) вместо времени retry.
 * Для терминальных событий форматтер берёт closedAt/filledAt из строки —
 * прогресс-поле им не мешает; для TP1/BREAKEVEN оно даёт бар подтверждения.
 */
export function buildRedeliveryPayload(signal, eventType, occurredAt) {
  if (eventType !== 'TP1' && eventType !== 'BREAKEVEN') return signal;
  const iso = occurredAt instanceof Date
    ? occurredAt.toISOString()
    : (occurredAt ?? null);
  return { ...signal, progressAt: iso };
}

/**
 * Кандидаты на повторную доставку: пары (lifecycle-событие × включённый
 * Telegram-пользователь) в окне TTL, для которых НЕТ строки SUCCESS.
 * attempts/last_attempt_at/last_error_code — агрегат по delivery_log.
 */
const CANDIDATES_SQL = `
  SELECT e.signal_id::text AS signal_id,
         e.event_type      AS event_type,
         e.occurred_at     AS occurred_at,
         e.created_at      AS event_created_at,
         c.user_id::text   AS user_id,
         COUNT(d.id)::int  AS attempts,
         MAX(d.created_at) AS last_attempt_at,
         (ARRAY_REMOVE(ARRAY_AGG(d.error_code ORDER BY d.created_at DESC), NULL))[1] AS last_error_code
    FROM signal_lifecycle_events e
    JOIN notification_channels c ON c.telegram_enabled = true
    LEFT JOIN notification_delivery_log d
      ON d.user_id = c.user_id
     AND d.event_id = e.signal_id::text
     AND d.event_type = e.event_type
   WHERE e.created_at > now() - make_interval(secs => $1::int)
   GROUP BY e.signal_id, e.event_type, e.occurred_at, e.created_at, c.user_id
  HAVING NOT COALESCE(BOOL_OR(d.result = 'SUCCESS'), false)
   ORDER BY e.created_at ASC, c.user_id ASC
   LIMIT $2::int`;

/** Успешно доставленные (signal, user, event) — для ordering-политики. */
const SUCCESS_SQL = `
  SELECT DISTINCT d.event_id::text AS signal_id,
                  d.user_id::text  AS user_id,
                  d.event_type     AS event_type
    FROM notification_delivery_log d
   WHERE d.result = 'SUCCESS'
     AND d.event_id = ANY($1::text[])`;

/** Пустой summary (до первого sweep). */
function emptySummary() {
  return {
    considered: 0,
    deliverable: 0,
    attempted: 0,
    delivered: 0,
    failed: 0,
    skippedBackoff: 0,
    skippedMaxAttempts: 0,
    suppressedPermanent: 0,
    suppressedStaleOrder: 0,
    skippedUnknown: 0,
    missingSignals: 0,
  };
}

export class NotificationRedeliveryWorker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.intervalMs]
   * @param {() => number} [opts.now]
   * @param {(sql: string, params?: unknown[]) => Promise<{rows: any[]}>} [opts.query]
   * @param {(id: string) => Promise<any>} [opts.loadSignal]
   * @param {(userId: string, payload: {eventType: string, eventId: string, text: string}) => Promise<{ok: boolean}>} [opts.deliver]
   * @param {number} [opts.batchLimit]
   * @param {object} [opts.telemetry]
   */
  constructor({
    intervalMs = REDELIVERY_SWEEP_INTERVAL_MS,
    now = () => Date.now(),
    query = (sql, params) => defaultPoolQuery(sql, params),
    loadSignal = getSignalById,
    deliver = (userId, payload) => deliverSavedTelegram(userId, payload),
    batchLimit = REDELIVERY_SWEEP_BATCH_LIMIT,
    telemetry = getHealthTelemetry().cycle(CYCLE_NOTIFICATION_REDELIVERY),
  } = {}) {
    this.intervalMs = intervalMs;
    this.nowFn = now;
    this.queryFn = query;
    this.loadSignalFn = loadSignal;
    this.deliverFn = deliver;
    this.batchLimit = batchLimit;
    /** Телеметрия цикла — та же система, что у монитора сигналов. */
    this.telemetry = telemetry;

    this.timer = null;
    this.running = false;
    /** In-process guard: единовременно не более одного sweep на инстанс. */
    this.inFlight = null;

    this.lastSweepStartedAt = null;
    this.lastSweepFinishedAt = null;
    this.lastSweepDurationMs = null;
    this.lastError = null;
    this.consecutiveFailures = 0;
    this.lastSummary = emptySummary();
  }

  isRunning() {
    return this.running;
  }

  get stats() {
    return {
      running: this.running,
      lastSweepStartedAt: this.lastSweepStartedAt,
      lastSweepFinishedAt: this.lastSweepFinishedAt,
      lastSweepDurationMs: this.lastSweepDurationMs,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
      /** Кандидатов, оставшихся недоставленными после последнего sweep. */
      pendingCount: Math.max(0, (this.lastSummary?.considered ?? 0) - (this.lastSummary?.delivered ?? 0)),
      lastSummary: this.lastSummary,
    };
  }

  /** Поднимает интервал и сразу выполняет первый sweep (после рестарта — без ожидания). */
  start() {
    if (this.running) return;
    this.running = true;
    this.telemetry.markStarted();
    this.timer = setInterval(() => {
      if (!this.running) return;
      this.sweep().catch((e) => this.recordError(e));
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.sweep().catch((e) => this.recordError(e));
  }

  /**
   * Остановка: новых sweep нет, текущий bounded-sweep дожидается
   * (его попытки доставки уже зафиксированы в журнале; недоставленное
   * подберёт следующий запуск — durable state в PostgreSQL).
   */
  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.allSettled(this.inFlight ? [this.inFlight] : []);
  }

  recordError(e) {
    const message = e instanceof Error ? e.message : String(e);
    this.lastError = message;
    this.consecutiveFailures += 1;
    // eslint-disable-next-line no-console
    console.error('[notification-redelivery] sweep error:', message);
  }

  /** Sweep с in-process guard: параллельный вызов ждёт/возвращает Т ОТ же sweep. */
  sweep() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.sweepOnce().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async sweepOnce() {
    const startedAt = this.nowFn();
    this.lastSweepStartedAt = new Date(startedAt).toISOString();
    this.telemetry.beginCycle();
    const summary = emptySummary();

    try {
      const ttlSeconds = Math.floor(REDELIVERY_EVENT_TTL_MS / 1000);
      const { rows } = await this.queryFn(CANDIDATES_SQL, [ttlSeconds, this.batchLimit]);
      const candidates = Array.isArray(rows) ? rows : [];
      summary.considered = candidates.length;

      // Успешные доставки затронутых сигналов — для ordering-подавления.
      const signalIds = [...new Set(candidates.map((r) => r.signal_id))];
      const successKeys = new Set();
      if (signalIds.length > 0) {
        const done = await this.queryFn(SUCCESS_SQL, [signalIds]);
        for (const row of done.rows ?? []) {
          successKeys.add(successKey(row.signal_id, row.user_id, row.event_type));
        }
      }

      const nowMs = this.nowFn();
      const deliverable = [];
      for (const row of candidates) {
        const candidate = {
          signalId: String(row.signal_id),
          userId: String(row.user_id),
          eventType: String(row.event_type),
          attempts: Number(row.attempts) || 0,
          lastAttemptAt: row.last_attempt_at === null || row.last_attempt_at === undefined
            ? null
            : new Date(row.last_attempt_at).getTime(),
          lastErrorCode: row.last_error_code ?? null,
        };
        const decision = redeliveryDecision(candidate, successKeys, nowMs);
        if (decision.action === 'DELIVER') {
          deliverable.push({
            candidate,
            occurredAt: row.occurred_at ?? null,
            eventCreatedAt: new Date(row.event_created_at).getTime(),
            rank: lifecycleEventRank(candidate.eventType),
          });
        } else if (decision.reason === 'BACKOFF') summary.skippedBackoff += 1;
        else if (decision.reason === 'MAX_ATTEMPTS') summary.skippedMaxAttempts += 1;
        else if (decision.reason === 'PERMANENT_SUPPRESSED') summary.suppressedPermanent += 1;
        else if (decision.reason === 'STALE_ORDER') summary.suppressedStaleOrder += 1;
        else summary.skippedUnknown += 1;
      }
      summary.deliverable = deliverable.length;

      // Причинный порядок внутри sweep: ранг события, затем время события.
      deliverable.sort((a, b) => (a.rank - b.rank) || (a.eventCreatedAt - b.eventCreatedAt));

      // Строка сигнала читается один раз на sweep (кэш), текст — ТОЛЬКО
      // существующим formatSignalTelegramText (второго форматтера нет).
      const signalCache = new Map();
      for (const item of deliverable) {
        const { candidate } = item;
        let signal = signalCache.get(candidate.signalId);
        if (signal === undefined) {
          signal = await this.loadSignalFn(candidate.signalId);
          signalCache.set(candidate.signalId, signal);
        }
        if (!signal) {
          // Событие без строки сигнала невозможно отформатировать честно —
          // не выдумываем, пропускаем (FK гарантирует, что это временно).
          summary.missingSignals += 1;
          continue;
        }
        const payload = buildRedeliveryPayload(signal, candidate.eventType, item.occurredAt);
        const text = formatSignalTelegramText(payload, candidate.eventType);
        summary.attempted += 1;
        try {
          const result = await this.deliverFn(candidate.userId, {
            eventType: candidate.eventType,
            eventId: candidate.signalId,
            text,
          });
          if (result && result.ok) summary.delivered += 1;
          else summary.failed += 1;
        } catch {
          // Диспетчер доставки сам не бросает; страховка на случай инъекции.
          summary.failed += 1;
        }
      }

      this.lastSweepDurationMs = this.nowFn() - startedAt;
      this.lastSweepFinishedAt = new Date(this.nowFn()).toISOString();
      this.lastSummary = summary;
      this.telemetry.completeCycle({
        ok: true,
        inspected: summary.considered,
        updated: summary.delivered,
        errors: summary.failed,
      });
      return summary;
    } catch (e) {
      this.lastSweepDurationMs = this.nowFn() - startedAt;
      this.lastSweepFinishedAt = new Date(this.nowFn()).toISOString();
      this.telemetry.completeCycle({ ok: false, error: e, errors: 1 });
      throw e;
    }
  }
}

let singleton = null;

/** @returns {NotificationRedeliveryWorker} */
export function getNotificationRedeliveryWorker() {
  if (!singleton) singleton = new NotificationRedeliveryWorker();
  return singleton;
}

/** Сброс синглтона — только для тестов. */
export function resetNotificationRedeliveryWorker() {
  singleton = null;
}

/** Диагностика для API/health (синглтон может отсутствовать). */
export function notificationRedeliveryStatus() {
  const worker = singleton;
  if (!worker) {
    return {
      running: false,
      lastSweepStartedAt: null,
      lastSweepFinishedAt: null,
      lastSweepDurationMs: null,
      lastError: null,
      consecutiveFailures: 0,
      pendingCount: 0,
      lastSummary: emptySummary(),
    };
  }
  return worker.stats;
}
