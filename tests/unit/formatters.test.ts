import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatPercent,
  formatNumber,
  formatTimestamp,
  formatDuration,
} from '@/utils/formatters';

describe('formatCurrency', () => {
  it('formats standard prices correctly with comma separators', () => {
    expect(formatCurrency(64850.25)).toBe('$64,850.25');
    expect(formatCurrency(3450.6)).toBe('$3,450.60');
  });

  it('formats compact representation for large amounts', () => {
    expect(formatCurrency(1280000000000, { compact: true })).toBe('$1.28T');
    expect(formatCurrency(414800000000, { compact: true })).toBe('$414.80B');
    expect(formatCurrency(5420000000, { compact: true })).toBe('$5.42B');
    expect(formatCurrency(345000000, { compact: true })).toBe('$345.00M');
    expect(formatCurrency(45000, { compact: true })).toBe('$45.00K');
  });

  it('handles micro values with extra precision', () => {
    expect(formatCurrency(0.00000985)).toBe('$0.00000985');
    expect(formatCurrency(0.584)).toBe('$0.5840');
  });

  it('handles zero and null gracefully', () => {
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(NaN as any)).toBe('$0.00');
  });
});

describe('formatPercent', () => {
  it('formats positive percentages with + sign by default', () => {
    expect(formatPercent(3.18)).toBe('+3.18%');
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('formats negative percentages with minus sign', () => {
    expect(formatPercent(-1.24)).toBe('-1.24%');
  });

  it('respects showSign option', () => {
    expect(formatPercent(5.2, { showSign: false })).toBe('5.20%');
  });
});

describe('formatNumber', () => {
  it('formats integers with comma separators', () => {
    expect(formatNumber(19750000, { decimals: 0 })).toBe('19,750,000');
  });

  it('formats compact large integers', () => {
    expect(formatNumber(146000000000, { compact: true })).toBe('146.00B');
  });
});

describe('formatTimestamp', () => {
  it('uses browser-local time by default and keeps an explicit UTC representation', () => {
    const iso = '2026-09-15T11:45:00Z';
    const local = formatTimestamp(iso);
    const expectedLocal = new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    expect(local).toBe(expectedLocal);
    const utc = formatTimestamp(iso, 'UTC');
    expect(utc).toContain('UTC');
    expect(utc).toContain('11:45:00');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute as < 1 мин', () => {
    expect(formatDuration(30000)).toBe('< 1 мин');
  });

  it('formats minutes', () => {
    expect(formatDuration(42 * 60_000)).toBe('42 мин');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(2 * 3600_000 + 15 * 60_000)).toBe('2 ч 15 мин');
  });

  it('formats hours without minutes when exact', () => {
    expect(formatDuration(5 * 3600_000)).toBe('5 ч');
  });

  it('formats days and hours', () => {
    expect(formatDuration(25 * 3600_000)).toBe('1 д 1 ч');
  });

  it('handles zero and negative', () => {
    expect(formatDuration(0)).toBe('< 1 мин');
    expect(formatDuration(-1000)).toBe('0 мин');
    expect(formatDuration(NaN)).toBe('0 мин');
  });
});
