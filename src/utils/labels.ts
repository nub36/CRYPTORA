/**
 * CRYPTORA — единый словарь русских подписей для машинных enum-значений.
 * ---------------------------------------------------------------------------
 * Машинные коды (`VOLUME_SPIKE`, `HIGH`, `LONG`…) остаются латиницей в данных,
 * схемах Zod и `data-qa`-атрибутах — это контракт, а не текст интерфейса.
 * В пользовательском слое они переводятся только через эти функции, чтобы
 * терминология была одинаковой во всех разделах (UX-цикл владельца, п. 2).
 *
 * Общепринятые аббревиатуры (OI, RSI, MACD, VaR, TVL, WS, LIVE, QA, MODEL /
 * ESTIMATED) сознательно не переводятся — см. docs/DESIGN_SYSTEM.md, раздел 11.
 */
import type { RadarEventType, RadarSeverity } from '../types/market';

export const RADAR_EVENT_TYPE_LABELS: Record<RadarEventType, string> = {
  VOLUME_SPIKE: 'Всплеск объёма',
  OI_SPIKE: 'Всплеск OI',
  FUNDING_EXTREME: 'Экстремальный фандинг',
  LIQUIDATION_BURST: 'Каскад ликвидаций',
  PRICE_MOVE: 'Резкое движение цены',
  VOLATILITY_EXPANSION: 'Расширение волатильности',
};

export const RADAR_SEVERITY_LABELS: Record<RadarSeverity, string> = {
  HIGH: 'Высокая',
  MEDIUM: 'Средняя',
  INFO: 'Инфо',
};

export type PositionSide = 'LONG' | 'SHORT';

/** Позиция: industry English «Long» / «Short» — русский вариант звучит искусственно. */
export const SIDE_LABELS: Record<PositionSide, string> = {
  LONG: 'Long',
  SHORT: 'Short',
};

/** Групповые подписи: в English множественного числа нет, форма та же. */
export const SIDE_PLURAL_LABELS: Record<PositionSide, string> = {
  LONG: 'Long',
  SHORT: 'Short',
};

export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export const IMPACT_LABELS: Record<ImpactLevel, string> = {
  HIGH: 'Высокое',
  MEDIUM: 'Среднее',
  LOW: 'Низкое',
};

export function radarEventTypeLabel(type: RadarEventType): string {
  return RADAR_EVENT_TYPE_LABELS[type] ?? type;
}

export function radarSeverityLabel(severity: RadarSeverity): string {
  return RADAR_SEVERITY_LABELS[severity] ?? severity;
}

export function sideLabel(side: PositionSide, plural = false): string {
  return (plural ? SIDE_PLURAL_LABELS : SIDE_LABELS)[side] ?? side;
}

export function impactLabel(impact: ImpactLevel): string {
  return IMPACT_LABELS[impact] ?? impact;
}

/**
 * Пара для отображения: «ETH» → «ETH/USDT», «ETHUSDT» → «ETH/USDT».
 *
 * Зачем: `SignalsAuditLedger` хранит symbol УЖЕ с котировочной валютой
 * (`LiveSignalEngine.publish()` добавляет `/USDT`), а карточка сигнала
 * добавляла суффикс второй раз — так на проде появился «ETH/USDT/USDT».
 * Функция идемпотентна: уже нормализованная пара возвращается без изменений.
 */
export function pairLabel(symbol: string, quote = 'USDT'): string {
  const s = symbol.trim();
  const upper = s.toUpperCase();
  const q = quote.toUpperCase();
  if (upper === q) return s;
  if (upper.endsWith(`/${q}`)) return s;
  if (!upper.includes('/') && upper.endsWith(q) && s.length > q.length) {
    return `${s.slice(0, s.length - q.length)}/${quote}`;
  }
  return `${s}/${quote}`;
}

/**
 * Знак сравнения для Stop Loss.
 *
 * Для LONG стоп ниже входа («< $X»), для SHORT — выше («> $X»). Раньше знак
 * был захардкожен как «<», из-за чего SHORT-стоп читался противоречиво.
 */
export function stopComparator(direction: 'LONG' | 'SHORT'): '<' | '>' {
  return direction === 'SHORT' ? '>' : '<';
}
