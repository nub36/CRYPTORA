/**
 * LIVE-реплеи стратегий = архивные раннеры на произвольном окне закрытых свечей.
 *
 * Контракт: на одном и том же окне LIVE-реплей V3.0 / V3.3 обязан выдать те же
 * сделки (бар сетапа, бар исполнения, цена, причина выхода, gross R), что и
 * замороженный исследовательский раннер. Иначе «сигналы» в продукте — не та
 * стратегия, что описана в архиве.
 *
 * Дополнительно проверяется устойчивость к скользящему окну (~1000 баров, как у
 * LIVE-провайдера): сетап последнего закрытого бара не зависит от того, сколько
 * истории слева от него уже отброшено.
 */
import { describe, it, expect } from 'vitest';
import fixture from '../strategyArchive/fixtures/v30-synthetic-parity.json';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { runV30Series } from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Runner';
import { runV33Series } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Runner';
import { runV30LiveReplay, V30_STRATEGY_ID } from '@/services/signals/live/replays/v30LiveReplay';
import { runV33LiveReplay, V33_STRATEGY_ID } from '@/services/signals/live/replays/v33LiveReplay';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import type { ReplayOutput } from '@/services/signals/live/replays/types';

const H = 3_600_000;
type Row = [number, number, number, number, number, number];

function toCandles(rows: Row[], spanMs: number): ArchiveCandle[] {
  return rows.map(([openTime, open, high, low, close, volume]) => ({
    openTime, open, high, low, close, volume, closeTime: openTime + spanMs - 1, isClosed: true,
  }));
}

const h1 = toCandles(fixture.candles1h as Row[], H);
const h4 = toCandles(fixture.candles4h as Row[], 4 * H);
const first = h1[0]!.openTime;
const last = h1[h1.length - 1]!.openTime;
const fullSplit = {
  symbol: 'SYNTH', timeframe: '1h' as const,
  trainFromMs: first, trainToMs: last,
  validFromMs: last + H, validToMs: last + 2 * H,
  testFromMs: last + 3 * H, testToMs: last + 4 * H,
};

function closedTrades(out: ReplayOutput) {
  return out.records.filter((r) => r.fill && r.outcome && r.outcome.status !== 'CANCELLED' && r.outcome.status !== 'EXPIRED');
}

/** 4h-серия, доступная LIVE-провайдеру на момент закрытия последнего 1h-бара окна. */
function h4VisibleAt(lastCloseTime: number, limit: number): ArchiveCandle[] {
  return h4.filter((c) => c.closeTime <= lastCloseTime).slice(-limit);
}

describe('V3.0 LIVE replay ≡ archived runner', () => {
  const live = runV30LiveReplay({ symbol: 'SYNTH', h1, h4 });
  const research = runV30Series({ symbol: 'SYNTH', bySeries: { '1h': h1, '4h': h4 }, split: fullSplit }, 'train');

  it('reproduces every research trade bar-for-bar (setup, fill, entry, exit, gross/net R)', () => {
    const trades = closedTrades(live);
    expect(research.trades.length).toBeGreaterThan(20);
    expect(trades.length).toBe(research.trades.length);
    research.trades.forEach((b, k) => {
      const a = trades[k]!;
      expect(a.strategyId).toBe(V30_STRATEGY_ID);
      expect(a.direction).toBe(b.direction);
      expect(a.setupOpenTime).toBe(b.setupOpenTime);
      expect(a.fill!.barOpenTime).toBe(b.fillOpenTime);
      expect(a.fill!.price).toBeCloseTo(b.entry, 10);
      expect(a.stop).toBeCloseTo(b.stop, 10);
      expect(a.outcome!.exitReason).toBe(b.exitReason);
      expect(a.outcome!.grossR).toBeCloseTo(b.grossR, 4);
      expect(a.outcome!.netR).toBeCloseTo(b.grossR - b.feeRHeadline, 4);
    });
  });

  it('keeps the research funnel: pending count and no-trade branches match', () => {
    expect(live.records.length).toBe(research.funnel.pendingCreated);
    const cancelled = live.records.filter((r) => r.outcome?.status === 'CANCELLED' && r.outcome.exitReason === 'CANCELLED').length;
    const rejected = live.records.filter((r) => r.outcome?.exitReason === 'REJECTED_GEOMETRY').length;
    expect(cancelled).toBe(research.funnel.cancelled);
    expect(rejected).toBe(research.funnel.rejected);
  });

  it('never publishes a pending the runner would reject at fill (geometry gate is evaluated on the setup bar)', () => {
    const publishedButRejected = live.records.filter((r) => r.publishable && r.outcome?.exitReason === 'REJECTED_GEOMETRY');
    expect(publishedButRejected).toEqual([]);
    expect(live.records.every((r) => r.entryType === 'LIMIT_CORRIDOR' && r.entryZone[0] < r.entryZone[1])).toBe(true);
  });

  it('is invariant to the sliding 1000-bar window: last-bar setups equal the full-history run', () => {
    // Окна, заканчивающиеся на баре сетапа полного прогона (+ контрольные окна без сетапа).
    const setupEnds = live.records.map((r) => h1.findIndex((c) => c.openTime === r.setupOpenTime) + 1).filter((end) => end >= 1000);
    const controlEnds = [1000, 1777, 2500, 3333, 4444, 5555, h1.length];
    expect(setupEnds.length).toBeGreaterThan(20);
    let compared = 0;
    for (const end of [...setupEnds, ...controlEnds]) {
      const w1 = h1.slice(end - 1000, end);
      const lastBar = w1[w1.length - 1]!;
      const win = runV30LiveReplay({ symbol: 'SYNTH', h1: w1, h4: h4VisibleAt(lastBar.closeTime, 1000) });
      const a = win.records.filter((r) => r.setupOpenTime === lastBar.openTime);
      const b = live.records.filter((r) => r.setupOpenTime === lastBar.openTime);
      expect(a.length).toBe(b.length);
      if (a.length) {
        expect(a[0]!.direction).toBe(b[0]!.direction);
        expect(a[0]!.entryZone).toEqual(b[0]!.entryZone);
        expect(a[0]!.stop).toBe(b[0]!.stop);
        expect(a[0]!.targets).toEqual(b[0]!.targets);
        expect(a[0]!.publishable).toBe(b[0]!.publishable);
        compared++;
      }
    }
    expect(compared).toBe(setupEnds.length);
  });

  it('reports insufficient history honestly instead of guessing', () => {
    const out = runV30LiveReplay({ symbol: 'SYNTH', h1: h1.slice(0, 40), h4: h4.slice(0, 10) });
    expect(out.records).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/недостаточно/);
  });
});

