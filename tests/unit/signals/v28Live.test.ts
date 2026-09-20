/**
 * V2.8 LIVE-обёртка (`runV28Live`) ≡ архивный sniper-цикл (`runSniperEntryLoop` +
 * `simulateTrailing`, как в `runV28Series` для arm=Trail).
 *
 * На синтетическом 1h-ряде (детерминированный LCG, без Math.random) обе реализации
 * должны выдать одинаковые sniper-сделки: бар сетапа, бар входа, цена входа,
 * стоп, причина и gross R выхода Trail. Дополнительно проверяется, что
 * состояние последнего бара (AWAITING_NEXT_OPEN) появляется ровно тогда, когда
 * полный прогон на удлинённом окне действительно исполняет вход на N+1.
 */
import { describe, it, expect } from 'vitest';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { runSniperEntryLoop } from '@/services/strategyArchive/legacy/v2/sniperEntryLoop';
import { simulateTrailing } from '@/services/strategyArchive/definitions/v2_8-zero-fee-sniper-trailing/v28Core';
import { FROZEN_ENGINE } from '@/services/strategyArchive/shared/frozenSettings';
import {
  runV28Live, v28EntryAtNextOpen, v28TrailOutcome, V28_LIVE_HTF,
} from '@/services/strategyArchive';
import { runV28LiveReplay, V28_STRATEGY_ID } from '@/services/signals/live/replays/v28LiveReplay';

const H = 3_600_000;
const T0 = Date.UTC(2024, 0, 1);

/** Детерминированный генератор (LCG) — тот же принцип, что фикстура паритета V3.0. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function synthetic1h(n: number, seed: number): ArchiveCandle[] {
  const rnd = lcg(seed);
  const out: ArchiveCandle[] = [];
  let price = 100;
  let regime = 1;
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) regime = rnd() < 0.5 ? -1 : 1;
    const drift = regime * 0.0006;
    const shock = rnd() < 0.06 ? (rnd() - 0.5) * 0.04 : 0;           // редкие импульсы → свипы
    const ret = drift + (rnd() - 0.5) * 0.012 + shock;
    const open = price;
    const close = Math.max(1, open * (1 + ret));
    const wickUp = Math.abs(rnd()) * 0.006 * open;
    const wickDn = Math.abs(rnd()) * 0.006 * open;
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(0.5, Math.min(open, close) - wickDn);
    const volume = 800 + rnd() * 600 + (shock !== 0 ? 1500 : 0);
    out.push({ openTime: T0 + i * H, closeTime: T0 + (i + 1) * H - 1, open, high, low, close, volume, isClosed: true });
    price = close;
  }
  return out;
}

function aggregate(c: readonly ArchiveCandle[], n: number): ArchiveCandle[] {
  const out: ArchiveCandle[] = [];
  for (let i = 0; i + n <= c.length; i += n) {
    const w = c.slice(i, i + n);
    out.push({
      openTime: w[0]!.openTime, closeTime: w[n - 1]!.closeTime,
      open: w[0]!.open, close: w[n - 1]!.close,
      high: Math.max(...w.map((x) => x.high)), low: Math.min(...w.map((x) => x.low)),
      volume: w.reduce((s, x) => s + x.volume, 0), isClosed: true,
    });
  }
  return out;
}

interface ResearchTrade { setupOpenTime: number; entryCandleTime: number; entryPrice: number; stop: number; reason: string; grossR: number; barsHeld: number }

/** Точно то, что делает `runV28Series` для arm=Trail, но без привязки к `splitFor`. */
function researchTrail(symbol: string, h1: ArchiveCandle[], htf: { '4h': ArchiveCandle[]; '1d': ArchiveCandle[] }): { trades: ResearchTrade[]; sniperEntries: number; actionable: number } {
  const trades: ResearchTrade[] = [];
  const timeoutBars = FROZEN_ENGINE.outcomeTimeoutBars;
  const stats = runSniperEntryLoop({
    symbol, timeframe: '1h', candles: h1, htf, fromMs: h1[0]!.openTime, toMs: h1[h1.length - 1]!.openTime,
    onSniperResolved: ({ open, closed }) => {
      const bars = closed.slice(open.entryIndex, Math.min(closed.length, open.entryIndex + timeoutBars + 64));
      const tr = simulateTrailing({ direction: open.direction, entryPrice: open.entryPrice, stopLoss: open.stop, bars });
      if (!tr) return;
      trades.push({ setupOpenTime: open.setupCandleTime, entryCandleTime: open.entryCandleTime, entryPrice: open.entryPrice, stop: open.stop, reason: tr.reason, grossR: tr.grossR, barsHeld: tr.barsHeld });
    },
  });
  return { trades, sniperEntries: stats.sniperEntries, actionable: stats.actionable };
}

const SEEDS = [7, 1234, 98765];
let tradesSeen = 0;

