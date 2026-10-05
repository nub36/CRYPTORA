/**
 * Декларации для server/services/notificationRedelivery.js.
 *
 * Durable redelivery Telegram lifecycle-уведомлений: пары
 * (signal_lifecycle_events × telegram-enabled user) без SUCCESS-доставки
 * ретраятся напрямую конкретному пользователю (не переэмитя факт).
 * Гарантия — durable at-least-once attempt с per-user SUCCESS suppression
 * (без exactly-once: у Telegram sendMessage нет idempotency key).
 */

/** Пауза между sweep-ами фонового worker-а (ms). */
export const REDELIVERY_SWEEP_INTERVAL_MS: number;
/** События старше этого возраста не ретраятся (ms). */
export const REDELIVERY_EVENT_TTL_MS: number;
/** Максимум попыток доставки на пару (event, user). */
export const REDELIVERY_MAX_ATTEMPTS: number;
export const REDELIVERY_BACKOFF_BASE_MS: number;
export const REDELIVERY_BACKOFF_MAX_MS: number;
/** Подавление пары после permanent-ошибки (ms). */
export const REDELIVERY_PERMANENT_SUPPRESSION_MS: number;
/** Верхний предел пар за один sweep. */
export const REDELIVERY_SWEEP_BATCH_LIMIT: number;

/** Причинный ранг события (меньше = раньше в нарративе). */
export const LIFECYCLE_EVENT_RANKS: Readonly<Record<string, number>>;

/** Ранг события или null для неизвестного типа (worker такие не трогает). */
export function lifecycleEventRank(eventType: unknown): number | null;

/** Экспоненциальный backoff после `attempts` состоявшихся попыток (ms). */
export function redeliveryBackoffMs(attempts: number): number;

/** Кандидат на повторную доставку (агрегат sweep-запроса). */
export interface RedeliveryCandidate {
  signalId: string;
  userId: string;
  eventType: string;
  attempts: number;
  lastAttemptAt: number | null;
  lastErrorCode: string | null;
}

export type RedeliveryDecision =
  | { action: 'DELIVER' }
  | { action: 'SKIP'; reason: 'UNKNOWN_EVENT_TYPE' | 'MAX_ATTEMPTS' | 'PERMANENT_SUPPRESSED' | 'BACKOFF' | 'STALE_ORDER' };

/** Чистая политика: доставлять пару (event, user) или пропустить. */
export function redeliveryDecision(
  candidate: RedeliveryCandidate,
  successKeys: ReadonlySet<string>,
  nowMs: number,
): RedeliveryDecision;

/** Полезная нагрузка повторной доставки: та же строка + исходное время факта. */
export function buildRedeliveryPayload(
  signal: Record<string, unknown>,
  eventType: string,
  occurredAt: Date | string | null,
): Record<string, unknown>;

export interface RedeliverySweepSummary {
  considered: number;
  deliverable: number;
  attempted: number;
  delivered: number;
  failed: number;
  skippedBackoff: number;
  skippedMaxAttempts: number;
  suppressedPermanent: number;
  suppressedStaleOrder: number;
  skippedUnknown: number;
  missingSignals: number;
}

export interface RedeliveryWorkerStats {
  running: boolean;
  lastSweepStartedAt: string | null;
  lastSweepFinishedAt: string | null;
  lastSweepDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  pendingCount: number;
  lastSummary: RedeliverySweepSummary;
}

export interface RedeliveryWorkerOptions {
  intervalMs?: number;
  now?: () => number;
  query?: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  loadSignal?: (id: string) => Promise<Record<string, unknown> | null>;
  deliver?: (
    userId: string,
    payload: { eventType: string; eventId: string; text: string },
  ) => Promise<{ ok: boolean }>;
  batchLimit?: number;
  telemetry?: any;
}

export declare class NotificationRedeliveryWorker {
  constructor(opts?: RedeliveryWorkerOptions);

  intervalMs: number;
  nowFn: () => number;
  queryFn: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  loadSignalFn: (id: string) => Promise<Record<string, unknown> | null>;
  deliverFn: (
    userId: string,
    payload: { eventType: string; eventId: string; text: string },
  ) => Promise<{ ok: boolean }>;
  batchLimit: number;
  telemetry: any;

  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  inFlight: Promise<RedeliverySweepSummary> | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastSummary: RedeliverySweepSummary;

  isRunning(): boolean;
  readonly stats: RedeliveryWorkerStats;
  /** Интервал + немедленный первый sweep (после рестарта — без ожидания). */
  start(): void;
  /** Остановка новых sweep + ожидание bounded текущего. */
  stop(): Promise<void>;
  /** Sweep с in-process guard (параллельный вызов = тот же promise). */
  sweep(): Promise<RedeliverySweepSummary>;
  recordError(e: unknown): void;
}

/** Синглтон, которым владеет server/index.js. */
export declare function getNotificationRedeliveryWorker(): NotificationRedeliveryWorker;

/** Сброс синглтона — только для тестов. */
export declare function resetNotificationRedeliveryWorker(): void;

/** Диагностика для health/API. */
export declare function notificationRedeliveryStatus(): RedeliveryWorkerStats;
