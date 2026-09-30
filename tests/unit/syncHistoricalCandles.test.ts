import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BINANCE_ENDPOINTS,
  HistoricalSyncError,
  atomicWriteJson,
  buildPlan,
  downloadSeries,
  endpointForMarket,
  validateSeriesRows,
  type HistoricalSeriesPlan,
} from '../../scripts/strategy-lab/sync-historical-candles.mjs';

const HOUR = 60 * 60_000;
const BASE = Date.parse('2025-01-01T00:00:00.000Z');
const tempDirs: string[] = [];

function plan(count: number, market: 'spot' | 'futures' = 'spot'): HistoricalSeriesPlan {
  return {
    market,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    intervalMs: HOUR,
    fromMs: BASE,
    toMs: BASE + count * HOUR,
    expectedCount: count,
    relativePath: `${market}/BTCUSDT/1h.json`,
  };
}

function row(index: number, values = ['100.1000', '102.2000', '99.9000', '101.5000', '12.3400']) {
  const openTime = BASE + index * HOUR;
  return [openTime, ...values, openTime + HOUR - 1];
}

function response(rows: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => rows,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Strategy Lab historical downloader · planning and sources', () => {
  it('default dry-run plan has exactly 50 series and 1,686,300 candles', () => {
    const result = buildPlan();
    expect(result.seriesCount).toBe(50);
    expect(result.candleCount).toBe(1_686_300);
    expect(result.series.filter((item) => item.market === 'spot')).toHaveLength(25);
    expect(result.series.filter((item) => item.market === 'futures')).toHaveLength(25);
  });

  it('uses the exact Spot endpoint and preserves raw decimal strings', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request) => response([row(0)]));
    const rows = await downloadSeries(plan(1, 'spot'), { fetchFn, nowMs: BASE + 10 * HOUR });
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(BINANCE_ENDPOINTS.spot);
    expect(endpointForMarket('spot')).toBe('https://api.binance.com/api/v3/klines');
    expect(rows[0].slice(1, 6)).toEqual(['100.1000', '102.2000', '99.9000', '101.5000', '12.3400']);
  });

  it('uses the exact Futures endpoint without Spot substitution', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request) =>
      response([row(0, ['200.1', '202.2', '199.9', '201.5', '2.34'])])
    );
    await downloadSeries(plan(1, 'futures'), { fetchFn, nowMs: BASE + 10 * HOUR });
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(BINANCE_ENDPOINTS.futures);
    expect(endpointForMarket('futures')).toBe('https://fapi.binance.com/fapi/v1/klines');
  });

  it('paginates with a Binance limit never above 1000', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const start = Number(url.searchParams.get('startTime'));
      const limit = Number(url.searchParams.get('limit'));
      const startIndex = (start - BASE) / HOUR;
      return response(Array.from({ length: limit }, (_, offset) => row(startIndex + offset)));
    });
    const rows = await downloadSeries(plan(1001), { fetchFn, nowMs: BASE + 2000 * HOUR });
    expect(rows).toHaveLength(1001);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const limits = fetchFn.mock.calls.map(([input]) => Number(new URL(String(input)).searchParams.get('limit')));
    expect(limits).toEqual([1000, 1]);
  });
});

describe('Strategy Lab historical downloader · strict validation', () => {
  it('rejects duplicate timestamps', () => {
    expect(() => validateSeriesRows([row(0), row(0)], plan(2), { nowMs: BASE + 10 * HOUR })).toThrowError(
      expect.objectContaining<Partial<HistoricalSyncError>>({ code: 'DUPLICATE_TIMESTAMP' })
    );
  });

  it('rejects gaps', () => {
    expect(() => validateSeriesRows([row(0), row(2)], plan(2), { nowMs: BASE + 10 * HOUR })).toThrowError(
      expect.objectContaining<Partial<HistoricalSyncError>>({ code: 'GAP_DETECTED' })
    );
  });

  it('rejects invalid OHLC geometry', () => {
    const bad = row(0, ['100.0', '99.0', '98.0', '101.0', '1.0']);
    expect(() => validateSeriesRows([bad], plan(1), { nowMs: BASE + 10 * HOUR })).toThrowError(
      expect.objectContaining<Partial<HistoricalSyncError>>({ code: 'INVALID_OHLC' })
    );
  });

  it('rejects an expected-count mismatch and forming candles', () => {
    expect(() => validateSeriesRows([row(0)], plan(2), { nowMs: BASE + 10 * HOUR })).toThrowError(
      expect.objectContaining<Partial<HistoricalSyncError>>({ code: 'EXPECTED_COUNT_MISMATCH' })
    );
    expect(() => validateSeriesRows([row(0)], plan(1), { nowMs: BASE + HOUR - 1 })).toThrowError(
      expect.objectContaining<Partial<HistoricalSyncError>>({ code: 'FORMING_CANDLE' })
    );
  });

  it('writes JSON atomically and leaves no temporary sibling', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cryptora-sync-'));
    tempDirs.push(root);
    const target = path.join(root, 'spot/BTCUSDT/1h.json');
    const payload = [row(0)];
    const metadata = await atomicWriteJson(target, payload);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(payload);
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readdir(path.dirname(target))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
