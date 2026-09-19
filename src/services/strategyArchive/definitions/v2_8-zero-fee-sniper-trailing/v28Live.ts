/**
 * V2.8 — LIVE-обёртка над АРХИВНЫМ исследовательским циклом (без изменения правил).
 *
 * Зачем отдельный файл. Архивный `runV28Series` привязан к замороженным
 * TRAIN/VALIDATION-срезам (`splitFor`) и отчитывается только о РАЗРЕШЁННЫХ
 * слотах — для live-журнала нужны ещё «сетап найден, ждёт входа по open N+1»
 * и «позиция открыта, ещё не закрыта». Эта обёртка повторяет цикл
 * `legacy/v2/sniperEntryLoop.ts` бар за баром на произвольном окне ЗАКРЫТЫХ
 * свечей и отдаёт состояние каждого сетапа как оно известно на конец окна.
 *
 * Что взято из архива без изменений (порядок гейтов = sniperEntryLoop):
 *   • `evaluateV2` (замороженный движок V2 @4839074) на окне `lookback + 60`
 *     видимых баров с HTF-сериями 4h/1d, каузально обрезанными по closeTime бара;
 *   • вход = OPEN бара N+1 (`resolveEntry`), стоп/цели сдвигаются на дельту
 *     исполнения, лестница целей `executableLadder`, валидность:
 *     risk > 0, ≥ 1 исполнимая цель, rr1 ≥ risk.min_rr, стоп с нужной стороны;
 *   • sniper = REVERSAL ∧ `baseSniper(setup, extremePoolKind(...)).ok`;
 *   • ОДИН слот позиции, освобождаемый только замороженным `trackOutcome`
 *     (TP/SL/TIMEOUT 48 баров) — независимо от измеряемого выхода;
 *   • выход кандидата Trail = `simulateTrailing` (V2.5: BE при MFE ≥ 1R,
 *     трейлинг 1R с шагом 0.25R, таймаут 10 баров без +1R) — как в v28Runner.
 *
 * Отличия от исследовательского прогона — только в ОКНЕ данных: research шёл по
 * многолетним срезам, live видит последние ~1000 закрытых баров. Первые
 * `minBars` баров окна служат прогревом (как в источнике), поэтому сетапы в
 * начале окна не оцениваются.
 *
 * Все цифры V2.8 — GROSS (нулевые комиссии). Обёртка дополнительно считает
 * net R по модели 2/5 bps, чтобы live-журнал не выдавал gross за net.
 *
 * Файл живёт внутри `strategyArchive/`, потому что только архивные модули
 * вправе импортировать `legacy/v2` (tests/unit/strategyArchive/legacyV2.test.ts).
 * CRYPTORA не исполняет сделки.
 */

import type { ArchiveCandle, ArchiveDirection, ArchiveTimeframe } from '../../types';
import { FROZEN_ENGINE } from '../../shared/frozenSettings';
import { evaluateV2 } from '../../legacy/v2/engine';
import { HTF_MAP } from '../../legacy/v2/htf';
import { trackOutcome } from '../../legacy/v2/tracker';
import { resolveEntry } from '../../legacy/v2/stateMachine';
import { executableLadder } from '../../legacy/v2/v2Runner';
import { Settings } from '../../legacy/v2/legacySettings';
import { baseSniper } from '../../legacy/v2/v24Engine';
import { extremePoolKind, type PoolKind } from '../../legacy/v2/corridorEntry';
import { toLegacyCandles, WINDOW_MARGIN } from '../../legacy/v2/sniperEntryLoop';
import type { Candle, Timeframe } from '../../legacy/v2/coreTypes';
import { TF_MS } from '../../legacy/v2/coreTypes';
import type { V2Setup } from '../../legacy/v2/types';
import { simulateTrailing } from './v28Core';

