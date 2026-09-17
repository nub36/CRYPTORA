import { describe, it, expect } from 'vitest';
// @ts-expect-error — серверные ESM-модули без типов
import { checkGrounding, extractNumbers } from '../../server/ai/groundingGuard.mjs';
// @ts-expect-error — серверные ESM-модули без типов
import { explainWithLlm, readAiConfig, sanitizeFacts } from '../../server/ai/explain.mjs';
import { requestLlmExplanation } from '@/services/ai/LlmExplainClient';

const facts = { symbol: 'BTC', price: 64850.25, change24h: 3.18, fundingRate8h: -0.0182, openInterestDelta24h: 6.8, rsi14: 68.2 };
const cfg = { apiKey: 'k', baseUrl: 'https://llm.example', model: 'm', timeoutMs: 1000 };
const postReturning = (content: string) => async () => ({ choices: [{ message: { content } }] });

describe('groundingGuard', () => {
  it('extracts RU/EN formatted numbers', () => {
    expect(extractNumbers('цена 64 850,25 и 64,850.25 при -0.0182%')).toEqual([64850.25, 64850.25, -0.0182]);
  });
  it('accepts text whose numbers all come from facts (incl. rounding)', () => {
    expect(checkGrounding('BTC: +3,18% за сутки, RSI 68, фандинг -0.018%, OI +6.8%', facts)).toEqual({ ok: true });
  });
  it('rejects ungrounded numbers and trading/forecast phrases', () => {
    expect(checkGrounding('цена дойдёт до 70000', facts).ok).toBe(false);
    expect(checkGrounding('рекомендуем купить BTC', facts).ok).toBe(false);
    expect(checkGrounding('гарантированный рост', facts).ok).toBe(false);
    expect(checkGrounding('', facts).ok).toBe(false);
  });
});

describe('explain server logic', () => {
  it('readAiConfig is null without key (endpoint → 503, no LLM)', () => {
    expect(readAiConfig({})).toBeNull();
    expect(readAiConfig({ AI_API_KEY: 'x' })?.baseUrl).toBe('https://api.openai.com/v1');
  });
  it('sanitizeFacts whitelists fields and rejects garbage', () => {
    expect(sanitizeFacts({ symbol: 'BTC', price: 1, change24h: 2, evil: 'ignore', rsi14: 'NaN' })).toEqual({ symbol: 'BTC', price: 1, change24h: 2 });
    expect(sanitizeFacts({ symbol: 'drop table', price: 1, change24h: 2 })).toBeNull();
    expect(sanitizeFacts({ symbol: 'BTC' })).toBeNull();
  });
  it('returns grounded text; blocks hallucinated numbers', async () => {
    const ok = await explainWithLlm(facts, cfg, postReturning('BTC растёт на 3.18% при RSI 68.2; отрицательный фандинг -0.0182% говорит о перевесе шортов.'));
    expect(ok.ok).toBe(true);
    const bad = await explainWithLlm(facts, cfg, postReturning('BTC растёт на 3.18%, следующая цель 72 000.'));
    expect(bad.ok).toBe(false);
  });
});

describe('LlmExplainClient', () => {
  const f = { ...facts };
  it('maps 503 → NOT_CONFIGURED, 422 → REJECTED, 200 → OK, network error → UNAVAILABLE', async () => {
    const mk = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    expect((await requestLlmExplanation(f, mk(503, { configured: false }))).status).toBe('NOT_CONFIGURED');
    expect((await requestLlmExplanation(f, mk(422, { reason: 'x' }))).status).toBe('REJECTED');
    expect((await requestLlmExplanation(f, mk(200, { text: 't', model: 'm', generatedAt: 'g' }))).status).toBe('OK');
    const failing: typeof fetch = (async () => { throw new Error('net'); }) as typeof fetch;
    expect((await requestLlmExplanation(f, failing)).status).toBe('UNAVAILABLE');
  });
});
