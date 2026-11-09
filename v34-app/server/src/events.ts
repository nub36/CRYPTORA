/**
 * События жизненного цикла сигнала — ПРОИЗВОДНЫЕ от собственных данных
 * продукта (строки `signals` и журнала `signal_events`).
 *
 * Правила перенесены из CRYPTORA (`server/services/signalLifecycleEvents.js`,
 * функции `classifyLifecycleTransition`, `classifyProgressEvents`,
 * `projectSignalLifecycleProgress`) и ограничены стратегией V3.4:
 *
 *   • TP1 доказан прогрессом frozen-ядра (`inspectTrade` → tp1Booked) ИЛИ
 *     терминальным исходом с TP1-доказуемой причиной;
 *   • BREAKEVEN — только событие прогресса у ОТКРЫТОЙ позиции (armed-стоп
 *     реально действовал); при терминальном TP2 оно НЕ создаётся: стоп мог не
 *     сработать, доказательства нет;
 *   • TP2 доказан событием или статусом TARGET_REACHED;
 *   • STOP_LOSS — событием или статусом INVALIDATED.
 *
 * Действующий стоп (`currentStop`) выводится ТОЛЬКО когда доказуем: armed-стоп
 * V3.4 стоит ровно на цене входа (правило степпера «stopNow = entry после
 * TP1»), а вход — это persisted `fill_price`. Во всех остальных случаях —
 * null. Выдуманный уровень хуже его отсутствия, а подставлять цену входа
 * вместо стопа запрещено.
 */
import type { SignalEventType } from './db';
import type { LifecycleProgress } from '@v34/core';

/** Причины выхода frozen-ядра, ДОКАЗЫВАЮЩИЕ достижение TP1 (правила V3.x). */
export const TP1_PROVEN_EXIT_REASONS: readonly string[] = Object.freeze([
  'TP2', 'TP1_THEN_BE', 'TP1_THEN_SL', 'TP1_THEN_TIMEOUT',
]);
/** Сделка реально закрыта по безубытку. */
export const BREAKEVEN_EXIT_REASONS: readonly string[] = Object.freeze(['TP1_THEN_BE']);

const NO_TRADE = new Set(['EXPIRED', 'CANCELLED', 'UNRESOLVED']);
const CLOSED = new Set(['TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED']);