describe('V3.3 LIVE replay ≡ archived runner', () => {
  const live = runV33LiveReplay({ symbol: 'SYNTH', h1, h4 });
  const research = runV33Series({ symbol: 'SYNTH', bySeries: { '1h': h1, '4h': h4 }, split: fullSplit }, 'train');

  it('reproduces every research trade bar-for-bar', () => {
    const trades = closedTrades(live);
    expect(research.trades.length).toBeGreaterThan(10);
    expect(trades.length).toBe(research.trades.length);
    research.trades.forEach((b, k) => {
      const a = trades[k]!;
      expect(a.strategyId).toBe(V33_STRATEGY_ID);
      expect(a.direction).toBe(b.direction);
      expect(a.setupOpenTime).toBe(b.setupOpenTime);
      expect(a.fill!.barOpenTime).toBe(b.fillOpenTime);
      expect(a.fill!.price).toBeCloseTo(b.entry, 10);
      expect(a.outcome!.exitReason).toBe(b.exitReason);
      expect(a.outcome!.grossR).toBeCloseTo(b.grossR, 4);
    });
  });

  it('matches the research funnel and hides geometry-rejected pendings from publication', () => {
    expect(live.records.length).toBe(research.funnel.pendingCreated);
    const rejected = live.records.filter((r) => r.outcome?.exitReason === 'REJECTED_GEOMETRY').length;
    expect(rejected).toBe(research.funnel.rejected);
    expect(live.records.filter((r) => r.publishable && r.outcome?.exitReason === 'REJECTED_GEOMETRY')).toEqual([]);
    // Большинство «pending» V3.3 отклоняются геометрией (TP1 позади коридора) — как в исследовании (~51%).
    expect(live.records.filter((r) => !r.publishable).length).toBeGreaterThan(0);
  });

  it('sliding 1000-bar window: last-bar setups equal the full run whenever the zone is born inside the window; older zones are skipped, never invented', () => {
    const WINDOW = 1000;
    const publishable = live.records.filter((r) => r.publishable);
    const setupEnds = publishable.map((r) => h1.findIndex((c) => c.openTime === r.setupOpenTime) + 1).filter((end) => end >= WINDOW);
    const controlEnds = [WINDOW, 1777, 2500, 3333, 4444, 5555, h1.length];
    expect(setupEnds.length).toBeGreaterThan(5);
    let compared = 0;
    let skippedOldZones = 0;
    for (const end of [...setupEnds, ...controlEnds]) {
      const w1 = h1.slice(end - WINDOW, end);
      const lastBar = w1[w1.length - 1]!;
      const win = runV33LiveReplay({ symbol: 'SYNTH', h1: w1, h4: h4VisibleAt(lastBar.closeTime, 1000) });
      const a = win.records.filter((r) => r.setupOpenTime === lastBar.openTime && r.publishable);
      const b = publishable.filter((r) => r.setupOpenTime === lastBar.openTime);
      // Окно никогда не выдумывает сетап, которого нет в полной истории.
      expect(a.length).toBeLessThanOrEqual(b.length);
      if (b.length && !a.length) {
        // Единственная допустимая причина пропуска: зона начала отслеживаться до прогрева окна
        // (первый пригодный 1H-бар зоны < старт окна + 60) — эффект «старта среза», как в исследовании.
        const firstTracked = Number(b[0]!.meta!.zoneFirstTrackedOpenTime);
        expect(firstTracked).toBeLessThan(w1[V33_CONSTANTS.WARMUP_BARS]!.openTime);
        skippedOldZones++;
        continue;
      }
      if (a.length) {
        expect(a[0]!.direction).toBe(b[0]!.direction);
        expect(a[0]!.entryZone).toEqual(b[0]!.entryZone);
        expect(a[0]!.stop).toBe(b[0]!.stop);
        expect(a[0]!.targets).toEqual(b[0]!.targets);
        expect(a[0]!.meta!.zoneKnownAt4hOpenTime).toBe(b[0]!.meta!.zoneKnownAt4hOpenTime);
        compared++;
      }
    }
    expect(compared + skippedOldZones).toBe(setupEnds.length);
    expect(compared).toBeGreaterThan(skippedOldZones);
  });
});
