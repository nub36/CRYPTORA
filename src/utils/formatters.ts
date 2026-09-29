/**
 * Financial formatters for high-density CRYPTORA terminal
 */

export function formatCurrency(
  value: number,
  options?: {
    decimals?: number;
    compact?: boolean;
    currencySymbol?: string;
  }
): string {
  if (value === null || value === undefined || isNaN(value)) return '$0.00';

  const symbol = options?.currencySymbol ?? '$';

  if (options?.compact) {
    const abs = Math.abs(value);
    if (abs >= 1e12) {
      return `${symbol}${(value / 1e12).toFixed(2)}T`;
    }
    if (abs >= 1e9) {
      return `${symbol}${(value / 1e9).toFixed(2)}B`;
    }
    if (abs >= 1e6) {
      return `${symbol}${(value / 1e6).toFixed(2)}M`;
    }
    if (abs >= 1e3) {
      return `${symbol}${(value / 1e3).toFixed(2)}K`;
    }
  }

  const decimals =
    options?.decimals !== undefined
      ? options.decimals
      : value === 0
      ? 2
      : Math.abs(value) < 0.0001
      ? 8
      : Math.abs(value) < 1
      ? 4
      : Math.abs(value) < 10
      ? 3
      : 2;

  const parts = value.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${symbol}${parts.join('.')}`;
}

export function formatPercent(
  value: number,
  options?: {
    showSign?: boolean;
    decimals?: number;
  }
): string {
  if (value === null || value === undefined || isNaN(value)) return '0.00%';

  const decimals = options?.decimals ?? 2;
  const fixed = value.toFixed(decimals);
  const showSign = options?.showSign ?? true;

  if (value > 0 && showSign) {
    return `+${fixed}%`;
  }
  return `${fixed}%`;
}

export function formatNumber(
  value: number,
  options?: {
    decimals?: number;
    compact?: boolean;
  }
): string {
  if (value === null || value === undefined || isNaN(value)) return '0';

  if (options?.compact) {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  }

  const decimals = options?.decimals ?? 2;
  const parts = value.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function formatTimestamp(isoString: string, mode: 'LOCAL' | 'UTC' = 'LOCAL'): string {
  const epochMs = Date.parse(isoString);
  if (!Number.isFinite(epochMs)) return isoString;
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    ...(mode === 'UTC' ? { timeZone: 'UTC' } : {}),
  }).format(new Date(epochMs));
  return mode === 'UTC' ? `${time} UTC` : time;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Canonical INSTRUMENT PRICE precision (задача §14).
 *
 * `formatCurrency` — универсальный денежный форматтер: он режет всё, что
 * попадает в диапазон 0.0001…1, до 4 знаков. Для контракта вроде MEW
 * (0.000478) это давало «$0.0005» — не та цена, которую показывает биржа.
 *
 * Правило precision здесь ОДНО на весь терминал и строится от фактических
 * метаданных инструмента, а не от «на глаз»:
 *   1) если известен tickSize биржи (`PRICE_FILTER.tickSize` из exchangeInfo)
 *      — количество знаков берётся ровно из него;
 *   2) иначе — значащие цифры: цена печатается с 5 значащими цифрами
 *      (не более 8 знаков после запятой — предел Binance), а заведомо лишние
 *      хвостовые нули убираются.
 * Научная нотация не используется нигде: UI проекта её не применяет.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Предел точности Binance для цены/размера: 8 знаков после запятой. */
export const MAX_PRICE_DECIMALS = 8;
/** Сколько значащих цифр показываем для суб-единичных цен (0.000478 → 6 знач.). */
const PRICE_SIGNIFICANT_DIGITS = 5;

/**
 * Число знаков после запятой из tickSize биржи: `"0.000001"` → 6, `0.01` → 2.
 * null — tickSize неизвестен/некорректен (метаданные источника отсутствуют).
 */
export function priceDecimalsFromTickSize(tickSize: number | string | null | undefined): number | null {
  if (tickSize === null || tickSize === undefined || tickSize === '') return null;
  const parsed = typeof tickSize === 'number' ? tickSize : Number.parseFloat(String(tickSize));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // Строковое представление точнее логарифма: 0.00000001 не превращается в 7 знаков.
  const text = typeof tickSize === 'string' ? tickSize.trim() : parsed.toFixed(MAX_PRICE_DECIMALS);
  const normalized = /e/i.test(text) ? parsed.toFixed(MAX_PRICE_DECIMALS) : text;
  const fraction = normalized.split('.')[1] ?? '';
  const trimmed = fraction.replace(/0+$/, '');
  return Math.min(MAX_PRICE_DECIMALS, trimmed.length);
}

/**
 * Сколько знаков после запятой нужно, чтобы цена читалась как на бирже.
 * Без tickSize — по значащим цифрам, поэтому 0.000478 не округляется до 0.00.
 */
export function instrumentPriceDecimals(
  value: number,
  options?: { tickSize?: number | string | null },
): number {
  const fromTick = priceDecimalsFromTickSize(options?.tickSize);
  if (fromTick !== null) return fromTick;
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 2;
  // Позиция первой значащей цифры: 0.000478 → 4 → 4 - 1 + 5 = 8 знаков.
  const leadingZeros = Math.max(0, Math.ceil(-Math.log10(abs)) - 1);
  return Math.min(MAX_PRICE_DECIMALS, leadingZeros + PRICE_SIGNIFICANT_DIGITS);
}

/** Убирает ЗАВЕДОМО лишние нули в хвосте дробной части: `0.00047800` → `0.000478`. */
export function trimTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Каноничная цена инструмента для карточек/таблиц/стакана.
 *
 * `0.000478` печатается как `$0.000478` (а не `$0.0005` и не `4.78e-4`),
 * `68 412.5` — как `$68,412.50`. Хвостовые нули за пределами минимальной
 * точности (2 знака для >= 1) не печатаются.
 */
export function formatInstrumentPrice(
  value: number | null | undefined,
  options?: { tickSize?: number | string | null; currencySymbol?: string; withSymbol?: boolean },
): string {
  const symbol = options?.withSymbol === false ? '' : options?.currencySymbol ?? '$';
  if (value === null || value === undefined || !Number.isFinite(value)) return `${symbol}—`;
  const decimals = instrumentPriceDecimals(value, { tickSize: options?.tickSize });
  const fixed = Math.abs(value).toFixed(decimals);
  const minimumDecimals = Math.abs(value) >= 1 || value === 0 ? 2 : 0;
  const [intPart, fractionPart = ''] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let fraction = fractionPart.replace(/0+$/, '');
  while (fraction.length < minimumDecimals) fraction += '0';
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol}${fraction ? `${grouped}.${fraction}` : grouped}`;
}

/** Format milliseconds as human-readable duration: "42 мин", "2 ч 15 мин", "1 д 5 ч". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 мин';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return '< 1 мин';
  if (totalMin < 60) return `${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d} д ${rh} ч` : `${d} д`;
}
