/**
 * CRYPTORA — canonical OHLCV normalization + validation.
 *
 * ONE implementation shared by:
 *   - the browser adapter path (src/services/data/adapters/normalization.ts),
 *   - the vitest suite,
 *   - the read-only diagnostic harness (scripts/diagnose-charts.mjs).
 *
 * WHY shared JS instead of TS: the diagnostic harness must exercise *the same*
 * normalization the UI uses. Re-implementing it in the script would make the
 * diagnosis worthless (it would validate a copy, not the product).
 *
 * Rules (no fabrication — see AGENTS.md / RULES §1):
 *   - a malformed row is REJECTED, never repaired with a neighbour's value;
 *   - a rejected series is reported as such, never padded to look complete;
 *   - `volume` is kept as-is when finite and >= 0, otherwise the row is rejected.
 */

/** Binance kline tuple indexes. */
const K_OPEN_TIME = 0;
const K_OPEN = 1;
const K_HIGH = 2;
const K_LOW = 3;
const K_CLOSE = 4;
const K_VOLUME = 5;
const K_CLOSE_TIME = 6;

/** Smallest plausible candle open time (2009-01-01) in ms — guards against second/ms confusion. */
const MIN_PLAUSIBLE_MS = 1_230_768_000_000;
/** 2100-01-01 in ms. */
const MAX_PLAUSIBLE_MS = 4_102_444_800_000;

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize ONE raw Binance kline tuple (spot `/api/v3/klines` and USD-M
 * `/fapi/v1/klines` share the same tuple shape).
 *
 * @param {unknown} row
 * @param {{ symbol: string, market?: 'spot'|'futures', exchange?: 'binance'|'kucoin', isFallback?: boolean }} ctx
 * @returns {{ ok: true, candle: any } | { ok: false, reason: string }}
 */
export function normalizeBinanceKlineRow(row, ctx) {
  if (!Array.isArray(row) || row.length < 6) return { ok: false, reason: 'row_not_tuple' };
  const openTimeMs = finiteNumber(row[K_OPEN_TIME]);
  if (openTimeMs === null) return { ok: false, reason: 'open_time_not_finite' };
  if (openTimeMs < MIN_PLAUSIBLE_MS || openTimeMs > MAX_PLAUSIBLE_MS) {
    return { ok: false, reason: 'open_time_out_of_range' };
  }
  const open = finiteNumber(row[K_OPEN]);
  const high = finiteNumber(row[K_HIGH]);
  const low = finiteNumber(row[K_LOW]);
  const close = finiteNumber(row[K_CLOSE]);
  const volume = finiteNumber(row[K_VOLUME]);
  if (open === null || high === null || low === null || close === null) {
    return { ok: false, reason: 'ohlc_not_finite' };
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return { ok: false, reason: 'ohlc_non_positive' };
  if (volume === null || volume < 0) return { ok: false, reason: 'volume_invalid' };
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    return { ok: false, reason: 'ohlc_inconsistent' };
  }
  const closeTimeMs = finiteNumber(row[K_CLOSE_TIME]);
  return {
    ok: true,
    candle: {
      time: Math.floor(openTimeMs / 1000),
      open,
      high,
      low,
      close,
      volume,
      provenance: {
        exchange: ctx.exchange ?? 'binance',
        market: ctx.market ?? 'spot',
        symbol: ctx.symbol,
        timestamp: closeTimeMs ?? openTimeMs,
        isFallback: ctx.isFallback ?? false,
      },
    },
  };
}

/**
 * Normalize a full raw kline array. Malformed rows and duplicate/backwards
 * timestamps are dropped and counted — never silently repaired.
 *
 * @param {unknown} rows
 * @param {{ symbol: string, market?: 'spot'|'futures', exchange?: 'binance'|'kucoin', isFallback?: boolean }} ctx
 * @returns {{ candles: any[], rejected: Array<{ index: number, reason: string }> }}
 */
export function normalizeBinanceKlineSeries(rows, ctx) {
  const candles = [];
  const rejected = [];
  if (!Array.isArray(rows)) return { candles, rejected: [{ index: -1, reason: 'payload_not_array' }] };
  let lastTime = -Infinity;
  for (let index = 0; index < rows.length; index++) {
    const result = normalizeBinanceKlineRow(rows[index], ctx);
    if (!result.ok) {
      rejected.push({ index, reason: result.reason });
      continue;
    }
    if (result.candle.time === lastTime) {
      rejected.push({ index, reason: 'duplicate_timestamp' });
      continue;
    }
    if (result.candle.time < lastTime) {
      rejected.push({ index, reason: 'non_monotonic_timestamp' });
      continue;
    }
    lastTime = result.candle.time;
    candles.push(result.candle);
  }
  return { candles, rejected };
}

/**
 * Validate an already-normalized OHLCV series (the invariants listed in §4 of
 * the task). Used by the diagnostic harness and by unit tests.
 *
 * @param {ReadonlyArray<any>} candles
 * @param {{ requireVolume?: boolean, minCandles?: number }} [options]
 * @returns {{ ok: boolean, issues: string[], count: number }}
 */
export function validateCandleSeries(candles, options = {}) {
  const issues = [];
  const minCandles = options.minCandles ?? 1;
  if (!Array.isArray(candles)) return { ok: false, issues: ['not_an_array'], count: 0 };
  if (candles.length < minCandles) issues.push(`too_few_candles:${candles.length}`);

  const seen = new Set();
  let previousTime = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c || typeof c !== 'object') { issues.push(`row_${i}:not_an_object`); continue; }
    const { time, open, high, low, close, volume } = c;
    if (!Number.isFinite(time) || !Number.isInteger(time)) { issues.push(`row_${i}:bad_timestamp`); continue; }
    if (time <= 0 || time * 1000 < MIN_PLAUSIBLE_MS || time * 1000 > MAX_PLAUSIBLE_MS) {
      issues.push(`row_${i}:timestamp_out_of_range`);
    }
    if (seen.has(time)) issues.push(`row_${i}:duplicate_timestamp`);
    seen.add(time);
    if (time < previousTime) issues.push(`row_${i}:timestamps_not_increasing`);
    previousTime = time;

    for (const [name, value] of [['open', open], ['high', high], ['low', low], ['close', close]]) {
      if (!Number.isFinite(value)) issues.push(`row_${i}:${name}_not_finite`);
    }
    if (Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(close) && high < Math.max(open, close)) {
      issues.push(`row_${i}:high_below_body`);
    }
    if (Number.isFinite(open) && Number.isFinite(low) && Number.isFinite(close) && low > Math.min(open, close)) {
      issues.push(`row_${i}:low_above_body`);
    }
    if (volume !== undefined && volume !== null) {
      if (!Number.isFinite(volume)) issues.push(`row_${i}:volume_not_finite`);
      else if (volume < 0) issues.push(`row_${i}:volume_negative`);
    } else if (options.requireVolume) {
      issues.push(`row_${i}:volume_missing`);
    }
  }
  return { ok: issues.length === 0, issues, count: candles.length };
}
