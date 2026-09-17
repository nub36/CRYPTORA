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

export function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC';
  } catch {
    return isoString;
  }
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
