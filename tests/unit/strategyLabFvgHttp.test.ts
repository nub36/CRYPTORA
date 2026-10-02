// @vitest-environment node
/**
 * Real HTTP acceptance coverage for Fair Value Gap V1 (RESEARCH ONLY).
 *
 * Uses the deterministic server replay harness: only historical candle
 * acquisition is replaced; request validation, the canonical compiler, the
 * Lab engine, the execution simulator and persistence all remain real.
 *
 * Covers:
 *  • creation timing — candidate known only after close(C), entry open(C+1);
 *  • first-retest timing — no earlier candidate, entry open(k+1);
 *  • zero slippage ⇒ exact open fill prices;
 *  • Saved Strategy round trip (create / list / PUT rename / list);
 *  • STRICT FVG wire schema — invented settings reject BEFORE any DB write;
 *  • save/replay same-draft parity.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import type { LabCandle } from '@/services/strategyLab/types';
import type { HttpClient } from '../helpers/httpHarness';
import {
  deterministicStrategyLabCandles,
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
      datasetVersion: 'deterministic-fvg-http-fixture-v1',
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
const { indicatorIdentifier } = await import('@/services/strategyLab/draft/identifiers');

const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_EMAIL = 'fvg-admin@cryptora.test';
const PASSWORD = 'correct horse battery staple';

let db: InstanceType<typeof MemoryDb>;
let client: HttpClient;
let close: () => Promise<void>;

const BASE_SECONDS = Math.floor(STRATEGY_LAB_FIXTURE_FROM_MS / 1000);

function bar(index: number, open: number, high: number, low: number, close: number): LabCandle {
  const time = BASE_SECONDS + index * 3600;
  return { time, closeTime: time + 3599, open, high, low, close, volume: 1_000 + index };
}

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

function mockFixture(candles: LabCandle[], version: string) {
  acquisitionSpies.read.mockResolvedValueOnce({
    covered: true,
    candles,
    meta: {
      datasetVersion: version,
      manifestGeneratedAt: '2025-01-15T00:00:00.000Z',
      coverageFrom: new Date(STRATEGY_LAB_FIXTURE_FROM_MS).toISOString(),
      coverageTo: new Date(STRATEGY_LAB_FIXTURE_TO_MS).toISOString(),
      seriesSha256: 'f'.repeat(64),
    },
  });
}

/**
 * Exactly one bullish FVG: candle 30 gaps above high[28] (zone [100.5, 101.5]).
 * The wick on candle 29 suppresses a follow-up gap at 31; later lows (102)
 * never re-enter the zone, so the zone stays ACTIVE and untouched.
 */
function fvgCreationCandles() {
  const candles: LabCandle[] = [];
  for (let i = 0; i < 30; i += 1) candles.push(bar(i, 100, i === 29 ? 102.5 : 100.5, 99.5, 100));
  candles.push(bar(30, 102, 103, 101.5, 102.5)); // C — confirmation
  for (let i = 31; i < 48; i += 1) candles.push(bar(i, 102.5, 103, 102, 102.5));
  return { candles, confirmation: 30, entry: 31 };
}

/**
 * One bullish FVG confirmed at 30 (zone [100.5, 104]); price floats above the
 * zone until candle 36 dips to 103.8 — the FIRST range overlap (no full fill).
 */
function fvgRetestCandles() {
  const candles: LabCandle[] = [];
  for (let i = 0; i < 30; i += 1) candles.push(bar(i, 100, i === 29 ? 105 : 100.5, 99.5, 100));
  candles.push(bar(30, 104, 105, 104, 104.5)); // C — zone [100.5, 104]
  for (let i = 31; i < 36; i += 1) candles.push(bar(i, 105, 105.5, 104.5, 105));
  candles.push(bar(36, 105, 105.5, 103.8, 105)); // first touch
  for (let i = 37; i < 48; i += 1) candles.push(bar(i, 105, 105.5, 104.5, 105));
  return { candles, confirmation: 30, retest: 36, entry: 37 };
}

