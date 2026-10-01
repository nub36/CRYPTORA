/**
 * CRYPTORA — Strategy Lab · Движок Конструктора Стратегий (Phase 2A, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Детерминированный исполнитель декларативных определений стратегий (Draft Definition).
 * Работает только внутри Strategy Lab: не публикует production-сигналы и не пишет в БД.
 *
 * Принципы:
 *   • Поддержка произвольного числа EMA и ATR индикаторов;
 *   • Правила LONG/SHORT на основе пересечений (crossesAbove, crossesBelow);
 *   • Стоп на основе ATR-множителя (atrMultiple);
 *   • Тейк-профит в единицах риска (rMultiple);
 *   • No look-ahead: решение на баре i использует только бары ≤ i;
 *   • Вход по OPEN следующего бара i+1 (market next open);
 *   • Полный детерминизм и точный паритет с базовой стратегией EMA + ATR.
 */

import { emaAligned, atrAligned, rsiAligned, confirmedFractals } from '../indicators';
import { simulateTrade } from '../executionSimulator';
import type {
  LabCandle,
  LabEvent,
  LabIndicatorSeries,
  LabRejection,
  LabSide,
  LabTrade,
  StrategyDraftDefinition,
  IndicatorDefinition,
} from '../types';

export interface DraftStrategyEvaluation {
  indicators: LabIndicatorSeries;
  events: LabEvent[];
  trades: LabTrade[];
  rejections: LabRejection[];
  warmupBars: number;
  evaluatedBars: number;
  candidateCount: number;
  rejectedCount: number;
}

function getPricesBySource(candles: LabCandle[], source?: IndicatorDefinition['source']): number[] {
  switch (source) {
    case 'open':
      return candles.map((c) => c.open);
    case 'high':
      return candles.map((c) => c.high);
    case 'low':
      return candles.map((c) => c.low);
    case 'close':
    default:
      return candles.map((c) => c.close);
  }
}

