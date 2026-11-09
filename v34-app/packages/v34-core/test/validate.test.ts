/**
 * Проверки рыночных данных: «мусор» биржи не должен становиться сигналом.
 */
import { describe, it, expect } from 'vitest';
import { describeIssues, validateCandleSeries, validateKlinesRow } from '../src/validate';
import type { ArchiveCandle } from '../src/strategy/types';
import { makeSyntheticSeries } from './fixtures/synthetic';

function candle(over: Partial<ArchiveCandle> = {}): ArchiveCandle {
  return {
    openTime: 0, open: 100, high: 101, low: 99, close: 100.5,
    volume: 10, closeTime: 3_599_999, isClosed: true, ...over,
  };
}

describe('validateCandleSeries', () => {
  it('корректная синтетическая серия проходит без замечаний', () => {
    const { h1 } = makeSyntheticSeries({ seed: 10, bars1h: 300 });
    expect(validateCandleSeries(h1, { intervalMs: 3_600_000, minBars: 61 })).toEqual([]);
  });

  it('ловит нечисловые значения, порядок OHLC, отрицательный объём', () => {
    const bad = [
      candle({ openTime: 0, closeTime: 3_599_999 }),
      candle({ openTime: 3_600_000, closeTime: 7_199_999, close: Number.NaN }),
      candle({ openTime: 7_200_000, closeTime: 10_799_999, high: 90, low: 99 }),
      candle({ openTime: 10_800_000, closeTime: 14_399_999, volume: -1 }),
    ];
    const codes = validateCandleSeries(bad).map((i) => i.code);
    expect(codes).toContain('NON_FINITE');
    expect(codes).toContain('OHLC_INCONSISTENT');
    expect(codes).toContain('NEGATIVE_VOLUME');
  });

  it('ловит дубликаты времени и неожиданный интервал', () => {
    const series = [
      candle({ openTime: 0, closeTime: 3_599_999 }),
      candle({ openTime: 0, closeTime: 3_599_999 }),
      candle({ openTime: 7_200_000, closeTime: 10_799_999 }),
    ];
    const codes = validateCandleSeries(series, { intervalMs: 3_600_000 }).map((i) => i.code);
    expect(codes).toContain('DUPLICATE_TIME');
    expect(codes).toContain('UNEXPECTED_INTERVAL');
  });

  it('пустая серия и не-массив — отдельные коды, а не пустой список', () => {
    expect(validateCandleSeries([]).map((i) => i.code)).toEqual(['EMPTY_SERIES']);
    expect(validateCandleSeries(null).map((i) => i.code)).toEqual(['NOT_AN_ARRAY']);
  });

  it('слишком мало баров и устаревшая серия', () => {
    const series = [candle({ openTime: 0, closeTime: 3_599_999 }), candle({ openTime: 3_600_000, closeTime: 7_199_999 })];
    const codes = validateCandleSeries(series, { minBars: 61, nowMs: 20 * 3_600_000, maxAgeMs: 2 * 3_600_000 }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['TOO_FEW_BARS', 'SERIES_TOO_OLD']));
  });
});

describe('validateKlinesRow', () => {
  it('нормальная строка Binance проходит', () => {
    expect(validateKlinesRow([1_700_000_000_000, '100.1', '101.2', '99.8', '100.9', '1234.5', 1_700_003_599_999])).toEqual([]);
  });

  it('битая строка отклоняется с понятным кодом', () => {
    expect(validateKlinesRow('nope').map((i) => i.code)).toEqual(['BAD_ROW_SHAPE']);
    expect(validateKlinesRow([1, 2]).map((i) => i.code)).toEqual(['BAD_ROW_SHAPE']);
    expect(validateKlinesRow(['x', 'y', 'z', 'w', 'v', 'u']).map((i) => i.code)).toEqual(['NON_FINITE']);
    expect(validateKlinesRow([1, '100', '98', '99', '100', '10']).map((i) => i.code)).toContain('OHLC_INCONSISTENT');
    expect(validateKlinesRow([1, '100', '101', '99', '100', '-5']).map((i) => i.code)).toContain('NEGATIVE_VOLUME');
  });
});

describe('describeIssues', () => {
  it('собирает краткую сводку и не скрывает хвост', () => {
    const issues = validateCandleSeries([
      candle({ close: Number.NaN }),
      candle({ openTime: 3_600_000, closeTime: 7_199_999, high: 1, low: 200 }),
      candle({ openTime: 7_200_000, closeTime: 10_799_999, volume: -1 }),
      candle({ openTime: 10_800_000, closeTime: 14_399_999, volume: -1 }),
    ]);
    const text = describeIssues(issues, 2);
    expect(text.split(';').length).toBe(2);
    expect(text).toContain('ещё');
  });
});
