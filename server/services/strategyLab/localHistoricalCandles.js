/**
 * CRYPTORA — Strategy Lab local historical archive (RESEARCH ONLY).
 *
 * This reader is intentionally isolated from the production market-data path.
 * It reads the archive manifest before selecting one exact market/symbol/
 * timeframe series and never substitutes spot for futures (or vice versa).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DEFAULT_STRATEGY_LAB_DATA_ROOT = '/srv/cryptora-data/strategy-lab/candles';
export const LOCAL_MANIFEST_SCHEMA_VERSION = 1;

const MARKET_VALUES = new Set(['spot', 'futures']);
const TIMEFRAME_MS = Object.freeze({
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
});
const SYMBOL_RE = /^[A-Z0-9]{2,25}$/;
const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export class LocalHistoricalError extends Error {
  constructor(message, code = 'LOCAL_HISTORICAL_ERROR') {
    super(message);
    this.name = 'LocalHistoricalError';
    this.code = code;
  }
}

function dataRoot(override) {
  return path.resolve(override ?? process.env.STRATEGY_LAB_DATA_ROOT ?? DEFAULT_STRATEGY_LAB_DATA_ROOT);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalSeriesPath(market, symbol, timeframe) {
  return `${market}/${symbol}/${timeframe}.json`;
}

function validateSelector({ market, symbol, timeframe, fromMs, toMs }) {
  if (!MARKET_VALUES.has(market)) {
    throw new LocalHistoricalError(`Unsupported local market: ${market}`, 'BAD_SELECTOR');
  }
  if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol)) {
    throw new LocalHistoricalError(`Invalid exact local symbol: ${symbol}`, 'BAD_SELECTOR');
  }
  if (!TIMEFRAME_MS[timeframe]) {
    throw new LocalHistoricalError(`Unsupported local timeframe: ${timeframe}`, 'BAD_SELECTOR');
  }
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs >= toMs) {
    throw new LocalHistoricalError('Invalid local historical range', 'BAD_RANGE');
  }
}

function parseIso(value, field) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(ms)) {
    throw new LocalHistoricalError(`Manifest ${field} is invalid`, 'INVALID_MANIFEST');
  }
  return ms;
}

function validateManifestEntry(entry, seen) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new LocalHistoricalError('Manifest contains a malformed series entry', 'INVALID_MANIFEST');
  }
  const { market, symbol, timeframe } = entry;
  if (!MARKET_VALUES.has(market) || typeof symbol !== 'string' || !SYMBOL_RE.test(symbol) || !TIMEFRAME_MS[timeframe]) {
    throw new LocalHistoricalError('Manifest contains an invalid series selector', 'INVALID_MANIFEST');
  }
  const key = `${market}/${symbol}/${timeframe}`;
  if (seen.has(key)) throw new LocalHistoricalError(`Manifest contains duplicate series ${key}`, 'INVALID_MANIFEST');
  seen.add(key);
  if (entry.path !== canonicalSeriesPath(market, symbol, timeframe)) {
    throw new LocalHistoricalError(`Manifest path is not canonical for ${key}`, 'INVALID_MANIFEST');
  }
  if (entry.status !== 'valid' && entry.status !== 'failed') {
    throw new LocalHistoricalError(`Manifest status is invalid for ${key}`, 'INVALID_MANIFEST');
  }
  if (entry.intervalMs !== TIMEFRAME_MS[timeframe]) {
    throw new LocalHistoricalError(`Manifest interval is invalid for ${key}`, 'INVALID_MANIFEST');
  }
  const coverageFromMs = parseIso(entry.coverageFrom, `${key}.coverageFrom`);
  const coverageToMs = parseIso(entry.coverageTo, `${key}.coverageTo`);
  if (coverageFromMs >= coverageToMs || (coverageToMs - coverageFromMs) % entry.intervalMs !== 0) {
    throw new LocalHistoricalError(`Manifest coverage is invalid for ${key}`, 'INVALID_MANIFEST');
  }
  const calculatedCount = (coverageToMs - coverageFromMs) / entry.intervalMs;
  if (
    !Number.isSafeInteger(entry.expectedCount) ||
    !Number.isSafeInteger(entry.candleCount) ||
    entry.expectedCount !== calculatedCount ||
    (entry.status === 'valid' && entry.candleCount !== entry.expectedCount)
  ) {
    throw new LocalHistoricalError(`Manifest candle count is invalid for ${key}`, 'INVALID_MANIFEST');
  }
  if (entry.status === 'valid' && !SHA256_RE.test(entry.sha256 ?? '')) {
    throw new LocalHistoricalError(`Manifest checksum is invalid for ${key}`, 'INVALID_MANIFEST');
  }
  return { ...entry, coverageFromMs, coverageToMs, key };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new LocalHistoricalError('manifest.json must contain an object', 'INVALID_MANIFEST');
  }
  const { manifestSha256, ...hashPayload } = manifest;
  if (!SHA256_RE.test(manifestSha256 ?? '') || sha256(JSON.stringify(hashPayload)) !== manifestSha256) {
    throw new LocalHistoricalError('manifest.json SHA-256 is invalid', 'INVALID_MANIFEST');
  }
  if (
    manifest.schemaVersion !== LOCAL_MANIFEST_SCHEMA_VERSION ||
    manifest.status !== 'valid' ||
    typeof manifest.datasetVersion !== 'string' ||
    typeof manifest.generatedAt !== 'string' ||
    !Array.isArray(manifest.series)
  ) {
    throw new LocalHistoricalError('manifest.json schema/status is invalid', 'INVALID_MANIFEST');
  }
  parseIso(manifest.generatedAt, 'generatedAt');
  const seen = new Set();
  const series = manifest.series.map((entry) => validateManifestEntry(entry, seen));
  if (manifest.summary) {
    const validSeries = series.filter((entry) => entry.status === 'valid').length;
    if (manifest.summary.totalSeries !== series.length || manifest.summary.validSeries !== validSeries) {
      throw new LocalHistoricalError('Manifest summary does not match series entries', 'INVALID_MANIFEST');
    }
  }
  return { ...manifest, series };
}

export async function readLocalManifest(options = {}) {
  const root = dataRoot(options.root);
  const manifestPath = path.join(root, 'manifest.json');
  let contents;
  try {
    contents = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new LocalHistoricalError(`Cannot read local manifest: ${error instanceof Error ? error.message : String(error)}`, 'LOCAL_IO_ERROR');
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new LocalHistoricalError('manifest.json is malformed JSON', 'INVALID_MANIFEST');
  }
  return { root, manifest: validateManifest(parsed) };
}

/** Inspect coverage without loading a candle array. */
export async function inspectLocalSeriesCoverage(params, options = {}) {
  validateSelector(params);
  const loaded = await readLocalManifest(options);
  if (!loaded) return { datasetAvailable: false, covered: false, reason: 'missing-manifest' };

  const { manifest } = loaded;
  const entry = manifest.series.find(
    (candidate) =>
      candidate.market === params.market &&
      candidate.symbol === params.symbol &&
      candidate.timeframe === params.timeframe
  );
  if (!entry) {
    return { datasetAvailable: true, covered: false, reason: 'series-missing', manifest };
  }
  if (entry.status !== 'valid') {
    throw new LocalHistoricalError(`Local series ${entry.key} is marked ${entry.status}`, 'INVALID_LOCAL_SERIES');
  }
  if (params.fromMs < entry.coverageFromMs || params.toMs > entry.coverageToMs) {
    return { datasetAvailable: true, covered: false, reason: 'insufficient-coverage', manifest, entry };
  }
  return { datasetAvailable: true, covered: true, root: loaded.root, manifest, entry };
}

