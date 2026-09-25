/**
 * Декларации для server/services/signalProvenance.js (миграция 011).
 *
 * Происхождение сигнала: кто РЕАЛЬНО сгенерировал сетап, записанный под
 * `strategy_id`. Единственный источник правил допуска — монитор и статистика
 * обязаны читать их отсюда, а не изобретать свои фильтры.
 */

/** Домен `signals.provenance_status` — тот же, что в CHECK-ограничении 011. */
export type ProvenanceStatus = 'VERIFIED' | 'MISMATCH' | 'UNKNOWN';

export const PROVENANCE_STATUSES: readonly ProvenanceStatus[];
export const PROVENANCE_VERIFIED: 'VERIFIED';
export const PROVENANCE_MISMATCH: 'MISMATCH';
export const PROVENANCE_UNKNOWN: 'UNKNOWN';

/**
 * Классификация сохранённой строки по префиксу `engine_setup_id`:
 *   префикс == strategy_id → VERIFIED
 *   префикс != strategy_id → MISMATCH
 *   префикса нет            → UNKNOWN (никогда не повышается автоматически)
 */
export function classifyProvenance(row: {
  strategyId?: string | null;
  engineSetupId?: string | null;
}): ProvenanceStatus;

/** Тот же классификатор в виде SQL `CASE` (для одного UPDATE на всю таблицу). */
export const PROVENANCE_CASE_SQL: string;

/** Открытую строку можно мониторить, только если provenance = VERIFIED. */
export function isMonitorEligible(
  row: { provenanceStatus?: string | null; status?: string } | null | undefined,
  openStatuses?: readonly string[]
): boolean;

/** Только VERIFIED попадает в win rate / R / сравнение стратегий. */
export function isStatisticsEligible(
  row: { provenanceStatus?: string | null } | null | undefined
): boolean;

/**
 * Статус происхождения НОВОГО сигнала — считается ДО записи в БД.
 * `mismatch: true` означает, что строка не должна быть записана вовсе.
 */
export function provenanceOfNewSignal(
  setup: { strategyId?: string | null } | null | undefined,
  strategyId: string
): { status: ProvenanceStatus; mismatch: boolean; generator: string | null };
