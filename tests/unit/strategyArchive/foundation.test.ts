import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ARCHIVE_TF_MS, FROZEN_ENGINE, FROZEN_SETTINGS_SHA256, STRATEGY_ARCHIVE, STRATEGY_ARCHIVE_PLANNED,
  V30_DEFINITION, V30_SOURCE_PINS, V30_SOURCE_RESULTS, V30_CAVEATS_RU, V30_COMMITS,
  ohlcvToArchiveCandles, archiveCandlesToOhlcv, detectTimestampUnit, toMs, validateSeries, splitFor,
} from '@/services/strategyArchive';
import { closedHtfCandles, findSwingsV2, atrAt, rvolAt } from '@/services/strategyArchive/shared/primitives';
import provenance from '@/services/strategyArchive/provenance/provenance.json';
import type { OHLCV } from '@/types/market';

const ROOT = resolve(__dirname, '../../..');
const sha = (rel: string) => createHash('sha256').update(readFileSync(resolve(ROOT, rel))).digest('hex');

describe('candle adapter: CRYPTORA OHLCV (seconds) ↔ archive Candle (ms)', () => {
  it('detects units by magnitude: seconds / milliseconds / microseconds', () => {
    expect(detectTimestampUnit(1640995200)).toBe('s');
    expect(detectTimestampUnit(1640995200000)).toBe('ms');
    expect(detectTimestampUnit(1764547200000000)).toBe('us');
    expect(toMs(1640995200)).toBe(1640995200000);
    expect(toMs(1764547200000000)).toBe(1764547200000);
  });

  it('open/close timestamps: closeTime = openTime + span − 1 (Binance convention), UTC, no timezone shift', () => {
    const rows: OHLCV[] = [{ time: 1640995200, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
    const [c] = ohlcvToArchiveCandles(rows, '1h');
    expect(c!.openTime).toBe(Date.UTC(2022, 0, 1, 0, 0, 0));
    expect(c!.closeTime).toBe(Date.UTC(2022, 0, 1, 0, 59, 59, 999));
    expect(new Date(c!.openTime).toISOString()).toBe('2022-01-01T00:00:00.000Z');
    const [d] = ohlcvToArchiveCandles(rows, '4h');
    expect(d!.closeTime - d!.openTime + 1).toBe(ARCHIVE_TF_MS['4h']);
  });

  it('closed-candle semantics: archive rows are closed; a forming LIVE candle is flagged open', () => {
    const t = 1640995200;
    const rows: OHLCV[] = [
      { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: t + 3600, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ];
    expect(ohlcvToArchiveCandles(rows, '1h').every((c) => c.isClosed)).toBe(true);
    const nowMs = (t + 3600 + 1800) * 1000;   // half-way through the second candle
    const live = ohlcvToArchiveCandles(rows, '1h', { nowMs });
    expect(live[0]!.isClosed).toBe(true);
    expect(live[1]!.isClosed).toBe(false);
    // an open candle is invisible to the HTF gate
    expect(closedHtfCandles(live, '1h', nowMs + 10 * 3600_000)).toHaveLength(1);
  });

  it('sorts, deduplicates and round-trips back to seconds', () => {
    const rows: OHLCV[] = [
      { time: 1640998800, open: 2, high: 3, low: 1, close: 2, volume: 1 },
      { time: 1640995200, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 1640998800, open: 2.5, high: 3, low: 1, close: 2, volume: 1 },
    ];
    const c = ohlcvToArchiveCandles(rows, '1h');
    expect(c.map((x) => x.openTime)).toEqual([1640995200000, 1640998800000]);
    expect(c[1]!.open).toBe(2.5);   // last duplicate wins
    expect(archiveCandlesToOhlcv(c).map((x) => x.time)).toEqual([1640995200, 1640998800]);
    expect(validateSeries(c, '1h').ok).toBe(true);
    expect(validateSeries(c, '15m').gaps).toBe(1);
  });
});

describe('frozen primitives', () => {
  const mk = (i: number, h: number, l: number, v = 1) => ({
    openTime: i * 3600_000, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: v, closeTime: i * 3600_000 + 3599_999, isClosed: true,
  });
  it('findSwingsV2: strict fractal, confirmedIndex = index + strength, labels in confirmation order', () => {
    const c = [1, 2, 3, 4, 9, 4, 3, 2, 1, 2, 3, 4, 12, 4, 3, 2, 1].map((h, i) => mk(i, h, h - 1));
    const s = findSwingsV2(c, 3);
    const highs = s.filter((x) => x.kind === 'HIGH');
    expect(highs.map((x) => [x.index, x.confirmedIndex, x.price, x.label])).toEqual([[4, 7, 9, 'FIRST'], [12, 15, 12, 'HH']]);
  });
  it('rvol excludes the current bar and needs a full window; ATR is Wilder', () => {
    const c = Array.from({ length: 30 }, (_, i) => mk(i, 11, 9, i === 29 ? 5 : 1));
    expect(rvolAt(c, 19, 20)).toBeNull();
    expect(rvolAt(c, 29, 20)).toBe(5);
    expect(atrAt(c, 12, 14)).toBeNull();
    expect(atrAt(c, 13, 14)).toBeCloseTo(2, 12);
  });
  it('ATR/RVOL at index i are unaffected by candles after i (no future access)', () => {
    const c = Array.from({ length: 40 }, (_, i) => mk(i, 10 + (i % 3), 9, 1 + (i % 4)));
    const later = [...c, mk(40, 100, 1, 999)];
    expect(atrAt(later, 30, 14)).toBe(atrAt(c, 30, 14));
    expect(rvolAt(later, 30, 20)).toBe(rvolAt(c, 30, 20));
  });
});

describe('frozen settings — no database, hash-pinned', () => {
  it('settings.json integrity matches the pinned sha256', () => {
    expect(sha('src/services/strategyArchive/results/v2-real-20260915-080338/settings.json')).toBe(FROZEN_SETTINGS_SHA256);
  });
  it('exposes the frozen registry values used by V3.0', () => {
    expect(FROZEN_ENGINE.swingLookback).toBe(3);
    expect(FROZEN_ENGINE.atrPeriod).toBe(14);
    expect(FROZEN_ENGINE.volumePeriod).toBe(20);
    expect(FROZEN_ENGINE.outcomeTimeoutBars).toBe(48);
    expect(FROZEN_ENGINE.slPriorityOnAmbiguousBar).toBe(true);
    expect(FROZEN_ENGINE.strategyCommit).toBe('f766b516617af71f262054a80cb211c842d577b2');
  });
  it('the archive module tree has no database / exchange / execution imports', () => {
    const files = [
      'src/services/strategyArchive/index.ts', 'src/services/strategyArchive/types.ts', 'src/services/strategyArchive/registry.ts',
      'src/services/strategyArchive/engine/reproductionEngine.ts', 'src/services/strategyArchive/engine/rMetrics.ts',
      'src/services/strategyArchive/shared/candleAdapter.ts', 'src/services/strategyArchive/shared/primitives.ts',
      'src/services/strategyArchive/shared/frozenSettings.ts',
      'src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/definition.ts',
      'src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core.ts',
      'src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Runner.ts',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
      expect(imports, f).not.toMatch(/kysely|['"]pg['"]|\/db\/|\/db['"]|ccxt|binance|exchange/i);
      expect(src, f).not.toMatch(/placeOrder|createOrder|apiKey|api_key|fetch\(/);
    }
  });
});

describe('provenance & source artifact integrity', () => {
  it('provenance manifest pins source head, dataset commit and hashes', () => {
    expect(provenance.sourceHead).toBe('292050c6c3f32807a85548e037f674d42a2efb18');
    expect(provenance.datasetCommit).toBe('c3c1dcecfe2784a147f591f2b5b4526cbf99df9f');
    expect(provenance.fullDatasetInRepository).toBe(false);
    expect(provenance.datasetProvenance.market).toBe('Spot');
    expect(provenance.requiredForV30.intervals).toEqual(['1h', '4h']);
  });
  it('copied artifacts hash exactly to the source values', () => {
    const base = 'src/services/strategyArchive/';
    expect(sha(base + 'results/v30/v30-train-metrics.json')).toBe(provenance.artifacts['v30-train-metrics.json']);
    expect(sha(base + 'results/v30/v30-validation-metrics.json')).toBe(provenance.artifacts['v30-validation-metrics.json']);
    expect(sha(base + 'results/v30/v30-port-parity.json')).toBe(provenance.artifacts['v30-port-parity.json']);
    expect(sha(base + 'results/v2-real-20260915-080338/splits.json')).toBe(provenance.artifacts['splits.json']);
    expect(sha(base + 'provenance/dataset-manifest.c3c1dce.json')).toBe(provenance.datasetManifestSha256);
  });
  it('definition pins agree with provenance', () => {
    const pin = (p: string) => V30_SOURCE_PINS.find((x) => x.path === p)!.sha256;
    expect(pin('research/v30_htf_trap.ts')).toBe(provenance.strategySources['research/v30_htf_trap.ts']);
    expect(pin('artifacts/research/v30/v30-train-metrics.json')).toBe(provenance.artifacts['v30-train-metrics.json']);
    expect(V30_COMMITS.sourceHead).toBe(provenance.sourceHead);
  });
  it('source-reported headline numbers are read from the artifacts, not typed by hand', () => {
    expect(V30_SOURCE_RESULTS.origin).toBe('SOURCE_REPORTED');
    expect(V30_SOURCE_RESULTS.train.n).toBe(1585);
    expect(V30_SOURCE_RESULTS.train.netRPerTrade.FUT_4).toBe(0.0994);
    expect(V30_SOURCE_RESULTS.validation.n).toBe(536);
    expect(V30_SOURCE_RESULTS.validation.netRPerTrade.FUT_4).toBe(0.06);
    expect(V30_SOURCE_RESULTS.validation.profitFactor).toBe(1.2484);
    expect(V30_SOURCE_RESULTS.portParity.parity).toBe('PASS');
  });
  it('splits.json is consulted for real symbols and matches the documented TRAIN window', () => {
    const s = splitFor('BTCUSDT', '1h')!;
    expect(new Date(s.trainFromMs).toISOString()).toBe('2022-01-01T00:00:00.000Z');
    expect(new Date(s.trainToMs).toISOString()).toBe('2024-05-26T13:00:00.000Z');
    expect(new Date(s.validFromMs).toISOString()).toBe('2024-05-26T14:00:00.000Z');
    expect(splitFor('NOPE', '1h')).toBeNull();
  });
});

describe('registry & status honesty', () => {
  it('V3.0 status is SOURCE_CHAIN_VERIFIED_NOT_RERUN — never REPRODUCED from synthetic parity alone', () => {
    expect(V30_DEFINITION.reproducibility).toBe('SOURCE_CHAIN_VERIFIED_NOT_RERUN');
    expect(V30_DEFINITION.verdict).toBe('VALIDATED_FOR_RESEARCH');
    expect(V30_DEFINITION.discrepancies.map((d) => d.id)).toContain('D-V30-001');
  });
  it('caveats mention the mandatory qualifications and forbid promise wording', () => {
    const all = V30_CAVEATS_RU.join(' ');
    expect(all).toMatch(/3 из 6/);
    expect(all).toMatch(/топ-5/);
    expect(all).toMatch(/перекрывающ/);
    expect(all).toMatch(/не исполняет сделки/);
    expect(all).not.toMatch(/прибыльная стратегия|лучший сигнал|ожидаемая доходность/i);
  });
  it('registry lists V3.0 and keeps every not-yet-imported version (incl. V3.1 FALSIFIED) visible', () => {
    expect(STRATEGY_ARCHIVE.map((d) => d.id)).toEqual(['V3_0_HTF_LIQUIDATION_TRAP']);
    expect(STRATEGY_ARCHIVE_PLANNED.find((p) => p.version === '3.1')?.sourceVerdict).toBe('FALSIFIED_ON_TRAIN');
    expect(STRATEGY_ARCHIVE_PLANNED.length).toBe(11);
  });
  it('definition is immutable', () => {
    expect(Object.isFrozen(V30_DEFINITION)).toBe(true);
    expect(() => { (V30_DEFINITION as { id: string }).id = 'x'; }).toThrow();
  });
});
