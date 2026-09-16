/**
 * `resolveEntry` from svechnoy-suslik-v2 `src/strategy/state-machine.ts` @ 4839074 (sha256 87bfdbf7…).
 * Only this pure function is ported (verbatim); the signal state machine itself (persistence, slots) is NOT.
 * ARCHIVE-ONLY.
 */

export function resolveEntry(
  setupCandleTime: number,
  timeframeMs: number,
  nextCandle: { openTime: number; open: number; isClosed: boolean } | null | undefined,
): { entryCandleTime: number; entryPrice: number } | null {
  if (!nextCandle) return null;
  const expected = setupCandleTime + timeframeMs;
  if (nextCandle.openTime !== expected) return null;
  if (!Number.isFinite(nextCandle.open) || nextCandle.open <= 0) return null;
  // NOTE: the candle does NOT need to be closed — its OPEN is known the instant
  // it starts. That is precisely the realistic fill.
  return { entryCandleTime: nextCandle.openTime, entryPrice: nextCandle.open };
}
