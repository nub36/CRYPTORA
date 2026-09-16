/**
 * `executableLadder` from svechnoy-suslik-v2 `src/replay/v2-runner.ts` @ 4839074 (sha256 92d6f6f3…).
 * Only this pure function is ported (verbatim); `replayV2Series` (the source's own replay loop) is NOT — each
 * archived V2.x version carries its own research loop. ARCHIVE-ONLY.
 */

export function executableLadder(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  stopPrice: number,
  takeProfits: readonly number[],
): { targets: number[]; rr1: number; risk: number } {
  const risk = Math.abs(entryPrice - stopPrice);
  const ahead = (t: number): boolean =>
    direction === 'LONG' ? t > entryPrice : t < entryPrice;
  const targets = takeProfits
    .filter((t) => Number.isFinite(t) && ahead(t))
    .sort((a, b) => Math.abs(a - entryPrice) - Math.abs(b - entryPrice));
  const first = targets[0];
  const reward1 = first === undefined
    ? 0
    : (direction === 'LONG' ? first - entryPrice : entryPrice - first);
  return { targets, rr1: risk > 0 ? reward1 / risk : 0, risk };
}
