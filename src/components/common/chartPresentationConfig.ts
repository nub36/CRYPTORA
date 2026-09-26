export const CHART_RIGHT_OFFSET = 6;
/**
 * Common initial candle window. Loading all 500 REST bars into the viewport made
 * current price action unreadable; 72 bars keeps enough context without turning
 * candles into a dense strip. This is applied only for a new symbol/timeframe
 * (or an explicit reset), never on an ordinary data/WS update.
 */
export const CHART_INITIAL_VISIBLE_BARS = 72;

export interface ChartLogicalRange {
  from: number;
  to: number;
}

export function initialChartLogicalRange(
  dataLength: number,
  visibleBars = CHART_INITIAL_VISIBLE_BARS,
  rightOffset = CHART_RIGHT_OFFSET
): ChartLogicalRange | null {
  if (!Number.isFinite(dataLength) || dataLength <= 0) return null;
  const length = Math.floor(dataLength);
  const count = Math.max(1, Math.min(length, Math.floor(visibleBars)));
  return {
    from: length - count,
    to: length - 1 + Math.max(0, rightOffset),
  };
}

export const RSI_FIXED_PRICE_RANGE = Object.freeze({ minValue: 0, maxValue: 100 });
