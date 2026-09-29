import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeBinanceKlineRow,
  normalizeBinanceKlineSeries,
  validateCandleSeries,
} from '../../shared/market/candleSeries.js';
import { normalizeBinanceKlines } from '@/services/data/adapters/normalization';

/**
 * Task §4 / §6 / §10 — the candle contract every chart relies on.
 *
 * The same module backs the UI normalizer and the `npm run diagnose:charts`
 * harness, so a malformed upstream row is rejected identically in both. A
 * rejected row is DROPPED and reported — never repaired with a synthetic
 * value, never allowed to reach the chart as NaN.
 */

const ROW = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const base: unknown[] = [
    1_726_358_400_000, '63800.00', '65500.00', '63500.00', '65000.00', '1000.0',
    1_726_361_999_999, '64000000.0', 1000, '500.0', '32000000.0', '0',
  ];
  for (const [index, value] of Object.entries(over)) base[Number(index)] = value;
  return base;
};

const CTX = { symbol: 'BTC', market: 'futures' as const, exchange: 'binance' as const };

afterEach(() => { vi.restoreAllMocks(); });

describe('single kline normalization', () => {
  it('accepts a well-formed row and converts ms → s', () => {
    const result = normalizeBinanceKlineRow(ROW(), CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candle.time).toBe(1_726_358_400);
    expect(result.candle.open).toBe(63_800);
    expect(result.candle.high).toBe(65_500);
    expect(result.candle.low).toBe(63_500);
    expect(result.candle.close).toBe(65_000);
    expect(result.candle.volume).toBe(1000);
    expect(result.candle.provenance).toMatchObject({ exchange: 'binance', market: 'futures', symbol: 'BTC', isFallback: false });
  });

  it.each([
    ['row_not_tuple', 'not-an-array' as unknown],
    ['row_not_tuple', [1_726_358_400_000, '1', '2']],
  ])('rejects a non-tuple payload (%s)', (reason, row) => {
    const result = normalizeBinanceKlineRow(row, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('rejects non-finite and out-of-range timestamps', () => {
    expect(normalizeBinanceKlineRow(ROW({ 0: 'abc' }), CTX)).toMatchObject({ ok: false, reason: 'open_time_not_finite' });
    expect(normalizeBinanceKlineRow(ROW({ 0: Number.NaN }), CTX)).toMatchObject({ ok: false, reason: 'open_time_not_finite' });
    expect(normalizeBinanceKlineRow(ROW({ 0: 1 }), CTX)).toMatchObject({ ok: false, reason: 'open_time_out_of_range' });
    expect(normalizeBinanceKlineRow(ROW({ 0: 4_200_000_000_000 }), CTX)).toMatchObject({ ok: false, reason: 'open_time_out_of_range' });
  });

  it('rejects NaN / Infinity / non-positive OHLC', () => {
    expect(normalizeBinanceKlineRow(ROW({ 1: 'NaN' }), CTX)).toMatchObject({ ok: false, reason: 'ohlc_not_finite' });
    expect(normalizeBinanceKlineRow(ROW({ 4: 'Infinity' }), CTX)).toMatchObject({ ok: false, reason: 'ohlc_not_finite' });
    expect(normalizeBinanceKlineRow(ROW({ 3: '0' }), CTX)).toMatchObject({ ok: false, reason: 'ohlc_non_positive' });
    expect(normalizeBinanceKlineRow(ROW({ 2: '-5' }), CTX)).toMatchObject({ ok: false, reason: 'ohlc_non_positive' });
  });

  it('rejects inconsistent high/low bounds', () => {
    // high must be >= max(open, close)
    expect(normalizeBinanceKlineRow(ROW({ 2: '64000.00' }), CTX)).toMatchObject({ ok: false, reason: 'ohlc_inconsistent' });
    // low must be <= min(open, close)
    expect(normalizeBinanceKlineRow(ROW({ 3: '64500.00' }), CTX)).toMatchObject({ ok: false, reason: 'ohlc_inconsistent' });
  });

  it('rejects negative or non-finite volume but accepts a real zero', () => {
    expect(normalizeBinanceKlineRow(ROW({ 5: '-1' }), CTX)).toMatchObject({ ok: false, reason: 'volume_invalid' });
    expect(normalizeBinanceKlineRow(ROW({ 5: 'oops' }), CTX)).toMatchObject({ ok: false, reason: 'volume_invalid' });
    const zero = normalizeBinanceKlineRow(ROW({ 5: '0' }), CTX);
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.candle.volume).toBe(0);
  });
});

describe('series normalization', () => {
  const series = (count: number, startMs = 1_726_358_400_000) =>
    Array.from({ length: count }, (_, i) => ROW({ 0: startMs + i * 3_600_000 }));

  it('keeps a valid series intact and strictly increasing', () => {
    const { candles, rejected } = normalizeBinanceKlineSeries(series(5), CTX);
    expect(rejected).toHaveLength(0);
    expect(candles).toHaveLength(5);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
    }
  });

  it('reports a non-array payload instead of throwing', () => {
    const result = normalizeBinanceKlineSeries({ code: -1121, msg: 'Invalid symbol.' }, CTX);
    expect(result.candles).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('payload_not_array');
  });

  it('drops duplicate timestamps', () => {
    const rows = series(3);
    rows.push(ROW({ 0: 1_726_358_400_000 + 2 * 3_600_000 })); // repeats the last bar
    const { candles, rejected } = normalizeBinanceKlineSeries(rows, CTX);
    expect(candles).toHaveLength(3);
    expect(rejected.map((r) => r.reason)).toContain('duplicate_timestamp');
  });

  it('drops out-of-order rows rather than reordering silently', () => {
    const rows = [...series(3)];
    rows.splice(1, 0, ROW({ 0: 1_726_351_200_000 }));
    const { candles, rejected } = normalizeBinanceKlineSeries(rows, CTX);
    expect(rejected.map((r) => r.reason)).toContain('non_monotonic_timestamp');
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
    }
  });

  it('keeps the good rows when only some are malformed', () => {
    const rows = [...series(4)];
    rows[2] = ROW({ 0: rows[2][0], 1: 'NaN' });
    const { candles, rejected } = normalizeBinanceKlineSeries(rows, CTX);
    expect(candles).toHaveLength(3);
    expect(rejected).toEqual([{ index: 2, reason: 'ohlc_not_finite' }]);
  });
});

