/**
 * CRYPTORA — Strategy Lab · тесты серверной валидации (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Проверяют zod-схему POST /api/strategy-lab/replay: границы диапазона, лимит
 * свечей, порядок дат, EMA Slow > EMA Fast, символ, таймфрейм. Сервер — источник
 * истины; фронт ничего из этого не решает.
 */

import { describe, it, expect } from 'vitest';
import {
  parseReplayRequest,
  replayRequestSchema,
  LAB_MAX_CANDLES,
  LAB_TF_MS,
} from '../../server/validators/strategyLab.js';

const HOUR = LAB_TF_MS['1h'];

function validBody(overrides: Record<string, unknown> = {}) {
  const to = 1_700_000_000_000;
  const from = to - 200 * HOUR;
  return {
    strategyId: 'EMA_ATR',
    market: 'spot',
    symbol: 'btcusdt',
    timeframe: '1h',
    from,
    to,
    researchConfig: {
      indicators: { emaFast: 20, emaSlow: 50, atrPeriod: 14 },
      strategy: { stopAtrMult: 1.5, targetR: 2 },
      execution: { feeBps: 5, slippageBps: 2 },
    },
    ...overrides,
  };
}

describe('Strategy Lab · replayRequestSchema', () => {
  it('валидное тело проходит и нормализует символ в верхний регистр', () => {
    const parsed = parseReplayRequest(validBody());
    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.market).toBe('spot');
    expect(parsed.timeframe).toBe('1h');
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

  it('отклоняет EMA Slow ≤ EMA Fast', () => {
    const r = replayRequestSchema.safeParse(
      validBody({
        researchConfig: {
          indicators: { emaFast: 50, emaSlow: 50, atrPeriod: 14 },
          strategy: { stopAtrMult: 1.5, targetR: 2 },
          execution: { feeBps: 5, slippageBps: 2 },
        },
      })
    );
    expect(r.success).toBe(false);
  });

  it('отклоняет диапазон, превышающий лимит свечей', () => {
    const to = 1_700_000_000_000;
    const from = to - (LAB_MAX_CANDLES + 500) * HOUR;
    const r = replayRequestSchema.safeParse(validBody({ from, to }));
    expect(r.success).toBe(false);
  });

  it('отклоняет некорректный символ и таймфрейм', () => {
    expect(replayRequestSchema.safeParse(validBody({ symbol: 'BTC/USDT!' })).success).toBe(false);
    expect(replayRequestSchema.safeParse(validBody({ timeframe: '3m' })).success).toBe(false);
  });

  it('отклоняет параметры вне допустимых границ (feeBps > 100)', () => {
    const r = replayRequestSchema.safeParse(
      validBody({
        researchConfig: {
          indicators: { emaFast: 20, emaSlow: 50, atrPeriod: 14 },
          strategy: { stopAtrMult: 1.5, targetR: 2 },
          execution: { feeBps: 500, slippageBps: 2 },
        },
      })
    );
    expect(r.success).toBe(false);
  });
});
