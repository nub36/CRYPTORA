import { describe, expect, it } from 'vitest';
import type { Time, TickMarkType } from 'lightweight-charts';
import { formatChartAxisTime, formatChartCrosshairTime } from '@/utils/chartTime';
import { formatEpochTime, formatEventTimestamp } from '@/utils/timePresentation';
import { formatTimestamp } from '@/utils/formatters';

const epochMs = Date.parse('2026-01-15T08:09:00.000Z');

describe('UTC storage with browser-local chart/event presentation', () => {
  it('formats the default axis and crosshair in the browser timezone', () => {
    const expected = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(epochMs);
    expect(formatChartAxisTime(epochMs / 1000 as Time, 3 as TickMarkType, 'LOCAL')).toBe(expected);
    expect(formatChartCrosshairTime(epochMs / 1000 as Time, 'LOCAL')).toContain(
      new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(epochMs),
    );
  });

  it('keeps UTC available only as an explicit display mode', () => {
    expect(formatChartAxisTime(epochMs / 1000 as Time, 3 as TickMarkType, 'UTC')).toBe('08:09');
    expect(formatEpochTime(epochMs, { mode: 'UTC' })).toBe('08:09');
    expect(formatEventTimestamp('2026-01-15T08:09:00.000Z', 'UTC')).toContain('08:09');
    expect(formatTimestamp('2026-01-15T08:09:00.000Z', 'UTC')).toContain('UTC');
  });

  it('does not apply a fixed-hour offset to event timestamps', () => {
    const iso = '2026-01-15T08:09:00.000Z';
    const expectedLocal = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    expect(formatEventTimestamp(iso)).toBe(expectedLocal);
    expect(formatTimestamp(iso)).toBe(new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
  });
});
