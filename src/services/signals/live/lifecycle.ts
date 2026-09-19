/**
 * Жизненный цикл ОПУБЛИКОВАННОГО сетапа — чистая функция от неизменяемой
 * публикации и закрытых свечей после бара сетапа.
 *
 * Принцип: исход считается по тем уровням, которые были опубликованы (и
 * захэшированы), а не по повторному прогону стратегии. Используются те же
 * замороженные функции архива, что и в исследовании:
 *
 *   • V3.0 / V3.3 (LIMIT_CORRIDOR): `corridorStep` (N+1…N+3: исполнение по худшей
 *     границе, отмена при касании стопа, отклонение геометрии, истечение) →
 *     `manageTrade` соответствующей версии (стоп раньше целей, TP1 → BE со
 *     следующего бара, таймаут 50 / 48 баров);
 *   • V2.8 (MARKET_NEXT_OPEN): `v28EntryAtNextOpen` (open N+1, сдвиг стопа/целей,
 *     `executableLadder`, rr1 ≥ min_rr) → `v28TrailOutcome` (Trail V2.5).
 *
 * Детерминировано: одинаковые публикация + свечи → одинаковый результат, поэтому
 * функцию можно вызывать на каждом скане без состояния.
 */
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { corridorStep, manageTrade as manageTradeV30, V30_CONSTANTS } from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import { manageTrade as manageTradeV33, V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import { v28EntryAtNextOpen, v28TrailOutcome } from '@/services/strategyArchive';
import type { AnalyticalSetup, SetupFill, SetupOutcome } from '@/services/signals/SignalsAuditLedger';
import { V30_STRATEGY_ID } from './replays/v30LiveReplay';
import { V33_STRATEGY_ID } from './replays/v33LiveReplay';
import { V28_STRATEGY_ID } from './replays/v28LiveReplay';
import { managedExitPrice, managedStatus, round } from './replays/shared';

export type LifecycleResult =
  /** Ничего нового по закрытым свечам. */
  | { kind: 'UNCHANGED' }
  /** Бар сетапа не найден в окне, хотя окно его должно покрывать (пропуск данных) — пропустить скан. */
  | { kind: 'SKIP'; reason: string }
  /** Исполнение известно, позиция ещё открыта. */
  | { kind: 'FILLED'; fill: SetupFill }
  /** Финальный исход (с исполнением или без). */
  | { kind: 'RESOLVED'; fill: SetupFill | null; outcome: SetupOutcome };

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

function pnlPct(direction: 'LONG' | 'SHORT', entry: number, exit: number): number {
  if (!(entry > 0)) return 0;
  const raw = direction === 'LONG' ? (exit - entry) / entry : (entry - exit) / entry;
  return round(raw * 100, 4);
}

function noTrade(status: 'EXPIRED' | 'CANCELLED' | 'UNRESOLVED', at: number, reason: string): SetupOutcome {
  return { status, closedAt: isoOf(at), exitReason: reason, exitPrice: null, resultR: null, netResultR: null, pnlResultPct: null, barsHeld: null };
}

export function trackPublishedSetup(entry: AnalyticalSetup, h1: readonly ArchiveCandle[]): LifecycleResult {
  if (h1.length === 0) return { kind: 'SKIP', reason: 'нет закрытых свечей' };
  const first = h1[0]!;
  const last = h1[h1.length - 1]!;
  if (entry.setupOpenTime < first.openTime) {
    return {
      kind: 'RESOLVED', fill: null,
      outcome: noTrade('UNRESOLVED', last.closeTime, 'OUT_OF_DATA_WINDOW'),
    };
  }
  let setupIndex = -1;
  for (let i = h1.length - 1; i >= 0; i--) {
    if (h1[i]!.openTime === entry.setupOpenTime) { setupIndex = i; break; }
    if (h1[i]!.openTime < entry.setupOpenTime) break;
  }
  if (setupIndex < 0) return { kind: 'SKIP', reason: 'бар сетапа отсутствует в окне данных' };
  if (setupIndex === h1.length - 1) return { kind: 'UNCHANGED' };

  if (entry.entryType === 'MARKET_NEXT_OPEN') return trackNextOpen(entry, h1, setupIndex);
  return trackCorridor(entry, h1, setupIndex);
}

function trackCorridor(entry: AnalyticalSetup, h1: readonly ArchiveCandle[], setupIndex: number): LifecycleResult {
  const isV33 = entry.strategyId === V33_STRATEGY_ID;
  const isV30 = entry.strategyId === V30_STRATEGY_ID;
  if (!isV30 && !isV33) return { kind: 'SKIP', reason: `неизвестная стратегия коридора ${entry.strategyId}` };
  const tp1 = entry.targets[0];
  const tp2 = entry.targets[1] ?? entry.targets[0];
  if (tp1 === undefined || tp2 === undefined) return { kind: 'SKIP', reason: 'у публикации нет целей' };

  const pending = {
    dir: entry.direction,
    zoneLow: entry.entryZone[0],
    zoneHigh: entry.entryZone[1],
    stop: entry.invalidationLevel,
    tp1, tp2,
    setupIndex,
  };
  const timeoutBars = isV33 ? V33_CONSTANTS.TIMEOUT_BARS : V30_CONSTANTS.TIMEOUT_BARS;
  const makerBps = isV33 ? V33_CONSTANTS.MAKER_BPS : V30_CONSTANTS.MAKER_BPS;
  const takerBps = isV33 ? V33_CONSTANTS.TAKER_BPS : V30_CONSTANTS.TAKER_BPS;
  const manage = isV33 ? manageTradeV33 : manageTradeV30;

  for (let j = setupIndex + 1; j < h1.length; j++) {
    const c = h1[j]!;
    const step = corridorStep(pending, c, j);
    if (step.kind === 'WAIT') continue;
    if (step.kind === 'CANCELLED') return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', c.closeTime, 'CANCELLED') };
    if (step.kind === 'EXPIRED') return { kind: 'RESOLVED', fill: null, outcome: noTrade('EXPIRED', c.closeTime, 'EXPIRED') };
    if (step.kind === 'REJECTED_GEOMETRY') return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', c.closeTime, 'REJECTED_GEOMETRY') };

    const fill: SetupFill = { price: step.fill, at: isoOf(c.openTime), barOpenTime: c.openTime, stop: pending.stop, targets: [tp1, tp2] };
    const bars = h1.slice(j, Math.min(h1.length, j + timeoutBars + 2));
    const r = manage(pending.dir, step.fill, pending.stop, tp1, tp2, bars);
    if (!r) return { kind: 'FILLED', fill };
    const lastBar = bars[Math.min(bars.length, r.barsHeld) - 1]!;
    const exitPrice = managedExitPrice(r.exit, step.fill, pending.stop, tp2, lastBar);
    const fee = r.feeR(makerBps, takerBps);
    return {
      kind: 'RESOLVED', fill,
      outcome: {
        status: managedStatus(r.exit),
        closedAt: isoOf(lastBar.closeTime),
        exitReason: r.exit,
        exitPrice,
        resultR: round(r.grossR, 4),
        netResultR: round(r.grossR - fee, 4),
        pnlResultPct: exitPrice !== null ? pnlPct(pending.dir, step.fill, exitPrice) : null,
        barsHeld: r.barsHeld,
      },
    };
  }
  return { kind: 'UNCHANGED' };
}

function trackNextOpen(entry: AnalyticalSetup, h1: readonly ArchiveCandle[], setupIndex: number): LifecycleResult {
  if (entry.strategyId !== V28_STRATEGY_ID) return { kind: 'SKIP', reason: `неизвестная стратегия входа по open ${entry.strategyId}` };
  const next = h1[setupIndex + 1];
  const res = v28EntryAtNextOpen({
    direction: entry.direction,
    setupOpenTime: entry.setupOpenTime,
    plannedEntry: entry.entryZone[0],
    plannedStop: entry.invalidationLevel,
    plannedTargets: entry.targets,
  }, next);
  if (res.kind === 'AWAITING') return { kind: 'UNCHANGED' };
  if (res.kind === 'NO_ENTRY') {
    return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', next!.closeTime, res.reason) };
  }
  const fill: SetupFill = { price: res.entryPrice, at: isoOf(res.entryCandleTime), barOpenTime: res.entryCandleTime, stop: res.stop, targets: res.targets };
  const barsFromEntry = h1.slice(setupIndex + 1);
  const t = v28TrailOutcome(entry.direction, res.entryPrice, res.stop, barsFromEntry);
  if (!t) return { kind: 'FILLED', fill };
  const exitBar = barsFromEntry[t.barsHeld - 1]!;
  return {
    kind: 'RESOLVED', fill,
    outcome: {
      status: t.reason === 'SL' ? 'INVALIDATED' : 'CLOSED',
      closedAt: isoOf(exitBar.closeTime),
      exitReason: t.reason,
      exitPrice: t.exitPrice,
      resultR: round(t.grossR, 4),
      netResultR: round(t.netR, 4),
      pnlResultPct: pnlPct(entry.direction, res.entryPrice, t.exitPrice),
      barsHeld: t.barsHeld,
    },
  };
}
