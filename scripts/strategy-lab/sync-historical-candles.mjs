#!/usr/bin/env node
/**
 * CRYPTORA Strategy Lab historical-candle archive synchronizer.
 *
 * This tool is deliberately dependency-free and isolated from the production
 * market-data pipeline. It stores Binance's OHLCV decimal strings unchanged.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATA_ROOT = '/srv/cryptora-data/strategy-lab/candles';
export const DEFAULT_FROM = '2025-09-30T00:00:00.000Z';
export const DEFAULT_TO = '2026-09-30T00:00:00.000Z';
export const MARKETS = Object.freeze(['spot', 'futures']);
export const SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LTCUSDT']);
export const TIMEFRAMES = Object.freeze(['5m', '15m', '30m', '1h', '4h']);
export const TIMEFRAME_MS = Object.freeze({
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
});
export const BINANCE_ENDPOINTS = Object.freeze({
  spot: 'https://api.binance.com/api/v3/klines',
  futures: 'https://fapi.binance.com/fapi/v1/klines',
});
export const BINANCE_PAGE_LIMIT = 1000;
export const MAX_RETRIES = 4;
export const MANIFEST_SCHEMA_VERSION = 1;

const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class HistoricalSyncError extends Error {
  constructor(message, code = 'HISTORICAL_SYNC_ERROR') {
    super(message);
    this.name = 'HistoricalSyncError';
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseDate(value, flag) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new HistoricalSyncError(`${flag} must be a valid ISO date`, 'BAD_ARGUMENT');
  }
  return ms;
}

function readOption(argv, index, name) {
  const token = argv[index];
  const prefix = `${name}=`;
  if (token.startsWith(prefix)) return { value: token.slice(prefix.length), consumed: 0 };
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new HistoricalSyncError(`${name} requires a value`, 'BAD_ARGUMENT');
  }
  return { value, consumed: 1 };
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = {
    dryRun: false,
    validateOnly: false,
    root: DEFAULT_DATA_ROOT,
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    market: undefined,
    symbol: undefined,
    timeframe: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (token === '--validate-only') {
      parsed.validateOnly = true;
      continue;
    }

    const names = ['--root', '--from', '--to', '--market', '--symbol', '--timeframe'];
    const name = names.find((candidate) => token === candidate || token.startsWith(`${candidate}=`));
    if (!name) throw new HistoricalSyncError(`Unknown argument: ${token}`, 'BAD_ARGUMENT');
    const { value, consumed } = readOption(argv, i, name);
    i += consumed;
    const key = name.slice(2);
    parsed[key] = value;
  }

  if (parsed.dryRun && parsed.validateOnly) {
    throw new HistoricalSyncError('--dry-run and --validate-only cannot be combined', 'BAD_ARGUMENT');
  }
  if (parsed.market && !MARKETS.includes(parsed.market)) {
    throw new HistoricalSyncError(`Unsupported market: ${parsed.market}`, 'BAD_ARGUMENT');
  }
  if (parsed.symbol) {
    parsed.symbol = parsed.symbol.trim().toUpperCase();
    if (!SYMBOLS.includes(parsed.symbol)) {
      throw new HistoricalSyncError(`Unsupported symbol: ${parsed.symbol}`, 'BAD_ARGUMENT');
    }
  }
  if (parsed.timeframe && !TIMEFRAMES.includes(parsed.timeframe)) {
    throw new HistoricalSyncError(`Unsupported timeframe: ${parsed.timeframe}`, 'BAD_ARGUMENT');
  }

  return parsed;
}

export function expectedCandleCount(fromMs, toMs, timeframe) {
  const intervalMs = TIMEFRAME_MS[timeframe];
  if (!intervalMs) throw new HistoricalSyncError(`Unsupported timeframe: ${timeframe}`, 'BAD_TIMEFRAME');
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs >= toMs) {
    throw new HistoricalSyncError('Coverage must have a valid from-inclusive/to-exclusive range', 'BAD_RANGE');
  }
  if (fromMs % intervalMs !== 0 || toMs % intervalMs !== 0) {
    throw new HistoricalSyncError(`Coverage must align to ${timeframe} boundaries`, 'BAD_RANGE');
  }
  const count = (toMs - fromMs) / intervalMs;
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new HistoricalSyncError('Coverage does not contain a whole number of candles', 'BAD_RANGE');
  }
  return count;
}

export function buildPlan(options = {}) {
  const fromIso = options.from ?? DEFAULT_FROM;
  const toIso = options.to ?? DEFAULT_TO;
  const fromMs = parseDate(fromIso, '--from');
  const toMs = parseDate(toIso, '--to');
  if (!(fromMs < toMs)) {
    throw new HistoricalSyncError('--from must be strictly earlier than --to', 'BAD_RANGE');
  }

  const markets = options.market ? [options.market] : MARKETS;
  const symbols = options.symbol ? [options.symbol.trim().toUpperCase()] : SYMBOLS;
  const timeframes = options.timeframe ? [options.timeframe] : TIMEFRAMES;
  for (const market of markets) {
    if (!MARKETS.includes(market)) throw new HistoricalSyncError(`Unsupported market: ${market}`, 'BAD_ARGUMENT');
  }
  for (const symbol of symbols) {
    if (!SYMBOLS.includes(symbol)) throw new HistoricalSyncError(`Unsupported symbol: ${symbol}`, 'BAD_ARGUMENT');
  }
  for (const timeframe of timeframes) {
    if (!TIMEFRAMES.includes(timeframe)) {
      throw new HistoricalSyncError(`Unsupported timeframe: ${timeframe}`, 'BAD_ARGUMENT');
    }
  }

  const series = [];
  for (const market of markets) {
    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        const intervalMs = TIMEFRAME_MS[timeframe];
        series.push({
          market,
          symbol,
          timeframe,
          intervalMs,
          fromMs,
          toMs,
          expectedCount: expectedCandleCount(fromMs, toMs, timeframe),
          relativePath: `${market}/${symbol}/${timeframe}.json`,
        });
      }
    }
  }

  return {
    root: path.resolve(options.root ?? DEFAULT_DATA_ROOT),
    fromMs,
    toMs,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    series,
    seriesCount: series.length,
    candleCount: series.reduce((sum, item) => sum + item.expectedCount, 0),
  };
}

export function endpointForMarket(market) {
  const endpoint = BINANCE_ENDPOINTS[market];
  if (!endpoint) throw new HistoricalSyncError(`Unsupported market: ${market}`, 'BAD_MARKET');
  return endpoint;
}

export function normalizeBinanceKline(row) {
  if (!Array.isArray(row) || row.length < 7) {
    throw new HistoricalSyncError('Binance returned a malformed kline row', 'MALFORMED_ROW');
  }
  return [row[0], row[1], row[2], row[3], row[4], row[5], row[6]];
}

function assertDecimal(value, field, index) {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new HistoricalSyncError(`Row ${index}: ${field} must be a raw decimal string`, 'INVALID_DECIMAL');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new HistoricalSyncError(`Row ${index}: ${field} is not finite`, 'INVALID_DECIMAL');
  }
  return number;
}

/** Validate canonical stored rows without changing their decimal strings. */
export function validateSeriesRows(rows, series, options = {}) {
  if (!Array.isArray(rows)) {
    throw new HistoricalSyncError('Series file must contain a JSON array', 'MALFORMED_SERIES');
  }
  const nowMs = options.nowMs ?? Date.now();
  const seen = new Set();
  let previousOpenTime = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length !== 7) {
      throw new HistoricalSyncError(`Row ${index}: expected exactly 7 fields`, 'MALFORMED_ROW');
    }
    const [openTime, openRaw, highRaw, lowRaw, closeRaw, volumeRaw, closeTime] = row;
    if (!Number.isSafeInteger(openTime) || !Number.isSafeInteger(closeTime)) {
      throw new HistoricalSyncError(`Row ${index}: timestamps must be safe integers`, 'INVALID_TIMESTAMP');
    }
    if (seen.has(openTime)) {
      throw new HistoricalSyncError(`Duplicate candle at ${openTime}`, 'DUPLICATE_TIMESTAMP');
    }
    seen.add(openTime);
    if (previousOpenTime !== null && openTime !== previousOpenTime + series.intervalMs) {
      throw new HistoricalSyncError(
        `Gap detected after ${previousOpenTime}; expected ${previousOpenTime + series.intervalMs}, got ${openTime}`,
        'GAP_DETECTED'
      );
    }
    if (openTime !== series.fromMs + index * series.intervalMs) {
      throw new HistoricalSyncError(`Row ${index}: candle is outside/aligned incorrectly for the requested range`, 'BAD_RANGE');
    }
    if (openTime < series.fromMs || openTime >= series.toMs || closeTime >= series.toMs) {
      throw new HistoricalSyncError(`Row ${index}: candle is outside the requested range`, 'BAD_RANGE');
    }
    if (closeTime !== openTime + series.intervalMs - 1) {
      throw new HistoricalSyncError(`Row ${index}: closeTime does not match ${series.timeframe}`, 'INVALID_TIMESTAMP');
    }
    if (closeTime >= nowMs) {
      throw new HistoricalSyncError(`Row ${index}: forming candle is not allowed`, 'FORMING_CANDLE');
    }

    const open = assertDecimal(openRaw, 'open', index);
    const high = assertDecimal(highRaw, 'high', index);
    const low = assertDecimal(lowRaw, 'low', index);
    const close = assertDecimal(closeRaw, 'close', index);
    const volume = assertDecimal(volumeRaw, 'volume', index);
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      throw new HistoricalSyncError(`Row ${index}: OHLC values must be positive`, 'INVALID_OHLC');
    }
    if (volume < 0) {
      throw new HistoricalSyncError(`Row ${index}: volume must be non-negative`, 'INVALID_VOLUME');
    }
    if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) {
      throw new HistoricalSyncError(`Row ${index}: invalid OHLC geometry`, 'INVALID_OHLC');
    }
    previousOpenTime = openTime;
  }

  if (rows.length !== series.expectedCount) {
    throw new HistoricalSyncError(
      `Expected ${series.expectedCount} candles, received ${rows.length}`,
      'EXPECTED_COUNT_MISMATCH'
    );
  }

  return {
    candleCount: rows.length,
    firstOpenTime: rows.length ? rows[0][0] : null,
    lastOpenTime: rows.length ? rows[rows.length - 1][0] : null,
  };
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 8_000);
}

