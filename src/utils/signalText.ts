/**
 * signalText — чистые текстовые helpers страницы /signals и уведомлений.
 *
 * Вынесены из SignalsPage, чтобы одни и те же формулировки использовались в
 * карточках журнала и в колокольчике, и чтобы покрыть их юнит-тестами.
 * Никакой математики стратегий здесь нет — только отображение фактов журнала.
 */

import { TRADE_CLOSED_STATUSES, type AnalyticalSetup, type SetupStatus } from '@/services/signals/SignalsAuditLedger';

export type SignalStatusFilter =
  | 'ALL'
  | 'OPEN'
  | 'TARGET_REACHED'
  | 'INVALIDATED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'NO_TRADE';

export const SIGNAL_STATUS_FILTERS: ReadonlyArray<{ id: SignalStatusFilter; label: string }> = [
  { id: 'ALL', label: 'Все' },
  { id: 'OPEN', label: 'Открытые' },
  { id: 'TARGET_REACHED', label: 'Цель достигнута' },
  { id: 'INVALIDATED', label: 'Инвалидированы' },
  { id: 'CLOSED', label: 'Закрыты по правилу' },
  { id: 'CANCELLED', label: 'Отменённые' },
  { id: 'NO_TRADE', label: 'Без сделки' },
];

export function matchesStatusFilter(status: SetupStatus, filter: SignalStatusFilter): boolean {
  switch (filter) {
    case 'ALL': return true;
    case 'OPEN': return status === 'ACTIVE' || status === 'FILLED';
    case 'TARGET_REACHED': return status === 'TARGET_REACHED';
    case 'INVALIDATED': return status === 'INVALIDATED';
    case 'CLOSED': return status === 'CLOSED';
    case 'CANCELLED': return status === 'CANCELLED';
    case 'NO_TRADE': return status === 'EXPIRED' || status === 'CANCELLED' || status === 'UNRESOLVED';
    default: return true;
  }
}

/** Причина выхода в терминах стратегии → человеческий русский. */
export function exitReasonLabelRu(reason: string | undefined): string {
  switch (reason) {
    case 'SL': return 'стоп';
    case 'TP2': return 'TP2';
    case 'TP1_THEN_BE': return 'TP1 → безубыток';
    case 'TP1_THEN_SL': return 'TP1 → стоп';
    case 'TP1_THEN_TIMEOUT': return 'TP1 → таймаут';
    case 'TIMEOUT': return 'таймаут';
    case 'TRAIL': return 'трейлинг-стоп';
    case 'BE': return 'безубыток';
    case 'EXPIRED': return 'коридор истёк';
    case 'CANCELLED': return 'стоп задет до входа';
    case 'REJECTED_GEOMETRY': return 'геометрия отклонена при исполнении';
    case 'NO_CONTIGUOUS_NEXT_BAR': return 'нет примыкающего бара N+1';
    case 'LADDER_INVALID_AT_FILL': return 'лестница целей невалидна при исполнении';
    case 'OUT_OF_DATA_WINDOW': return 'бар сетапа вышел за окно данных';
    default: return reason ?? '—';
  }
}

/** '+1.40 R' / '−0.50 R' / '—'. ASCII-минус не используется: знак даёт toFixed. */
export function formatSignedR(r: number | null | undefined): string {
  if (typeof r !== 'number' || !Number.isFinite(r)) return '—';
  return `${r > 0 ? '+' : ''}${r.toFixed(2)} R`;
}

/** Чистый R исхода (net; при отсутствии — gross; нет сделки — null). */
export function setupNetR(s: Pick<AnalyticalSetup, 'netResultR' | 'resultR'>): number | null {
  if (typeof s.netResultR === 'number' && Number.isFinite(s.netResultR)) return s.netResultR;
  if (typeof s.resultR === 'number' && Number.isFinite(s.resultR)) return s.resultR;
  return null;
}

/**
 * Одна строка итога человеческим языком — для карточки и колокольчика.
 * Числа берутся из журнала как есть, ничего не пересчитывается.
 */
export function describeSetupOutcome(s: AnalyticalSetup): string {
  const r = formatSignedR(setupNetR(s));
  switch (s.status) {
    case 'ACTIVE': return 'Ждёт исполнения лимитного коридора';
    case 'FILLED': return 'В позиции: вход исполнен, исход отслеживается';
    case 'TARGET_REACHED': return `Цель достигнута: ${r} чистыми (${exitReasonLabelRu(s.exitReason)})`;
    case 'INVALIDATED': return `Стоп: ${r} (${exitReasonLabelRu(s.exitReason)})`;
    case 'CLOSED': return `Закрыт по правилу (${exitReasonLabelRu(s.exitReason)}): ${r}`;
    case 'EXPIRED': return 'Сделки не было: коридор истёк без касания';
    case 'CANCELLED': return 'Сделки не было: отменён до входа';
    case 'UNRESOLVED': return 'Исход не отслежен: бар сетапа вышел за окно данных';
    default: return s.status;
  }
}

export interface TradeOutcomeCounts {
  total: number;
  positive: number;
  negative: number;
  flat: number;
}

/** Плюсовые/минусовые среди закрытых сделок (по чистому R). */
export function countTradeOutcomes(setups: readonly AnalyticalSetup[]): TradeOutcomeCounts {
  const trades = setups.filter((s) => TRADE_CLOSED_STATUSES.includes(s.status));
  let positive = 0;
  let negative = 0;
  let flat = 0;
  for (const t of trades) {
    const r = setupNetR(t);
    if (r === null || r === 0) flat++;
    else if (r > 0) positive++;
    else negative++;
  }
  return { total: trades.length, positive, negative, flat };
}

const STRATEGY_SHORT_MAP: Record<string, string> = {
  V3_0_HTF_LIQUIDATION_TRAP: 'V3.0',
  V3_3_HTF_ZONE_MITIGATION: 'V3.3',
  V2_8_ZERO_FEE_SNIPER_TRAILING: 'V2.8',
};

/** Короткая метка стратегии (V3.0 / V3.3 / V2.8); неизвестный id — как есть. */
export function strategyShortLabel(strategyId: string): string {
  return STRATEGY_SHORT_MAP[strategyId] ?? strategyId;
}
