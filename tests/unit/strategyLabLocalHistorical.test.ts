import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LocalHistoricalError,
  getLocalDatasetCoverage,
  inspectLocalSeriesCoverage,
  readLocalHistoricalCandles,
} from '../../server/services/strategyLab/localHistoricalCandles.js';
import {
  LOCAL_MAX_CANDLES,
  REST_MAX_CANDLES,
  runReplay,
  selectHistoricalCandles,
} from '../../server/services/strategyLab/labService.js';

const HOUR = 60 * 60_000;
const FIVE_MINUTES = 5 * 60_000;
const BASE = Date.parse('2025-01-01T00:00:00.000Z');
const tempDirs: string[] = [];

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function rows(startPrice: number) {
  return Array.from({ length: 4 }, (_, index) => {
    const openTime = BASE + index * HOUR;
    const open = startPrice + index;
    return [
      openTime,
      open.toFixed(4),
      (open + 2).toFixed(4),
      (open - 1).toFixed(4),
      (open + 1).toFixed(4),
      (10 + index).toFixed(4),
      openTime + HOUR - 1,
    ];
  });
}

async function createArchive() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cryptora-local-history-'));
  tempDirs.push(root);
  const generatedAt = '2025-02-01T00:00:00.000Z';
  const definitions = [
    { market: 'spot', values: rows(100) },
    { market: 'futures', values: rows(200) },
  ] as const;
  const series = [];
  for (const definition of definitions) {
    const relativePath = `${definition.market}/BTCUSDT/1h.json`;
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    const contents = `${JSON.stringify(definition.values)}\n`;
    await writeFile(filePath, contents);
    series.push({
      market: definition.market,
      symbol: 'BTCUSDT',
      timeframe: '1h',
      path: relativePath,
      status: 'valid',
      intervalMs: HOUR,
      expectedCount: 4,
      candleCount: 4,
      coverageFrom: new Date(BASE).toISOString(),
      coverageTo: new Date(BASE + 4 * HOUR).toISOString(),
      firstOpenTime: BASE,
      lastOpenTime: BASE + 3 * HOUR,
      sha256: sha256(contents),
      bytes: Buffer.byteLength(contents),
    });
  }
  const payload = {
    schemaVersion: 1,
    status: 'valid',
    datasetVersion: generatedAt,
    generatedAt,
    coverageFrom: new Date(BASE).toISOString(),
    coverageTo: new Date(BASE + 4 * HOUR).toISOString(),
    sources: {
      spot: 'https://api.binance.com/api/v3/klines',
      futures: 'https://fapi.binance.com/fapi/v1/klines',
    },
    summary: { validSeries: 2, totalSeries: 2, totalCandles: 8 },
    series,
  };
  const manifest = { ...payload, manifestSha256: sha256(JSON.stringify(payload)) };
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return { root, manifest };
}

function request(market: 'spot' | 'futures', from = BASE, to = BASE + 4 * HOUR) {
  return { market, symbol: 'BTCUSDT', timeframe: '1h', fromMs: from, toMs: to } as const;
}

