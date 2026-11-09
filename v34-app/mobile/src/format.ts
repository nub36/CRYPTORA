/**
 * Форматирование для UI. Ничего не досчитывает: только подписи и числа,
 * которые уже пришли с сервера.
 */
import type { SignalEventType, SignalStatus, SignalView } from './api/types';

export const STATUS_LABELS: Record<SignalStatus, string> = {
  ACTIVE: 'Ожидает входа',
  FILLED: 'В позиции',
  TARGET_REACHED: 'TP2 достигнут',
  INVALIDATED: 'Стоп',
  CLOSED: 'Закрыт',
  EXPIRED: 'Истёк',
  CANCELLED: 'Отменён',
  UNRESOLVED: 'Нет данных',
};

export const EVENT_LABELS: Record<SignalEventType, string> = {
  NEW_SIGNAL: 'Сигнал опубликован',
  FILL: 'Вход исполнен',
  TP1: 'TP1 достигнут',
  TP2: 'TP2 достигнут',
  BREAKEVEN: 'Стоп переведён в безубыток',
  STOP_LOSS: 'Стоп сработал',
  CLOSED: 'Сделка закрыта',
  CANCELLED: 'Сигнал отменён',
};

/** Причины выхода в терминах frozen-ядра. */
export const EXIT_REASON_LABELS: Record<string, string> = {
  SL: 'Стоп',
  TP2: 'TP2',
  TP1_THEN_BE: 'TP1 → безубыток',
  TP1_THEN_SL: 'TP1 → стоп',
  TP1_THEN_TIMEOUT: 'TP1 → таймаут',
  TIMEOUT: 'Таймаут',
  EXPIRED: 'Коридор истёк',
  CANCELLED: 'Коридор отменён',
  REJECTED_GEOMETRY: 'Отклонён по геометрии',
  OUT_OF_DATA_WINDOW: 'Бар вне окна данных',
};

export function statusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export function exitReasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return EXIT_REASON_LABELS[reason] ?? reason;
}

/** Цена с точностью, зависящей от масштаба. Никаких «округлений на глаз». */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8;
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Уровни входа: коридор показывается как есть, без «средней цены». */
export function formatEntryZone(zone: { low: number; high: number } | null): string {
  if (!zone) return '—';
  return `${formatPrice(zone.low)} – ${formatPrice(zone.high)}`;
}

/** Время события — в UTC, чтобы совпадать с сервером и барами биржи. */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatSignedR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded} R`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded} %`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export type SignalStateView = 'waitingEntry' | 'inPosition' | 'closed';

/** Состояние сигнала — производное от статуса, а не от цены. */
export function signalState(signal: Pick<SignalView, 'status'>): SignalStateView {
  if (signal.status === 'ACTIVE') return 'waitingEntry';
  if (signal.status === 'FILLED') return 'inPosition';
  return 'closed';
}

/** Подпись «какой стоп действует» — только по подтверждённым сервером данным. */
export function activeStopLabel(signal: SignalView): string {
  if (signal.progress.currentStop !== null) {
    return `${formatPrice(signal.progress.currentStop)} (безубыток)`;
  }
  if (signal.status === 'FILLED' && signal.initialStopLoss !== null) {
    return `${formatPrice(signal.initialStopLoss)} (первоначальный)`;
  }
  return '—';
}
