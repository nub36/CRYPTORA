/**
 * Общие помощники LIVE-реплеев: перевод результата `manageTrade` (V3.0 / V3.3 —
 * одинаковая семантика выходов) в исход записи и форматирование чисел для
 * человекочитаемых факторов.
 */
import type { ArchiveCandle, ArchiveDirection } from '@/services/strategyArchive/types';
import type { ReplayFinalStatus, ReplayOutcome } from './types';

export type ManagedExit = 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT';

export interface ManagedTradeLike {
  exit: ManagedExit;
  grossR: number;
  feeR: (makerBps: number, takerBps: number) => number;
  barsHeld: number;
}

/** Цена последней ноги выхода по правилам V3.x (manageTrade не возвращает её явно). */
export function managedExitPrice(
  exit: ManagedExit, entry: number, stop0: number, tp2: number, lastBar: ArchiveCandle | undefined,
): number | null {
  switch (exit) {
    case 'SL': return stop0;
    case 'TP2': return tp2;
    case 'TP1_THEN_BE': return entry;
    case 'TP1_THEN_SL': return stop0;
    case 'TIMEOUT':
    case 'TP1_THEN_TIMEOUT':
      return lastBar ? lastBar.close : null;
    default: return null;
  }
}

export function managedStatus(exit: ManagedExit): ReplayFinalStatus {
  if (exit === 'SL') return 'INVALIDATED';
  if (exit === 'TP2') return 'TARGET_REACHED';
  return 'CLOSED';
}

export function outcomeFromManagedTrade(args: {
  r: ManagedTradeLike;
  bars: readonly ArchiveCandle[];
  entry: number;
  stop0: number;
  tp2: number;
  makerBps: number;
  takerBps: number;
}): ReplayOutcome {
  const { r, bars, entry, stop0, tp2, makerBps, takerBps } = args;
  const lastBar = bars[Math.min(bars.length, r.barsHeld) - 1];
  const fee = r.feeR(makerBps, takerBps);
  return {
    status: managedStatus(r.exit),
    barOpenTime: lastBar ? lastBar.openTime : bars[bars.length - 1]!.openTime,
    exitReason: r.exit,
    exitPrice: managedExitPrice(r.exit, entry, stop0, tp2, lastBar),
    grossR: round(r.grossR, 4),
    netR: round(r.grossR - fee, 4),
    barsHeld: r.barsHeld,
  };
}

export function round(x: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(x * m) / m;
}

/** Форматирование цены с разумной точностью для текста факторов. */
export function fmtPx(p: number): string {
  if (!Number.isFinite(p)) return '—';
  const abs = Math.abs(p);
  const digits = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return p.toFixed(digits);
}

/** Направленное R:R от центра входа до финальной цели. */
export function rrFrom(direction: ArchiveDirection, entry: number, stop: number, target: number): number {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return 0;
  const reward = direction === 'LONG' ? target - entry : entry - target;
  return round(reward / risk, 2);
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(0)} %`;
}

/**
 * Геометрия лимитного коридора при худшем исполнении (LONG → верхняя граница,
 * SHORT → нижняя). Те же условия, что `corridorStep` проверяет на баре исполнения.
 */
export function corridorGeometryOk(
  direction: ArchiveDirection, zoneLow: number, zoneHigh: number, stop: number, tp1: number, tp2: number,
): boolean {
  const long = direction === 'LONG';
  const fill = long ? zoneHigh : zoneLow;
  const risk = Math.abs(fill - stop);
  return risk > 0
    && (long ? stop < fill : stop > fill)
    && (long ? tp1 > fill && tp2 > tp1 : tp1 < fill && tp2 < tp1);
}
