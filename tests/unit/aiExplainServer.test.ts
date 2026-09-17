import { describe, it, expect } from 'vitest';
// @ts-expect-error — серверные ESM-модули без типов
import { checkGrounding, extractNumbers } from '../../server/ai/groundingGuard.mjs';
// @ts-expect-error — серверные ESM-модули без типов
import { sanitizeStructuredFacts, sanitizeFacts, readAiConfig, RateLimiter, DigestCache, factsDigest } from '../../server/ai/explain.mjs';
import { requestLlmExplanation, buildCoinDetailFacts, marketContextFactToStructured } from '@/services/ai/LlmExplainClient';
import { validateAiExplanation } from '@/services/ai/AiOutputContract';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFacts = {
  symbol: 'BTC',
  timestamp: '2026-09-17T12:00:00Z',
  spot: {
    origin: 'FACTUAL',
    price: 64850.25,
    change24h: 3.18,
    volume24h: 28_500_000_000,
    source: 'binance',
  },
  derivatives: {
    origin: 'FACTUAL',
    fundingRate8h: -0.0182,
    openInterestDelta24h: 6.8,
  },
  indicators: {
    origin: 'DERIVED',
    rsi14: 68.2,
    macd: { macd: 120.5, signal: 95.2, hist: 25.3 },
    sma20: 64200,
    sma50: 63000,
    sma200: 58000,
    bollinger: { upper: 66500, middle: 64200, lower: 61900 },
  },
  radar: {
    origin: 'FACTUAL',
    anomalies: [{ type: 'VOLUME_SPIKE', metricValue: '+3.4σ', severity: 'HIGH' }],
  },
};

// cfg fixture kept for future direct explainWithLlm tests
// const cfg = { apiKey: 'k', model: 'gpt-4o-mini', timeoutMs: 1000, maxOutputTokens: 800, rateLimitPerMin: 10, maxConcurrency: 3, maxBodyBytes: 16384, cacheMaxEntries: 100 };

const goodExplanation = {
  summary: 'BTC растёт на 3.18% при RSI 68.2',
  keyObservations: ['RSI 68.2 близок к зоне перекупленности', 'Фандинг отрицательный -0.0182%'],
  supportingFacts: ['Объём +3.4σ от нормы'],
  counterEvidence: ['Отрицательный фандинг может указывать на шорт-сквиз'],
  dataLimitations: [],
  riskNotes: ['RSI выше 68 — возможна коррекция'],
};

// ---------------------------------------------------------------------------
// groundingGuard
// ---------------------------------------------------------------------------

