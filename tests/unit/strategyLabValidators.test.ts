/**
 * CRYPTORA — Strategy Lab · тесты серверной валидации (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Проверяют zod-схему POST /api/strategy-lab/replay: границы диапазона, лимит
 * свечей, порядок дат, валидацию StrategyDraftDefinition (индикаторы, правила,
 * стоп/цель, ссылки на индикаторы), символ, таймфрейм. Сервер — источник истины.
 */

import { describe, it, expect } from 'vitest';
import {
  parseReplayRequest,
  replayRequestSchema,
  strategyDefinitionSchema,
  LAB_MAX_CANDLES,
  LAB_TF_MS,
} from '../../server/validators/strategyLab.js';

const HOUR = LAB_TF_MS['1h'];

function validDraftDefinition() {
  return {
    name: 'EMA Cross + ATR',
    indicators: [
      { id: 'ema-20', type: 'EMA', name: 'EMA 20', period: 20, source: 'close', visible: true },
      { id: 'ema-50', type: 'EMA', name: 'EMA 50', period: 50, source: 'close', visible: true },
      { id: 'atr-14', type: 'ATR', name: 'ATR 14', period: 14, visible: false },
    ],
    long: {
      left: 'ema-20',
      operator: 'crossesAbove',
      right: 'ema-50',
    },
    short: {
      left: 'ema-20',
      operator: 'crossesBelow',
      right: 'ema-50',
    },
    stop: {
      type: 'atrMultiple',
      indicatorId: 'atr-14',
      multiplier: 1.5,
    },
    target: {
      type: 'rMultiple',
      multiplier: 2.0, // or multiple
      multiple: 2.0,
    },
    execution: {
      feeBps: 5,
      slippageBps: 2,
    },
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  const to = 1_700_000_000_000;
  const from = to - 200 * HOUR;
  return {
    strategyDefinition: validDraftDefinition(),
    market: 'spot',
    symbol: 'btcusdt',
    timeframe: '1h',
    from,
    to,
    ...overrides,
  };
}

describe('Strategy Lab · replayRequestSchema & StrategyDraftDefinition', () => {
  it('валидное тело с strategyDefinition проходит и нормализует символ в верхний регистр', () => {
    const parsed = parseReplayRequest(validBody());
    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.market).toBe('spot');
    expect(parsed.timeframe).toBe('1h');
    expect(parsed.strategyDefinition?.name).toBe('EMA Cross + ATR');
    expect(parsed.strategyDefinition?.indicators).toHaveLength(3);
  });

  it('принимает ISO-строки дат', () => {
    const parsed = parseReplayRequest(
      validBody({ from: '2024-01-01T00:00:00Z', to: '2024-01-05T00:00:00Z' })
    );
    expect(typeof parsed.from).toBe('number');
    expect(parsed.from).toBeLessThan(parsed.to);
  });

  it('отклоняет from ≥ to', () => {
    const r = replayRequestSchema.safeParse(validBody({ from: 2_000, to: 1_000 }));
    expect(r.success).toBe(false);
  });

  it('отклоняет диапазон, превышающий лимит свечей (5000)', () => {
    const to = 1_700_000_000_000;
    const from = to - (LAB_MAX_CANDLES + 500) * HOUR;
    const r = replayRequestSchema.safeParse(validBody({ from, to }));
    expect(r.success).toBe(false);
  });

  it('отклоняет некорректный символ и таймфрейм', () => {
    expect(replayRequestSchema.safeParse(validBody({ symbol: 'BTC/USDT!' })).success).toBe(false);
    expect(replayRequestSchema.safeParse(validBody({ timeframe: '3m' })).success).toBe(false);
  });

  it('отклоняет неизвестный индикатор в правиле LONG', () => {
    const def = validDraftDefinition();
    def.long.left = 'unknown-indicator';
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });

  it('отклоняет неизвестный индикатор в правиле SHORT', () => {
    const def = validDraftDefinition();
    def.short.right = 'non-existent-ema';
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });

  it('отклоняет неверный тип индикатора в правиле пересечения (ATR вместо EMA)', () => {
    const def = validDraftDefinition();
    def.long.left = 'atr-14'; // ATR нельзя использовать в EMA пересечении
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });

  it('отклоняет совпадение левого и правого индикатора в правиле', () => {
    const def = validDraftDefinition();
    def.long.right = 'ema-20'; // left: ema-20, right: ema-20
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });

  it('отклоняет неизвестный или не-ATR индикатор для стопа', () => {
    const def1 = validDraftDefinition();
    def1.stop.indicatorId = 'unknown-atr';
    expect(strategyDefinitionSchema.safeParse(def1).success).toBe(false);

    const def2 = validDraftDefinition();
    def2.stop.indicatorId = 'ema-20'; // EMA вместо ATR
    expect(strategyDefinitionSchema.safeParse(def2).success).toBe(false);
  });

  it('отклоняет дублирующиеся ID индикаторов', () => {
    const def = validDraftDefinition();
    def.indicators.push({
      id: 'ema-20',
      type: 'EMA' as const,
      name: 'EMA 20 Dup',
      period: 200,
      visible: true,
    });
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });

  it('отклоняет пустой список индикаторов', () => {
    const def = validDraftDefinition();
    def.indicators = [];
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });

  it('отклоняет параметры исполнения вне допустимых границ (feeBps > 100)', () => {
    const def = validDraftDefinition();
    def.execution = { feeBps: 150, slippageBps: 2 };
    const r = strategyDefinitionSchema.safeParse(def);
    expect(r.success).toBe(false);
  });
});