function fvgDraft(longCondition: string, name = 'FVG HTTP replay', visible = true) {
  return {
    name,
    apiVersion: 2 as const,
    indicators: [
      { id: 'fvg-main', type: 'FVG' as const, name: 'Fair Value Gap', visible },
      { id: 'atr-main', type: 'ATR' as const, name: 'ATR Main', period: 14, visible: false },
    ],
    sourceCode: `strategy(${JSON.stringify(name)}, () => { LONG(${longCondition}); SHORT(bearishFvg(FVG_MAIN)); STOP(multiply(ATR_MAIN, 0.5)); TAKE_PROFIT(R(1)); });`,
    execution: { feeBps: 0, slippageBps: 0 },
  };
}

beforeAll(async () => {
  db = new MemoryDb();
  __setPoolForTests(db.asPool());
  db.users.push({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    display_name: 'FVG Admin',
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

describe('Strategy Lab FVG · HTTP creation timing', () => {
  it('confirms the gap only at close(C) and enters at open(C+1) with the exact open price', async () => {
    const { candles, confirmation, entry } = fvgCreationCandles();
    mockFixture(candles, 'deterministic-fvg-creation-fixture-v1');

    const response = await client.post('/api/strategy-lab/replay', replayBody(fvgDraft('bullishFvg(FVG_MAIN)')));
    expect(response.status).toBe(200);
    const result = response.body as any;

    expect(result.fairValueGaps).toHaveLength(1);
    expect(result.fairValueGaps[0]).toMatchObject({
      id: 'fvg:fvg-main:BULLISH:28:30',
      direction: 'BULLISH',
      low: 100.5,
      high: 101.5,
      state: 'ACTIVE',
      knownAt: candles[confirmation].closeTime, // known after close(C) only
    });

    const candidates = (result.events as any[]).filter((event) => event.kind === 'CANDIDATE');
    expect(candidates).toHaveLength(1); // no earlier candidate anywhere
    expect(candidates[0].candleTime).toBe(candles[confirmation].time);
    expect(candidates[0].knownAt).toBe(candles[confirmation].closeTime);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.signalTime).toBe(candles[confirmation].time);
    // Not fillable at open(C): execution is next-bar-open.
    expect(trade.entryTime).toBe(candles[entry].time);
    expect(trade.entryPrice).toBe(candles[entry].open); // zero slippage: exact open
  });
});

describe('Strategy Lab FVG · HTTP first-retest timing', () => {
  it('fires only on the first range overlap k, known at close(k), entering at open(k+1)', async () => {
    const { candles, confirmation, retest, entry } = fvgRetestCandles();
    mockFixture(candles, 'deterministic-fvg-retest-fixture-v1');

    const response = await client.post('/api/strategy-lab/replay', replayBody(fvgDraft('bullishFvgRetest(FVG_MAIN)', 'FVG retest HTTP replay')));
    expect(response.status).toBe(200);
    const result = response.body as any;

    expect(result.fairValueGaps).toHaveLength(1);
    expect(result.fairValueGaps[0]).toMatchObject({
      direction: 'BULLISH',
      confirmationIndex: confirmation,
      state: 'PARTIALLY_FILLED',
      firstTouchIndex: retest,
      firstTouchedAt: candles[retest].closeTime,
    });

    const candidates = (result.events as any[]).filter((event) => event.kind === 'CANDIDATE');
    expect(candidates).toHaveLength(1); // no candidate before the first touch
    expect(candidates[0].candleTime).toBe(candles[retest].time);
    expect(candidates[0].knownAt).toBe(candles[retest].closeTime);

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.signalTime).toBe(candles[retest].time);
    // No fill at open(k): entry waits for the next bar open.
    expect(trade.entryTime).toBe(candles[entry].time);
    expect(trade.entryPrice).toBe(candles[entry].open);
  });
});

describe('Strategy Lab FVG · Saved Strategies round trip', () => {
  it('creates, lists, renames and relists an FVG strategy preserving identity and visibility', async () => {
    const draft = fvgDraft('bullishFvg(FVG_MAIN)', 'FVG Saved', false);
    const created = await client.post('/api/strategy-lab/saved-strategies', draft);
    expect(created.status).toBe(201);
    const saved = (created.body as any).strategy;
    expect(saved.indicators).toEqual(draft.indicators);

    const listed = await client.get('/api/strategy-lab/saved-strategies');
    expect(listed.status).toBe(200);
    const fromList = (listed.body as any).strategies.find((item: any) => item.id === saved.id);
    expect(fromList.name).toBe('FVG Saved');
    const fvg = fromList.indicators.find((ind: any) => ind.type === 'FVG');
    expect(fvg).toEqual({ id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: false });

    const renamed = await client.request('PUT', `/api/strategy-lab/saved-strategies/${saved.id}`, {
      body: { ...draft, name: 'FVG Renamed', sourceCode: draft.sourceCode.replace('"FVG Saved"', '"FVG Renamed"') },
    });
    expect(renamed.status).toBe(200);

    const relisted = await client.get('/api/strategy-lab/saved-strategies');
    const after = (relisted.body as any).strategies.find((item: any) => item.id === saved.id);
    expect(after.name).toBe('FVG Renamed'); // display name changed…
    const fvgAfter = after.indicators.find((ind: any) => ind.type === 'FVG');
    expect(fvgAfter.id).toBe('fvg-main'); // …while the stable id…
    expect(fvgAfter.visible).toBe(false); // …and visibility are preserved.
    expect(indicatorIdentifier(fvgAfter.id)).toBe('FVG_MAIN'); // code identifier stays FVG_MAIN
  });

  it('REJECTS invented FVG settings with the strict wire schema before any DB write', async () => {
    const invented: Array<Record<string, unknown>> = [
      { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true, period: 3 },
      { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true, source: 'close' },
      { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true, atrIndicatorId: 'atr-main' },
      { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true, displacementMultiplier: 1.5 },
    ];
    for (const indicator of invented) {
      const draft = { ...fvgDraft('bullishFvg(FVG_MAIN)', 'FVG Invalid') };
      (draft.indicators as unknown[]) = [indicator, draft.indicators[1]];
      const before = db.savedStrategies.length;
      const beforeWrites = db.executed.filter((sql) => /INSERT INTO strategy_lab_saved_strategies/i.test(sql)).length;
      const response = await client.post('/api/strategy-lab/saved-strategies', draft);
      expect(response.status).toBe(400); // silently stripping (period: 3 …) is forbidden
      expect(db.savedStrategies.length).toBe(before);
      expect(db.executed.filter((sql) => /INSERT INTO strategy_lab_saved_strategies/i.test(sql)).length).toBe(beforeWrites);
    }
  });

  it('replays a saved FVG draft with exact same-draft parity', async () => {
    const { candles } = fvgCreationCandles();
    const draft = fvgDraft('bullishFvg(FVG_MAIN)', 'FVG Parity');

    mockFixture(candles, 'deterministic-fvg-parity-a');
    const direct = await client.post('/api/strategy-lab/replay', replayBody(draft));
    expect(direct.status).toBe(200);

    const created = await client.post('/api/strategy-lab/saved-strategies', draft);
    expect(created.status).toBe(201);
    const saved = (created.body as any).strategy;
    const roundTripped = {
      name: saved.name,
      indicators: saved.indicators,
      sourceCode: saved.sourceCode,
      execution: saved.execution,
      apiVersion: saved.apiVersion,
    };

    mockFixture(candles, 'deterministic-fvg-parity-b');
    const replayed = await client.post('/api/strategy-lab/replay', replayBody(roundTripped));
    expect(replayed.status).toBe(200);

    const a = direct.body as any;
    const b = replayed.body as any;
    expect(b.trades).toEqual(a.trades);
    expect(b.fairValueGaps).toEqual(a.fairValueGaps);
    expect(b.events).toEqual(a.events);
    expect(b.rejections).toEqual(a.rejections);
    expect(b.metrics).toEqual(a.metrics);
  });
});
