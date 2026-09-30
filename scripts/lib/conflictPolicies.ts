/**
 * CRYPTORA — счётное ядро исследования конфликтов позиций (opposite / duplicate).
 *
 * ИССЛЕДОВАТЕЛЬСКИЙ КОД. Приложением не импортируется и на runtime не влияет:
 * им пользуются только `scripts/audit-signal-conflicts.mts` и юнит-тесты.
 *
 * ПОЧЕМУ ЗДЕСЬ ЕСТЬ TRACER, ЕСЛИ «НЕ ПИСАТЬ ВТОРУЮ МАТЕМАТИКУ»
 * -----------------------------------------------------------
 * Политики C и D контрфактические: они закрывают позицию в момент, которого в
 * замороженной `manageTrade` не существует. Сама `manageTrade` этого дать не
 * может — она возвращает только финальный результат и не сообщает, на каком
 * баре был взят TP1.
 *
 * Поэтому здесь есть `traceTrade` — построчный обход тех же правил, умеющий
 * закрыть позицию досрочно. Чтобы он не «уехал» от стратегии, есть
 * `verifyTracer`: каждая сделка прогоняется и через ядро, и через tracer, а
 * результаты сверяются (exit, grossR, netR, barsHeld, hitTp1, hitTp2). Скрипт
 * останавливается при первом расхождении, а
 * `tests/unit/signalConflictPolicies.test.ts` держит это равенство на
 * детерминированных сценариях.
 */
import type { ArchiveCandle, ArchiveDirection } from '@/services/strategyArchive/types';
import type { ReplayRecord } from '@/services/signals/live/replays/types';
import { V33_CONSTANTS, manageTrade as manageV33, legFeeR } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import { V30_CONSTANTS, manageTrade as manageV30 } from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';

const f4 = (x: number | null): string => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(4));

/* ══════════════════════════════════════════════════════════════ tracer ══ */

export type ExitReason =
  | 'SL' | 'TP2' | 'TP1_THEN_BE' | 'TP1_THEN_SL' | 'TP1_THEN_TIMEOUT' | 'TIMEOUT'
  | 'CLOSED_ON_OPPOSITE' | 'CLOSED_REMAINDER_ON_OPPOSITE' | 'OPEN_AT_WINDOW_END';

export interface TraceResult {
  exit: ExitReason;
  /** Суммарный «отмеченный» R: реализованное + переоценка открытого остатка. */
  grossR: number;
  /** Суммарный «отмеченный» net R. Для open === true это НЕ результат сделки. */
  netR: number;
  /** true — позиция не закрыта на конце окна; netR содержит MTM-компоненту. */
  open: boolean;
  /** Фактически зафиксированная часть (для открытой сделки — снятый TP1). */
  realizedGrossR: number;
  realizedNetR: number;
  /**
   * Переоценка ещё открытого остатка по close последнего бара. Комиссия выхода
   * НЕ списана: выхода не было. Для закрытых сделок — 0.
   */
  mtmR: number;
  /** Вес всё ещё открытого остатка (0 для закрытых, 0.5 после TP1, иначе 1). */
  openWeight: number;
  barsHeld: number;
  hitTp1: boolean;
  hitTp2: boolean;
  /** Индекс бара (от бара исполнения), на котором взят TP1. -1 — не взят. */
  tp1Bar: number;
  /** Индекс бара выхода от бара исполнения. */
  exitBar: number;
  exitPrice: number;
}

export interface TraceArgs {
  direction: ArchiveDirection;
  entry: number;
  stop0: number;
  tp1: number;
  tp2: number;
  bars: readonly ArchiveCandle[];
  timeoutBars: number;
  makerBps: number;
  takerBps: number;
  /** Досрочное закрытие: на этом баре (индекс от бара входа) по этой цене. */
  closeAt?: { bar: number; price: number };
  /**
   * Позицию, не закрывшуюся внутри окна, вернуть переоценённой по close
   * последнего бара вместо `null`.
   *
   * Нужно ТОЛЬКО для боевого режима. В проде часть сигналов прямо сейчас в
   * позиции; если такие сделки отбрасывать, из анализа исчезнут именно те
   * конфликты, ради которых он затевался. В датасетном режиме флаг не
   * передаётся, поэтому равенство с замороженной `manageTrade` там остаётся
   * тотальным.
   */
  allowOpen?: boolean;
}

