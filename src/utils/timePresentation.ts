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

/**
 * Short label for the viewer's own timezone (e.g. "GMT+2", "UTC").
 * Never hardcodes an offset — it is read from the browser at call time, so a
 * user in any region sees their own zone.
 */
export function localTimeZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const zone = parts.find((part) => part.type === 'timeZoneName')?.value;
    if (zone) return zone;
  } catch {
    // Older engines may not support `shortOffset`; fall through to the IANA name.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
}

/** RFC3339/ISO timestamps remain UTC in data; the default visible representation is browser-local time. */
export function formatEventTimestamp(isoTimestamp: string, mode: TimeDisplayMode = 'LOCAL'): string {
  const epochMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(epochMs)) return isoTimestamp;
  return formatEpochTime(epochMs, { mode, includeDate: true });
}