describe('groundingGuard', () => {
  it('extracts RU/EN formatted numbers', () => {
    expect(extractNumbers('цена 64 850,25 и 64,850.25 при -0.0182%')).toEqual([64850.25, 64850.25, -0.0182]);
  });
  it('accepts text whose numbers all come from facts (incl. rounding)', () => {
    expect(checkGrounding('BTC: +3,18% за сутки, RSI 68, фандинг -0.018%, OI +6.8%', baseFacts)).toEqual({ ok: true });
  });
  it('rejects ungrounded numbers and trading/forecast phrases', () => {
    expect(checkGrounding('цена дойдёт до 70000', baseFacts).ok).toBe(false);
    expect(checkGrounding('рекомендуем купить BTC', baseFacts).ok).toBe(false);
    expect(checkGrounding('гарантированный рост', baseFacts).ok).toBe(false);
    expect(checkGrounding('', baseFacts).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeStructuredFacts
// ---------------------------------------------------------------------------

describe('sanitizeStructuredFacts', () => {
  it('accepts valid StructuredFacts with all groups', () => {
    const result = sanitizeStructuredFacts(baseFacts);
    expect(result).not.toBeNull();
    expect(result.symbol).toBe('BTC');
    expect(result.spot.price).toBe(64850.25);
    expect(result.derivatives.fundingRate8h).toBe(-0.0182);
    expect(result.indicators.rsi14).toBe(68.2);
    expect(result.radar.anomalies).toHaveLength(1);
  });
  it('rejects garbage symbol', () => {
    expect(sanitizeStructuredFacts({ ...baseFacts, symbol: 'drop table' })).toBeNull();
  });
  it('rejects missing spot', () => {
    const { spot, ...rest } = baseFacts;
    expect(sanitizeStructuredFacts(rest)).toBeNull();
  });
  it('rejects negative price', () => {
    expect(sanitizeStructuredFacts({ ...baseFacts, spot: { ...baseFacts.spot, price: -100 } })).toBeNull();
  });
  it('whitelists only known numeric fields', () => {
    const result = sanitizeStructuredFacts({ ...baseFacts, evil: 'ignore', spot: { ...baseFacts.spot, hacked: 999 } });
    expect(result).not.toBeNull();
    expect(result.evil).toBeUndefined();
  });
  it('accepts minimal facts (only spot)', () => {
    const minimal = { symbol: 'ETH', timestamp: '2026-09-17T12:00:00Z', spot: { origin: 'FACTUAL', price: 3450, change24h: -1.2, volume24h: 15e9, source: 'binance' } };
    expect(sanitizeStructuredFacts(minimal)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

describe('validateAiExplanation', () => {
  it('accepts valid structured output', () => {
    expect(validateAiExplanation(goodExplanation)).toBe(true);
  });
  it('rejects missing summary', () => {
    expect(validateAiExplanation({ ...goodExplanation, summary: '' })).toBe(false);
  });
  it('rejects non-array keyObservations', () => {
    expect(validateAiExplanation({ ...goodExplanation, keyObservations: 'not array' })).toBe(false);
  });
  it('rejects too many items (> 20)', () => {
    expect(validateAiExplanation({ ...goodExplanation, keyObservations: Array(21).fill('x') })).toBe(false);
  });
  it('rejects null/undefined', () => {
    expect(validateAiExplanation(null)).toBe(false);
    expect(validateAiExplanation(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readAiConfig
// ---------------------------------------------------------------------------

describe('readAiConfig', () => {
  it('is null without key', () => {
    expect(readAiConfig({})).toBeNull();
  });
  it('reads OPENAI_API_KEY', () => {
    const cfg = readAiConfig({ OPENAI_API_KEY: 'sk-test' });
    expect(cfg).not.toBeNull();
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.model).toBe('gpt-4o-mini');
  });
  it('falls back to legacy AI_API_KEY', () => {
    const cfg = readAiConfig({ AI_API_KEY: 'legacy-key' });
    expect(cfg).not.toBeNull();
    expect(cfg.apiKey).toBe('legacy-key');
  });
  it('respects OPENAI_MODEL', () => {
    const cfg = readAiConfig({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-4o' });
    expect(cfg.model).toBe('gpt-4o');
  });
});

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  it('allows up to maxPerMin requests', () => {
    const rl = new RateLimiter(3);
    expect(rl.allow('ip1')).toBe(true);
    expect(rl.allow('ip1')).toBe(true);
    expect(rl.allow('ip1')).toBe(true);
    expect(rl.allow('ip1')).toBe(false);
  });
  it('different IPs have separate buckets', () => {
    const rl = new RateLimiter(1);
    expect(rl.allow('ip1')).toBe(true);
    expect(rl.allow('ip2')).toBe(true);
    expect(rl.allow('ip1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DigestCache
// ---------------------------------------------------------------------------

describe('DigestCache', () => {
  it('stores and retrieves', () => {
    const c = new DigestCache(5);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
  });
  it('evicts LRU', () => {
    const c = new DigestCache(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // evicts 'a'
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// factsDigest
// ---------------------------------------------------------------------------

describe('factsDigest', () => {
  it('returns consistent hash for same input', () => {
    expect(factsDigest({ a: 1 })).toBe(factsDigest({ a: 1 }));
  });
  it('returns different hash for different input', () => {
    expect(factsDigest({ a: 1 })).not.toBe(factsDigest({ a: 2 }));
  });
  it('returns 16-char hex', () => {
    expect(factsDigest({ x: true })).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// buildCoinDetailFacts
// ---------------------------------------------------------------------------

describe('buildCoinDetailFacts', () => {
  it('builds valid StructuredFacts from coin detail params', () => {
    const facts = buildCoinDetailFacts({
      symbol: 'BTC',
      price: 65000,
      change24h: 2.5,
      volume24h: 28e9,
      rsi14: 62,
      fundingRate8h: 0.01,
      anomalies: [{ type: 'VOLUME_SPIKE', metricValue: '+2σ' }],
    });
    expect(facts.symbol).toBe('BTC');
    expect(facts.spot.price).toBe(65000);
    expect(facts.indicators?.rsi14).toBe(62);
    expect(facts.derivatives?.fundingRate8h).toBe(0.01);
    expect(facts.radar?.anomalies).toHaveLength(1);
    // Passes server-side validation
    expect(sanitizeStructuredFacts(facts)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// marketContextFactToStructured
// ---------------------------------------------------------------------------

describe('marketContextFactToStructured', () => {
  it('converts MarketContextFact to StructuredFacts', () => {
    const mcf = { symbol: 'ETH', price: 3450, change24h: -1.2, fundingRate8h: -0.02, rsi14: 28 };
    const sf = marketContextFactToStructured(mcf);
    expect(sf.symbol).toBe('ETH');
    expect(sf.spot.price).toBe(3450);
    expect(sf.derivatives?.fundingRate8h).toBe(-0.02);
    expect(sf.indicators?.rsi14).toBe(28);
    expect(sanitizeStructuredFacts(sf)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LlmExplainClient
// ---------------------------------------------------------------------------

describe('LlmExplainClient', () => {
  it('maps 503 → NOT_CONFIGURED', async () => {
    const mk = (status: number, body: unknown): typeof fetch =>
      (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const result = await requestLlmExplanation(baseFacts as any, mk(503, { configured: false }));
    expect(result.status).toBe('NOT_CONFIGURED');
  });
  it('maps 422 → REJECTED', async () => {
    const mk = (status: number, body: unknown): typeof fetch =>
      (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const result = await requestLlmExplanation(baseFacts as any, mk(422, { reason: 'ungrounded' }));
    expect(result.status).toBe('REJECTED');
  });
  it('maps 200 with valid explanation → OK', async () => {
    const body = { status: 'OK', explanation: goodExplanation, model: 'gpt-4o-mini', generatedAt: '2026-09-17T12:00:00Z' };
    const mk: typeof fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const result = await requestLlmExplanation(baseFacts as any, mk);
    expect(result.status).toBe('OK');
    expect(result.explanation?.summary).toContain('BTC');
  });
  it('maps 200 with legacy text → OK (backward compat)', async () => {
    const body = { configured: true, grounded: true, text: 'BTC растёт на 3.18%', model: 'gpt-4o-mini', generatedAt: '2026-09-17T12:00:00Z' };
    const mk: typeof fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const result = await requestLlmExplanation(baseFacts as any, mk);
    expect(result.status).toBe('OK');
    expect(result.explanation?.summary).toContain('3.18%');
  });
  it('maps network error → UNAVAILABLE', async () => {
    const failing: typeof fetch = (async () => { throw new Error('net'); }) as typeof fetch;
    const result = await requestLlmExplanation(baseFacts as any, failing);
    expect(result.status).toBe('UNAVAILABLE');
  });
  it('maps 429 → RATE_LIMITED', async () => {
    const mk: typeof fetch = (async () => new Response(JSON.stringify({ reason: 'rate limited' }), { status: 429 })) as typeof fetch;
    const result = await requestLlmExplanation(baseFacts as any, mk);
    expect(result.status).toBe('RATE_LIMITED');
  });
});
