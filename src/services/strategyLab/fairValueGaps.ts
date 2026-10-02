/**
 * CRYPTORA — Strategy Lab · Fair Value Gaps V1 (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Deterministic, no-look-ahead three-candle Fair Value Gap detection with a
 * full zone lifecycle (ACTIVE → PARTIALLY_FILLED → FILLED).
 *
 * Pattern (A = C−2, B = C−1, C = confirmation):
 *   • bullish: low[C] > high[A]  → zone [high[A], low[C]];
 *   • bearish: high[C] < low[A]  → zone [high[C], low[A]].
 * Comparisons are STRICT — touching/equal extremes reject the gap. Candle B
 * never defines bounds.
 *
 * Timing: a gap is confirmed only after close(C) (`knownAt = closeTime(C)`);
 * it is unusable at A, B or open(C). Lifecycle begins on the NEXT completed
 * candle C+1 — a zone confirmed on k never participates in touch/fill/inside
 * on k itself.
 *
 * Per-candle ordering for already-confirmed zones:
 *   1. record first range overlap (first touch → retest event);
 *   2. apply directional full fill (bullish: low[k] ≤ zone.low; bearish:
 *      high[k] ≥ zone.high) — FILLED is terminal;
 *   3. evaluate close-inside only for surviving non-FILLED zones (inclusive);
 *   4. detect/append gaps confirmed on k.
 * A first touch that also fully fills records BOTH retest and FILLED and is
 * excluded from inside. A discontinuous full fill (directional extreme
 * satisfied WITHOUT range overlap — price gapped past the zone) fills the zone
 * but records no retest and no first-touch metadata: the intrabar path is
 * never inferred.
 *
 * PERFORMANCE. The naive active-list scan is O(candles × zones) and measured
 * ~74.6 s on 105,120 candles with ~105k persistent adversarial zones. This
 * implementation keeps per-direction HEAP indexes instead (no interval tree,
 * no treap):
 *   • touch heap  — untouched zones keyed by the boundary nearest to price
 *     (bullish: max-heap on zone.high; bearish: min-heap on zone.low);
 *   • fill heap   — non-FILLED zones keyed by the far boundary
 *     (bullish: max-heap on zone.low; bearish: min-heap on zone.high);
 *   • inside heap — non-FILLED zones keyed like the touch heap, with lazy
 *     removal of FILLED entries at the top.
 * Every zone enters/leaves each heap at most once → O(n log n) total.
 *
 * Why the O(1) inside check is sound: after step 2 every surviving bullish
 * zone has zone.low < low[k] ≤ close[k] (otherwise the fill heap would have
 * filled it), so `zone.low ≤ close` holds automatically and inside reduces to
 * `max(zone.high) ≥ close`. Symmetrically for bearish zones `zone.high ≥
 * close` is automatic and inside reduces to `min(zone.low) ≤ close`. The
 * optimized/reference equivalence test asserts this bar-for-bar.
 */

import type {
  FvgDirection,
  FvgIndicatorDefinition,
  LabCandle,
  LabFairValueGap,
} from './types';

export interface FairValueGapEvaluation {
  /** All confirmed gaps in chronological confirmation order, kept after fill. */
  fairValueGaps: LabFairValueGap[];
  /** Discrete creation events addressed by [closed confirmation index]. */
  confirmationsByIndex: Map<number, Set<string>>;
  /** Current-close membership of surviving zones confirmed before this candle. */
  insideByIndex: Map<number, Set<string>>;
  /** First post-confirmation range overlaps (first touch ⇒ retest). */
  retestsByIndex: Map<number, Set<string>>;
}

export function fvgConfirmationKey(indicatorId: string, direction: FvgDirection): string {
  return `${indicatorId}:${direction}`;
}

function makeId(
  indicatorId: string,
  direction: FvgDirection,
  firstIndex: number,
  confirmationIndex: number
): string {
  return `fvg:${indicatorId}:${direction}:${firstIndex}:${confirmationIndex}`;
}

/**
 * Minimal deterministic binary max-heap on a numeric score. Min-heap behaviour
 * is obtained by negating the score at the call site. Ties are broken by
 * insertion sequence so iteration order never depends on engine internals.
 */
class ZoneHeap {
  private readonly scores: number[] = [];
  private readonly seqs: number[] = [];
  private readonly zones: LabFairValueGap[] = [];

