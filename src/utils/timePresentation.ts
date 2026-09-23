export type TimeDisplayMode = 'LOCAL' | 'UTC';

export interface TimePresentationOptions {
  mode?: TimeDisplayMode;
  locale?: string;
  includeDate?: boolean;
}

/** Format a UTC epoch value for people without changing its stored value. LOCAL delegates to the browser timezone. */
export function formatEpochTime(epochMs: number, options: TimePresentationOptions = {}): string {
  const { mode = 'LOCAL', locale = 'ru-RU', includeDate = false } = options;
  const formatter = new Intl.DateTimeFormat(locale, {
    ...(includeDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(mode === 'UTC' ? { timeZone: 'UTC' } : {}),
  });
  return formatter.format(new Date(epochMs));
}

/** RFC3339/ISO timestamps remain UTC in data; the default visible representation is browser-local time. */
export function formatEventTimestamp(isoTimestamp: string, mode: TimeDisplayMode = 'LOCAL'): string {
  const epochMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(epochMs)) return isoTimestamp;
  return formatEpochTime(epochMs, { mode, includeDate: true });
}
