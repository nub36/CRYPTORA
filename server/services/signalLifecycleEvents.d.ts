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