/**
 * Построчный обход правил ведения V3.x. Условия и порядок взяты из
 * `v33Core.manageTrade` / `v30Core.manageTrade` (они идентичны с точностью до
 * TIMEOUT_BARS) и проверяются на равенство в `verifyTracer`.
 *
 * Единственное расширение — `closeAt`: закрыть остаток на заданном баре по
 * заданной цене, если к этому бару позиция ещё жива. Это и есть контрфакт
 * политик C и D.
 */
export function traceTrade(a: TraceArgs): TraceResult | null {
  const { direction, entry, stop0, tp1, tp2, bars, timeoutBars, makerBps, takerBps, closeAt, allowOpen } = a;
  const risk = Math.abs(entry - stop0);
  if (!(risk > 0) || bars.length === 0) return null;
  const long = direction === 'LONG';
  const rOf = (p: number): number => (long ? p - entry : entry - p) / risk;

  let hitTp1 = false;
  let tp1Bar = -1;
  let realised = 0;
  const legs: { price: number; weight: number; taker: boolean }[] = [{ price: entry, weight: 1, taker: false }];

  const finish = (exit: ExitReason, exitPrice: number, weight: number, i: number): TraceResult => {
    legs.push({ price: exitPrice, weight, taker: true });
    const gross = realised + weight * rOf(exitPrice);
    const fee = legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? takerBps : makerBps, risk), 0);
    return {
      exit, grossR: gross, netR: gross - fee,
      open: false, realizedGrossR: gross, realizedNetR: gross - fee, mtmR: 0, openWeight: 0,
      barsHeld: i + 1,
      hitTp1, hitTp2: exit === 'TP2', tp1Bar, exitBar: i, exitPrice,
    };
  };

  /**
   * Позиция доживает до конца окна. Выхода НЕ было, поэтому закрывающая нога не
   * добавляется и тейкерская комиссия на остаток не начисляется: списано только
   * то, что реально уплачено (вход и, если был, снятый TP1).
   */
  const finishOpen = (i: number, close: number): TraceResult => {
    const fee = legs.reduce((s, l) => s + legFeeR(l.price, l.weight, l.taker ? takerBps : makerBps, risk), 0);
    const w = hitTp1 ? 0.5 : 1;
    const mtm = w * rOf(close);
    return {
      exit: 'OPEN_AT_WINDOW_END',
      grossR: realised + mtm, netR: realised - fee + mtm,
      open: true,
      realizedGrossR: realised, realizedNetR: realised - fee, mtmR: mtm, openWeight: w,
      barsHeld: i + 1,
      hitTp1, hitTp2: false, tp1Bar, exitBar: i, exitPrice: close,
    };
  };

  for (let i = 0; i < bars.length && i < timeoutBars; i++) {
    const c = bars[i]!;

    // Контрфактическое закрытие проверяется ПЕРЕД правилами бара: новый
    // встречный сигнал исполняется по открытию своего бара, то есть раньше,
    // чем стало известно, куда этот бар сходит дальше.
    if (closeAt && i === closeAt.bar) {
      return finish(
        hitTp1 ? 'CLOSED_REMAINDER_ON_OPPOSITE' : 'CLOSED_ON_OPPOSITE',
        closeAt.price, hitTp1 ? 0.5 : 1, i,
      );
    }

    const beArmed = hitTp1 && tp1Bar >= 0 && i > tp1Bar;
    const stopNow = beArmed ? entry : stop0;
    const hitStop = long ? c.low <= stopNow : c.high >= stopNow;
    const hitT1 = !hitTp1 && (long ? c.high >= tp1 : c.low <= tp1);
    const hitT2 = long ? c.high >= tp2 : c.low <= tp2;

    if (hitStop) {
      if (!hitTp1) return finish('SL', stopNow, 1, i);
      return finish(beArmed ? 'TP1_THEN_BE' : 'TP1_THEN_SL', stopNow, 0.5, i);
    }
    if (hitT1) {
      hitTp1 = true; tp1Bar = i;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      if (hitT2) return finish('TP2', tp2, 0.5, i);
      if (i + 1 >= timeoutBars) return finish('TP1_THEN_TIMEOUT', c.close, 0.5, i);
      continue;
    }
    if (hitTp1 && hitT2) return finish('TP2', tp2, 0.5, i);
    if (!hitTp1 && hitT2) {
      hitTp1 = true;
      realised += 0.5 * rOf(tp1);
      legs.push({ price: tp1, weight: 0.5, taker: true });
      return finish('TP2', tp2, 0.5, i);
    }
    if (i + 1 >= timeoutBars) return finish(hitTp1 ? 'TP1_THEN_TIMEOUT' : 'TIMEOUT', c.close, hitTp1 ? 0.5 : 1, i);
  }
  if (allowOpen) {
    // Позиция ещё живёт. Переоценка по последнему закрытому бару — это НЕ исход
    // сделки, а отметка «здесь и сейчас»; в отчёте такие строки видны по
    // exit = OPEN_AT_WINDOW_END и не должны читаться как реализованный R.
    const lastIdx = Math.min(bars.length, timeoutBars) - 1;
    const lastBar = bars[lastIdx];
    if (!lastBar) return null;
    return finishOpen(lastIdx, lastBar.close);
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════ сделки ══ */

export interface Trade {
  id: string;
  strategyId: string;
  symbol: string;
  direction: ArchiveDirection;
  /** Публикация = закрытие бара сетапа (движок публикует с задержкой 0 баров). */
  publishedAt: number;
  setupOpenTime: number;
  fillIndex: number;       // индекс бара исполнения в h1
  fillTime: number;
  fillPrice: number;
  stop: number;
  tp1: number;
  tp2: number;
  timeoutBars: number;
  makerBps: number;
  takerBps: number;
  bars: readonly ArchiveCandle[];   // окно ведения, bars[0] = бар исполнения
  base: TraceResult;                // базовый исход (== замороженная manageTrade)
}

export const V33_ID = 'V3_3_HTF_ZONE_MITIGATION';
export const V30_ID = 'V3_0_HTF_LIQUIDATION_TRAP';

export function buildTrades(symbol: string, h1: ArchiveCandle[], records: ReplayRecord[], strategyId: string): Trade[] {
  const timeoutBars = strategyId === V33_ID ? V33_CONSTANTS.TIMEOUT_BARS : V30_CONSTANTS.TIMEOUT_BARS;
  const makerBps = strategyId === V33_ID ? V33_CONSTANTS.MAKER_BPS : V30_CONSTANTS.MAKER_BPS;
  const takerBps = strategyId === V33_ID ? V33_CONSTANTS.TAKER_BPS : V30_CONSTANTS.TAKER_BPS;
  const idx = new Map<number, number>();
  h1.forEach((c, i) => idx.set(c.openTime, i));

  const trades: Trade[] = [];
  for (const r of records) {
    if (!r.publishable || !r.fill) continue;
    const i = idx.get(r.fill.barOpenTime);
    if (i === undefined) continue;
    const bars = h1.slice(i, Math.min(h1.length, i + timeoutBars + 2));
    const tp1 = r.fill.targets[0]!, tp2 = r.fill.targets[1]!;
    const t = traceTrade({
      direction: r.direction, entry: r.fill.price, stop0: r.fill.stop,
      tp1, tp2, bars, timeoutBars, makerBps, takerBps,
    });
    if (!t) continue;   // позиция не закрылась внутри окна данных — в статистику не идёт
    trades.push({
      id: `${strategyId}|${symbol}|${r.direction}|${r.setupOpenTime}`,
      strategyId, symbol, direction: r.direction,
      publishedAt: r.setupCloseTime, setupOpenTime: r.setupOpenTime,
      fillIndex: i, fillTime: r.fill.barOpenTime, fillPrice: r.fill.price,
      stop: r.fill.stop, tp1, tp2, timeoutBars, makerBps, takerBps, bars, base: t,
    });
  }
  trades.sort((a, b) => a.publishedAt - b.publishedAt || a.fillTime - b.fillTime);
  return trades;
}

/** Сверка tracer ↔ замороженная manageTrade на КАЖДОЙ сделке. */
export function verifyTracer(trades: Trade[]): { checked: number; mismatches: string[] } {
  const mismatches: string[] = [];
  let checked = 0;
  for (const t of trades) {
    const manage = t.strategyId === V33_ID ? manageV33 : manageV30;
    const r = manage(t.direction, t.fillPrice, t.stop, t.tp1, t.tp2, t.bars);
    if (t.base.exit === 'OPEN_AT_WINDOW_END') {
      // Позиция открыта: ядро ОБЯЗАНО вернуть null. Если оно её закрыло —
      // расхождение, и оно опаснее любого другого.
      if (r) mismatches.push(`${t.id}: tracer считает позицию открытой, ядро закрыло её как ${r.exit}`);
      checked++;
      continue;
    }
    if (!r) { mismatches.push(`${t.id}: ядро вернуло null, tracer — ${t.base.exit}`); continue; }
    const fee = r.feeR(t.makerBps, t.takerBps);
    const netCore = r.grossR - fee;
    const same = r.exit === t.base.exit
      && Math.abs(r.grossR - t.base.grossR) < 1e-9
      && Math.abs(netCore - t.base.netR) < 1e-9
      && r.barsHeld === t.base.barsHeld
      && r.hitTp1 === t.base.hitTp1
      && r.hitTp2 === t.base.hitTp2;
    if (!same) {
      mismatches.push(
        `${t.id}: ядро ${r.exit}/gross ${f4(r.grossR)}/net ${f4(netCore)}/bars ${r.barsHeld}/tp1 ${r.hitTp1}`
        + ` ≠ tracer ${t.base.exit}/gross ${f4(t.base.grossR)}/net ${f4(t.base.netR)}/bars ${t.base.barsHeld}/tp1 ${t.base.hitTp1}`,
      );
    }
    checked++;
  }
  return { checked, mismatches };
}

/* ═══════════════════════════════════════════════ состояние в момент T ══ */

export type StateLabel = 'BEFORE_TP1' | 'AFTER_TP1';
export type SizeLabel = 'OPEN_FULL' | 'OPEN_REMAINDER';
export type ProtLabel = 'ORIGINAL_STOP' | 'PROTECTED_BE';

export interface StateAt {
  open: boolean;
  state: StateLabel;
  size: SizeLabel;
  protection: ProtLabel;
  realizedR: number;
  unrealizedR: number;
  nextTarget: number;
  barIndex: number;
  refClose: number;
}

/**
 * Состояние сделки на момент `atMs`, вычисленное по тем же событиям, что
 * проходит tracer. Опорная цена — close последнего ЗАКРЫТОГО бара до `atMs`.
 */
export function stateAt(t: Trade, atMs: number): StateAt | null {
  const rOf = (p: number): number => {
    const risk = Math.abs(t.fillPrice - t.stop);
    return (t.direction === 'LONG' ? p - t.fillPrice : t.fillPrice - p) / risk;
  };
  const exitTime = t.bars[t.base.exitBar]!.closeTime;
  if (atMs < t.fillTime || atMs > exitTime) return null;
  let bi = -1;
  for (let i = 0; i < t.bars.length; i++) {
    if (t.bars[i]!.closeTime <= atMs) bi = i; else break;
  }
  const refBar = bi >= 0 ? t.bars[bi]! : t.bars[0]!;
  const afterTp1 = t.base.tp1Bar >= 0 && bi >= t.base.tp1Bar;
  const beArmed = t.base.tp1Bar >= 0 && bi > t.base.tp1Bar;
  const weight = afterTp1 ? 0.5 : 1;
  return {
    open: true,
    state: afterTp1 ? 'AFTER_TP1' : 'BEFORE_TP1',
    size: afterTp1 ? 'OPEN_REMAINDER' : 'OPEN_FULL',
    protection: beArmed ? 'PROTECTED_BE' : 'ORIGINAL_STOP',
    realizedR: afterTp1 ? 0.5 * rOf(t.tp1) : 0,
    unrealizedR: weight * rOf(refBar.close),
    nextTarget: afterTp1 ? t.tp2 : t.tp1,
    barIndex: bi,
    refClose: refBar.close,
  };
}

/* ═════════════════════════════════════════════════════════════ policies ══ */

export type PolicyId = 'A_BASELINE' | 'B_BLOCK_OPPOSITE' | 'C_EXIT_ON_OPPOSITE' | 'D_EXIT_REMAINDER_AFTER_TP1' | 'E_SAME_DIRECTION_DEDUP' | 'BE_COMBINED';

export interface Applied {
  trade: Trade;
  result: TraceResult;
  truncatedBy: string | null;
}

export interface PolicyRun {
  policy: PolicyId;
  applied: Applied[];
  rejected: { id: string; reason: string; by: string }[];
  /** Для D: встречные сигналы, отклонённые из-за недостигнутого TP1. */
  deferred: { id: string; by: string; unrealizedR: number }[];
}

export const exitTimeOf = (a: Applied): number => a.trade.bars[a.result.exitBar]!.closeTime;

export function runPolicy(policy: PolicyId, all: Trade[]): PolicyRun {
  const applied: Applied[] = [];
  const rejected: PolicyRun['rejected'] = [];
  const deferred: PolicyRun['deferred'] = [];

  for (const cand of all) {
    // Открытые на момент публикации кандидата, той же пары стратегия+символ.
    const openAtPub = applied.filter(
      (a) => a.trade.strategyId === cand.strategyId && a.trade.symbol === cand.symbol
        && a.trade.fillTime <= cand.publishedAt && exitTimeOf(a) >= cand.publishedAt,
    );
    const openAtFill = applied.filter(
      (a) => a.trade.strategyId === cand.strategyId && a.trade.symbol === cand.symbol
        && a.trade.fillTime <= cand.fillTime && exitTimeOf(a) > cand.fillTime,
    );
    const oppPub = openAtPub.filter((a) => a.trade.direction !== cand.direction);
    const samePub = openAtPub.filter((a) => a.trade.direction === cand.direction);
    const oppFill = openAtFill.filter((a) => a.trade.direction !== cand.direction);

    if ((policy === 'B_BLOCK_OPPOSITE' || policy === 'BE_COMBINED') && oppPub.length > 0) {
      rejected.push({ id: cand.id, reason: 'BLOCKED_OPPOSITE_OPEN', by: oppPub[0]!.trade.id });
      continue;
    }
    if ((policy === 'E_SAME_DIRECTION_DEDUP' || policy === 'BE_COMBINED') && samePub.length > 0) {
      rejected.push({ id: cand.id, reason: 'BLOCKED_SAME_DIRECTION_OPEN', by: samePub[0]!.trade.id });
      continue;
    }

    if (policy === 'C_EXIT_ON_OPPOSITE' && oppFill.length > 0) {
      for (const a of oppFill) closeEarly(a, cand);
    }

    if (policy === 'D_EXIT_REMAINDER_AFTER_TP1' && oppFill.length > 0) {
      // TP1 первой сделки должен быть взят СТРОГО до бара исполнения встречной.
      const notReady = oppFill.filter((a) => {
        const st = stateAt(a.trade, cand.bars[0]!.openTime);
        return !st || st.state !== 'AFTER_TP1';
      });
      if (notReady.length > 0) {
        const a = notReady[0]!;
        const st = stateAt(a.trade, cand.bars[0]!.openTime);
        deferred.push({ id: cand.id, by: a.trade.id, unrealizedR: st ? st.unrealizedR : 0 });
        rejected.push({ id: cand.id, reason: 'DEFERRED_TP1_NOT_REACHED', by: a.trade.id });
        continue;
      }
      for (const a of oppFill) closeEarly(a, cand);
    }

    applied.push({ trade: cand, result: cand.base, truncatedBy: null });
  }

  /** Закрыть уже принятую сделку на баре исполнения встречной по её цене. */
  function closeEarly(a: Applied, cand: Trade): void {
    const bar = a.trade.bars.findIndex((c) => c.openTime === cand.bars[0]!.openTime);
    if (bar < 0 || bar > a.result.exitBar) return;
    const t = traceTrade({
      direction: a.trade.direction, entry: a.trade.fillPrice, stop0: a.trade.stop,
      tp1: a.trade.tp1, tp2: a.trade.tp2, bars: a.trade.bars,
      timeoutBars: a.trade.timeoutBars, makerBps: a.trade.makerBps, takerBps: a.trade.takerBps,
      closeAt: { bar, price: cand.fillPrice },
    });
    if (!t) return;
    a.result = t;
    a.truncatedBy = cand.id;
  }

  return { policy, applied, rejected, deferred };
}

/* ═══════════════════════════════════════════════════════════════ метрики ══ */

export interface Metrics {
  trades: number;
  /**
   * Σ netR по ЗАКРЫТЫМ сделкам + зафиксированные части ещё открытых. Не
   * содержит переоценки открытых остатков.
   */
  netR: number;
  grossR: number;
  /** Сделок с настоящим исходом (open === false). */
  closedTrades: number;
  /** Σ netR только по закрытым сделкам — база для avgR/expectancy/winRate. */
  closedNetR: number;
  /** Позиций, живых на конце окна. */
  openTrades: number;
  /** Уже снятые части (TP1) по ещё открытым позициям — это реализованный R. */
  openRealizedR: number;
  /** Переоценка открытых остатков. НЕ реализованный результат. */
  openMtmR: number;
  /** netR + openMtmR. Отмеченный итог портфеля. */
  totalMarkedR: number;
  avgR: number;
  expectancy: number;
  winRate: number;
  tp1: number;
  tp2: number;
  sl: number;
  tp1ThenSl: number;
  tp1ThenBe: number;
  timeout: number;
  truncated: number;
  maxConcurrent: number;
  oppositeOverlaps: number;
  sameDirDuplicates: number;
  rejected: number;
}

export interface OverlapRec {
  strategyId: string;
  symbol: string;
  first: Applied;
  second: Applied;
  from: number;
  to: number;
  hours: number;
}

export function overlapsOf(applied: Applied[], opposite: boolean): OverlapRec[] {
  const res: OverlapRec[] = [];
  const byKey = new Map<string, Applied[]>();
  for (const a of applied) {
    const k = `${a.trade.strategyId}|${a.trade.symbol}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(a);
  }
  for (const [, list] of byKey) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        const differs = a.trade.direction !== b.trade.direction;
        if (differs !== opposite) continue;
        const from = Math.max(a.trade.fillTime, b.trade.fillTime);
        const to = Math.min(exitTimeOf(a), exitTimeOf(b));
        if (to <= from) continue;
        const [first, second] = a.trade.fillTime <= b.trade.fillTime ? [a, b] : [b, a];
        res.push({
          strategyId: a.trade.strategyId, symbol: a.trade.symbol,
          first, second, from, to, hours: (to - from) / 3_600_000,
        });
      }
    }
  }
  res.sort((x, y) => x.from - y.from);
  return res;
}

export function maxConcurrent(applied: Applied[]): number {
  const ev: { t: number; d: number }[] = [];
  for (const a of applied) {
    ev.push({ t: a.trade.fillTime, d: 1 });
    ev.push({ t: exitTimeOf(a), d: -1 });
  }
  ev.sort((x, y) => x.t - y.t || x.d - y.d);
  let cur = 0, max = 0;
  for (const e of ev) { cur += e.d; if (cur > max) max = cur; }
  return max;
}

export function metricsOf(run: PolicyRun): Metrics {
  const A = run.applied;
  // Открытая позиция — не исход. Ожидание и win rate считаются только по
  // сделкам, которые действительно завершились; снятый на открытой позиции TP1
  // попадает в реализованный R портфеля, но не создаёт «ещё одну сделку».
  const closed = A.filter((a) => !a.result.open);
  const open = A.filter((a) => a.result.open);
  const closedNetR = closed.reduce((s, a) => s + a.result.netR, 0);
  const openRealizedR = open.reduce((s, a) => s + a.result.realizedNetR, 0);
  const openMtmR = open.reduce((s, a) => s + a.result.mtmR, 0);
  const netR = closedNetR + openRealizedR;
  const grossR = closed.reduce((s, a) => s + a.result.grossR, 0)
    + open.reduce((s, a) => s + a.result.realizedGrossR, 0);
  const wins = closed.filter((a) => a.result.netR > 0).length;
  return {
    trades: A.length,
    netR, grossR,
    closedTrades: closed.length,
    closedNetR,
    openTrades: open.length,
    openRealizedR,
    openMtmR,
    totalMarkedR: netR + openMtmR,
    avgR: closed.length ? closedNetR / closed.length : 0,
    expectancy: closed.length ? closedNetR / closed.length : 0,
    winRate: closed.length ? wins / closed.length : 0,
    tp1: A.filter((a) => a.result.hitTp1).length,
    tp2: A.filter((a) => a.result.exit === 'TP2').length,
    sl: A.filter((a) => a.result.exit === 'SL').length,
    tp1ThenSl: A.filter((a) => a.result.exit === 'TP1_THEN_SL').length,
    tp1ThenBe: A.filter((a) => a.result.exit === 'TP1_THEN_BE').length,
    timeout: A.filter((a) => a.result.exit === 'TIMEOUT' || a.result.exit === 'TP1_THEN_TIMEOUT').length,
    truncated: A.filter((a) => a.truncatedBy !== null).length,
    maxConcurrent: maxConcurrent(A),
    oppositeOverlaps: overlapsOf(A, true).length,
    sameDirDuplicates: overlapsOf(A, false).length,
    rejected: run.rejected.length,
  };
}


/* ══════════════════════════════════════════ вход из боевого дампа ══ */

export interface ProdSignal {
  id: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  direction: ArchiveDirection;
  signalCandleTs: string;
  createdAt: string | null;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  targets: number[];
  status: string;
  fillPrice: number | null;
  filledAt: string | null;
}

export interface ProdDump {
  generatedAt: string;
  signals: ProdSignal[];
  /** Ключ «SYMBOL|timeframe», значение — закрытые свечи по возрастанию openTime. */
  candles: Record<string, ArchiveCandle[]>;
}

/**
 * Боевые строки → те же `Trade`, что строит датасетный режим.
 *
 * Отличие от датасета ровно одно: момент публикации берётся из настоящего
 * `created_at`, а не из закрытия бара сетапа. В проде между закрытием бара и
 * публикацией проходит 15-75 секунд, и для вопроса «в каком состоянии была
 * первая сделка, когда появился встречный сигнал» важна именно публикация.
 */
export function buildTradesFromDump(dump: ProdDump): { trades: Trade[]; skipped: string[] } {
  const trades: Trade[] = [];
  const skipped: string[] = [];
  for (const s of dump.signals) {
    if (s.fillPrice == null || !s.filledAt) { skipped.push(`${s.id}: нет исполнения`); continue; }
    if (s.stopLoss == null || s.targets.length < 2) { skipped.push(`${s.id}: нет стопа или целей`); continue; }
    const series = dump.candles[`${s.symbol}|${s.timeframe}`];
    if (!series || series.length === 0) { skipped.push(`${s.id}: нет свечей ${s.symbol} ${s.timeframe}`); continue; }
    const fillTime = new Date(s.filledAt).getTime();
    // filled_at в проде — openTime бара исполнения, но полагаться на побайтовое
    // совпадение нельзя: достаточно одной миграции с округлением, чтобы сделка
    // молча исчезла из анализа. Поэтому берётся бар, в интервал которого
    // попадает отметка, и только если такого нет — пропуск с причиной.
    let i = series.findIndex((c) => c.openTime === fillTime);
    if (i < 0) i = series.findIndex((c) => fillTime >= c.openTime && fillTime <= c.closeTime);
    if (i < 0) { skipped.push(`${s.id}: бар исполнения ${s.filledAt} вне окна свечей`); continue; }

    const isV33 = s.strategyId === V33_ID;
    const timeoutBars = isV33 ? V33_CONSTANTS.TIMEOUT_BARS : V30_CONSTANTS.TIMEOUT_BARS;
    const makerBps = isV33 ? V33_CONSTANTS.MAKER_BPS : V30_CONSTANTS.MAKER_BPS;
    const takerBps = isV33 ? V33_CONSTANTS.TAKER_BPS : V30_CONSTANTS.TAKER_BPS;
    const bars = series.slice(i, Math.min(series.length, i + timeoutBars + 2));
    const base = traceTrade({
      direction: s.direction, entry: s.fillPrice, stop0: s.stopLoss,
      tp1: s.targets[0]!, tp2: s.targets[1]!, bars, timeoutBars, makerBps, takerBps,
      allowOpen: true,
    });
    if (!base) { skipped.push(`${s.id}: не удалось восстановить ведение (пустое окно свечей)`); continue; }
    trades.push({
      id: s.id, strategyId: s.strategyId, symbol: s.symbol, direction: s.direction,
      publishedAt: s.createdAt ? new Date(s.createdAt).getTime() : new Date(s.signalCandleTs).getTime(),
      setupOpenTime: new Date(s.signalCandleTs).getTime(),
      fillIndex: i, fillTime, fillPrice: s.fillPrice, stop: s.stopLoss,
      tp1: s.targets[0]!, tp2: s.targets[1]!, timeoutBars, makerBps, takerBps, bars, base,
    });
  }
  trades.sort((a, b) => a.publishedAt - b.publishedAt || a.fillTime - b.fillTime);
  return { trades, skipped };
}

/* ═══════════════════════════════ однонаправленный стек (ОТДЕЛЬНО) ══ */

export interface StackCluster {
  strategyId: string;
  symbol: string;
  direction: ArchiveDirection;
  /** Максимум одновременно открытых позиций ОДНОГО направления. */
  maxDepth: number;
  from: number;
  to: number;
  ids: string[];
}

/**
 * Однонаправленное наслоение позиций — это не то же самое, что встречный
 * конфликт, и считается отдельно: здесь нет противоположных экспозиций, есть
 * кратное увеличение размера ставки на одну идею.
 *
 * Пары (как в overlapsOf) для этого не годятся: три одновременных SHORT дают
 * три пары и выглядят как три независимых события, хотя риск в этот момент
 * утроен один раз. Поэтому считается ГЛУБИНА стека.
 */
export function stackClusters(applied: Applied[], minDepth = 2): StackCluster[] {
  const byKey = new Map<string, Applied[]>();
  for (const a of applied) {
    const k = `${a.trade.strategyId}|${a.trade.symbol}|${a.trade.direction}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(a);
  }
  const res: StackCluster[] = [];
  for (const [k, list] of byKey) {
    const [strategyId, symbol, direction] = k.split('|') as [string, string, ArchiveDirection];
    const ev: { t: number; d: number; a: Applied }[] = [];
    for (const a of list) {
      ev.push({ t: a.trade.fillTime, d: 1, a });
      ev.push({ t: exitTimeOf(a), d: -1, a });
    }
    ev.sort((x, y) => x.t - y.t || x.d - y.d);
    let depth = 0;
    let cluster: { from: number; maxDepth: number; ids: Set<string> } | null = null;
    for (const e of ev) {
      depth += e.d;
      if (e.d === 1 && depth >= minDepth) {
        if (!cluster) cluster = { from: e.t, maxDepth: depth, ids: new Set() };
        cluster.maxDepth = Math.max(cluster.maxDepth, depth);
        for (const a of list) {
          if (a.trade.fillTime <= e.t && exitTimeOf(a) >= e.t) cluster.ids.add(a.trade.id);
        }
      }
      if (cluster && depth < minDepth) {
        res.push({ strategyId, symbol, direction, maxDepth: cluster.maxDepth, from: cluster.from, to: e.t, ids: [...cluster.ids] });
        cluster = null;
      }
    }
    if (cluster) {
      res.push({ strategyId, symbol, direction, maxDepth: cluster.maxDepth, from: cluster.from, to: ev[ev.length - 1]!.t, ids: [...cluster.ids] });
    }
  }
  res.sort((a, b) => b.maxDepth - a.maxDepth || a.from - b.from);
  return res;
}
