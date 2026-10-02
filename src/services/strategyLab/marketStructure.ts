/**
 * CRYPTORA — Strategy Lab · Market Structure V1 (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * A bounded, chronological latest-confirmed-pivot model. Pivot confirmation is
 * the only bounded forward read. On every completed candle we first evaluate
 * breaks against levels confirmed on earlier candles, then register pivots whose
 * confirmation is this candle. A newly confirmed level therefore cannot break
 * on its own confirmation candle.
 */

import type {
  LabCandle,
  LabMarketStructureEvent,
  LabMarketStructureState,
  MarketStructureIndicatorDefinition,
} from './types';

export interface MarketStructureEvaluation {
  /** Complete immutable research output; visibility never changes this list. */
  marketStructureEvents: LabMarketStructureEvent[];
  /** O(1) discrete predicate lookups by closed candle index. */
  eventsByIndex: Map<number, Set<string>>;
}

type SwingEvent = Extract<LabMarketStructureEvent, { kind: 'SWING_HIGH' | 'SWING_LOW' }>;
type BreakKind = Extract<LabMarketStructureEvent, { kind: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' }>['kind'];

interface StructureState {
  state: LabMarketStructureState;
  activeSwingHigh: SwingEvent | null;
  activeSwingLow: SwingEvent | null;
}

export function marketStructureEventKey(indicatorId: string, kind: LabMarketStructureEvent['kind']): string {
  return `${indicatorId}:${kind}`;
}

function swingId(
  indicatorId: string,
  kind: 'SWING_HIGH' | 'SWING_LOW',
  sourceIndex: number,
  confirmationIndex: number
): string {
  return `ms:${indicatorId}:${kind}:${sourceIndex}:${confirmationIndex}`;
}

function isSwingHigh(candles: readonly LabCandle[], center: number, leftBars: number, rightBars: number): boolean {
  const price = candles[center]!.high;
  for (let index = center - leftBars; index < center; index += 1) if (!(price > candles[index]!.high)) return false;
  for (let index = center + 1; index <= center + rightBars; index += 1) if (!(price > candles[index]!.high)) return false;
  return true;
}

function isSwingLow(candles: readonly LabCandle[], center: number, leftBars: number, rightBars: number): boolean {
  const price = candles[center]!.low;
  for (let index = center - leftBars; index < center; index += 1) if (!(price < candles[index]!.low)) return false;
  for (let index = center + 1; index <= center + rightBars; index += 1) if (!(price < candles[index]!.low)) return false;
  return true;
}

function registerKey(eventsByIndex: Map<number, Set<string>>, index: number, key: string): void {
  const keys = eventsByIndex.get(index) ?? new Set<string>();
  keys.add(key);
  eventsByIndex.set(index, keys);
}

function createSwing(
  definition: MarketStructureIndicatorDefinition,
  candles: readonly LabCandle[],
  sourceIndex: number,
  kind: 'SWING_HIGH' | 'SWING_LOW'
): SwingEvent {
  const source = candles[sourceIndex]!;
  const confirmationIndex = sourceIndex + definition.rightBars;
  const confirmation = candles[confirmationIndex]!;
  return {
    id: swingId(definition.id, kind, sourceIndex, confirmationIndex),
    indicatorId: definition.id,
    kind,
    sourceIndex,
    sourceCandleTime: source.time,
    confirmationIndex,
    confirmationCandleTime: confirmation.time,
    knownAt: confirmation.closeTime,
    price: kind === 'SWING_HIGH' ? source.high : source.low,
  };
}

function chooseBreak(
  state: StructureState,
  candle: LabCandle,
  index: number
): { kind: BreakKind; swing: SwingEvent; nextState: LabMarketStructureState } | null {
  const activeHigh = state.activeSwingHigh;
  const activeLow = state.activeSwingLow;
  const high = activeHigh !== null && activeHigh.confirmationIndex < index ? activeHigh : null;
  const low = activeLow !== null && activeLow.confirmationIndex < index ? activeLow : null;
  const upward = high !== null && candle.close > high.price;
  const downward = low !== null && candle.close < low.price;

  const bullish = (): { kind: BreakKind; swing: SwingEvent; nextState: LabMarketStructureState } | null =>
    upward && high ? { kind: state.state === 'BEARISH' ? 'BULLISH_CHOCH' : 'BULLISH_BOS', swing: high, nextState: 'BULLISH' } : null;
  const bearish = (): { kind: BreakKind; swing: SwingEvent; nextState: LabMarketStructureState } | null =>
    downward && low ? { kind: state.state === 'BULLISH' ? 'BEARISH_CHOCH' : 'BEARISH_BOS', swing: low, nextState: 'BEARISH' } : null;

  // Directional safety precedence handles malformed/gapped topology while
  // preserving one event per indicator per candle.
  if (state.state === 'BULLISH') return bearish() ?? bullish();
  if (state.state === 'BEARISH') return bullish() ?? bearish();
  if (upward && downward && high && low) {
    if (high.confirmationIndex === low.confirmationIndex) return bullish();
    return high.confirmationIndex > low.confirmationIndex ? bullish() : bearish();
  }
  return bullish() ?? bearish();
}

/**
 * Evaluates every configured Market Structure indicator in one chronological
 * pass. State is constant-sized per definition; no historical pivot rescan or
 * final-replay state is used for predicate timing.
 */
export function evaluateMarketStructure(
  candles: readonly LabCandle[],
  definitions: readonly MarketStructureIndicatorDefinition[]
): MarketStructureEvaluation {
  const marketStructureEvents: LabMarketStructureEvent[] = [];
  const eventsByIndex = new Map<number, Set<string>>();
  const states = new Map<string, StructureState>(definitions.map((definition) => [
    definition.id,
    { state: 'NEUTRAL', activeSwingHigh: null, activeSwingLow: null },
  ]));

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;

    // 1–2. Breaks use only levels that confirmed before this candle. At most
    // one event is emitted by chooseBreak for each configured indicator.
    for (const definition of definitions) {
      const structure = states.get(definition.id)!;
      const chosen = chooseBreak(structure, candle, index);
      if (!chosen) continue;

      const previousState = structure.state;
      const event: LabMarketStructureEvent = {
        id: `ms:${definition.id}:${chosen.kind}:${index}:${chosen.swing.id}`,
        indicatorId: definition.id,
        kind: chosen.kind,
        breakIndex: index,
        breakCandleTime: candle.time,
        knownAt: candle.closeTime,
        breakClose: candle.close,
        level: chosen.swing.price,
        brokenSwingId: chosen.swing.id,
        brokenSwingKind: chosen.swing.kind,
        brokenSwingSourceIndex: chosen.swing.sourceIndex,
        brokenSwingSourceCandleTime: chosen.swing.sourceCandleTime,
        previousState,
        newState: chosen.nextState,
      };
      marketStructureEvents.push(event);
      registerKey(eventsByIndex, index, marketStructureEventKey(definition.id, event.kind));
      if (chosen.swing.kind === 'SWING_HIGH') structure.activeSwingHigh = null;
      else structure.activeSwingLow = null;
      structure.state = chosen.nextState;
    }

    // 3. Only after break evaluation, confirm and arm pivots whose right-side
    // window ends here. They are visible to swing predicates on this index but
    // cannot participate in a break until the next completed candle.
    for (const definition of definitions) {
      const sourceIndex = index - definition.rightBars;
      if (sourceIndex < definition.leftBars) continue;
      const structure = states.get(definition.id)!;
      if (isSwingHigh(candles, sourceIndex, definition.leftBars, definition.rightBars)) {
        const event = createSwing(definition, candles, sourceIndex, 'SWING_HIGH');
        marketStructureEvents.push(event);
        registerKey(eventsByIndex, index, marketStructureEventKey(definition.id, event.kind));
        structure.activeSwingHigh = event; // supersedes, never falls back
      }
      if (isSwingLow(candles, sourceIndex, definition.leftBars, definition.rightBars)) {
        const event = createSwing(definition, candles, sourceIndex, 'SWING_LOW');
        marketStructureEvents.push(event);
        registerKey(eventsByIndex, index, marketStructureEventKey(definition.id, event.kind));
        structure.activeSwingLow = event; // supersedes, never falls back
      }
    }
  }

  return { marketStructureEvents, eventsByIndex };
}
