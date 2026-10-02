// @vitest-environment node
/**
 * Real HTTP acceptance harness for Strategy Lab replay. Only historical candle
 * acquisition is replaced; request validation, runReplay, the canonical draft
 * compiler/evaluator, simulator, and JSON serialization all remain real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import type { HttpClient } from '../helpers/httpHarness';
import {
  deterministicStrategyLabCandles,
  STRATEGY_LAB_FIXTURE_BARS,
  STRATEGY_LAB_FIXTURE_FROM_MS,
  STRATEGY_LAB_FIXTURE_TO_MS,
} from '../helpers/strategyLabCandles';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.REGISTER_RATE_LIMIT = '100000';
process.env.API_RATE_LIMIT = '1000000';
process.env.SESSION_STORE = 'memory';
process.env.MAIL_TRANSPORT = 'json';

const acquisitionSpies = vi.hoisted(() => ({
  fetch: vi.fn(async () => { throw new Error('Network candle fallback must not run'); }),
  inspect: vi.fn(async () => ({ datasetAvailable: true, covered: true })),
  read: vi.fn(async () => ({
    covered: true,
    candles: deterministicStrategyLabCandles(),
    meta: {
      datasetVersion: 'deterministic-http-fixture-v1',
      manifestGeneratedAt: '2025-01-15T00:00:00.000Z',
      coverageFrom: new Date(STRATEGY_LAB_FIXTURE_FROM_MS).toISOString(),
      coverageTo: new Date(STRATEGY_LAB_FIXTURE_TO_MS).toISOString(),
      seriesSha256: 'a'.repeat(64),
    },
  })),
}));

vi.mock('../../server/services/strategyLab/historicalCandles.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchLabCandles: acquisitionSpies.fetch };
});

vi.mock('../../server/services/strategyLab/localHistoricalCandles.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    inspectLocalSeriesCoverage: acquisitionSpies.inspect,
    readLocalHistoricalCandles: acquisitionSpies.read,
  };
});

const { createApp } = await import('../../server/app.js');
const { __setPoolForTests } = await import('../../server/db/pool.js');
const { MemoryDb } = await import('../helpers/memoryDb');
const { listen } = await import('../helpers/httpHarness');
const { defaultResearchDraft } = await import('@/services/strategyLab/draft');

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_EMAIL = 'replay-admin@cryptora.test';
const PASSWORD = 'correct horse battery staple';

let client: HttpClient;
let close: () => Promise<void>;

function replayBody(strategyDraft: unknown) {
  return {
    market: 'spot',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    from: STRATEGY_LAB_FIXTURE_FROM_MS,
    to: STRATEGY_LAB_FIXTURE_TO_MS,
    strategyDraft,
  };
}

beforeAll(async () => {
  const db = new MemoryDb();
  __setPoolForTests(db.asPool());
  db.users.push({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    display_name: 'Replay Admin',
    password_hash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    role: 'admin',
    is_active: true,
    email_verified: true,
    email_verified_at: new Date('2025-01-01T00:00:00.000Z'),
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    last_login_at: null,
  });
  const harness = await listen(createApp({ sessionStore: 'memory' }));
  client = harness.client;
  close = harness.close;
  const login = await client.post('/api/auth/login', { email: ADMIN_EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await close();
  __setPoolForTests(null);
});

describe('Strategy Lab replay · deterministic real HTTP path', () => {
  it('replays the existing EMA/ATR draft through the real server path', async () => {
    const response = await client.post('/api/strategy-lab/replay', replayBody(defaultResearchDraft()));
    expect(response.status).toBe(200);

    const result = response.body as any;
    expect(result.meta).toMatchObject({
      strategyId: 'CODE_DRAFT',
      researchOnly: true,
      dataSource: 'local-dataset',
    });
    expect(result.candles).toHaveLength(STRATEGY_LAB_FIXTURE_BARS);
    expect(result.indicators.byIndicatorId['ema-fast']).toHaveLength(STRATEGY_LAB_FIXTURE_BARS);
    expect(result.indicators.byIndicatorId['atr-main'].some((value: number | null) => value !== null)).toBe(true);
    expect(result.metrics).toEqual(expect.objectContaining({ trades: expect.any(Number) }));
  });

  it('accepts RSI threshold DSL and returns the official RSI series by stable ID', async () => {
    const draft = {
      name: 'RSI HTTP replay',
      apiVersion: 2 as const,
      indicators: [
        { id: 'rsi-main', type: 'RSI' as const, name: 'RSI Main', period: 14, source: 'close' as const },
        { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 14 },
      ],
      sourceCode: 'strategy("RSI HTTP replay", () => { LONG(below(RSI_MAIN, 30)); SHORT(above(RSI_MAIN, 70)); STOP(multiply(ATR_MAIN, 1.5)); TAKE_PROFIT(R(2)); });',
      execution: { feeBps: 5, slippageBps: 2 },
    };

    const response = await client.post('/api/strategy-lab/replay', replayBody(draft));
    expect(response.status).toBe(200);

    const result = response.body as any;
    const rsi: Array<number | null> = result.indicators.byIndicatorId['rsi-main'];
    expect(result.meta).toMatchObject({ strategyId: 'CODE_DRAFT', researchOnly: true });
    expect(result.indicators.indicatorsList).toContainEqual(expect.objectContaining({ id: 'rsi-main', type: 'RSI' }));
    expect(rsi).toHaveLength(STRATEGY_LAB_FIXTURE_BARS);
    expect(rsi.slice(0, 14)).toEqual(new Array(14).fill(null));
    expect(rsi.slice(14).some((value) => value !== null)).toBe(true);
  });

  it('uses only the mocked local candle acquisition boundary', () => {
    expect(acquisitionSpies.inspect).toHaveBeenCalled();
    expect(acquisitionSpies.read).toHaveBeenCalled();
    expect(acquisitionSpies.fetch).not.toHaveBeenCalled();
  });
});