/** Минимальный снапшот строки сигнала, которого достаточно для классификации. */
export interface SignalSnapshot {
  status: string;
  fillPrice: number | null;
  closeReason?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  filledAt?: string | null;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Какие события несёт переход «было → стало». Порядок — нарратив пользователя:
 * вход → цель → исход. Ровно один терминальный класс.
 */
export function classifyTransition(previous: SignalSnapshot | null, next: SignalSnapshot | null): SignalEventType[] {
  if (!next) return [];
  const events: SignalEventType[] = [];

  const prevEntered = previous?.status === 'FILLED' || previous?.fillPrice != null;
  const entered = next.fillPrice != null;
  if (!prevEntered && entered) events.push('FILL');

  if (CLOSED.has(next.status)) {
    if (NO_TRADE.has(next.status)) {
      events.push('CANCELLED');
    } else if (next.status === 'TARGET_REACHED') {
      if (TP1_PROVEN_EXIT_REASONS.includes(next.closeReason ?? '')) events.push('TP1');
      events.push('TP2');
    } else if (next.status === 'INVALIDATED') {
      if (TP1_PROVEN_EXIT_REASONS.includes(next.closeReason ?? '')) events.push('TP1');
      events.push('STOP_LOSS');
    } else if (BREAKEVEN_EXIT_REASONS.includes(next.closeReason ?? '')) {
      if (next.closeReason === 'TP1_THEN_BE') events.push('TP1');
      events.push('BREAKEVEN');
    } else {
      if (TP1_PROVEN_EXIT_REASONS.includes(next.closeReason ?? '')) events.push('TP1');
      events.push('CLOSED');
    }
  }
  return events;
}

/**
 * Промежуточные события ОТКРЫТОЙ позиции. Источник — только `inspectTrade`
 * frozen-ядра (тот же степпер, что считает терминальный исход).
 */
export function classifyProgress(progress: LifecycleProgress | null | undefined): SignalEventType[] {
  if (!progress || typeof progress !== 'object') return [];
  const events: SignalEventType[] = [];
  if (progress.tp1Booked === true) events.push('TP1');
  if (progress.beArmed === true) events.push('BREAKEVEN');
  return events;
}

/** Время факта прогресс-события — closeTime подтверждающего бара (не «сейчас»). */
export function progressOccurredAt(
  progress: LifecycleProgress | null | undefined,
  eventType: SignalEventType,
): string | null {
  if (!progress || typeof progress !== 'object') return null;
  const ms = eventType === 'TP1' ? progress.tp1At : progress.beArmedAt;
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

/** Время факта события из строки сигнала (не «сейчас»). */
export function occurredAtFor(signal: SignalSnapshot, eventType: SignalEventType): string | null {
  if (eventType === 'NEW_SIGNAL') return isoOrNull(signal.createdAt);
  if (eventType === 'FILL') return isoOrNull(signal.filledAt);
  return isoOrNull(signal.closedAt);
}

export interface LifecycleEventView {
  eventType: string;
  occurredAt: string | null;
}

export interface LifecycleProjection {
  tp1Hit: boolean;
  tp1HitAt: string | null;
  tp2Hit: boolean;
  tp2HitAt: string | null;
  breakevenArmed: boolean;
  breakevenArmedAt: string | null;
  stopHit: boolean;
  stopHitAt: string | null;
  /** Действующий стоп — только когда доказуем (BE на цене входа). */
  currentStop: number | null;
  currentStopBasis: 'BE_AT_ENTRY' | null;
}

/**
 * READ-ONLY проекция для UI/API. Чистая функция от строки `signals` и её
 * журнала событий: ничего не считает по рынку и не воспроизводит стратегию.
 */
export function projectSignalProgress(row: SignalSnapshot, events: readonly LifecycleEventView[]): LifecycleProjection {
  const byType = new Map<string, LifecycleEventView>();
  for (const e of events) {
    if (!e || typeof e.eventType !== 'string' || e.eventType.length === 0) continue;
    if (!byType.has(e.eventType)) byType.set(e.eventType, e);
  }
  const at = (type: string): string | null => {
    const e = byType.get(type);
    return e ? isoOrNull(e.occurredAt) : null;
  };

  const status = row.status;
  const closeReason = row.closeReason ?? null;
  const tradeClosed = CLOSED.has(status) && !NO_TRADE.has(status);

  const tp1Hit = byType.has('TP1') || (tradeClosed && TP1_PROVEN_EXIT_REASONS.includes(closeReason ?? ''));
  const tp2Hit = byType.has('TP2') || status === 'TARGET_REACHED';
  const breakevenArmed = byType.has('BREAKEVEN') && status === 'FILLED';
  const stopHit = byType.has('STOP_LOSS') || status === 'INVALIDATED';

  let currentStop: number | null = null;
  let currentStopBasis: LifecycleProjection['currentStopBasis'] = null;
  const fillPrice = row.fillPrice;
  if (breakevenArmed && typeof fillPrice === 'number' && Number.isFinite(fillPrice)) {
    currentStop = fillPrice;
    currentStopBasis = 'BE_AT_ENTRY';
  }

  return {
    tp1Hit,
    tp1HitAt: at('TP1'),
    tp2Hit,
    tp2HitAt: at('TP2') ?? (status === 'TARGET_REACHED' ? isoOrNull(row.closedAt) : null),
    breakevenArmed,
    breakevenArmedAt: breakevenArmed ? at('BREAKEVEN') : null,
    stopHit,
    stopHitAt: at('STOP_LOSS') ?? (status === 'INVALIDATED' ? isoOrNull(row.closedAt) : null),
    currentStop,
    currentStopBasis,
  };
}