async function fetchJsonWithRetries(url, options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const retries = options.retries ?? MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return await response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        throw new HistoricalSyncError(`Binance request failed with HTTP ${response.status}`, 'UPSTREAM_ERROR');
      }
    } catch (error) {
      if (error instanceof HistoricalSyncError) throw error;
      if (attempt === retries) {
        const reason = error?.name === 'AbortError' ? 'timed out' : error instanceof Error ? error.message : String(error);
        throw new HistoricalSyncError(`Binance request ${reason}`, 'UPSTREAM_ERROR');
      }
    } finally {
      clearTimeout(timer);
    }
    await sleepFn(retryDelayMs(response, attempt));
  }
  throw new HistoricalSyncError('Retry budget exhausted', 'UPSTREAM_ERROR');
}

export async function downloadSeries(series, options = {}) {
  const rows = [];
  let cursor = series.fromMs;
  const endpoint = endpointForMarket(series.market);

  while (cursor < series.toMs && rows.length < series.expectedCount) {
    const remaining = series.expectedCount - rows.length;
    const limit = Math.min(BINANCE_PAGE_LIMIT, remaining);
    const query = new URLSearchParams({
      symbol: series.symbol,
      interval: series.timeframe,
      startTime: String(cursor),
      endTime: String(series.toMs - 1),
      limit: String(limit),
    });
    const payload = await fetchJsonWithRetries(`${endpoint}?${query}`, options);
    if (!Array.isArray(payload)) {
      throw new HistoricalSyncError('Binance returned a non-array payload', 'UPSTREAM_ERROR');
    }
    if (payload.length === 0) break;

    for (const item of payload) rows.push(normalizeBinanceKline(item));
    const lastOpenTime = Number(payload[payload.length - 1]?.[0]);
    if (!Number.isSafeInteger(lastOpenTime)) {
      throw new HistoricalSyncError('Binance returned an invalid openTime', 'INVALID_TIMESTAMP');
    }
    const nextCursor = lastOpenTime + series.intervalMs;
    if (nextCursor <= cursor) {
      throw new HistoricalSyncError('Binance pagination did not advance', 'PAGINATION_STALLED');
    }
    cursor = nextCursor;
    if (payload.length < limit) break;
  }

  validateSeriesRows(rows, series, { nowMs: options.nowMs });
  return rows;
}

