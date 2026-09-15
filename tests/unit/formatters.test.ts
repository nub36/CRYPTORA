import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatPercent,
  formatNumber,
  formatTimestamp,
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
  it('formats valid ISO date into UTC time string', () => {
    const formatted = formatTimestamp('2026-09-15T11:45:00Z');
    expect(formatted).toContain('UTC');
    expect(formatted).toContain('11:45:00');
  });
});