export function evaluateDraftStrategy(
  candles: LabCandle[],
  definition: StrategyDraftDefinition
): DraftStrategyEvaluation {
  const n = candles.length;
  const indSeries: Record<string, (number | null)[]> = {};

  // 1. Расчёт серий всех объявленных индикаторов
  for (const ind of definition.indicators) {
    if (ind.type === 'EMA') {
      const prices = getPricesBySource(candles, ind.source);
      indSeries[ind.id] = emaAligned(prices, ind.period);
    } else if (ind.type === 'ATR') {
      indSeries[ind.id] = atrAligned(candles, ind.period);
    } else if (ind.type === 'RSI') {
      indSeries[ind.id] = rsiAligned(getPricesBySource(candles, ind.source), ind.period);
    } else if (ind.type === 'FRACTALS') {
      const events = confirmedFractals(candles); const series = new Array<number | null>(n).fill(null);
      for (const event of events) if (event.kind === 'HIGH') series[event.confirmationIndex] = event.price;
      indSeries[ind.id] = series;
    }
  }

  // Определение ключевых серий для совместимости с LabIndicatorSeries
  const longLeftId = definition.long.kind === 'cross' ? definition.long.left : '';
  const longRightId = definition.long.kind === 'cross' ? definition.long.right : '';
  const stopIndId = definition.stop.indicatorId;

  const emaFastSeries = indSeries[longLeftId] || indSeries['ema-fast'] || new Array(n).fill(null);
  const emaSlowSeries = indSeries[longRightId] || indSeries['ema-slow'] || new Array(n).fill(null);
  const atrSeries = indSeries[stopIndId] || indSeries['atr'] || new Array(n).fill(null);

  const indicators: LabIndicatorSeries = {
    emaFast: emaFastSeries,
    emaSlow: emaSlowSeries,
    atr: atrSeries,
    byIndicatorId: indSeries,
    indicatorsList: definition.indicators,
  };

  const events: LabEvent[] = [];
  const trades: LabTrade[] = [];
  const rejections: LabRejection[] = [];

  // Индикаторы, необходимые для оценки правил и стопа
  const idsOf = (c: any): string[] => c.kind === 'cross' ? [c.left, c.right] : [c.indicatorId];
  const requiredIds = [...idsOf(definition.long), ...idsOf(definition.short), definition.stop.indicatorId];
  let firstEvaluable = -1;
  for (let i = 1; i < n; i++) if (requiredIds.every((id) => indSeries[id]?.[i] !== null && indSeries[id]?.[i - 1] !== null)) { firstEvaluable = i; break; }

  let candidateCount = 0;
  let rejectedCount = 0;
  let evaluatedBars = 0;

  const feeBps = definition.execution?.feeBps ?? 5;
  const slippageBps = definition.execution?.slippageBps ?? 2;

  if (firstEvaluable >= 0) {
    for (let i = firstEvaluable; i < n; i++) {
      evaluatedBars += 1;

      const predicate = (condition: any, i: number): boolean => {
        if (condition.kind === 'cross') {
          const lp = indSeries[condition.left]?.[i - 1] ?? null, lc = indSeries[condition.left]?.[i] ?? null;
          const rp = indSeries[condition.right]?.[i - 1] ?? null, rc = indSeries[condition.right]?.[i] ?? null;
          return lp !== null && lc !== null && rp !== null && rc !== null && (condition.operator === 'crossesAbove' ? lp <= rp && lc > rc : lp >= rp && lc < rc);
        }
        if (condition.kind === 'threshold') { const v = indSeries[condition.indicatorId]?.[i] ?? null; return v !== null && (condition.operator === 'above' ? v > condition.threshold : v < condition.threshold); }
        if (condition.kind === 'fractal') { const events = confirmedFractals(candles); return events.some((e) => e.confirmationIndex === i && e.kind === (condition.operator === 'fractalHigh' ? 'HIGH' : 'LOW')); }
        return false;
      };
      const longTriggered = predicate(definition.long, i);
      const shortTriggered = predicate(definition.short, i);

      let side: LabSide | null = null;
      if (longTriggered && !shortTriggered) side = 'LONG';
      else if (shortTriggered && !longTriggered) side = 'SHORT';

      if (side === null) continue;

      candidateCount += 1;
      const signal = candles[i];
      const candleTime = signal.time;
      const knownAt = signal.closeTime;
      const stopIndicatorValue = indSeries[definition.stop.indicatorId]?.[i] ?? null;

      const diagnostics: Record<string, number | string | null> = {
        signalClose: signal.close,
        atr: stopIndicatorValue,
      };

      if (side === 'LONG') {
        diagnostics.emaFast = indSeries[longLeftId]?.[i] ?? null;
        diagnostics.emaSlow = indSeries[longRightId]?.[i] ?? null;
      } else {
        diagnostics.emaFast = definition.short.kind === 'cross' ? indSeries[definition.short.left]?.[i] ?? null : null;
        diagnostics.emaSlow = definition.short.kind === 'cross' ? indSeries[definition.short.right]?.[i] ?? null : null;
      }

      const reject = (reason: string) => {
        rejectedCount += 1;
        rejections.push({
          id: `rej-${i}-${side}`,
          candleTime,
          knownAt,
          side: side as LabSide,
          reason,
          diagnostics,
        });
        events.push({
          id: `ev-rej-${i}`,
          kind: 'REJECTION',
          candleTime,
          knownAt,
          side: side as LabSide,
          reason,
          payload: { ...diagnostics },
        });
      };

      if (stopIndicatorValue === null) {
        reject('NO_ATR');
        continue;
      }
      if (!(stopIndicatorValue > 0)) {
        reject('ZERO_ATR');
        continue;
      }
      if (i + 1 >= n) {
        reject('NO_ENTRY_BAR');
        continue;
      }

      const stopDistance = stopIndicatorValue * definition.stop.multiplier;
      const sim = simulateTrade(candles, {
        id: `trade-${i}-${side}`,
        side,
        signalTime: candleTime,
        signalIndex: i,
        stopDistance,
        targetR: definition.target.multiple,
        feeBps,
        slippageBps,
      });

      if (!sim) {
        reject('NO_ENTRY_BAR');
        continue;
      }

      const { trade } = sim;
      trades.push(trade);

      const entryBar = candles[sim.entryIndex];
      const exitBar = candles[sim.exitIndex];

      // CANDIDATE
      events.push({
        id: `ev-cand-${i}`,
        kind: 'CANDIDATE',
        candleTime,
        knownAt,
        side,
        price: signal.close,
        payload: { atr: stopIndicatorValue, tradeId: trade.id },
      });

      // ENTRY
      events.push({
        id: `ev-entry-${i}`,
        kind: 'ENTRY',
        candleTime: entryBar.time,
        knownAt: entryBar.time,
        side,
        price: entryBar.open,
        zone: [Math.min(trade.entryPrice, entryBar.open), Math.max(trade.entryPrice, entryBar.open)],
        payload: { tradeId: trade.id },
      });

      // FILL
      events.push({
        id: `ev-fill-${i}`,
        kind: 'FILL',
        candleTime: entryBar.time,
        knownAt: entryBar.time,
        side,
        price: trade.entryPrice,
        payload: { tradeId: trade.id },
      });

      // OUTCOME (TP / STOP)
      if (trade.outcome === 'TARGET') {
        events.push({
          id: `ev-tp1-${i}`,
          kind: 'TP1',
          candleTime: exitBar.time,
          knownAt: exitBar.closeTime,
          side,
          price: trade.exitPrice,
          payload: { tradeId: trade.id },
        });
      } else if (trade.outcome === 'STOP') {
        events.push({
          id: `ev-stop-${i}`,
          kind: 'STOP',
          candleTime: exitBar.time,
          knownAt: exitBar.closeTime,
          side,
          price: trade.exitPrice,
          reason: trade.exitReason,
          payload: { tradeId: trade.id },
        });
      }

      // EXIT
      events.push({
        id: `ev-exit-${i}`,
        kind: 'EXIT',
        candleTime: exitBar.time,
        knownAt: exitBar.closeTime,
        side,
        price: trade.exitPrice,
        reason: trade.exitReason,
        payload: {
          grossR: trade.grossR,
          netR: trade.netR,
          barsHeld: trade.barsHeld,
          tradeId: trade.id,
        },
      });
    }
  }

  const warmupBars = firstEvaluable < 0 ? n : firstEvaluable;

  return {
    indicators,
    events,
    trades,
    rejections,
    warmupBars,
    evaluatedBars,
    candidateCount,
    rejectedCount,
  };
}
