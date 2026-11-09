/**
 * Ведение опубликованного сигнала V3.4: копия ↔ исходная `trackPublishedSetup`
 * из CRYPTORA на одинаковых обезличенных данных и одинаковых публикациях.
 *
 * Сравниваются все ветки: UNCHANGED (бар сетапа — последний), SKIP (бара нет в
 * окне), CANCELLED/EXPIRED/REJECTED_GEOMETRY, FILLED с прогрессом
 * (TP1 забронирован / armed-стоп) и RESOLVED с исходом в R.
 */
import { describe, it, expect } from 'vitest';
import { trackPublishedSetup } from '@/services/signals/live/lifecycle';
import { trackV34PublishedSignal, type PublishedSignal } from '../src/signals/lifecycle';
import { runV34LiveReplay } from '../src/signals/v34LiveReplay';
import { makeSyntheticSeries } from './fixtures/synthetic';
import type { ArchiveCandle } from '../src/strategy/types';

const SEEDS = [1, 2, 10, 28, 33, 45, 47, 49] as const;

/** Форма строки, которую ожидает исходная реализация (AnalyticalSetup). */
function asLedgerSetup(sig: PublishedSignal) {
  return {
    id: `test-${sig.setupOpenTime}`,
    strategyId: sig.strategyId,
    strategyVersion: '3.4',
    symbol: 'ASSET/USDT',
    direction: sig.direction,
    timeframe: '1h',
    setupOpenTime: sig.setupOpenTime,
    entryType: sig.entryType,
    entryZone: [sig.entryZone[0], sig.entryZone[1]],
    invalidationLevel: sig.invalidationLevel,
    targets: [...sig.targets],
    riskRewardRatio: 1,
    confirmingFactors: [],
    invalidationFactors: [],
    exitRule: '',
    validForBars: 3,
    createdAt: new Date(sig.setupOpenTime).toISOString(),
    latencyBars: 0,
    status: 'ACTIVE' as const,
    prevHash: 'GENESIS',
    auditHash: 'test',
  };
}

function plain<T>(x: T): unknown {
  return JSON.parse(JSON.stringify(x));
}

/** Срез плюс несколько вариантов усечения окна — чтобы получить все ветки. */
function windowsFor(h1: readonly ArchiveCandle[], setupOpenTime: number): ArchiveCandle[][] {
  const idx = h1.findIndex((c) => c.openTime === setupOpenTime);
  if (idx < 0) return [];
  const out: ArchiveCandle[][] = [];
  for (const extra of [0, 1, 2, 3, 4, 6, 10, 60]) {
    const end = Math.min(h1.length, idx + 1 + extra);
    out.push(h1.slice(0, end));
  }
  return out;
}

describe('trackV34PublishedSignal: копия ↔ исходник', () => {
  it('все ветки жизненного цикла совпадают', () => {
    let checked = 0;
    const kinds = new Set<string>();
    const exitReasons = new Set<string>();

    for (const seed of SEEDS) {
      const { h1, h4 } = makeSyntheticSeries({ seed, bars1h: 900 });
      const out = runV34LiveReplay({ symbol: 'ASSET-A', h1, h4 });
      for (const rec of out.records) {
        if (rec.meta?.targetQualityRejectReason != null) continue;
        const sig: PublishedSignal = {
          strategyId: rec.strategyId,
          direction: rec.direction,
          setupOpenTime: rec.setupOpenTime,
          entryType: rec.entryType,
          entryZone: [rec.entryZone[0], rec.entryZone[1]],
          invalidationLevel: rec.stop,
          targets: [...rec.targets],
        };
        for (const w of windowsFor(h1, rec.setupOpenTime)) {
          const a = trackPublishedSetup(asLedgerSetup(sig) as never, w);
          const b = trackV34PublishedSignal(sig, w);
          expect(plain(b)).toEqual(plain(a));
          kinds.add(b.kind);
          if (b.kind === 'RESOLVED' && b.outcome.exitReason) exitReasons.add(b.outcome.exitReason);
          if (b.kind === 'FILLED') {
            // Прогресс открытой позиции — состояние frozen-степпера, не догадка.
            expect(b.progress).toBeDefined();
          }
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
    expect(kinds.has('UNCHANGED')).toBe(true);
    expect(kinds.has('RESOLVED')).toBe(true);
    expect([...exitReasons].some((r) => r === 'SL' || r === 'TP2' || r === 'TP1_THEN_BE')).toBe(true);
  });

  it('бар сетапа вне окна → UNRESOLVED (данные не подменяются)', () => {
    const { h1 } = makeSyntheticSeries({ seed: 10, bars1h: 900 });
    const sig: PublishedSignal = {
      strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      direction: 'LONG',
      setupOpenTime: h1[0]!.openTime - 1,
      entryType: 'LIMIT_CORRIDOR',
      entryZone: [100, 101],
      invalidationLevel: 99,
      targets: [105, 110],
    };
    const res = trackV34PublishedSignal(sig, h1.slice(10));
    expect(res.kind).toBe('RESOLVED');
    if (res.kind === 'RESOLVED') {
      expect(res.outcome.status).toBe('UNRESOLVED');
      expect(res.outcome.exitReason).toBe('OUT_OF_DATA_WINDOW');
      expect(res.outcome.resultR).toBeNull();
    }
  });

  it('недостижимый коридор истекает и не получает выдуманного исхода сделки', () => {
    const { h1 } = makeSyntheticSeries({ seed: 10, bars1h: 300 });
    const start = h1[100]!;
    const sig: PublishedSignal = {
      strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      direction: 'LONG',
      setupOpenTime: start.openTime,
      entryType: 'LIMIT_CORRIDOR',
      // Коридор глубоко под ценой: за три бара туда не дойти.
      entryZone: [start.close * 0.1, start.close * 0.101],
      invalidationLevel: start.close * 0.05,
      targets: [start.close * 1.2, start.close * 1.4],
    };
    // Окно ровно до истечения коридора (N+3).
    const res = trackV34PublishedSignal(sig, h1.slice(0, 104));
    expect(res.kind).toBe('RESOLVED');
    if (res.kind === 'RESOLVED') {
      expect(res.outcome.status).toBe('EXPIRED');
      expect(res.fill).toBeNull();
      expect(res.outcome.resultR).toBeNull();
      expect(res.outcome.pnlResultPct).toBeNull();
    }
  });
});
