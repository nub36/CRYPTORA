/**
 * V3.4 — ведение ОПУБЛИКОВАННОГО сигнала по закрытым 1H-свечам.
 *
 * ПОРТ ИЗ CRYPTORA, БЕЗ ИЗМЕНЕНИЯ ПРАВИЛ
 * --------------------------------------
 * Источник: `src/services/signals/live/lifecycle.ts` (функция `trackCorridor`,
 * ветки V3.0/V3.3/V3.4). В изолированный продукт перенесена ТОЛЬКО ветка
 * V3.4/V3.3, вызовы функций — те же самые frozen-функции архива:
 *
 *   • `corridorStep`  — `v30Core.ts` (та же функция, которой реплей ловит
 *     исполнение коридора: N+1…N+3, худшая граница, отмена/истечение/
 *     отклонение геометрии);
 *   • `manageTrade`   — `v33Core.ts` (стоп раньше целей, TP1 → BE со следующего
 *     бара, таймаут 48 баров, комиссии 2/5 bps);
 *   • `inspectTrade`  — тот же степпер `v33Core.ts`, экспорт прогресса
 *     открытой позиции (TP1 забронирован / armed-стоп действовал).
 *
 * Вторая реализация правил здесь НЕ создаётся: любая копия расходится с
 * определением. Совпадение с исходной реализацией проверяется
 * `test/parity.lifecycle.test.ts` на одинаковых обезличенных данных.
 *
 * Исход считается по уровням ПУБЛИКАЦИИ (те, что ушли в БД), а не по повторному
 * прогону стратегии: сигнал нельзя «переиграть» задним числом.
 *
 * ⚠️ Только сигналы. Ордера не выставляются.
 */
import type { ArchiveCandle } from '../strategy/types';
import { corridorStep } from '../strategy/v30Core';
import { inspectTrade, manageTrade, V33_CONSTANTS } from '../strategy/v33Core';
import { managedExitPrice, managedStatus, round } from './replayShared';

/** Строка, минимально необходимая для ведения сигнала (как AnalyticalSetup). */
export interface PublishedSignal {
  strategyId: string;
  direction: 'LONG' | 'SHORT';
  /** openTime закрытого бара, на котором сформирован сетап (ms). */
  setupOpenTime: number;
  entryType: 'LIMIT_CORRIDOR' | 'MARKET_NEXT_OPEN';
  entryZone: [number, number];
  /** Первоначальный стоп (публикуется и не меняется). */
  invalidationLevel: number;
  /** TP1, TP2 (лестница целей публикации). */
  targets: number[];
}

export interface SignalFill {
  price: number;
  /** ISO-время открытия бара исполнения. */
  at: string;
  barOpenTime: number;
  stop: number;
  targets: number[];
}

export interface SignalOutcome {
  status: 'TARGET_REACHED' | 'INVALIDATED' | 'CLOSED' | 'EXPIRED' | 'CANCELLED' | 'UNRESOLVED';
  closedAt: string;
  exitReason: string;
  exitPrice: number | null;
  resultR: number | null;
  netResultR: number | null;
  pnlResultPct: number | null;
  barsHeld: number | null;
}

export interface LifecycleProgress {
  tp1Booked: boolean;
  tp1At: number | null;
  beArmed: boolean;
  beArmedAt: number | null;
}

export type LifecycleResult =
  /** Ничего нового по закрытым свечам. */
  | { kind: 'UNCHANGED' }
  /** Бар сетапа не найден в окне (пропуск данных) — скан пропускается. */
  | { kind: 'SKIP'; reason: string }
  /** Исполнение известно, позиция ещё открыта. */
  | { kind: 'FILLED'; fill: SignalFill; progress?: LifecycleProgress }
  /** Финальный исход (с исполнением или без). */
  | { kind: 'RESOLVED'; fill: SignalFill | null; outcome: SignalOutcome };

export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

export function pnlPct(direction: 'LONG' | 'SHORT', entry: number, exit: number): number {
  if (!(entry > 0)) return 0;
  const raw = direction === 'LONG' ? (exit - entry) / entry : (entry - exit) / entry;
  return round(raw * 100, 4);
}

export function noTrade(status: 'EXPIRED' | 'CANCELLED' | 'UNRESOLVED', at: number, reason: string): SignalOutcome {
  return {
    status, closedAt: isoOf(at), exitReason: reason, exitPrice: null,
    resultR: null, netResultR: null, pnlResultPct: null, barsHeld: null,
  };
}

/**
 * Ведение опубликованного V3.4-сигнала. Тело — из
 * `lifecycle.ts: trackCorridor` (vетка `isV33`), вызовы — те же frozen-функции.
 */
export function trackV34PublishedSignal(entry: PublishedSignal, h1: readonly ArchiveCandle[]): LifecycleResult {
  if (h1.length === 0) return { kind: 'SKIP', reason: 'нет закрытых свечей' };
  const first = h1[0]!;
  const last = h1[h1.length - 1]!;
  if (entry.setupOpenTime < first.openTime) {
    return { kind: 'RESOLVED', fill: null, outcome: noTrade('UNRESOLVED', last.closeTime, 'OUT_OF_DATA_WINDOW') };
  }
  let setupIndex = -1;
  for (let i = h1.length - 1; i >= 0; i--) {
    if (h1[i]!.openTime === entry.setupOpenTime) { setupIndex = i; break; }
    if (h1[i]!.openTime < entry.setupOpenTime) break;
  }
  if (setupIndex < 0) return { kind: 'SKIP', reason: 'бар сетапа отсутствует в окне данных' };
  if (setupIndex === h1.length - 1) return { kind: 'UNCHANGED' };

  if (entry.entryType !== 'LIMIT_CORRIDOR') {
    return { kind: 'SKIP', reason: `V3.4 использует только LIMIT_CORRIDOR, получено ${entry.entryType}` };
  }

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
  const timeoutBars = V33_CONSTANTS.TIMEOUT_BARS;
  const makerBps = V33_CONSTANTS.MAKER_BPS;
  const takerBps = V33_CONSTANTS.TAKER_BPS;

  for (let j = setupIndex + 1; j < h1.length; j++) {
    const c = h1[j]!;
    const step = corridorStep(pending, c, j);
    if (step.kind === 'WAIT') continue;
    if (step.kind === 'CANCELLED') return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', c.closeTime, 'CANCELLED') };
    if (step.kind === 'EXPIRED') return { kind: 'RESOLVED', fill: null, outcome: noTrade('EXPIRED', c.closeTime, 'EXPIRED') };
    if (step.kind === 'REJECTED_GEOMETRY') {
      return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', c.closeTime, 'REJECTED_GEOMETRY') };
    }

    const fill: SignalFill = {
      price: step.fill, at: isoOf(c.openTime), barOpenTime: c.openTime,
      stop: pending.stop, targets: [tp1, tp2],
    };
    const bars = h1.slice(j, Math.min(h1.length, j + timeoutBars + 2));
    const r = manageTrade(pending.dir, step.fill, pending.stop, tp1, tp2, bars);
    if (!r) {
      const prog = inspectTrade(pending.dir, step.fill, pending.stop, tp1, tp2, bars);
      return { kind: 'FILLED', fill, ...(prog ? { progress: prog } : {}) };
    }
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