/** Write bytes through a same-directory temporary file and atomic rename. */
export async function atomicWriteFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o640);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function atomicWriteJson(filePath, value) {
  const contents = `${JSON.stringify(value)}\n`;
  await atomicWriteFile(filePath, contents);
  return { sha256: sha256(contents), bytes: Buffer.byteLength(contents) };
}

function manifestHash(manifestWithoutHash) {
  return sha256(JSON.stringify(manifestWithoutHash));
}

function createManifest(plan, entries, generatedAt = new Date().toISOString()) {
  const ordered = [...entries].sort((a, b) =>
    `${a.market}/${a.symbol}/${a.timeframe}`.localeCompare(`${b.market}/${b.symbol}/${b.timeframe}`)
  );
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    status: 'valid',
    datasetVersion: generatedAt,
    generatedAt,
    coverageFrom: plan.from,
    coverageTo: plan.to,
    sources: BINANCE_ENDPOINTS,
    summary: {
      validSeries: ordered.filter((entry) => entry.status === 'valid').length,
      totalSeries: ordered.length,
      totalCandles: ordered.reduce((sum, entry) => sum + entry.candleCount, 0),
    },
    series: ordered,
  };
  return { ...manifest, manifestSha256: manifestHash(manifest) };
}

function assertManifestHash(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new HistoricalSyncError('manifest.json must contain an object', 'INVALID_MANIFEST');
  }
  const { manifestSha256, ...payload } = manifest;
  if (typeof manifestSha256 !== 'string' || manifestSha256 !== manifestHash(payload)) {
    throw new HistoricalSyncError('manifest.json SHA-256 is invalid', 'INVALID_MANIFEST');
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.status !== 'valid' || !Array.isArray(manifest.series)) {
    throw new HistoricalSyncError('manifest.json schema or status is invalid', 'INVALID_MANIFEST');
  }
}