describe('V2.8 LIVE wrapper ≡ archived sniper loop + Trail', () => {
  it('uses 4h and 1d as HTF context for 1h (frozen HTF_MAP)', () => {
    expect([...V28_LIVE_HTF]).toEqual(['4h', '1d']);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: sniper trades match bar-for-bar`, () => {
      const h1 = synthetic1h(2600, seed);
      const htf = { '4h': aggregate(h1, 4), '1d': aggregate(h1, 24) };
      const research = researchTrail('SYNTH', h1, htf);
      const live = runV28Live({ symbol: 'SYNTH', candles: h1, htf });

      // Sniper-сделки, чей Trail-выход известен, — те же, что у исследовательского цикла.
      const liveClosed = live.events.filter((e) => e.status === 'CLOSED' && e.frozenSlotResolved);
      expect(research.actionable).toBeGreaterThan(0);
      expect(liveClosed.length).toBe(research.trades.length);
      tradesSeen += research.trades.length;
      research.trades.forEach((b, k) => {
        const a = liveClosed[k]!;
        expect(a.setupOpenTime).toBe(b.setupOpenTime);
        expect(a.fill!.barOpenTime).toBe(b.entryCandleTime);
        expect(a.fill!.price).toBeCloseTo(b.entryPrice, 10);
        expect(a.fill!.stop).toBeCloseTo(b.stop, 10);
        expect(a.trail!.reason).toBe(b.reason);
        expect(a.trail!.grossR).toBeCloseTo(b.grossR, 6);
        expect(a.trail!.barsHeld).toBe(b.barsHeld);
        // net R ≤ gross R всегда (комиссии 2/5 bps поверх нулевых комиссий источника)
        expect(a.trail!.netR).toBeLessThan(a.trail!.grossR);
      });
      // Счётчик sniper-входов = число событий с исполнением (OPEN + CLOSED, включая ещё не освобождённые слоты).
      const liveFilled = live.events.filter((e) => e.fill !== null).length;
      expect(liveFilled).toBe(research.sniperEntries);
      // actionable = валидные входы (sniper + non-sniper) → в обёртке это fill-события + nonSniperSetups
      expect(liveFilled + live.nonSniperSetups).toBeGreaterThanOrEqual(research.sniperEntries);
    });
  }

  it('the synthetic series actually produced sniper trades to compare (guard against a vacuous test)', () => {
    expect(tradesSeen).toBeGreaterThan(0);
  });

  it('AWAITING_NEXT_OPEN on the last bar is exactly the setup the full run fills on N+1', () => {
    const h1 = synthetic1h(2600, 1234);
    const htf = { '4h': aggregate(h1, 4), '1d': aggregate(h1, 24) };
    const full = runV28Live({ symbol: 'SYNTH', candles: h1, htf });
    const filledSetups = full.events.filter((e) => e.fill !== null);
    expect(filledSetups.length).toBeGreaterThan(0);

    for (const ev of filledSetups.slice(0, 6)) {
      const cut = h1.findIndex((c) => c.openTime === ev.setupOpenTime) + 1;
      const win = h1.slice(0, cut);
      const partial = runV28Live({
        symbol: 'SYNTH', candles: win,
        htf: { '4h': htf['4h'].filter((c) => c.closeTime <= win[win.length - 1]!.closeTime), '1d': htf['1d'].filter((c) => c.closeTime <= win[win.length - 1]!.closeTime) },
      });
      const lastEv = partial.events[partial.events.length - 1];
      expect(lastEv?.status).toBe('AWAITING_NEXT_OPEN');
      expect(lastEv?.setupOpenTime).toBe(ev.setupOpenTime);
      expect(lastEv?.direction).toBe(ev.direction);
      expect(lastEv?.plannedEntry).toBe(ev.plannedEntry);
      expect(lastEv?.plannedStop).toBe(ev.plannedStop);

      // Публикуемый план + бар N+1 → то же исполнение, что в полном прогоне.
      const res = v28EntryAtNextOpen({
        direction: lastEv!.direction, setupOpenTime: lastEv!.setupOpenTime,
        plannedEntry: lastEv!.plannedEntry, plannedStop: lastEv!.plannedStop, plannedTargets: lastEv!.plannedTargets,
      }, h1[cut]);
      expect(res.kind).toBe('FILLED');
      if (res.kind === 'FILLED') {
        expect(res.entryPrice).toBeCloseTo(ev.fill!.price, 10);
        expect(res.stop).toBeCloseTo(ev.fill!.stop, 10);
        if (ev.trail) {
          const t = v28TrailOutcome(ev.direction, res.entryPrice, res.stop, h1.slice(cut));
          expect(t?.reason).toBe(ev.trail.reason);
          expect(t?.grossR).toBeCloseTo(ev.trail.grossR, 6);
        }
      }
    }
  });

  it('refuses entry when bar N+1 is not contiguous (data gap) and reports AWAITING without N+1', () => {
    const plan = { direction: 'LONG' as const, setupOpenTime: T0, plannedEntry: 100, plannedStop: 99, plannedTargets: [102, 103] };
    expect(v28EntryAtNextOpen(plan, undefined)).toEqual({ kind: 'AWAITING' });
    const gapBar: ArchiveCandle = { openTime: T0 + 2 * H, closeTime: T0 + 3 * H - 1, open: 100.5, high: 101, low: 100, close: 100.8, volume: 1, isClosed: true };
    expect(v28EntryAtNextOpen(plan, gapBar)).toEqual({ kind: 'NO_ENTRY', reason: 'NO_CONTIGUOUS_NEXT_BAR' });
  });

  it('LIVE replay adapter carries the GROSS-only warning and MARKET_NEXT_OPEN semantics', () => {
    const h1 = synthetic1h(2600, 7);
    const out = runV28LiveReplay({ symbol: 'SYNTH', h1, htf: { '4h': aggregate(h1, 4), '1d': aggregate(h1, 24) } });
    expect(out.evaluatedBars).toBeGreaterThan(2000);
    for (const r of out.records) {
      expect(r.strategyId).toBe(V28_STRATEGY_ID);
      expect(r.entryType).toBe('MARKET_NEXT_OPEN');
      expect(r.validForBars).toBe(1);
      expect(r.invalidationFactors.join(' ')).toMatch(/GROSS/);
      if (r.outcome && r.fill) {
        expect(r.outcome.netR).not.toBeNull();
        expect(r.outcome.netR!).toBeLessThan(r.outcome.grossR!);
      }
    }
  });
});
