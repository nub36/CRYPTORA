/**
 * CRYPTORA — Strategy Lab · форматирование для отображения (frontend)
 * ---------------------------------------------------------------------------
 * ТОЛЬКО презентация (§18). Исходные значения расчётов НЕ округляются здесь —
 * форматтеры получают уже посчитанные сервером числа и лишь готовят строку.
 * Low-price активы (PEPE-подобные) должны читаться: для |x|<1 показываем
 * достаточную значимость через toPrecision, не «0.0000».
 */

/** Адаптивная цена: крупные — с фикс. дробями, мелкие — со значащими цифрами. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1000) return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  // < 1: показываем 6 значащих цифр, убираем хвостовые нули.
  const s = value.toPrecision(6);
  return trimZeros(s);
}

function trimZeros(s: string): string {
  if (!s.includes('.') || s.includes('e') || s.includes('E')) return s;
  return s.replace(/\.?0+$/, '');
}

export function formatR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(value);
}

/** Unix-СЕКУНДЫ → локальная дата-время. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  return new Date(seconds * 1000).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sideLabel(side: 'LONG' | 'SHORT' | undefined): string {
  return side === 'LONG' ? 'LONG' : side === 'SHORT' ? 'SHORT' : '—';
}
