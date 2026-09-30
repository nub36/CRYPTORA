/**
 * CRYPTORA — Strategy Lab · симулятор исполнения (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Отдельный Lab-only симулятор. НЕ импортирует и НЕ переиспользует production
 * lifecycle (server/services/strategyEngine, src/services/signals/live/lifecycle)
 * как изменяемую основу — исследовательский контур изолирован.
 *
 * Детерминизм: только арифметика над закрытыми свечами, без Math.random, без
 * времени. Никакого фиктивного $ PnL — результат считается в R.
 *
 * Правило одинаковой свечи (§16): если один бар задевает и стоп, и цель,
 * консервативно считаем, что первым сработал СТОП (worst-case).
 */

import type { LabCandle, LabSide, LabTrade, LabTradeOutcome } from './types';

export const SAME_BAR_RULE =
  'Если один бар задевает и стоп, и цель — первым считается СТОП (worst-case).';

export interface SimulateEntryInput {
  id: string;
  side: LabSide;
  /** openTime бара сигнала (решение), секунды. */
  signalTime: number;
  /** Индекс бара сигнала в массиве candles. */
  signalIndex: number;
  /** Дистанция стопа в ЦЕНЕ (ATR(i) × stopAtrMult), > 0. */
  stopDistance: number;
  targetR: number;
  feeBps: number;
  slippageBps: number;
}

export interface SimulatedTrade {
  trade: LabTrade;
  entryIndex: number;
  exitIndex: number;
}

/**
 * Симулировать одну сделку: вход по OPEN бара signalIndex+1, затем движение по
 * закрытым барам до стопа/цели/конца данных. Возвращает null, если входного бара
 * нет (обрабатывается вызывающим как отказ NO_ENTRY_BAR).
 */
export function simulateTrade(
  candles: LabCandle[],
  input: SimulateEntryInput
): SimulatedTrade | null {
  const entryIndex = input.signalIndex + 1;
  if (entryIndex >= candles.length) return null;
  if (!(input.stopDistance > 0)) return null;

  const { side, targetR, feeBps, slippageBps } = input;
  const slip = slippageBps / 10_000;
  const entryBar = candles[entryIndex];

  // Проскальзывание: вход хуже для нас (LONG платит выше, SHORT продаёт ниже).
  const entryPrice = side === 'LONG' ? entryBar.open * (1 + slip) : entryBar.open * (1 - slip);

  const stop =
    side === 'LONG' ? entryPrice - input.stopDistance : entryPrice + input.stopDistance;
  const target =
    side === 'LONG'
      ? entryPrice + targetR * input.stopDistance
      : entryPrice - targetR * input.stopDistance;

  const risk = input.stopDistance; // дистанция до стопа в цене

  let exitIndex = candles.length - 1;
  let exitReason = 'END_OF_DATA';
  let outcome: LabTradeOutcome = 'EXIT';
  let rawExitPrice = candles[candles.length - 1].close;

  for (let j = entryIndex; j < candles.length; j++) {
    const bar = candles[j];
    let stopHit: boolean;
    let targetHit: boolean;
    if (side === 'LONG') {
      stopHit = bar.low <= stop;
      targetHit = bar.high >= target;
    } else {
      stopHit = bar.high >= stop;
      targetHit = bar.low <= target;
    }

    if (stopHit && targetHit) {
      // Консервативно: стоп первым.
      exitIndex = j;
      rawExitPrice = stop;
      outcome = 'STOP';
      exitReason = 'SAME_BAR_STOP_FIRST';
      break;
    }
    if (stopHit) {
      exitIndex = j;
      rawExitPrice = stop;
      outcome = 'STOP';
      exitReason = 'STOP';
      break;
    }
    if (targetHit) {
      exitIndex = j;
      rawExitPrice = target;
      outcome = 'TARGET';
      exitReason = 'TARGET';
      break;
    }
  }

  // Проскальзывание на выходе (кроме выхода ровно по стопу/цели — они уже уровни;
  // применяем slip только к END_OF_DATA закрытию, чтобы не «улучшать» стоп/цель).
  let exitPrice = rawExitPrice;
  if (exitReason === 'END_OF_DATA') {
    exitPrice = side === 'LONG' ? rawExitPrice * (1 - slip) : rawExitPrice * (1 + slip);
  }

  const grossMove = side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  const grossR = grossMove / risk;

  // Комиссия в R: feeBps на сторону от цены входа и выхода, переведённая в R.
  const feeFraction = feeBps / 10_000;
  const feeCostPrice = feeFraction * (entryPrice + exitPrice);
  const feeR = feeCostPrice / risk;
  const netR = grossR - feeR;

  const trade: LabTrade = {
    id: input.id,
    side,
    signalTime: input.signalTime,
    entryTime: entryBar.time,
    entryPrice,
    stop,
    target,
    exitTime: candles[exitIndex].time,
    exitPrice,
    outcome,
    exitReason,
    grossR,
    netR,
    barsHeld: exitIndex - entryIndex,
  };

  return { trade, entryIndex, exitIndex };
}