function decimalNumber(value, field, index) {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new LocalHistoricalError(`Local row ${index}: ${field} is not a raw decimal string`, 'CORRUPT_LOCAL_DATA');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new LocalHistoricalError(`Local row ${index}: ${field} is not finite`, 'CORRUPT_LOCAL_DATA');
  }
  return number;
}

function validateStoredRows(rows, entry, nowMs) {
  if (!Array.isArray(rows) || rows.length !== entry.candleCount) {
    throw new LocalHistoricalError(`Local series ${entry.key} has an invalid candle count`, 'CORRUPT_LOCAL_DATA');
  }
  let previous = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length !== 7) {
      throw new LocalHistoricalError(`Local row ${index} is malformed`, 'CORRUPT_LOCAL_DATA');
    }
    const [openTime, openRaw, highRaw, lowRaw, closeRaw, volumeRaw, closeTime] = row;
    if (!Number.isSafeInteger(openTime) || !Number.isSafeInteger(closeTime)) {
      throw new LocalHistoricalError(`Local row ${index} has invalid timestamps`, 'CORRUPT_LOCAL_DATA');
    }
    if (index === 0 && openTime !== entry.coverageFromMs) {
      throw new LocalHistoricalError(`Local series ${entry.key} starts outside manifest coverage`, 'CORRUPT_LOCAL_DATA');
    }
    if (previous !== null && openTime !== previous + entry.intervalMs) {
      throw new LocalHistoricalError(`Local series ${entry.key} contains a duplicate or gap`, 'CORRUPT_LOCAL_DATA');
    }
    if (closeTime !== openTime + entry.intervalMs - 1 || closeTime >= entry.coverageToMs || closeTime >= nowMs) {
      throw new LocalHistoricalError(`Local row ${index} has invalid close/forming time`, 'CORRUPT_LOCAL_DATA');
    }
    const open = decimalNumber(openRaw, 'open', index);
    const high = decimalNumber(highRaw, 'high', index);
    const low = decimalNumber(lowRaw, 'low', index);
    const close = decimalNumber(closeRaw, 'close', index);
    const volume = decimalNumber(volumeRaw, 'volume', index);
    if (
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0 ||
      high < Math.max(open, low, close) ||
      low > Math.min(open, high, close)
    ) {
      throw new LocalHistoricalError(`Local row ${index} has invalid OHLCV geometry`, 'CORRUPT_LOCAL_DATA');
    }
    previous = openTime;
  }
  if (rows.length && rows[rows.length - 1][0] + entry.intervalMs !== entry.coverageToMs) {
    throw new LocalHistoricalError(`Local series ${entry.key} does not reach manifest coverageTo`, 'CORRUPT_LOCAL_DATA');
  }
}