describe('series validation', () => {
  const T0 = 1_726_358_400; // seconds, inside the plausible range
  const candle = (offset: number, over: Record<string, number> = {}) => ({
    time: T0 + offset, open: 100, high: 110, low: 90, close: 105, volume: 10, ...over,
  });

  it('accepts a healthy series', () => {
    const result = validateCandleSeries([candle(1000), candle(2000), candle(3000)]);
    expect(result).toMatchObject({ ok: true, count: 3 });
    expect(result.issues).toHaveLength(0);
  });

  it('flags an empty series', () => {
    expect(validateCandleSeries([]).ok).toBe(false);
  });

  it('flags non-increasing timestamps and duplicates', () => {
    expect(validateCandleSeries([candle(2000), candle(1000)]).ok).toBe(false);
    expect(validateCandleSeries([candle(1000), candle(1000)]).ok).toBe(false);
  });

  it('flags broken OHLC relationships and non-finite numbers', () => {
    expect(validateCandleSeries([candle(1000, { high: 100, close: 105 })]).ok).toBe(false);
    expect(validateCandleSeries([candle(1000, { low: 106 })]).ok).toBe(false);
    expect(validateCandleSeries([candle(1000, { close: Number.NaN })]).ok).toBe(false);
  });

  it('only requires volume when asked to', () => {
    const noVolume = [{ time: T0, open: 1, high: 2, low: 0.5, close: 1.5 }];
    expect(validateCandleSeries(noVolume).ok).toBe(true);
    expect(validateCandleSeries(noVolume, { requireVolume: true }).ok).toBe(false);
  });

  it('enforces a minimum length when asked to', () => {
    expect(validateCandleSeries([candle(1000)], { minCandles: 2 }).ok).toBe(false);
  });
});

describe('adapter-level normalization uses the shared contract', () => {
  it('stamps the requested market on every candle', () => {
    const spot = normalizeBinanceKlines([ROW()], 'BTC', 'spot');
    const futures = normalizeBinanceKlines([ROW()], 'BTCUSDT', 'futures');
    expect((spot[0] as unknown as { provenance: { market: string } }).provenance.market).toBe('spot');
    expect((futures[0] as unknown as { provenance: { market: string } }).provenance.market).toBe('futures');
  });

  it('returns an empty array (not synthetic candles) for a malformed payload', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeBinanceKlines([ROW({ 1: 'NaN' })], 'BTC', 'futures')).toEqual([]);
    expect(normalizeBinanceKlines({ code: -1121 } as unknown as unknown[], 'BTC', 'futures')).toEqual([]);
  });

  it('warns about rejected rows so the loss is never silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    normalizeBinanceKlines([ROW(), ROW({ 0: 1_726_362_000_000, 5: '-3' })], 'BTC', 'futures');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('отброшено 1');
  });
});
