export type SignalLifecycleEventType =
  | 'NEW_SIGNAL'
  | 'FILL'
  | 'BREAKEVEN'
  | 'STOP_LOSS'
  | 'CANCELLED'
  | 'CLOSED'
  | `TP${number}`;

/** Фиксированные типы событий (лестница TPn распознаётся отдельно). */
export const SIGNAL_LIFECYCLE_EVENT_TYPES: readonly string[];

export function isSignalTargetEventType(eventType: unknown): boolean;
export function isSignalLifecycleEventType(eventType: unknown): boolean;

/** Причины frozen-выхода, ДОКАЗЫВАЮЩИЕ достижение TP1 (правила V3.x). */
export const TP1_PROVEN_EXIT_REASONS: readonly string[];
/** Сделка реально закрыта по безубытку (стоп стоял на уровне входа). */
export const BREAKEVEN_EXIT_REASONS: readonly string[];
/**
 * V3.x с коридорным входом: armed-стоп после TP1 стоит ровно на цене входа
 * (R3/R4). Закрытый список (fail-closed): V2.8 и неизвестные стратегии
 * действующего стопа не получают никогда.
 */
export const V3_CORRIDOR_STRATEGY_IDS: readonly string[];

/**
 * READ-ONLY проекция lifecycle-прогресса для UI. Чистая функция от строки
 * (форма mapRow) и событий журнала ЭТОГО сигнала. См. реализацию —
 * `projectSignalLifecycleProgress` в signalLifecycleEvents.js.
 */
export interface SignalLifecycleProgressInput {
  status?: string;
  strategyId?: string;
  closeReason?: string | null;
  fillPrice?: number | null;
  closedAt?: Date | string | null;
}

export interface SignalLifecycleProgress {
  tp1Hit: boolean;
  tp1HitAt: string | null;
  tp2Hit: boolean;
  tp2HitAt: string | null;
  breakevenArmed: boolean;
  breakevenArmedAt: string | null;
  stopHit: boolean;
  stopHitAt: string | null;
  currentStop: number | null;
  currentStopBasis: 'BE_AT_ENTRY' | null;
}

export function projectSignalLifecycleProgress(
  row: SignalLifecycleProgressInput | null | undefined,
  events: Array<{ eventType?: unknown; occurredAt?: unknown }> | null | undefined
): SignalLifecycleProgress;

export interface SignalLifecycleSnapshot {
  status?: string;
  fillPrice?: number | null;
}

/** Чистая классификация перехода «было → стало» в упорядоченный список событий. */
export function classifyLifecycleTransition(
  previous: SignalLifecycleSnapshot | null,
  next: Record<string, unknown> | null,
): string[];

export function recordSignalLifecycleEvent(
  signalId: string,
  input: { eventType: string; occurredAt?: Date | string | null },
): Promise<{ recorded: boolean }>;

export function dispatchSignalLifecycleEvents(
  signal: Record<string, unknown> | null,
  previous?: SignalLifecycleSnapshot | null,
): Promise<string[]>;

/** Прогресс ОТКРЫТОЙ позиции из FILLED-результата frozen-ядра (§6). */
export interface SignalProgress {
  tp1Booked?: boolean;
  tp1At?: number | null;
  beArmed?: boolean;
  beArmedAt?: number | null;
}

/** Чистая классификация прогресса открытой позиции → ['TP1', 'BREAKEVEN']. */
export function classifyProgressEvents(progress: SignalProgress | null | undefined): string[];

/**
 * Промежуточные уведомления об ОТКРЫТОЙ позиции: прогресс → TP1/BREAKEVEN →
 * персистентный дедуп → emit. Никогда не бросает. Вызывается на каждом тике
 * открытой FILLED-строки (повторы гасятся PK signal_lifecycle_events).
 */
export function dispatchSignalProgressEvents(
  signal: Record<string, unknown> | null,
  progress?: SignalProgress | null,
): Promise<string[]>;

export function dispatchNewSignalEvent(
  signal: Record<string, unknown> | null,
): Promise<{ recorded: boolean }>;