  get size(): number {
    return this.zones.length;
  }

  peek(): LabFairValueGap | undefined {
    return this.zones[0];
  }

  peekScore(): number {
    return this.scores[0];
  }

  push(score: number, seq: number, zone: LabFairValueGap): void {
    const scores = this.scores;
    const seqs = this.seqs;
    const zones = this.zones;
    let index = zones.length;
    scores.push(score);
    seqs.push(seq);
    zones.push(zone);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (
        scores[parent] > scores[index] ||
        (scores[parent] === scores[index] && seqs[parent] <= seqs[index])
      ) {
        break;
      }
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): LabFairValueGap | undefined {
    const zones = this.zones;
    const n = zones.length;
    if (n === 0) return undefined;
    const top = zones[0];
    const last = n - 1;
    this.swap(0, last);
    this.scores.pop();
    this.seqs.pop();
    zones.pop();
    const scores = this.scores;
    const seqs = this.seqs;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= last) break;
      const right = left + 1;
      let best = left;
      if (
        right < last &&
        (scores[right] > scores[left] || (scores[right] === scores[left] && seqs[right] < seqs[left]))
      ) {
        best = right;
      }
      if (
        scores[index] > scores[best] ||
        (scores[index] === scores[best] && seqs[index] <= seqs[best])
      ) {
        break;
      }
      this.swap(index, best);
      index = best;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const scores = this.scores;
    const seqs = this.seqs;
    const zones = this.zones;
    const score = scores[a];
    scores[a] = scores[b];
    scores[b] = score;
    const seq = seqs[a];
    seqs[a] = seqs[b];
    seqs[b] = seq;
    const zone = zones[a];
    zones[a] = zones[b];
    zones[b] = zone;
  }
}

/** Per-direction lifecycle indexes of one FVG definition. */
interface DirectionIndexes {
  /** Untouched non-FILLED zones; score = boundary nearest to price. */
  touch: ZoneHeap;
  /** Non-FILLED zones; score = directional full-fill boundary. */
  fill: ZoneHeap;
  /** Non-FILLED zones for the O(1) close-inside existence check. */
  inside: ZoneHeap;
}

interface DefinitionState {
  definition: FvgIndicatorDefinition;
  bullish: DirectionIndexes;
  bearish: DirectionIndexes;
}

function createIndexes(): DirectionIndexes {
  return { touch: new ZoneHeap(), fill: new ZoneHeap(), inside: new ZoneHeap() };
}

function registerKey(map: Map<number, Set<string>>, index: number, key: string): void {
  const keys = map.get(index) ?? new Set<string>();
  keys.add(key);
  map.set(index, keys);
}

function recordFirstTouch(zone: LabFairValueGap, candle: LabCandle, index: number): void {
  zone.firstTouchIndex = index;
  zone.firstTouchCandleTime = candle.time;
  zone.firstTouchedAt = candle.closeTime;
  if (zone.state === 'ACTIVE') zone.state = 'PARTIALLY_FILLED';
}

function recordFill(zone: LabFairValueGap, candle: LabCandle, index: number): void {
  zone.fillIndex = index;
  zone.fillCandleTime = candle.time;
  zone.filledAt = candle.closeTime;
  zone.state = 'FILLED';
}

/**
 * Evaluate all FVG definitions in one chronological pass over closed candles.
 * Detection reads only candles ≤ k; lifecycle advances only zones confirmed on
 * earlier candles, so every exposed map is safe for the strategy evaluator at
 * a completed index.
 */