function matchesSelection(entry, plan) {
  return plan.series.some(
    (series) =>
      series.market === entry.market &&
      series.symbol === entry.symbol &&
      series.timeframe === entry.timeframe &&
      series.fromMs === Date.parse(entry.coverageFrom) &&
      series.toMs === Date.parse(entry.coverageTo)
  );
}

export async function validateArchive(plan) {
  const manifestPath = path.join(plan.root, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new HistoricalSyncError(
      `Cannot read manifest.json: ${error instanceof Error ? error.message : String(error)}`,
      'INVALID_MANIFEST'
    );
  }
  assertManifestHash(manifest);

  const selected = manifest.series.filter((entry) => matchesSelection(entry, plan));
  if (selected.length !== plan.series.length) {
    throw new HistoricalSyncError('Manifest does not contain every selected series/range', 'INVALID_MANIFEST');
  }

  let candleCount = 0;
  for (const series of plan.series) {
    const entry = selected.find(
      (candidate) =>
        candidate.market === series.market &&
        candidate.symbol === series.symbol &&
        candidate.timeframe === series.timeframe
    );
    if (!entry || entry.status !== 'valid' || entry.path !== series.relativePath) {
      throw new HistoricalSyncError(`Manifest entry is invalid for ${series.relativePath}`, 'INVALID_MANIFEST');
    }
    const filePath = path.join(plan.root, series.relativePath);
    const contents = await fs.readFile(filePath, 'utf8');
    if (sha256(contents) !== entry.sha256) {
      throw new HistoricalSyncError(`SHA-256 mismatch for ${series.relativePath}`, 'CHECKSUM_MISMATCH');
    }
    let rows;
    try {
      rows = JSON.parse(contents);
    } catch {
      throw new HistoricalSyncError(`Malformed JSON in ${series.relativePath}`, 'MALFORMED_SERIES');
    }
    validateSeriesRows(rows, series);
    candleCount += rows.length;
  }

  return { seriesCount: selected.length, candleCount, manifest };
}

export async function syncHistoricalCandles(options = {}) {
  const plan = buildPlan(options);
  if (options.dryRun) return { mode: 'dry-run', ...plan };
  if (options.validateOnly) return { mode: 'validate-only', ...plan, ...(await validateArchive(plan)) };

  const entries = [];
  for (const series of plan.series) {
    options.onProgress?.({ type: 'download-start', series });
    const rows = await downloadSeries(series, options);
    const filePath = path.join(plan.root, series.relativePath);
    const written = await atomicWriteJson(filePath, rows);
    const entry = {
      market: series.market,
      symbol: series.symbol,
      timeframe: series.timeframe,
      path: series.relativePath,
      status: 'valid',
      intervalMs: series.intervalMs,
      expectedCount: series.expectedCount,
      candleCount: rows.length,
      coverageFrom: new Date(series.fromMs).toISOString(),
      coverageTo: new Date(series.toMs).toISOString(),
      firstOpenTime: rows[0][0],
      lastOpenTime: rows[rows.length - 1][0],
      sha256: written.sha256,
      bytes: written.bytes,
    };
    entries.push(entry);
    options.onProgress?.({ type: 'download-complete', series, entry });
  }

  const manifest = createManifest(plan, entries, options.generatedAt);
  await atomicWriteJson(path.join(plan.root, 'manifest.json'), manifest);
  return { mode: 'sync', ...plan, manifest };
}

function printResult(result) {
  const mode = result.mode === 'dry-run' ? 'DRY RUN' : result.mode === 'validate-only' ? 'VALIDATION' : 'SYNC';
  console.log(mode);
  console.log(`ROOT: ${result.root}`);
  console.log(`FROM: ${result.from}`);
  console.log(`TO: ${result.to}`);
  console.log(`SERIES: ${result.seriesCount}`);
  console.log(`CANDLES: ${result.candleCount}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const result = await syncHistoricalCandles({
    ...options,
    onProgress:
      options.dryRun || options.validateOnly
        ? undefined
        : ({ type, series }) => {
            if (type === 'download-start') console.error(`Downloading ${series.relativePath} ...`);
          },
  });
  printResult(result);
  return result;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
