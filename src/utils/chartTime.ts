import type { Time, TickMarkType } from 'lightweight-charts';
import { formatEpochTime, TimeDisplayMode } from './timePresentation';

export function chartTimeToEpochMs(time: Time): number | null {
  if (typeof time === 'number') return time * 1000;
  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const day = time as { year: number; month: number; day: number };
  return Date.UTC(day.year, day.month - 1, day.day);
}

export function formatChartAxisTime(
  time: Time,
  tickType: TickMarkType,
  mode: TimeDisplayMode = 'LOCAL',
  locale = 'en-US',
): string {
  const epochMs = chartTimeToEpochMs(time);
  if (epochMs === null) return '';
  const date = new Date(epochMs);
  const options: Intl.DateTimeFormatOptions = tickType === 0
    ? { year: 'numeric' }
    : tickType === 1
      ? { month: 'short' }
      : tickType === 2
        ? { month: 'short', day: '2-digit' }
        : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return new Intl.DateTimeFormat(locale, {
    ...options,
    ...(mode === 'UTC' ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

export function formatChartCrosshairTime(time: Time | undefined, mode: TimeDisplayMode): string {
  if (time === undefined) return '';
  const epochMs = chartTimeToEpochMs(time);
  return epochMs === null ? '' : formatEpochTime(epochMs, { mode, locale: 'ru-RU', includeDate: true });
}
