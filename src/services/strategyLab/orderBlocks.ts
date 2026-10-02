/**
 * CRYPTORA — Strategy Lab · confirmed Order Blocks (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Deterministic, no-look-ahead Order Block V1. A zone is created only after the
 * close of its displacement/confirmation candle. Lifecycle updates begin on the
 * following closed candle, never on the confirmation candle itself.
 */

import type {
  LabCandle,
  LabOrderBlock,
  OrderBlockDirection,
  OrderBlockIndicatorDefinition,
} from './types';

export interface OrderBlockEvaluation {
  /** All confirmed zones, retained after invalidation for chart/history output. */
  orderBlocks: LabOrderBlock[];
  /** Discrete confirmation events addressed by [closed candle index]. */
  confirmationsByIndex: Map<number, Set<string>>;
}

export function orderBlockConfirmationKey(
  indicatorId: string,
  direction: OrderBlockDirection
): string {
  return `${indicatorId}:${direction}`;
}

function makeId(
  indicatorId: string,
  direction: OrderBlockDirection,
  sourceIndex: number,
  confirmationIndex: number
): string {
  return `ob:${indicatorId}:${direction}:${sourceIndex}:${confirmationIndex}`;
}

function findBullishSource(
  candles: readonly LabCandle[],
  confirmationIndex: number,
  lookback: number
): number | null {
  const confirmation = candles[confirmationIndex];
  for (let sourceIndex = confirmationIndex - 1; sourceIndex >= Math.max(0, confirmationIndex - lookback); sourceIndex -= 1) {
    const source = candles[sourceIndex];
    if (source.close < source.open && confirmation.close > source.high) return sourceIndex;
  }
  return null;
}

function findBearishSource(
  candles: readonly LabCandle[],
  confirmationIndex: number,
  lookback: number
): number | null {
  const confirmation = candles[confirmationIndex];
  for (let sourceIndex = confirmationIndex - 1; sourceIndex >= Math.max(0, confirmationIndex - lookback); sourceIndex -= 1) {
    const source = candles[sourceIndex];
    if (source.close > source.open && confirmation.close < source.low) return sourceIndex;
  }
  return null;
}

function advanceLifecycle(block: LabOrderBlock, candle: LabCandle, index: number): boolean {
  // The caller invokes lifecycle processing before detecting this candle's new
  // zones. Every block here was confirmed on a preceding candle, so k > j.
  if (block.mitigationIndex === undefined && candle.low <= block.high && candle.high >= block.low) {
    block.mitigationIndex = index;
    block.mitigatedAt = candle.closeTime;
    block.state = 'MITIGATED';
  }

  const invalidated =
    block.direction === 'BULLISH'
      ? candle.close < block.low
      : candle.close > block.high;

  if (!invalidated) return false;

  // A bar that both overlaps and invalidates records mitigation above first.
  block.invalidationIndex = index;
  block.invalidationCandleTime = candle.time;
  block.invalidatedAt = candle.closeTime;
  block.state = 'INVALIDATED';
  return true;
}

/**
 * Evaluate all Order Block definitions once in chronological candle order.
 *
 * Detection only reads the confirmation candle, its bounded preceding source
 * window, and the referenced ATR at that same closed candle. Lifecycle state is
 * advanced only for already-confirmed zones. The confirmation map is therefore
 * safe for direct use by the strategy evaluator at a closed index.
 */
export function evaluateOrderBlocks(
  candles: readonly LabCandle[],
  definitions: readonly OrderBlockIndicatorDefinition[],
  indicatorSeries: Readonly<Record<string, readonly (number | null)[] | undefined>>
): OrderBlockEvaluation {
  const orderBlocks: LabOrderBlock[] = [];
  const confirmationsByIndex = new Map<number, Set<string>>();
  const active: LabOrderBlock[] = [];

  for (let confirmationIndex = 0; confirmationIndex < candles.length; confirmationIndex += 1) {
    const confirmation = candles[confirmationIndex];

    // Invalidated zones no longer participate in later lifecycle checks.
    let nextActive = 0;
    for (let activeIndex = 0; activeIndex < active.length; activeIndex += 1) {
      const block = active[activeIndex];
      if (!advanceLifecycle(block, confirmation, confirmationIndex)) {
        active[nextActive] = block;
        nextActive += 1;
      }
    }
    active.length = nextActive;

    for (const definition of definitions) {
      const atr = indicatorSeries[definition.atrIndicatorId]?.[confirmationIndex] ?? null;
      if (atr === null || !Number.isFinite(atr) || !(atr > 0)) continue;

      let direction: OrderBlockDirection | null = null;
      let sourceIndex: number | null = null;

      if (
        confirmation.close > confirmation.open &&
        confirmation.close - confirmation.open >= atr * definition.displacementMultiplier
      ) {
        direction = 'BULLISH';
        sourceIndex = findBullishSource(candles, confirmationIndex, definition.lookback);
      } else if (
        confirmation.close < confirmation.open &&
        confirmation.open - confirmation.close >= atr * definition.displacementMultiplier
      ) {
        direction = 'BEARISH';
        sourceIndex = findBearishSource(candles, confirmationIndex, definition.lookback);
      }

      if (direction === null || sourceIndex === null) continue;

      const source = candles[sourceIndex];
      const block: LabOrderBlock = {
        id: makeId(definition.id, direction, sourceIndex, confirmationIndex),
        indicatorId: definition.id,
        direction,
        sourceIndex,
        sourceCandleTime: source.time,
        confirmationIndex,
        confirmationCandleTime: confirmation.time,
        knownAt: confirmation.closeTime,
        low: source.low,
        high: source.high,
        state: 'ACTIVE',
      };

      orderBlocks.push(block);
      active.push(block);
      const key = orderBlockConfirmationKey(definition.id, direction);
      const atIndex = confirmationsByIndex.get(confirmationIndex) ?? new Set<string>();
      atIndex.add(key);
      confirmationsByIndex.set(confirmationIndex, atIndex);
    }
  }

  return { orderBlocks, confirmationsByIndex };
}
