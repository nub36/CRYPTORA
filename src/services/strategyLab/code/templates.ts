export const EMA_TREND_CODE = `strategy("EMA Trend", () => {
  const fast = EMA(CLOSE, 20);
  const slow = EMA(CLOSE, 50);
  const atr = ATR(14);
  LONG(crossesAbove(fast, slow));
  SHORT(crossesBelow(fast, slow));
  STOP(multiply(atr, 1.5));
  TAKE_PROFIT(R(2));
});`;