export const V28_LIVE_TIMEFRAME: ArchiveTimeframe = '1h';
/** HTF-серии, которые замороженный движок ожидает для 1h (HTF_MAP['1h']). */
export const V28_LIVE_HTF: readonly ArchiveTimeframe[] = HTF_MAP['1h'] as readonly ArchiveTimeframe[];
/** Модель комиссий для net-оценки рядом с gross (2 bps maker вход, 5 bps taker выход). */
export const V28_LIVE_NET_FEES = Object.freeze({ makerBps: 2, takerBps: 5 });
/** Вид пула ликвидности у снятого экстремума (диагностика архивного фильтра). */
export type V28PoolKind = PoolKind;

export type V28LiveStatus =
  /** Сетап на баре N найден, бар N+1 ещё не открылся (вход по его OPEN). */
  | 'AWAITING_NEXT_OPEN'
  /** Вход исполнен по OPEN N+1, позиция ещё открыта по правилам Trail. */
  | 'OPEN'
  /** Trail завершил позицию (TRAIL / BE / SL / TIMEOUT). */
  | 'CLOSED'
  /** Бар N+1 существует, но не примыкает к N (пропуск в данных) — входа не было. */
  | 'NO_ENTRY';

export interface V28LiveEvent {
  status: V28LiveStatus;
  direction: ArchiveDirection;
  setupOpenTime: number;
  setupCloseTime: number;
  setupClose: number;
  /** Уровни, как их выдал замороженный движок на баре N (до сдвига на дельту исполнения). */
  plannedEntry: number;
  plannedStop: number;
  plannedTargets: number[];
  /** Причины движка V2 (человеческий язык, как в источнике). */
  engineReasons: string[];
  sweepLevel: number | null;
  poolKind: V28PoolKind;
  /** Исполнение по OPEN N+1 (null, пока N+1 не открылся). */
  fill: { barOpenTime: number; price: number; stop: number; targets: number[]; rr1: number } | null;
  /** Исход Trail-кандидата (null, пока позиция открыта). */
  trail: {
    reason: 'TRAIL' | 'BE' | 'SL' | 'TIMEOUT';
    exitPrice: number;
    barsHeld: number;
    grossR: number;
    netR: number;
    exitBarOpenTime: number;
  } | null;
  /** Замороженный трекер уже освободил слот (для отладки честности цикла). */
  frozenSlotResolved: boolean;
}

export interface V28LiveOutput {
  events: V28LiveEvent[];
  evaluatedBars: number;
  firstEvaluatedOpenTime: number | null;
  lastEvaluatedOpenTime: number | null;
  /** Сколько actionable-сетапов движка НЕ прошли sniper-фильтр (не публикуются). */
  nonSniperSetups: number;
  minBars: number;
}

export interface V28LiveArgs {
  /** Базовый актив без котировки (BTC). Движок V2 использует символ только как метку. */
  symbol: string;
  /** Закрытые 1h-свечи по возрастанию openTime. Незакрытые отбрасываются. */
  candles: readonly ArchiveCandle[];
  /** HTF-серии: 4h и 1d (закрытые). Отсутствие серии = движок работает без неё, как в источнике. */
  htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>>;
}

function htfUpperBound(c: readonly Candle[], asOf: number, span: number): number {
  let lo = 0, hi = c.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]!.openTime + span <= asOf) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

/** Net R по модели maker вход / taker выход (аналогично `feeR` из v25Trailing, без изменения архива). */
export function v28NetR(grossR: number, entryPrice: number, exitPrice: number, risk: number): number {
  if (!(risk > 0)) return grossR;
  const fee = ((V28_LIVE_NET_FEES.makerBps / 10000) * entryPrice + (V28_LIVE_NET_FEES.takerBps / 10000) * Math.abs(exitPrice)) / risk;
  return grossR - fee;
}

interface OpenSlot {
  entryIndex: number; entryPrice: number; stop: number; tps: number[];
  entryCandleTime: number; direction: ArchiveDirection; sniper: boolean; setupCandleTime: number;
  eventIndex: number | null;
}

