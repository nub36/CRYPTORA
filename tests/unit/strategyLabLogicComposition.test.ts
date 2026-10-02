import { describe, expect, it } from 'vitest';
import type { LabCandle } from '@/services/strategyLab/types';
import {
  compileResearchDraft,
  MAX_CONDITION_DEPTH,
  MAX_CONDITION_NODES,
} from '@/services/strategyLab/draft/compile';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';

const START = 1_710_000_000;

function candle(index: number, open: number, high: number, low: number, close: number): LabCandle {
  const time = START + index * 60;
  return { time, closeTime: time + 59, open, high, low, close, volume: 1 };
}

function oscillatingCandles(count = 32): LabCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = index % 2 === 0 ? 100 : 101;
    const close = index % 2 === 0 ? 101 : 100;
    return candle(index, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close);
  });
}

function logicDraft(long: string, short = 'below(RSI_MAIN, 0)') {
  return {
    name: 'Logical composition',
    apiVersion: 2 as const,
    indicators: [
      { id: 'rsi-main', type: 'RSI' as const, name: 'RSI Main', period: 2, source: 'close' as const, visible: false },
      { id: 'atr-stop', type: 'ATR' as const, name: 'ATR Stop', period: 2, visible: false },
    ],
    sourceCode: `strategy("Logical composition", () => { LONG(${long}); SHORT(${short}); STOP(multiply(ATR_STOP, 0.1)); TAKE_PROFIT(R(1)); });`,
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

function candidates(long: string): number {
  const compiled = compileResearchDraft(logicDraft(long));
  expect(compiled.ok).toBe(true);
  return evaluateDraftStrategy(oscillatingCandles(), compiled.definition!).candidateCount;
}

describe('Strategy Lab safe logical composition', () => {
  it('evaluates all when every child is true and rejects the decision when one child is false', () => {
    expect(candidates('all(above(RSI_MAIN, 0), below(RSI_MAIN, 100))')).toBeGreaterThan(0);
    expect(candidates('all(above(RSI_MAIN, 0), below(RSI_MAIN, 0))')).toBe(0);
  });

  it('evaluates any when one child is true and rejects it when all children are false', () => {
    expect(candidates('any(below(RSI_MAIN, 0), above(RSI_MAIN, 0))')).toBeGreaterThan(0);
    expect(candidates('any(below(RSI_MAIN, 0), above(RSI_MAIN, 100))')).toBe(0);
  });

  it('evaluates not as a pure boolean negation', () => {
    expect(candidates('not(above(RSI_MAIN, 0))')).toBe(0);
    expect(candidates('not(below(RSI_MAIN, 0))')).toBeGreaterThan(0);
  });

  it('compiles and evaluates nested all(any(...), not(...)) on the same decision candle', () => {
    const source = 'all(any(below(RSI_MAIN, 0), above(RSI_MAIN, 0)), not(below(RSI_MAIN, 0)))';
    const compiled = compileResearchDraft(logicDraft(source));
    expect(compiled).toMatchObject({
      ok: true,
      definition: {
        long: {
          kind: 'all',
          conditions: [
            { kind: 'any' },
            { kind: 'not' },
          ],
        },
      },
    });
    expect(evaluateDraftStrategy(oscillatingCandles(), compiled.definition!).candidateCount).toBeGreaterThan(0);
  });

  it.each([
    ['all()', 'не менее двух'],
    ['all(above(RSI_MAIN, 0))', 'не менее двух'],
    ['any()', 'не менее двух'],
    ['any(above(RSI_MAIN, 0))', 'не менее двух'],
    ['not()', 'ровно одно'],
    ['not(above(RSI_MAIN, 0), below(RSI_MAIN, 100))', 'ровно одно'],
  ])('rejects invalid logical arity: %s', (condition, message) => {
    const result = compileResearchDraft(logicDraft(condition));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain(message);
  });

  it('continues to reject an unknown child function instead of allowing arbitrary expressions', () => {
    const result = compileResearchDraft(logicDraft('all(above(RSI_MAIN, 0), unknownCondition(RSI_MAIN))'));
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes('Неизвестная функция'))).toBe(true);
  });

  it('rejects condition trees beyond the explicit depth and node limits', () => {
    let tooDeep = 'below(RSI_MAIN, 50)';
    for (let depth = 0; depth < MAX_CONDITION_DEPTH; depth += 1) tooDeep = `not(${tooDeep})`;
    const deep = compileResearchDraft(logicDraft(tooDeep));
    expect(deep.ok).toBe(false);
    expect(deep.errors[0]?.message).toContain(`глубина условий (${MAX_CONDITION_DEPTH})`);

    const oversized = `all(${Array.from({ length: MAX_CONDITION_NODES }, () => 'below(RSI_MAIN, 50)').join(', ')})`;
    const nodes = compileResearchDraft(logicDraft(oversized));
    expect(nodes.ok).toBe(false);
    expect(nodes.errors[0]?.message).toContain(`число условий (${MAX_CONDITION_NODES})`);
  });

  it('retains every recursively referenced indicator and the Order Block ATR dependency canonically', () => {
    const draft = {
      name: 'Recursive dependencies',
      apiVersion: 2 as const,
      indicators: [
        { id: 'atr-stop', type: 'ATR' as const, name: 'ATR Stop', period: 14, visible: false },
        { id: 'atr-ob', type: 'ATR' as const, name: 'ATR OB', period: 14, visible: false },
        { id: 'rsi-main', type: 'RSI' as const, name: 'RSI Main', period: 14, source: 'close' as const, visible: false },
        { id: 'order-block-main', type: 'ORDER_BLOCK' as const, name: 'Order Block', lookback: 5, displacementMultiplier: 1, atrIndicatorId: 'atr-ob', visible: true },
      ],
      sourceCode: 'strategy("Recursive dependencies", () => { LONG(all(below(RSI_MAIN, 40), bullishOrderBlockRetest(ORDER_BLOCK_MAIN))); SHORT(any(above(RSI_MAIN, 60), bearishOrderBlockRetest(ORDER_BLOCK_MAIN))); STOP(multiply(ATR_STOP, 1.5)); TAKE_PROFIT(R(2)); });',
      execution: { feeBps: 0, slippageBps: 0 },
    };
    const compiled = compileResearchDraft(draft);
    expect(compiled.ok).toBe(true);
    expect(compiled.definition?.indicators.map((indicator) => indicator.id)).toEqual([
      'rsi-main', 'order-block-main', 'atr-ob', 'atr-stop',
    ]);
  });

  it('evaluates insideBullishOrderBlock only after confirmation and fills at the next open', () => {
    const draft = {
      name: 'Inside Order Block',
      apiVersion: 2 as const,
      indicators: [
        { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 1, visible: false },
        { id: 'order-block-main', type: 'ORDER_BLOCK' as const, name: 'Order Block', lookback: 5, displacementMultiplier: 1, atrIndicatorId: 'atr-main', visible: true },
      ],
      sourceCode: 'strategy("Inside Order Block", () => { LONG(insideBullishOrderBlock(ORDER_BLOCK_MAIN)); SHORT(insideBearishOrderBlock(ORDER_BLOCK_MAIN)); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });',
      execution: { feeBps: 0, slippageBps: 0 },
    };
    const candles = [
      candle(0, 100, 100, 90, 95),
      candle(1, 95, 102, 95, 102), // confirmation; not yet eligible for inside
      candle(2, 102, 103, 96, 97), // close is inside source zone [90, 100]
      candle(3, 98, 99, 97, 98), // fill
    ];
    const compiled = compileResearchDraft(draft);
    expect(compiled.ok).toBe(true);
    const result = evaluateDraftStrategy(candles, compiled.definition!);
    expect(result.events.find((event) => event.kind === 'CANDIDATE')).toMatchObject({ candleTime: candles[2].time, side: 'LONG' });
    expect(result.events.find((event) => event.kind === 'FILL')).toMatchObject({ candleTime: candles[3].time, price: candles[3].open });
    expect(result.events.some((event) => event.kind === 'CANDIDATE' && event.candleTime === candles[1].time)).toBe(false);
  });
});
