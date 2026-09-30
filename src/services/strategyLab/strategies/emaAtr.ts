/**
 * CRYPTORA — Strategy Lab · стратегия EMA + ATR (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Полноценная исследовательская стратегия CRYPTORA. Работает только внутри
 * Strategy Lab: не публикует production-сигналы и не пишет в БД. Перевод в
 * production — отдельный явный процесс и отдельная задача.
 *
 * Детерминированное правило (см. registry.ts → rule[]):
 *   • сигнал по пересечению EMA на ЗАКРЫТОМ баре i;
 *   • вход по OPEN следующего бара i+1 (market next open);
 *   • стоп = ATR(i) × Stop ATR; цель = Target R × дистанция стопа;
 *   • одна свеча задела стоп и цель → консервативно СТОП.
 *
 * No look-ahead: решение на баре i использует только бары ≤ i. Вход и исход
 * моделируются по последующим барам симулятором, но НЕ влияют на решение.
 */

import { emaAligned, atrAligned } from '../indicators';
import { simulateTrade } from '../executionSimulator';
import type {
  LabCandle,
  LabEvent,
  LabIndicatorSeries,
  LabRejection,
  LabSide,
  LabTrade,
  ResearchConfig,
} from '../types';

export interface EmaAtrEvaluation {
  indicators: LabIndicatorSeries;
  events: LabEvent[];
  trades: LabTrade[];
  rejections: LabRejection[];
  warmupBars: number;
  evaluatedBars: number;
  candidateCount: number;
  rejectedCount: number;
}

export function evaluateEmaAtr(
  candles: LabCandle[],
  config: ResearchConfig
): EmaAtrEvaluation {
  const n = candles.length;
  const closes = candles.map((c) => c.close);

  const emaFast = emaAligned(closes, config.indicators.emaFast);
  const emaSlow = emaAligned(closes, config.indicators.emaSlow);
  const atr = atrAligned(candles, config.indicators.atrPeriod);
  const indicators: LabIndicatorSeries = { emaFast, emaSlow, atr };

  const events: LabEvent[] = [];
  const trades: LabTrade[] = [];
  const rejections: LabRejection[] = [];

  // Первый бар, на котором вообще можно вычислить пересечение (обе EMA есть на i и i-1).
  let firstEvaluable = -1;
  for (let i = 1; i < n; i++) {
    if (
      emaFast[i] !== null &&
      emaSlow[i] !== null &&
      emaFast[i - 1] !== null &&
      emaSlow[i - 1] !== null
    ) {
      firstEvaluable = i;
      break;
    }
  }

  let candidateCount = 0;
  let rejectedCount = 0;
  let evaluatedBars = 0;

  if (firstEvaluable >= 0) {
    for (let i = firstEvaluable; i < n; i++) {
      const fPrev = emaFast[i - 1];
      const sPrev = emaSlow[i - 1];
      const fCur = emaFast[i];
      const sCur = emaSlow[i];
      if (fPrev === null || sPrev === null || fCur === null || sCur === null) continue;
      evaluatedBars += 1;

      let side: LabSide | null = null;
      if (fPrev <= sPrev && fCur > sCur) side = 'LONG';
      else if (fPrev >= sPrev && fCur < sCur) side = 'SHORT';
      if (side === null) continue;

      // Обнаружен candidate-сигнал.
      candidateCount += 1;
      const signal = candles[i];
      const candleTime = signal.time;
      const knownAt = signal.closeTime; // сигнал известен только после закрытия бара i
      const atrValue = atr[i];

      const diagnostics: Record<string, number | string | null> = {
        emaFast: fCur,
        emaSlow: sCur,
        atr: atrValue,
        signalClose: signal.close,
      };

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

      if (atrValue === null) {
        reject('NO_ATR');
        continue;
      }
      if (!(atrValue > 0)) {
        reject('ZERO_ATR');
        continue;
      }
      if (i + 1 >= n) {
        reject('NO_ENTRY_BAR');
        continue;
      }

      const stopDistance = atrValue * config.strategy.stopAtrMult;
      const sim = simulateTrade(candles, {
        id: `trade-${i}-${side}`,
        side,
        signalTime: candleTime,
        signalIndex: i,
        stopDistance,
        targetR: config.strategy.targetR,
        feeBps: config.execution.feeBps,
        slippageBps: config.execution.slippageBps,
      });

      if (!sim) {
        reject('NO_ENTRY_BAR');
        continue;
      }

      const { trade } = sim;
      trades.push(trade);

      const entryBar = candles[sim.entryIndex];
      const exitBar = candles[sim.exitIndex];

      // CANDIDATE (принят) — на баре сигнала.
      events.push({
        id: `ev-cand-${i}`,
        kind: 'CANDIDATE',
        candleTime,
        knownAt,
        side,
        price: signal.close,
        payload: { atr: atrValue, tradeId: trade.id },
      });
      // ENTRY — намеренный вход по OPEN бара i+1.
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
      // FILL — фактическое исполнение с проскальзыванием.
      events.push({
        id: `ev-fill-${i}`,
        kind: 'FILL',
        candleTime: entryBar.time,
        knownAt: entryBar.time,
        side,
        price: trade.entryPrice,
        payload: { tradeId: trade.id },
      });
      // Исход.
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
      events.push({
        id: `ev-exit-${i}`,
        kind: 'EXIT',
        candleTime: exitBar.time,
        knownAt: exitBar.closeTime,
        side,
        price: trade.exitPrice,
        reason: trade.exitReason,
        payload: { grossR: trade.grossR, netR: trade.netR, barsHeld: trade.barsHeld, tradeId: trade.id },
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