/**
 * Прогон архивного sniper-цикла по окну закрытых свечей. Детерминирован: одно
 * и то же окно → один и тот же список событий.
 */
export function runV28Live(args: V28LiveArgs): V28LiveOutput {
  const settings = Settings.fromFrozenSnapshot();
  const minRr = settings.num('risk.min_rr');
  const swing = Math.floor(settings.num('engine.swing_lookback'));
  const lookback = Math.floor(settings.num('engine.lookback_candles'));
  const minBars = Math.max(80, swing * 6 + 40);
  const winLen = lookback + WINDOW_MARGIN;
  const tf = V28_LIVE_TIMEFRAME as Timeframe;
  const tfMs = TF_MS[tf];
  const timeoutBars = FROZEN_ENGINE.outcomeTimeoutBars;

  const closed = toLegacyCandles(args.candles.filter((c) => c.isClosed));
  const htf: Partial<Record<Timeframe, readonly Candle[]>> = {};
  const htfSpans = new Map<Timeframe, number>();
  for (const h of HTF_MAP[tf] ?? []) {
    const s = args.htf[h as ArchiveTimeframe];
    if (s && s.length > 0) htf[h] = toLegacyCandles(s.filter((c) => c.isClosed));
    htfSpans.set(h, TF_MS[h]);
  }

  const out: V28LiveOutput = {
    events: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, nonSniperSetups: 0, minBars,
  };
  let open: OpenSlot | null = null;

  for (let i = minBars; i < closed.length; i++) {
    const candle = closed[i]!;
    out.evaluatedBars++;
    if (out.firstEvaluatedOpenTime === null) out.firstEvaluatedOpenTime = candle.openTime;
    out.lastEvaluatedOpenTime = candle.openTime;

    if (open) {
      const slice = closed.slice(open.entryIndex, i + 1);
      const res = trackOutcome({
        direction: open.direction, entryPrice: open.entryPrice,
        stopLoss: open.stop, takeProfits: open.tps,
        entryCandleTime: open.entryCandleTime, candles: slice, settings, qty: 0,
      });
      if (res) {
        if (open.eventIndex !== null) out.events[open.eventIndex]!.frozenSlotResolved = true;
        open = null;
      }
    }

    if (open === null) {
      const start = Math.max(0, i - winLen + 1);
      const visible = closed.slice(start, i + 1);
      let htfArg: Partial<Record<Timeframe, readonly Candle[]>> | undefined;
      if (Object.keys(htf).length > 0) {
        const bounded: Partial<Record<Timeframe, readonly Candle[]>> = {};
        const asOf = candle.closeTime;
        for (const [h, span] of htfSpans) {
          const hc = htf[h]; if (!hc || hc.length === 0) continue;
          const ub = htfUpperBound(hc, asOf, span);
          if (ub < 0) continue;
          bounded[h] = hc.slice(Math.max(0, ub - 200 + 1), ub + 1);
        }
        htfArg = bounded;
      }
      const s: V2Setup | null = evaluateV2({ symbol: args.symbol, timeframe: tf, candles: visible, settings, htfCandles: htfArg });
      if (s !== null && s.direction !== 'WAIT' && s.stop !== null && s.entry !== null && s.targets.length > 0) {
        const next = closed[i + 1];
        const isLastBar = i === closed.length - 1;
        // Sniper-гейт оценивается ДО исполнения (зависит только от бара N), поэтому его
        // можно вычислить и для последнего бара окна, когда N+1 ещё не открылся.
        let sniper = false;
        let poolKind: PoolKind = 'NONE';
        if (s.kind === 'REVERSAL') {
          poolKind = extremePoolKind(s, visible, settings);
          sniper = baseSniper(s, poolKind).ok;
        }
        const plannedStop = s.stop.price;
        const plannedTargets = s.targets.map((t) => t.price);
        const plannedLadder = executableLadder(s.direction, s.entry, plannedStop, plannedTargets);
        const plannedValid = plannedLadder.risk > 0 && plannedLadder.targets.length > 0 && plannedLadder.rr1 >= minRr
          && (s.direction === 'LONG' ? plannedStop < s.entry : plannedStop > s.entry);

        if (isLastBar) {
          // Бар N+1 ещё не открылся: публикуем ожидание входа по open N+1 (только sniper и только
          // если план валиден по геометрии бара N — окончательная проверка повторится на N+1).
          if (sniper && plannedValid) {
            out.events.push({
              status: 'AWAITING_NEXT_OPEN', direction: s.direction,
              setupOpenTime: candle.openTime, setupCloseTime: candle.closeTime, setupClose: candle.close,
              plannedEntry: s.entry, plannedStop, plannedTargets: plannedLadder.targets,
              engineReasons: [...s.reasons], sweepLevel: s.sweep?.level ?? null, poolKind,
              fill: null, trail: null, frozenSlotResolved: false,
            });
          } else if (plannedValid) {
            out.nonSniperSetups++;
          }
          break;
        }

        const ent = resolveEntry(candle.openTime, tfMs, next);
        if (!ent) {
          if (sniper && plannedValid) {
            out.events.push({
              status: 'NO_ENTRY', direction: s.direction,
              setupOpenTime: candle.openTime, setupCloseTime: candle.closeTime, setupClose: candle.close,
              plannedEntry: s.entry, plannedStop, plannedTargets: plannedLadder.targets,
              engineReasons: [...s.reasons], sweepLevel: s.sweep?.level ?? null, poolKind,
              fill: null, trail: null, frozenSlotResolved: false,
            });
          }
          continue;
        }
        const shift = ent.entryPrice - s.entry;
        const stopPrice = s.stop.price + shift;
        const tps = s.targets.map((t) => t.price + shift);
        const lad = executableLadder(s.direction, ent.entryPrice, stopPrice, tps);
        const risk = Math.abs(ent.entryPrice - stopPrice);
        const valid = risk > 0 && lad.targets.length > 0 && lad.rr1 >= minRr
          && (s.direction === 'LONG' ? stopPrice < ent.entryPrice : stopPrice > ent.entryPrice);
        if (valid) {
          let eventIndex: number | null = null;
          if (sniper) {
            const trailBars = closed.slice(i + 1, Math.min(closed.length, i + 1 + timeoutBars + 64));
            const tr = simulateTrailing({ direction: s.direction, entryPrice: ent.entryPrice, stopLoss: stopPrice, bars: trailBars });
            const ev: V28LiveEvent = {
              status: tr ? 'CLOSED' : 'OPEN', direction: s.direction,
              setupOpenTime: candle.openTime, setupCloseTime: candle.closeTime, setupClose: candle.close,
              plannedEntry: s.entry, plannedStop: s.stop.price, plannedTargets: plannedLadder.targets,
              engineReasons: [...s.reasons], sweepLevel: s.sweep?.level ?? null, poolKind,
              fill: { barOpenTime: ent.entryCandleTime, price: ent.entryPrice, stop: stopPrice, targets: lad.targets, rr1: lad.rr1 },
              trail: tr ? {
                reason: tr.reason, exitPrice: tr.exitPrice, barsHeld: tr.barsHeld, grossR: tr.grossR,
                netR: v28NetR(tr.grossR, ent.entryPrice, tr.exitPrice, risk),
                exitBarOpenTime: trailBars[tr.barsHeld - 1]!.openTime,
              } : null,
              frozenSlotResolved: false,
            };
            eventIndex = out.events.push(ev) - 1;
          } else {
            out.nonSniperSetups++;
          }
          open = {
            entryIndex: i + 1, entryPrice: ent.entryPrice, stop: stopPrice, tps: lad.targets,
            entryCandleTime: ent.entryCandleTime, direction: s.direction, sniper, setupCandleTime: candle.openTime,
            eventIndex,
          };
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Жизненный цикл ОПУБЛИКОВАННОГО сетапа (те же frozen-функции)         */
/* ------------------------------------------------------------------ */

export interface V28NextOpenPlan {
  direction: ArchiveDirection;
  setupOpenTime: number;
  /** Уровни бара N, как были опубликованы (entry = close N по движку). */
  plannedEntry: number;
  plannedStop: number;
  plannedTargets: readonly number[];
}

export type V28NextOpenResult =
  | { kind: 'AWAITING' }
  | { kind: 'NO_ENTRY'; reason: 'NO_CONTIGUOUS_NEXT_BAR' | 'LADDER_INVALID_AT_FILL' }
  | { kind: 'FILLED'; entryCandleTime: number; entryPrice: number; stop: number; targets: number[]; rr1: number; risk: number };

/**
 * Исполнение опубликованного V2.8-плана по OPEN бара N+1 — ровно те проверки, что
 * делает архивный цикл после `resolveEntry`: сдвиг стопа/целей на дельту исполнения,
 * `executableLadder`, risk > 0, ≥ 1 цель, rr1 ≥ risk.min_rr, стоп с нужной стороны.
 */
export function v28EntryAtNextOpen(plan: V28NextOpenPlan, next: ArchiveCandle | undefined): V28NextOpenResult {
  if (!next) return { kind: 'AWAITING' };
  const settings = Settings.fromFrozenSnapshot();
  const minRr = settings.num('risk.min_rr');
  const ent = resolveEntry(plan.setupOpenTime, TF_MS[V28_LIVE_TIMEFRAME as Timeframe], next);
  if (!ent) return { kind: 'NO_ENTRY', reason: 'NO_CONTIGUOUS_NEXT_BAR' };
  const shift = ent.entryPrice - plan.plannedEntry;
  const stopPrice = plan.plannedStop + shift;
  const tps = plan.plannedTargets.map((t) => t + shift);
  const lad = executableLadder(plan.direction, ent.entryPrice, stopPrice, tps);
  const risk = Math.abs(ent.entryPrice - stopPrice);
  const valid = risk > 0 && lad.targets.length > 0 && lad.rr1 >= minRr
    && (plan.direction === 'LONG' ? stopPrice < ent.entryPrice : stopPrice > ent.entryPrice);
  if (!valid) return { kind: 'NO_ENTRY', reason: 'LADDER_INVALID_AT_FILL' };
  return { kind: 'FILLED', entryCandleTime: ent.entryCandleTime, entryPrice: ent.entryPrice, stop: stopPrice, targets: lad.targets, rr1: lad.rr1, risk };
}

export interface V28TrailOutcome {
  reason: 'TRAIL' | 'BE' | 'SL' | 'TIMEOUT';
  exitPrice: number;
  barsHeld: number;
  grossR: number;
  netR: number;
}

/**
 * Выход кандидата Trail для исполненной позиции: `simulateTrailing` (V2.5, frozen) на
 * закрытых барах начиная с бара исполнения (как v28Runner: timeout + 64 баров максимум).
 * null — позиция ещё открыта.
 */
export function v28TrailOutcome(
  direction: ArchiveDirection, entryPrice: number, stop: number, barsFromEntry: readonly ArchiveCandle[],
): V28TrailOutcome | null {
  const bars = barsFromEntry.slice(0, FROZEN_ENGINE.outcomeTimeoutBars + 64);
  const tr = simulateTrailing({ direction, entryPrice, stopLoss: stop, bars });
  if (!tr) return null;
  const risk = Math.abs(entryPrice - stop);
  return { reason: tr.reason, exitPrice: tr.exitPrice, barsHeld: tr.barsHeld, grossR: tr.grossR, netR: v28NetR(tr.grossR, entryPrice, tr.exitPrice, risk) };
}