function lowerBound(rows, target) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (rows[middle][0] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Read and slice one exact local series. Decimal strings stay strings through
 * validation and are converted to Number only while building Lab candles.
 */
export async function readLocalHistoricalCandles(params, options = {}) {
  const inspection = options.inspection ?? (await inspectLocalSeriesCoverage(params, options));
  if (!inspection.covered) return inspection;

  const filePath = path.join(inspection.root, inspection.entry.path);
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new LocalHistoricalError(
      `Cannot read local series ${inspection.entry.key}: ${error instanceof Error ? error.message : String(error)}`,
      'CORRUPT_LOCAL_DATA'
    );
  }
  if (sha256(contents) !== inspection.entry.sha256) {
    throw new LocalHistoricalError(`Checksum mismatch for local series ${inspection.entry.key}`, 'CORRUPT_LOCAL_DATA');
  }
  let rows;
  try {
    rows = JSON.parse(contents);
  } catch {
    throw new LocalHistoricalError(`Malformed JSON for local series ${inspection.entry.key}`, 'CORRUPT_LOCAL_DATA');
  }
  validateStoredRows(rows, inspection.entry, options.nowMs ?? Date.now());

  const start = lowerBound(rows, params.fromMs);
  let end = lowerBound(rows, params.toMs);
  while (end > start && rows[end - 1][6] >= params.toMs) end -= 1;
  const candles = rows.slice(start, end).map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Math.floor(row[6] / 1000),
  }));

  return {
    datasetAvailable: true,
    covered: true,
    candles,
    meta: {
      dataSource: 'local-dataset',
      datasetVersion: inspection.manifest.datasetVersion,
      manifestGeneratedAt: inspection.manifest.generatedAt,
      coverageFrom: inspection.entry.coverageFrom,
      coverageTo: inspection.entry.coverageTo,
      seriesSha256: inspection.entry.sha256,
    },
  };
}

/** Metadata-only archive summary for the admin coverage endpoint. */
export async function getLocalDatasetCoverage(options = {}) {
  const loaded = await readLocalManifest(options);
  if (!loaded) return { datasetAvailable: false };
  const valid = loaded.manifest.series.filter((entry) => entry.status === 'valid');
  const uniqueSorted = (values) => [...new Set(values)].sort();
  return {
    datasetAvailable: true,
    coverageFrom: valid.length
      ? new Date(Math.min(...valid.map((entry) => entry.coverageFromMs))).toISOString()
      : null,
    coverageTo: valid.length
      ? new Date(Math.max(...valid.map((entry) => entry.coverageToMs))).toISOString()
      : null,
    markets: uniqueSorted(valid.map((entry) => entry.market)),
    symbols: uniqueSorted(valid.map((entry) => entry.symbol)),
    timeframes: uniqueSorted(valid.map((entry) => entry.timeframe)),
    validSeries: valid.length,
    totalSeries: loaded.manifest.series.length,
    datasetVersion: loaded.manifest.datasetVersion,
    manifestGeneratedAt: loaded.manifest.generatedAt,
  };
}