export function evaluateFairValueGaps(
  candles: readonly LabCandle[],
  definitions: readonly FvgIndicatorDefinition[]
): FairValueGapEvaluation {
  const fairValueGaps: LabFairValueGap[] = [];
  const confirmationsByIndex = new Map<number, Set<string>>();
  const insideByIndex = new Map<number, Set<string>>();
  const retestsByIndex = new Map<number, Set<string>>();
  const states: DefinitionState[] = definitions.map((definition) => ({
    definition,
    bullish: createIndexes(),
    bearish: createIndexes(),
  }));
  let sequence = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];

    for (const state of states) {
      const key = (direction: FvgDirection) => fvgConfirmationKey(state.definition.id, direction);

      // ── 1. First range overlap of untouched zones (retest), and the
      //       discontinuous no-overlap edge where the candle gapped entirely
      //       past an untouched zone (full fill WITHOUT retest/first touch).
      {
        const touch = state.bullish.touch;
        // Bullish overlap needs zone.high ≥ low[k]; stop at the first zone
        // entirely above price. zone.low ≤ high[k] is checked per pop.
        while (touch.size > 0 && touch.peekScore() >= candle.low) {
          const zone = touch.pop()!;
          if (zone.state === 'FILLED') continue; // lazy removal
          if (candle.high >= zone.low) {
            recordFirstTouch(zone, candle, index);
            registerKey(retestsByIndex, index, key('BULLISH'));
          } else {
            // candle.high < zone.low ⇒ candle.low < zone.low: discontinuous
            // full fill. No retest, no first-touch metadata (§ edge).
            recordFill(zone, candle, index);
          }
        }
      }
      {
        const touch = state.bearish.touch;
        while (touch.size > 0 && -touch.peekScore() <= candle.high) {
          const zone = touch.pop()!;
          if (zone.state === 'FILLED') continue;
          if (candle.low <= zone.high) {
            recordFirstTouch(zone, candle, index);
            registerKey(retestsByIndex, index, key('BEARISH'));
          } else {
            recordFill(zone, candle, index);
          }
        }
      }

      // ── 2. Directional full fill (terminal), after first-touch recording.
      {
        const fill = state.bullish.fill;
        while (fill.size > 0 && fill.peekScore() >= candle.low) {
          const zone = fill.pop()!;
          if (zone.state === 'FILLED') continue; // discontinuous fill above
          recordFill(zone, candle, index);
        }
      }
      {
        const fill = state.bearish.fill;
        while (fill.size > 0 && -fill.peekScore() <= candle.high) {
          const zone = fill.pop()!;
          if (zone.state === 'FILLED') continue;
          recordFill(zone, candle, index);
        }
      }

      // ── 3. Close-inside for surviving non-FILLED zones (inclusive bounds).
      //       Survivors already satisfy the far-boundary inequality (see the
      //       header proof), so one lazy-cleaned heap top decides existence.
      {
        const inside = state.bullish.inside;
        while (inside.size > 0 && inside.peek()!.state === 'FILLED') inside.pop();
        if (inside.size > 0 && inside.peekScore() >= candle.close) {
          registerKey(insideByIndex, index, key('BULLISH'));
        }
      }
      {
        const inside = state.bearish.inside;
        while (inside.size > 0 && inside.peek()!.state === 'FILLED') inside.pop();
        if (inside.size > 0 && -inside.peekScore() <= candle.close) {
          registerKey(insideByIndex, index, key('BEARISH'));
        }
      }

      // ── 4. Detect gaps whose confirmation candle is k. They are visible to
      //       creation predicates on k but start lifecycle only on k+1.
      if (index >= 2) {
        const first = candles[index - 2];
        const middle = candles[index - 1];
        let direction: FvgDirection | null = null;
        let low = 0;
        let high = 0;
        if (candle.low > first.high) {
          direction = 'BULLISH';
          low = first.high;
          high = candle.low;
        } else if (candle.high < first.low) {
          direction = 'BEARISH';
          low = candle.high;
          high = first.low;
        }
        if (direction !== null) {
          const zone: LabFairValueGap = {
            id: makeId(state.definition.id, direction, index - 2, index),
            indicatorId: state.definition.id,
            direction,
            firstIndex: index - 2,
            firstCandleTime: first.time,
            middleIndex: index - 1,
            middleCandleTime: middle.time,
            confirmationIndex: index,
            confirmationCandleTime: candle.time,
            knownAt: candle.closeTime,
            low,
            high,
            state: 'ACTIVE',
          };
          fairValueGaps.push(zone);
          registerKey(confirmationsByIndex, index, key(direction));
          const indexes = direction === 'BULLISH' ? state.bullish : state.bearish;
          const seq = sequence;
          sequence += 1;
          if (direction === 'BULLISH') {
            indexes.touch.push(zone.high, seq, zone);
            indexes.fill.push(zone.low, seq, zone);
            indexes.inside.push(zone.high, seq, zone);
          } else {
            indexes.touch.push(-zone.low, seq, zone);
            indexes.fill.push(-zone.high, seq, zone);
            indexes.inside.push(-zone.low, seq, zone);
          }
        }
      }
    }
  }

  return { fairValueGaps, confirmationsByIndex, insideByIndex, retestsByIndex };
}