function parsedRequest(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: 'EMA_ATR',
    market: 'spot',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    from: BASE,
    to: BASE + 4 * HOUR,
    researchConfig: {
      indicators: { emaFast: 20, emaSlow: 50, atrPeriod: 14 },
      strategy: { stopAtrMult: 1.5, targetR: 2 },
      execution: { feeBps: 5, slippageBps: 2 },
    },
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Strategy Lab local historical reader', () => {
  it('reads the exact Spot path', async () => {
    const { root } = await createArchive();
    const result = await readLocalHistoricalCandles(request('spot'), { root, nowMs: BASE + 10 * HOUR });
    expect(result.covered).toBe(true);
    expect(result.candles[0].open).toBe(100);
    expect(result.meta.dataSource).toBe('local-dataset');
  });

  it('reads the exact Futures path and never mixes Spot/Futures values', async () => {
    const { root } = await createArchive();
    const spot = await readLocalHistoricalCandles(request('spot'), { root, nowMs: BASE + 10 * HOUR });
    const futures = await readLocalHistoricalCandles(request('futures'), { root, nowMs: BASE + 10 * HOUR });
    expect(spot.candles[0].open).toBe(100);
    expect(futures.candles[0].open).toBe(200);
    expect(futures.candles.map((c: { open: number }) => c.open)).not.toEqual(
      spot.candles.map((c: { open: number }) => c.open)
    );
  });

  it('slices a requested date range with preserved timestamps', async () => {
    const { root } = await createArchive();
    const result = await readLocalHistoricalCandles(
      request('spot', BASE + HOUR, BASE + 3 * HOUR),
      { root, nowMs: BASE + 10 * HOUR }
    );
    expect(result.candles).toHaveLength(2);
    expect(result.candles.map((c: { time: number }) => c.time)).toEqual([
      (BASE + HOUR) / 1000,
      (BASE + 2 * HOUR) / 1000,
    ]);
  });

  it('rejects an invalid/failed manifest', async () => {
    const { root } = await createArchive();
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.status = 'failed';
    const { manifestSha256: _oldHash, ...payload } = manifest;
    manifest.manifestSha256 = sha256(JSON.stringify(payload));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(inspectLocalSeriesCoverage(request('spot'), { root })).rejects.toEqual(
      expect.objectContaining<Partial<LocalHistoricalError>>({ code: 'INVALID_MANIFEST' })
    );
  });

  it('rejects a series file whose SHA-256 no longer matches the manifest', async () => {
    const { root } = await createArchive();
    const seriesPath = path.join(root, 'spot/BTCUSDT/1h.json');
    await writeFile(seriesPath, `${JSON.stringify(rows(999))}\n`);
    await expect(
      readLocalHistoricalCandles(request('spot'), { root, nowMs: BASE + 10 * HOUR })
    ).rejects.toEqual(
      expect.objectContaining<Partial<LocalHistoricalError>>({ code: 'CORRUPT_LOCAL_DATA' })
    );
  });

  it('rejects a manifest path that attempts to escape the dataset root', async () => {
    const { root } = await createArchive();
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.series[0].path = '../outside.json';
    const { manifestSha256: _oldHash, ...payload } = manifest;
    manifest.manifestSha256 = sha256(JSON.stringify(payload));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(inspectLocalSeriesCoverage(request('spot'), { root })).rejects.toEqual(
      expect.objectContaining<Partial<LocalHistoricalError>>({ code: 'INVALID_MANIFEST' })
    );
  });

  it('reports insufficient coverage without reading another market', async () => {
    const { root } = await createArchive();
    const inspection = await inspectLocalSeriesCoverage(
      request('spot', BASE, BASE + 5 * HOUR),
      { root }
    );
    expect(inspection).toEqual(expect.objectContaining({ datasetAvailable: true, covered: false, reason: 'insufficient-coverage' }));
  });

  it('returns metadata-only coverage and handles a missing archive', async () => {
    const { root } = await createArchive();
    expect(await getLocalDatasetCoverage({ root })).toEqual(
      expect.objectContaining({
        datasetAvailable: true,
        coverageFrom: new Date(BASE).toISOString(),
        coverageTo: new Date(BASE + 4 * HOUR).toISOString(),
        markets: ['futures', 'spot'],
        symbols: ['BTCUSDT'],
        timeframes: ['1h'],
        validSeries: 2,
        totalSeries: 2,
      })
    );
    expect(await getLocalDatasetCoverage({ root: path.join(root, 'missing') })).toEqual({ datasetAvailable: false });
  });
});

