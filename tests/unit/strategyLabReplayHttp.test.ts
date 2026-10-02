// @vitest-environment node
/**
 * Real HTTP acceptance harness for Strategy Lab replay. Only historical candle
 * acquisition is replaced; request validation, runReplay, the canonical draft
 * compiler/evaluator, simulator, and JSON serialization all remain real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import type { LabCandle } from '@/services/strategyLab/types';
import type { HttpClient } from '../helpers/httpHarness';
import {
  deterministicStrategyLabCandles,
  deterministicFractalCandles,
  STRATEGY_LAB_FIXTURE_BARS,
  STRATEGY_LAB_FIXTURE_FROM_MS,
  STRATEGY_LAB_FIXTURE_TO_MS,
  FRACTAL_FIXTURE_BARS,
  FRACTAL_FIXTURE_TO_MS,
  FRACTAL_CENTER_INDEX,
  FRACTAL_CONFIRMATION_INDEX,
  FRACTAL_FILL_INDEX,
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

let db: InstanceType<typeof MemoryDb>;
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

function orderBlockRetestCandles() {
  const source = 30;
  const confirmation = source + 1;
  const retest = source + 4;
  const fill = retest + 1;
  const candles = Array.from({ length: 48 }, (_, index) => {
    const time = Math.floor(STRATEGY_LAB_FIXTURE_FROM_MS / 1000) + index * 3600;
    const open = 100 + index * 0.1;
    return { time, closeTime: time + 3599, open, high: open + 0.3, low: open - 0.2, close: open + 0.1, volume: 1_000 + index };
  });
  candles[source] = { ...candles[source], open: 110, high: 110, low: 108.8, close: 109 };
  candles[confirmation] = { ...candles[confirmation], open: 109, high: 115, low: 109, close: 115 };
  candles[source + 2] = { ...candles[source + 2], open: 116, high: 116.4, low: 115.8, close: 116.1 };
  candles[source + 3] = { ...candles[source + 3], open: 117, high: 117.4, low: 116.8, close: 117.1 };
  candles[retest] = { ...candles[retest], open: 112, high: 116, low: 109, close: 109.5 };
  candles[fill] = { ...candles[fill], open: 111, high: 111.4, low: 110.8, close: 111.1 };
  return { candles, source, confirmation, retest, fill };
}

function orderBlockRetestDraft(longCondition = 'bullishOrderBlockRetest(ORDER_BLOCK_MAIN)') {
  return {
    name: 'Order Block retest HTTP replay',
    apiVersion: 2 as const,
    indicators: [
      { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 14, visible: false },
      { id: 'rsi-main', type: 'RSI' as const, name: 'RSI Main', period: 14, source: 'close' as const, visible: false },
      { id: 'order-block-main', type: 'ORDER_BLOCK' as const, name: 'Order Block', lookback: 5, displacementMultiplier: 1, atrIndicatorId: 'atr-main', visible: true },
    ],
    sourceCode: `strategy("Order Block retest HTTP replay", () => { LONG(${longCondition}); SHORT(bearishOrderBlockRetest(ORDER_BLOCK_MAIN)); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });`,
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

function mockOrderBlockRetestFixture(candles: LabCandle[]) {
  acquisitionSpies.read.mockResolvedValueOnce({
    covered: true,
    candles,
    meta: {
      datasetVersion: 'deterministic-order-block-retest-fixture-v1',
      manifestGeneratedAt: '2025-01-15T00:00:00.000Z',
      coverageFrom: new Date(STRATEGY_LAB_FIXTURE_FROM_MS).toISOString(),
      coverageTo: new Date(FRACTAL_FIXTURE_TO_MS).toISOString(),
      seriesSha256: 'd'.repeat(64),
    },
  });
}

function marketStructureCandles() {
  const values: Array<[number, number, number, number]> = [
    [95, 100, 90, 95], [105, 110, 95, 105], [100, 105, 92, 100], [111, 112, 100, 111],
    [91, 100, 90, 91], [100, 105, 93, 100], [89, 102, 88, 89], [106, 108, 100, 106],
    [102, 104, 101, 102], [109, 110, 105, 109], [110, 111, 108, 110],
  ];
  const candles = values.map(([open, high, low, close], index) => {
    const time = Math.floor(STRATEGY_LAB_FIXTURE_FROM_MS / 1000) + index * 3600;
    return { time, closeTime: time + 3599, open, high, low, close, volume: 1_000 + index };
  });
  return { candles, swingSource: 1, swingConfirmation: 2, choch: 7, fill: 8 };
}

function marketStructureDraft(longCondition = 'bullishCHoCH(MARKET_STRUCTURE_MAIN)', visible = true) {
  return {
    name: 'Market Structure HTTP replay',
    apiVersion: 2 as const,
    indicators: [
      { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 1, visible: false },
      { id: 'rsi-main', type: 'RSI' as const, name: 'RSI Main', period: 2, source: 'close' as const, visible: false },
      { id: 'market-structure-main', type: 'MARKET_STRUCTURE' as const, name: 'Market Structure', leftBars: 1, rightBars: 1, visible },
    ],
    sourceCode: `strategy("Market Structure HTTP replay", () => { LONG(${longCondition}); SHORT(bearishCHoCH(MARKET_STRUCTURE_MAIN)); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });`,
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

function mockMarketStructureFixture(candles: LabCandle[]) {
  acquisitionSpies.read.mockResolvedValueOnce({
    covered: true,
    candles,
    meta: {
      datasetVersion: 'deterministic-market-structure-fixture-v1',
      manifestGeneratedAt: '2025-01-15T00:00:00.000Z',
      coverageFrom: new Date(STRATEGY_LAB_FIXTURE_FROM_MS).toISOString(),
      coverageTo: new Date(FRACTAL_FIXTURE_TO_MS).toISOString(),
      seriesSha256: 'e'.repeat(64),
    },
  });
}

function allIndicatorsDraft() {
  return {
    name: 'All indicator capabilities',
    apiVersion: 2 as const,
    indicators: [
      { id: 'ema-fast', type: 'EMA' as const, name: 'EMA Fast', period: 20, source: 'close' as const, visible: true },
      { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 14, visible: false },
      { id: 'rsi-main', type: 'RSI' as const, name: 'RSI 14', period: 14, source: 'close' as const, visible: false },
      { id: 'fractal-main', type: 'FRACTALS' as const, name: 'Fractals', period: 5, visible: true },
    ],
    sourceCode: 'strategy("All indicator capabilities", () => { LONG(below(RSI_MAIN, 30)); SHORT(fractalHigh(FRACTAL_MAIN)); STOP(multiply(ATR_MAIN, 1.5)); TAKE_PROFIT(R(2)); });',
    execution: { feeBps: 5, slippageBps: 2 },
  };
}

beforeAll(async () => {
  db = new MemoryDb();
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

  it('accepts the exact same all-indicator draft for save and replay', async () => {
    const sameDraft = allIndicatorsDraft();
    const saved = await client.post('/api/strategy-lab/saved-strategies', sameDraft);
    expect(saved.status).toBe(201);
    expect((saved.body as any).strategy).toMatchObject({
      name: sameDraft.name,
      indicators: sameDraft.indicators,
      sourceCode: sameDraft.sourceCode,
      apiVersion: sameDraft.apiVersion,
    });

    const replayed = await client.post('/api/strategy-lab/replay', replayBody(sameDraft));
    expect(replayed.status).toBe(200);
    expect((replayed.body as any).meta).toMatchObject({ strategyId: 'CODE_DRAFT', researchOnly: true });
    expect(db.savedStrategies).toHaveLength(1);
  });

  it('rejects an unknown RSI identifier through replay HTTP validation', async () => {
    const draft = allIndicatorsDraft();
    draft.sourceCode = draft.sourceCode.replace('RSI_MAIN', 'RSI_UNKNOWN');
    const response = await client.post('/api/strategy-lab/replay', replayBody(draft));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_STRATEGY_CODE' });
  });

  it('rejects fractalHigh applied to EMA through replay HTTP validation', async () => {
    const draft = allIndicatorsDraft();
    draft.sourceCode = draft.sourceCode.replace('fractalHigh(FRACTAL_MAIN)', 'fractalHigh(EMA_FAST)');
    const response = await client.post('/api/strategy-lab/replay', replayBody(draft));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_STRATEGY_CODE' });
  });

  it('rejects RSI threshold 101 through replay HTTP validation', async () => {
    const draft = allIndicatorsDraft();
    draft.sourceCode = draft.sourceCode.replace('below(RSI_MAIN, 30)', 'below(RSI_MAIN, 101)');
    const response = await client.post('/api/strategy-lab/replay', replayBody(draft));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_STRATEGY_CODE' });
  });

  it('rejects FRACTALS period 7 through request schema validation', async () => {
    const draft = allIndicatorsDraft();
    draft.indicators = draft.indicators.map((indicator) =>
      indicator.id === 'fractal-main' ? { ...indicator, period: 7 } : indicator
    );
    const response = await client.post('/api/strategy-lab/replay', replayBody(draft));
    expect(response.status).toBe(400);
  });

  it('confirms a LOW Fractal at i+2 and fills only at i+3', async () => {
    const candles = deterministicFractalCandles();
    acquisitionSpies.read.mockResolvedValueOnce({
      covered: true,
      candles,
      meta: {
        datasetVersion: 'deterministic-fractal-fixture-v1',
        manifestGeneratedAt: '2025-01-15T00:00:00.000Z',
        coverageFrom: new Date(STRATEGY_LAB_FIXTURE_FROM_MS).toISOString(),
        coverageTo: new Date(FRACTAL_FIXTURE_TO_MS).toISOString(),
        seriesSha256: 'b'.repeat(64),
      },
    });

    const draft = {
      name: 'Confirmed Fractal HTTP replay',
      apiVersion: 2 as const,
      indicators: [
        { id: 'fractal-main', type: 'FRACTALS' as const, name: 'Fractals', period: 5, visible: true },
        { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 14, visible: false },
      ],
      sourceCode: 'strategy("Confirmed Fractal HTTP replay", () => { LONG(fractalLow(FRACTAL_MAIN)); SHORT(fractalHigh(FRACTAL_MAIN)); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });',
      execution: { feeBps: 0, slippageBps: 0 },
    };

    const response = await client.post('/api/strategy-lab/replay', {
      ...replayBody(draft),
      to: FRACTAL_FIXTURE_TO_MS,
    });
    expect(response.status).toBe(200);

    const result = response.body as any;
    expect(result.candles).toHaveLength(FRACTAL_FIXTURE_BARS);
    const event = result.indicators.fractalEvents.find(
      (candidate: any) =>
        candidate.indicatorId === 'fractal-main' &&
        candidate.kind === 'LOW' &&
        candidate.sourceIndex === FRACTAL_CENTER_INDEX
    );
    expect(event).toEqual({
      indicatorId: 'fractal-main',
      kind: 'LOW',
      sourceIndex: FRACTAL_CENTER_INDEX,
      sourceCandleTime: candles[FRACTAL_CENTER_INDEX].time,
      confirmationIndex: FRACTAL_CONFIRMATION_INDEX,
      knownAt: candles[FRACTAL_CONFIRMATION_INDEX].closeTime,
      price: candles[FRACTAL_CENTER_INDEX].low,
    });
    expect(event.knownAt).toBeGreaterThan(event.sourceCandleTime);
    expect(result.indicators.fractalEvents.filter((candidate: any) => candidate.kind === 'LOW'))
      .toHaveLength(1);
    expect(result.indicators.fractalEvents.some((candidate: any) => candidate.kind === 'HIGH'))
      .toBe(false);

    const trade = result.trades.find(
      (candidate: any) => candidate.side === 'LONG' && candidate.signalTime === candles[FRACTAL_CONFIRMATION_INDEX].time
    );
    expect(trade).toBeDefined();
    expect(trade.entryTime).toBe(candles[FRACTAL_FILL_INDEX].time);
    expect(trade.entryPrice).toBe(candles[FRACTAL_FILL_INDEX].open);

    const fills = result.events.filter(
      (candidate: any) => candidate.kind === 'ENTRY' || candidate.kind === 'FILL'
    );
    expect(fills.some((candidate: any) => candidate.candleTime === candles[FRACTAL_CENTER_INDEX].time)).toBe(false);
    expect(fills.some((candidate: any) => candidate.candleTime === candles[FRACTAL_CENTER_INDEX + 1].time)).toBe(false);
    expect(fills.some((candidate: any) => candidate.candleTime === candles[FRACTAL_CONFIRMATION_INDEX].time)).toBe(false);
    expect(fills.filter((candidate: any) => candidate.candleTime === candles[FRACTAL_FILL_INDEX].time))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'ENTRY', side: 'LONG' }),
        expect.objectContaining({ kind: 'FILL', side: 'LONG', price: candles[FRACTAL_FILL_INDEX].open }),
      ]));
  });

  it('confirms an Order Block only at j close and fills directly at open(j+1)', async () => {
    const source = 30;
    const confirmation = source + 1;
    const fill = confirmation + 1;
    const candles = Array.from({ length: 48 }, (_, index) => {
      const time = Math.floor(STRATEGY_LAB_FIXTURE_FROM_MS / 1000) + index * 3600;
      const open = 100 + index * 0.1;
      return { time, closeTime: time + 3599, open, high: open + 0.3, low: open - 0.2, close: open + 0.1, volume: 1_000 + index };
    });
    candles[source] = { ...candles[source], open: 110, high: 110, low: 108.8, close: 109 };
    candles[confirmation] = { ...candles[confirmation], open: 109, high: 115, low: 109, close: 115 };
    candles[fill] = { ...candles[fill], open: 116, high: 116.4, low: 115.8, close: 116.1 };
    acquisitionSpies.read.mockResolvedValueOnce({
      covered: true,
      candles,
      meta: {
        datasetVersion: 'deterministic-order-block-fixture-v1',
        manifestGeneratedAt: '2025-01-15T00:00:00.000Z',
        coverageFrom: new Date(STRATEGY_LAB_FIXTURE_FROM_MS).toISOString(),
        coverageTo: new Date(FRACTAL_FIXTURE_TO_MS).toISOString(),
        seriesSha256: 'c'.repeat(64),
      },
    });
    const draft = {
      name: 'Order Block HTTP replay',
      apiVersion: 2 as const,
      indicators: [
        { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 14, visible: false },
        { id: 'order-block-main', type: 'ORDER_BLOCK' as const, name: 'Order Block', lookback: 5, displacementMultiplier: 1, atrIndicatorId: 'atr-main', visible: true },
      ],
      sourceCode: 'strategy("Order Block HTTP replay", () => { LONG(bullishOrderBlock(ORDER_BLOCK_MAIN)); SHORT(bearishOrderBlock(ORDER_BLOCK_MAIN)); STOP(multiply(ATR_MAIN, 0.1)); TAKE_PROFIT(R(1)); });',
      execution: { feeBps: 0, slippageBps: 0 },
    };
    const response = await client.post('/api/strategy-lab/replay', { ...replayBody(draft), to: FRACTAL_FIXTURE_TO_MS });
    expect(response.status).toBe(200);
    const result = response.body as any;
    const block = result.orderBlocks.find((candidate: any) => candidate.indicatorId === 'order-block-main' && candidate.direction === 'BULLISH');
    expect(block).toMatchObject({
      sourceIndex: source,
      sourceCandleTime: candles[source].time,
      confirmationIndex: confirmation,
      confirmationCandleTime: candles[confirmation].time,
      knownAt: candles[confirmation].closeTime,
      low: candles[source].low,
      high: candles[source].high,
    });
    const trade = result.trades.find((candidate: any) => candidate.side === 'LONG' && candidate.signalTime === candles[confirmation].time);
    expect(trade).toMatchObject({ entryTime: candles[fill].time, entryPrice: candles[fill].open });
    expect(result.events.some((candidate: any) => candidate.kind === 'CANDIDATE' && candidate.candleTime < candles[confirmation].time)).toBe(false);
    expect(result.events.some((candidate: any) => (candidate.kind === 'ENTRY' || candidate.kind === 'FILL') && candidate.candleTime === candles[confirmation].time)).toBe(false);
  });

  it('proves retest no-look-ahead through the official server replay and fills only at open(k+1)', async () => {
    const { candles, source, confirmation, retest, fill } = orderBlockRetestCandles();
    mockOrderBlockRetestFixture(candles);
    const response = await client.post('/api/strategy-lab/replay', {
      ...replayBody(orderBlockRetestDraft()),
      to: FRACTAL_FIXTURE_TO_MS,
    });
    expect(response.status).toBe(200);

    const result = response.body as any;
    const block = result.orderBlocks.find((candidate: any) => candidate.direction === 'BULLISH');
    expect(block).toMatchObject({ sourceIndex: source, confirmationIndex: confirmation, mitigationIndex: retest });
    expect(result.events.some((event: any) => event.kind === 'CANDIDATE' && event.candleTime === candles[confirmation].time)).toBe(false);
    expect(result.trades.some((trade: any) => trade.signalTime < candles[retest].time)).toBe(false);
    expect(result.events.some((event: any) => (event.kind === 'ENTRY' || event.kind === 'FILL') && event.candleTime === candles[retest].time)).toBe(false);

    const trade = result.trades.find((candidate: any) => candidate.side === 'LONG' && candidate.signalTime === candles[retest].time);
    expect(trade).toMatchObject({ entryTime: candles[fill].time, entryPrice: candles[fill].open });
    expect(result.events.find((event: any) => event.kind === 'CANDIDATE' && event.candleTime === candles[retest].time))
      .toMatchObject({ knownAt: candles[retest].closeTime, side: 'LONG' });
  });

  it('executes recursively composed retest and RSI conditions through the official replay path', async () => {
    const fixture = orderBlockRetestCandles();
    mockOrderBlockRetestFixture(fixture.candles);
    const matching = orderBlockRetestDraft('all(bullishOrderBlockRetest(ORDER_BLOCK_MAIN), below(RSI_MAIN, 100))');
    const saved = await client.post('/api/strategy-lab/saved-strategies', matching);
    expect(saved.status).toBe(201);
    expect((saved.body as any).strategy.sourceCode).toBe(matching.sourceCode);
    const listed = await client.get('/api/strategy-lab/saved-strategies');
    const loaded = (listed.body as any).strategies.find((strategy: any) => strategy.sourceCode === matching.sourceCode);
    expect(loaded).toBeDefined();
    const loadedDraft = {
      name: loaded.name,
      indicators: loaded.indicators,
      sourceCode: loaded.sourceCode,
      execution: loaded.execution,
      apiVersion: loaded.apiVersion,
    };
    const accepted = await client.post('/api/strategy-lab/replay', { ...replayBody(loadedDraft), to: FRACTAL_FIXTURE_TO_MS });
    expect(accepted.status).toBe(200);
    const acceptedResult = accepted.body as any;
    expect(acceptedResult.indicators.byIndicatorId['rsi-main'][fixture.retest]).toBeLessThan(100);
    expect(acceptedResult.trades.some((trade: any) => trade.side === 'LONG' && trade.signalTime === fixture.candles[fixture.retest].time)).toBe(true);

    mockOrderBlockRetestFixture(fixture.candles);
    const blocked = orderBlockRetestDraft('all(bullishOrderBlockRetest(ORDER_BLOCK_MAIN), below(RSI_MAIN, 0))');
    const rejected = await client.post('/api/strategy-lab/replay', { ...replayBody(blocked), to: FRACTAL_FIXTURE_TO_MS });
    expect(rejected.status).toBe(200);
    expect((rejected.body as any).trades.some((trade: any) => trade.side === 'LONG')).toBe(false);
  });


  it('replays Market Structure chronology, no-look-ahead timing, composition, and saved-draft parity through real HTTP', async () => {
    const fixture = marketStructureCandles();
    const matching = marketStructureDraft('all(bullishCHoCH(MARKET_STRUCTURE_MAIN), below(RSI_MAIN, 100))');
    const saved = await client.post('/api/strategy-lab/saved-strategies', matching);
    expect(saved.status).toBe(201);
    const listed = await client.get('/api/strategy-lab/saved-strategies');
    const loaded = (listed.body as any).strategies.find((entry: any) => entry.sourceCode === matching.sourceCode);
    expect(loaded).toBeDefined();

    mockMarketStructureFixture(fixture.candles);
    const response = await client.post('/api/strategy-lab/replay', {
      ...replayBody({ name: loaded.name, indicators: loaded.indicators, sourceCode: loaded.sourceCode, execution: loaded.execution, apiVersion: loaded.apiVersion }),
      to: FRACTAL_FIXTURE_TO_MS,
    });
    expect(response.status).toBe(200);
    const result = response.body as any;
    const swing = result.marketStructureEvents.find((event: any) => event.kind === 'SWING_HIGH' && event.sourceIndex === fixture.swingSource);
    expect(swing).toMatchObject({
      id: `ms:market-structure-main:SWING_HIGH:${fixture.swingSource}:${fixture.swingConfirmation}`,
      confirmationIndex: fixture.swingConfirmation,
      knownAt: fixture.candles[fixture.swingConfirmation].closeTime,
    });
    const breakEvent = result.marketStructureEvents.find((event: any) => event.kind === 'BULLISH_CHOCH' && event.breakIndex === fixture.choch);
    expect(breakEvent).toMatchObject({
      knownAt: fixture.candles[fixture.choch].closeTime,
      previousState: 'BEARISH',
      newState: 'BULLISH',
    });
    expect(result.marketStructureEvents.some((event: any) => event.kind === 'BULLISH_CHOCH' && event.breakIndex < fixture.choch)).toBe(false);
    const candidate = result.events.find((event: any) => event.kind === 'CANDIDATE' && event.candleTime === fixture.candles[fixture.choch].time && event.side === 'LONG');
    const trade = result.trades.find((entry: any) => entry.side === 'LONG' && entry.signalTime === fixture.candles[fixture.choch].time);
    expect(candidate).toMatchObject({ knownAt: fixture.candles[fixture.choch].closeTime });
    expect(trade).toMatchObject({ entryTime: fixture.candles[fixture.fill].time, entryPrice: fixture.candles[fixture.fill].open });
    expect(result.events.some((event: any) => (event.kind === 'ENTRY' || event.kind === 'FILL') && event.candleTime === fixture.candles[fixture.choch].time)).toBe(false);

    mockMarketStructureFixture(fixture.candles);
    const blocked = marketStructureDraft('all(bullishCHoCH(MARKET_STRUCTURE_MAIN), below(RSI_MAIN, 0))');
    const rejected = await client.post('/api/strategy-lab/replay', { ...replayBody(blocked), to: FRACTAL_FIXTURE_TO_MS });
    expect(rejected.status).toBe(200);
    expect((rejected.body as any).trades.some((entry: any) => entry.side === 'LONG' && entry.signalTime === fixture.candles[fixture.choch].time)).toBe(false);
  });

  it('rejects invalid Market Structure settings and wrong Market Structure DSL types through HTTP before persistence', async () => {
    const invalidSettings = marketStructureDraft();
    (invalidSettings.indicators[2] as { leftBars: number }).leftBars = 0;
    const invalidSaved = await client.post('/api/strategy-lab/saved-strategies', invalidSettings);
    expect(invalidSaved.status).toBe(400);

    const wrongType = marketStructureDraft('bullishBOS(ATR_MAIN)');
    const invalidReplay = await client.post('/api/strategy-lab/replay', replayBody(wrongType));
    expect(invalidReplay.status).toBe(400);
    expect(invalidReplay.body).toMatchObject({ code: 'INVALID_STRATEGY_CODE' });
  });

  it('uses only the mocked local candle acquisition boundary', () => {
    expect(acquisitionSpies.inspect).toHaveBeenCalled();
    expect(acquisitionSpies.read).toHaveBeenCalled();
    expect(acquisitionSpies.fetch).not.toHaveBeenCalled();
  });
});
