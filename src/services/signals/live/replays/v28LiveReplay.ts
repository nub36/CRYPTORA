/**
 * V2.8 — Zero-fee Sniper + Trailing — LIVE-реплей через архивную обёртку
 * `runV28Live` (замороженный движок V2 @4839074 + sniper-фильтр + Trail-выход).
 *
 * Здесь только перевод событий обёртки в общий формат `ReplayRecord`:
 *   • AWAITING_NEXT_OPEN → запись без исполнения (вход по OPEN следующего бара);
 *   • OPEN               → исполнение известно, позиция ещё ведётся Trail;
 *   • CLOSED             → исход Trail (TRAIL / BE / SL / TIMEOUT), gross и net R;
 *   • NO_ENTRY           → пропуск в данных (N+1 не примыкает) — сделки не было.
 *
 * Важно для читателя: все исследовательские цифры V2.8 — GROSS (нулевые
 * комиссии); при модели 2/5 bps стратегия в источнике net-отрицательна. Это
 * повторяется в факторах риска каждой записи.
 */
import type { ArchiveCandle, ArchiveTimeframe } from '@/services/strategyArchive/types';
import { runV28Live, type V28LiveEvent } from '@/services/strategyArchive';
import type { ReplayOutput, ReplayRecord } from './types';
import { fmtPx, round, rrFrom } from './shared';

export const V28_STRATEGY_ID = 'V2_8_ZERO_FEE_SNIPER_TRAILING';
export const V28_STRATEGY_VERSION = '2.8';

export const V28_EXIT_RULE_RU =
  'Вход по OPEN бара N+1 (рыночный, без коридора). Выход — кандидат Trail (V2.5): безубыток при MFE ≥ 1R, '
  + 'трейлинг-стоп в 1R от пика MFE с шагом 0.25R, без фиксированных целей; таймаут 10 баров, если +1R не достигнут. '
  + 'Стоп структурный: за тенью свипа + 0.25 ATR (frozen). Один слот позиции на инструмент.';

export interface V28ReplayArgs {
  symbol: string;
  h1: readonly ArchiveCandle[];
  htf: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>>;
}

function toRecord(symbol: string, ev: V28LiveEvent): ReplayRecord {
  const long = ev.direction === 'LONG';
  const entryRef = ev.fill ? ev.fill.price : ev.plannedEntry;
  const stopRef = ev.fill ? ev.fill.stop : ev.plannedStop;
  const targetsRef = ev.fill ? ev.fill.targets : ev.plannedTargets;
  const finalTarget = targetsRef[targetsRef.length - 1] ?? entryRef;

  const record: ReplayRecord = {
    strategyId: V28_STRATEGY_ID,
    strategyVersion: V28_STRATEGY_VERSION,
    symbol,
    direction: ev.direction,
    setupOpenTime: ev.setupOpenTime,
    setupCloseTime: ev.setupCloseTime,
    setupClose: ev.setupClose,
    entryType: 'MARKET_NEXT_OPEN',
    // Вход = OPEN следующего бара; до его открытия ориентир — закрытие бара N (движок публикует его как entry).
    entryZone: [entryRef, entryRef],
    stop: stopRef,
    targets: targetsRef,
    riskRewardRatio: rrFrom(ev.direction, entryRef, stopRef, finalTarget),
    validForBars: 1,
    exitRule: V28_EXIT_RULE_RU,
    confirmingFactors: [
      ...ev.engineReasons.map((r) => `Движок V2 (frozen 4839074): ${r}`),
      `Sniper-фильтр пройден: REVERSAL после свипа ${ev.sweepLevel !== null ? `уровня ${fmtPx(ev.sweepLevel)} ` : ''}(пул ликвидности: ${ev.poolKind}); реклейм ≤ 3 бара, penetration ≥ 0.10 ATR, тень ≥ 0.25, тело ≥ 0.35, RVOL > 1.2.`,
      `План на баре N: вход ${fmtPx(ev.plannedEntry)} (ориентир — close), стоп ${fmtPx(ev.plannedStop)}, цели ${ev.plannedTargets.map(fmtPx).join(' / ')} (лестница frozen-движка — ориентир для SMC-выхода; кандидат Trail целей не использует).`,
      ...(ev.fill
        ? [`Исполнение по OPEN бара N+1 (${new Date(ev.fill.barOpenTime).toISOString().slice(0, 16).replace('T', ' ')} UTC): ${fmtPx(ev.fill.price)}; стоп сдвинут на дельту исполнения → ${fmtPx(ev.fill.stop)}; RR до первой цели ${round(ev.fill.rr1, 2)}.`]
        : ['Ожидается открытие бара N+1: вход по его OPEN, стоп и цели сдвинутся на дельту исполнения.']),
    ],
    invalidationFactors: [
      `${long ? 'Закрытие/касание ниже' : 'Закрытие/касание выше'} стопа ${fmtPx(stopRef)} — выход по SL.`,
      'Таймаут Trail: 10 баров без достижения +1R → выход по close.',
      'ВСЕ исследовательские цифры V2.8 — GROSS (нулевые комиссии). При модели 2/5 bps стратегия в источнике net-отрицательна; удаление одной лучшей сделки меняет знак результата на VALIDATION.',
      'В источнике V2.8 вытеснена V3.0 (SUPERSEDED). Прошлое не гарантирует будущего.',
    ],
    fill: ev.fill ? { barOpenTime: ev.fill.barOpenTime, price: ev.fill.price, stop: ev.fill.stop, targets: ev.fill.targets } : null,
    outcome: null,
    // Обёртка публикует AWAITING только для sniper-сетапов с валидной лестницей на баре N.
    publishable: true,
    publishNote: null,
  };

  if (ev.status === 'NO_ENTRY') {
    record.outcome = {
      status: 'CANCELLED', barOpenTime: ev.setupOpenTime, exitReason: 'NO_CONTIGUOUS_NEXT_BAR',
      exitPrice: null, grossR: null, netR: null, barsHeld: null,
    };
  } else if (ev.status === 'CLOSED' && ev.trail) {
    const t = ev.trail;
    record.outcome = {
      status: t.reason === 'SL' ? 'INVALIDATED' : 'CLOSED',
      barOpenTime: t.exitBarOpenTime,
      exitReason: t.reason,
      exitPrice: t.exitPrice,
      grossR: round(t.grossR, 4),
      netR: round(t.netR, 4),
      barsHeld: t.barsHeld,
    };
  }
  return record;
}

export function runV28LiveReplay(args: V28ReplayArgs): ReplayOutput {
  const res = runV28Live({ symbol: args.symbol, candles: args.h1, htf: args.htf });
  const out: ReplayOutput = {
    records: res.events.map((ev) => toRecord(args.symbol, ev)),
    evaluatedBars: res.evaluatedBars,
    firstEvaluatedOpenTime: res.firstEvaluatedOpenTime,
    lastEvaluatedOpenTime: res.lastEvaluatedOpenTime,
    notes: [],
  };
  if (res.evaluatedBars === 0) {
    out.notes.push(`V2.8: недостаточно закрытых 1H-баров для прогрева движка V2 (нужно > ${res.minBars}).`);
  }
  if (res.nonSniperSetups > 0) {
    out.notes.push(`V2.8: ${res.nonSniperSetups} actionable-сетапов движка V2 не прошли sniper-фильтр и не публикуются (как в исследовании).`);
  }
  return out;
}