describe('Strategy Lab source selection and source-specific limits', () => {
  const localMeta = {
    datasetVersion: 'fixture-v1',
    manifestGeneratedAt: '2025-02-01T00:00:00.000Z',
    coverageFrom: new Date(BASE).toISOString(),
    coverageTo: new Date(BASE + 365 * 24 * HOUR).toISOString(),
    seriesSha256: 'a'.repeat(64),
  };
  const coveredInspector = vi.fn(async () => ({ covered: true, datasetAvailable: true }));
  const emptyLocalReader = vi.fn(async () => ({ covered: true, candles: [], meta: localMeta }));

  it('covered local replay returns meta.dataSource=local-dataset', async () => {
    const core = {
      isKnownLabStrategy: () => true,
      runLabReplay: (input: { candles: unknown[] }) => ({ meta: { candleCount: input.candles.length }, candles: input.candles }),
    };
    const result = await runReplay(parsedRequest(), {
      localInspector: coveredInspector,
      localReader: emptyLocalReader,
      core,
      nowMs: BASE + 10 * HOUR,
    });
    expect(result.meta.dataSource).toBe('local-dataset');
    expect(result.meta.dataset).toEqual(expect.objectContaining({ version: 'fixture-v1' }));
  });

  it('replay keeps Spot/Futures isolated when archived values intentionally differ', async () => {
    const { root } = await createArchive();
    const core = {
      isKnownLabStrategy: () => true,
      runLabReplay: (input: { market: string; candles: Array<{ open: number }> }) => ({
        meta: { market: input.market, firstOpen: input.candles[0]?.open },
        candles: input.candles,
      }),
    };
    const spot = await runReplay(parsedRequest({ market: 'spot' }), {
      dataRoot: root,
      core,
      nowMs: BASE + 10 * HOUR,
    });
    const futures = await runReplay(parsedRequest({ market: 'futures' }), {
      dataRoot: root,
      core,
      nowMs: BASE + 10 * HOUR,
    });
    expect(spot.meta).toEqual(expect.objectContaining({ market: 'spot', firstOpen: 100 }));
    expect(futures.meta).toEqual(expect.objectContaining({ market: 'futures', firstOpen: 200 }));
    expect(spot.meta.dataSource).toBe('local-dataset');
    expect(futures.meta.dataSource).toBe('local-dataset');
  });

  it('accepts the exact 2025-09-30 → 2026-09-30 local 5m range (105120) without REST', async () => {
    const from = Date.parse('2025-09-30T00:00:00.000Z');
    const to = Date.parse('2026-09-30T00:00:00.000Z');
    const fetchFn = vi.fn();
    expect((to - from) / FIVE_MINUTES).toBe(105_120);
    const result = await selectHistoricalCandles(
      parsedRequest({ timeframe: '5m', from, to }),
      { localInspector: coveredInspector, localReader: emptyLocalReader, fetchFn }
    );
    expect(LOCAL_MAX_CANDLES).toBe(120_000);
    expect(result.meta.dataSource).toBe('local-dataset');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects more than 120000 candles even when local coverage exists', async () => {
    await expect(
      selectHistoricalCandles(
        parsedRequest({ timeframe: '5m', from: BASE, to: BASE + 120_001 * FIVE_MINUTES }),
        { localInspector: coveredInspector, localReader: emptyLocalReader }
      )
    ).rejects.toEqual(expect.objectContaining({ code: 'LOCAL_RANGE_TOO_LARGE' }));
  });

  it('missing local archive + <=5000 allows the REST fallback', async () => {
    const localInspector = vi.fn(async () => ({ covered: false, datasetAvailable: false, reason: 'missing-manifest' }));
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => [] }));
    const result = await selectHistoricalCandles(parsedRequest(), {
      localInspector,
      fetchFn,
      nowMs: BASE + 10 * HOUR,
    });
    expect(REST_MAX_CANDLES).toBe(5000);
    expect(result.meta.dataSource).toBe('binance-rest');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('outside local coverage + <=5000 allows the REST fallback', async () => {
    const localInspector = vi.fn(async () => ({ covered: false, datasetAvailable: true, reason: 'insufficient-coverage' }));
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => [] }));
    const result = await selectHistoricalCandles(parsedRequest(), {
      localInspector,
      fetchFn,
      nowMs: BASE + 10 * HOUR,
    });
    expect(result.meta.dataSource).toBe('binance-rest');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('missing local archive + >5000 rejects before any Binance request', async () => {
    const fetchFn = vi.fn();
    await expect(
      selectHistoricalCandles(
        parsedRequest({ from: BASE, to: BASE + 5001 * HOUR }),
        { localInspector: async () => ({ covered: false, datasetAvailable: false }), fetchFn }
      )
    ).rejects.toEqual(expect.objectContaining({ code: 'REST_RANGE_TOO_LARGE' }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('outside local coverage + >5000 rejects before any Binance request', async () => {
    const fetchFn = vi.fn();
    await expect(
      selectHistoricalCandles(
        parsedRequest({ from: BASE, to: BASE + 5001 * HOUR }),
        {
          localInspector: async () => ({
            covered: false,
            datasetAvailable: true,
            reason: 'insufficient-coverage',
          }),
          fetchFn,
        }
      )
    ).rejects.toEqual(expect.objectContaining({ code: 'REST_RANGE_TOO_LARGE' }));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
