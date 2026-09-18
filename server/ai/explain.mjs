/**
 * POST /api/ai/explain — AI-объяснение поверх структурированных фактов (docs/AI.md §3–5).
 *
 * Architecture:
 *   Browser → StructuredFacts → /api/ai/explain → OpenAI → structured AiExplanation → groundingGuard → Browser
 *
 * Key invariants:
 *   - OPENAI_API_KEY never reaches browser (server env only)
 *   - LLM output is structured JSON (validated at runtime)
 *   - Every number in output must exist in input facts (groundingGuard)
 *   - No trading commands, no price predictions, no guaranteed returns
 *   - On any AI failure, CRYPTORA terminal continues working
 *
 * ENV:
 *   OPENAI_API_KEY          — required for LLM (absent → 503 AI_NOT_CONFIGURED)
 *   OPENAI_MODEL            — default gpt-4o-mini
 *   AI_GATEWAY_PORT          — default 3100 (NOT 3000)
 *   AI_REQUEST_TIMEOUT_MS   — default 30000
 *   AI_MAX_OUTPUT_TOKENS    — default 800
 *   AI_RATE_LIMIT_PER_MIN   — default 10 (per-IP)
 *   AI_MAX_CONCURRENCY       — default 3
 *   AI_MAX_BODY_BYTES        — default 16384
 *   AI_CACHE_MAX_ENTRIES     — default 100 (LRU by digest of facts)
 */

import OpenAI from 'openai';
import crypto from 'node:crypto';
import { checkGrounding } from './groundingGuard.mjs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function readAiConfig(env = process.env) {
  const apiKey = (env.OPENAI_API_KEY ?? env.AI_API_KEY ?? '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: (env.OPENAI_MODEL ?? env.AI_MODEL ?? 'gpt-4o-mini').trim(),
    timeoutMs: Number(env.AI_REQUEST_TIMEOUT_MS) || 30_000,
    maxOutputTokens: Number(env.AI_MAX_OUTPUT_TOKENS) || 800,
    rateLimitPerMin: Number(env.AI_RATE_LIMIT_PER_MIN) || 10,
    maxConcurrency: Number(env.AI_MAX_CONCURRENCY) || 3,
    maxBodyBytes: Number(env.AI_MAX_BODY_BYTES) || 16_384,
    cacheMaxEntries: Number(env.AI_CACHE_MAX_ENTRIES) || 100,
  };
}

// ---------------------------------------------------------------------------
// System prompt — strict policy (docs/AI.md §6)
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = [
  'Ты — объясняющий слой аналитического терминала CRYPTORA. Терминал НЕ торгует и НЕ исполняет сделки.',
  '',
  'Тебе передан JSON со структурированными фактами. Каждое поле имеет origin: FACTUAL, DERIVED, MODEL_ESTIMATED или UNAVAILABLE.',
  'Твоя задача — объяснить взаимосвязь метрик простым русским языком.',
  '',
  'Ты ОБЯЗАН ответить строго валидным JSON без markdown-обёртки. Структура ответа:',
  '{',
  '  "summary": "1–2 предложения: ключевая картина",',
  '  "keyObservations": ["наблюдение 1", "наблюдение 2", ...],',
  '  "supportingFacts": ["факт из данных", ...],',
  '  "counterEvidence": ["альтернативная трактовка", ...],',
  '  "dataLimitations": ["какие данные отсутствуют или оценочные", ...],',
  '  "riskNotes": ["наблюдение по риску, НЕ рекомендация", ...]',
  '}',
  '',
  'СТРОГО ЗАПРЕЩЕНО:',
  '- называть числа, которых нет в переданных фактах;',
  '- прогнозировать цену или направление;',
  '- обещать доходность;',
  '- давать команды исполнения (покупать/продавать/открывать/закрывать);',
  '- упоминать стоп-лоссы, тейк-профиты, цели по цене;',
  '- представлять исторические данные как прогноз;',
  '- использовать данные с origin=UNAVAILABLE как факты.',
  '',
  'Если origin=MODEL_ESTIMATED — прямо укажи в dataLimitations, что это модельная оценка.',
  'Если origin=UNAVAILABLE — укажи, что данные отсутствуют и это ограничение анализа.',
  '',
  'Допустимые формулировки: «данные показывают…», «наблюдается…», «это может согласовываться с…».',
  'Решение всегда остаётся за пользователем.',
].join('\n');

// ---------------------------------------------------------------------------
// Structured Facts validation (whitelist only, no free-form strings from client)
// ---------------------------------------------------------------------------

const VALID_SYMBOL = /^[A-Z0-9]{2,12}$/;
const VALID_ORIGIN = new Set(['FACTUAL', 'DERIVED', 'MODEL_ESTIMATED', 'UNAVAILABLE']);

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

export function sanitizeStructuredFacts(input) {
  if (!input || typeof input !== 'object') return null;
  const f = {};

  // symbol — required
  if (typeof input.symbol !== 'string' || !VALID_SYMBOL.test(input.symbol)) return null;
  f.symbol = input.symbol;

  // timestamp — required ISO string
  if (typeof input.timestamp !== 'string' || input.timestamp.length > 40) return null;
  f.timestamp = input.timestamp;

  // spot — required
  if (!input.spot || typeof input.spot !== 'object') return null;
  const spot = {};
  if (!VALID_ORIGIN.has(input.spot.origin)) return null;
  spot.origin = input.spot.origin;
  if (!isFiniteNum(input.spot.price) || input.spot.price <= 0) return null;
  spot.price = input.spot.price;
  if (!isFiniteNum(input.spot.change24h)) return null;
  spot.change24h = input.spot.change24h;
  if (isFiniteNum(input.spot.change1h)) spot.change1h = input.spot.change1h;
  if (isFiniteNum(input.spot.change7d)) spot.change7d = input.spot.change7d;
  if (isFiniteNum(input.spot.volume24h)) spot.volume24h = input.spot.volume24h;
  if (isFiniteNum(input.spot.high24h)) spot.high24h = input.spot.high24h;
  if (isFiniteNum(input.spot.low24h)) spot.low24h = input.spot.low24h;
  if (isFiniteNum(input.spot.marketCap)) spot.marketCap = input.spot.marketCap;
  if (typeof input.spot.source === 'string' && input.spot.source.length <= 30) spot.source = input.spot.source;
  f.spot = spot;

  // derivatives — optional
  if (input.derivatives && typeof input.derivatives === 'object') {
    const d = {};
    if (!VALID_ORIGIN.has(input.derivatives.origin)) return null;
    d.origin = input.derivatives.origin;
    if (isFiniteNum(input.derivatives.openInterest)) d.openInterest = input.derivatives.openInterest;
    if (isFiniteNum(input.derivatives.openInterestDelta24h)) d.openInterestDelta24h = input.derivatives.openInterestDelta24h;
    if (isFiniteNum(input.derivatives.fundingRate8h)) d.fundingRate8h = input.derivatives.fundingRate8h;
    if (isFiniteNum(input.derivatives.basisPct)) d.basisPct = input.derivatives.basisPct;
    if (isFiniteNum(input.derivatives.markPrice)) d.markPrice = input.derivatives.markPrice;
    if (isFiniteNum(input.derivatives.indexPrice)) d.indexPrice = input.derivatives.indexPrice;
    f.derivatives = d;
  }

  // liquidations — optional
  if (input.liquidations && typeof input.liquidations === 'object') {
    const l = {};
    if (!VALID_ORIGIN.has(input.liquidations.origin)) return null;
    l.origin = input.liquidations.origin;
    if (isFiniteNum(input.liquidations.longLiquidations24h)) l.longLiquidations24h = input.liquidations.longLiquidations24h;
    if (isFiniteNum(input.liquidations.shortLiquidations24h)) l.shortLiquidations24h = input.liquidations.shortLiquidations24h;
    if (isFiniteNum(input.liquidations.totalUsd24h)) l.totalUsd24h = input.liquidations.totalUsd24h;
    if (isFiniteNum(input.liquidations.activeStreams)) l.activeStreams = input.liquidations.activeStreams;
    f.liquidations = l;
  }

  // indicators — optional
  if (input.indicators && typeof input.indicators === 'object') {
    const ind = {};
    if (!VALID_ORIGIN.has(input.indicators.origin)) return null;
    ind.origin = input.indicators.origin;
    if (isFiniteNum(input.indicators.rsi14)) ind.rsi14 = input.indicators.rsi14;
    if (isFiniteNum(input.indicators.sma20)) ind.sma20 = input.indicators.sma20;
    if (isFiniteNum(input.indicators.sma50)) ind.sma50 = input.indicators.sma50;
    if (isFiniteNum(input.indicators.sma200)) ind.sma200 = input.indicators.sma200;
    if (input.indicators.macd && typeof input.indicators.macd === 'object') {
      const m = input.indicators.macd;
      if (isFiniteNum(m.macd) && isFiniteNum(m.signal) && isFiniteNum(m.hist)) {
        ind.macd = { macd: m.macd, signal: m.signal, hist: m.hist };
      }
    }
    if (input.indicators.bollinger && typeof input.indicators.bollinger === 'object') {
      const b = input.indicators.bollinger;
      if (isFiniteNum(b.upper) && isFiniteNum(b.middle) && isFiniteNum(b.lower)) {
        ind.bollinger = { upper: b.upper, middle: b.middle, lower: b.lower };
        if (isFiniteNum(b.bandwidthPct)) ind.bollinger.bandwidthPct = b.bandwidthPct;
      }
    }
    f.indicators = ind;
  }

  // radar — optional
  if (input.radar && typeof input.radar === 'object') {
    const r = {};
    if (!VALID_ORIGIN.has(input.radar.origin)) return null;
    r.origin = input.radar.origin;
    if (Array.isArray(input.radar.anomalies)) {
      r.anomalies = input.radar.anomalies
        .slice(0, 10)
        .filter((a) => a && typeof a.type === 'string' && /^[A-Z_]{3,40}$/.test(a.type))
        .map((a) => {
          const item = { type: a.type };
          if (typeof a.metricValue === 'string') item.metricValue = a.metricValue.slice(0, 40);
          if (typeof a.severity === 'string' && /^(HIGH|MEDIUM|INFO)$/.test(a.severity)) item.severity = a.severity;
          return item;
        });
    } else {
      r.anomalies = [];
    }
    f.radar = r;
  }

  // models — optional
  if (input.models && typeof input.models === 'object') {
    const m = {};
    if (input.models.origin !== 'MODEL_ESTIMATED') return null;
    m.origin = 'MODEL_ESTIMATED';
    if (input.models.liquidationZones && typeof input.models.liquidationZones === 'object') {
      const lz = {};
      if (isFiniteNum(input.models.liquidationZones.longZone)) lz.longZone = input.models.liquidationZones.longZone;
      if (isFiniteNum(input.models.liquidationZones.shortZone)) lz.shortZone = input.models.liquidationZones.shortZone;
      if (Object.keys(lz).length > 0) m.liquidationZones = lz;
    }
    if (typeof input.models.heatmapAvailable === 'boolean') m.heatmapAvailable = input.models.heatmapAvailable;
    if (typeof input.models.leverageTiersAvailable === 'boolean') m.leverageTiersAvailable = input.models.leverageTiersAvailable;
    f.models = m;
  }

  return f;
}

// ---------------------------------------------------------------------------
// Simple per-IP rate limiter (sliding window, in-memory)
// ---------------------------------------------------------------------------

export class RateLimiter {
  constructor(maxPerMin = 10) {
    this.maxPerMin = maxPerMin;
    this.buckets = new Map(); // ip → [timestamps]
  }
  allow(ip) {
    const now = Date.now();
    const window = 60_000;
    let bucket = this.buckets.get(ip);
    if (!bucket) { bucket = []; this.buckets.set(ip, bucket); }
    // Prune old entries
    while (bucket.length > 0 && bucket[0] <= now - window) bucket.shift();
    if (bucket.length >= this.maxPerMin) return false;
    bucket.push(now);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Simple LRU cache by digest of facts
// ---------------------------------------------------------------------------

export class DigestCache {
  constructor(maxEntries = 100) {
    this.max = maxEntries;
    this.map = new Map();
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    // Evict oldest
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }
}

export function factsDigest(facts) {
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

export class ConcurrencyLimiter {
  constructor(max = 3) {
    this.max = max;
    this.running = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.running < this.max) { this.running++; return; }
    await new Promise((resolve) => this.queue.push(resolve));
    this.running++;
  }
  release() {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// LLM call — uses OpenAI SDK with dependency injection for tests
// ---------------------------------------------------------------------------

/**
 * @param {object} facts — sanitized StructuredFacts
 * @param {ReturnType<typeof readAiConfig>} cfg
 * @param {object} [client] — injectable OpenAI client for tests
 */
export async function explainWithLlm(facts, cfg, client = null) {
  const openai = client ?? new OpenAI({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs });

  const userContent = `Факты (JSON):\n${JSON.stringify(facts, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: cfg.model,
    temperature: 0.15,
    max_tokens: cfg.maxOutputTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const raw = response.choices?.[0]?.message?.content ?? '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'LLM returned invalid JSON' };
  }

  // Validate structured output
  if (!validateExplanation(parsed)) {
    return { ok: false, reason: 'LLM output failed schema validation' };
  }

  // Grounding check: every number in output must exist in input
  const allText = [
    parsed.summary,
    ...parsed.keyObservations,
    ...parsed.supportingFacts,
    ...parsed.counterEvidence,
    ...parsed.dataLimitations,
    ...parsed.riskNotes,
  ].join(' ');

  const guard = checkGrounding(allText, facts);
  if (!guard.ok) {
    return { ok: false, reason: `Grounding failed: ${guard.reason}` };
  }

  return { ok: true, explanation: parsed, model: cfg.model };
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateExplanation(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj;
  if (typeof o.summary !== 'string' || o.summary.length === 0) return false;
  if (!isStringArray(o.keyObservations)) return false;
  if (!isStringArray(o.supportingFacts)) return false;
  if (!isStringArray(o.counterEvidence)) return false;
  if (!isStringArray(o.dataLimitations)) return false;
  if (!isStringArray(o.riskNotes)) return false;
  for (const arr of [o.keyObservations, o.supportingFacts, o.counterEvidence, o.dataLimitations, o.riskNotes]) {
    if (arr.length > 20) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// HTTP handler for productionServer
// ---------------------------------------------------------------------------

/** Shared state instances (created once per process) */
let _rateLimiter = null;
let _concurrency = null;
let _cache = null;

function getState(cfg) {
  if (!_rateLimiter) _rateLimiter = new RateLimiter(cfg.rateLimitPerMin);
  if (!_concurrency) _concurrency = new ConcurrencyLimiter(cfg.maxConcurrency);
  if (!_cache) _cache = new DigestCache(cfg.cacheMaxEntries);
  return { rateLimiter: _rateLimiter, concurrency: _concurrency, cache: _cache };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {object} env
 * @param {object} [deps] — injectable deps for tests { openaiClient }
 */
export function handleAiExplain(req, res, env = process.env, deps = {}) {
  const cfg = readAiConfig(env);
  const send = (status, obj) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-AI-Engine': 'CRYPTORA-AI-v1',
    });
    res.end(JSON.stringify(obj));
  };

  if (req.method !== 'POST') return send(405, { error: 'Method Not Allowed' });
  if (!cfg) return send(503, { status: 'NOT_CONFIGURED', configured: false });

  const { rateLimiter, concurrency, cache } = getState(cfg);
  const ip = req.socket?.remoteAddress ?? 'unknown';

  if (!rateLimiter.allow(ip)) {
    return send(429, { status: 'RATE_LIMITED', reason: 'Превышен лимит запросов (10/мин)' });
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > cfg.maxBodyBytes) {
      req.destroy();
    }
  });

  req.on('end', async () => {
    let facts;
    try {
      facts = sanitizeStructuredFacts(JSON.parse(raw));
    } catch {
      facts = null;
    }
    if (!facts) return send(400, { error: 'Некорректные StructuredFacts' });

    // Check cache
    const digest = factsDigest(facts);
    const cached = cache.get(digest);
    if (cached) return send(200, { ...cached, cached: true });

    await concurrency.acquire();
    try {
      const result = await explainWithLlm(facts, cfg, deps.openaiClient ?? null);
      if (!result.ok) {
        return send(422, { status: 'REJECTED', reason: result.reason });
      }
      const response = {
        status: 'OK',
        explanation: result.explanation,
        model: result.model,
        generatedAt: new Date().toISOString(),
      };
      cache.set(digest, response);
      return send(200, response);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
        return send(504, { status: 'TIMEOUT', reason: 'Превышен таймаут LLM' });
      }
      if (msg.includes('429') || msg.includes('rate_limit')) {
        return send(429, { status: 'RATE_LIMITED', reason: 'Rate limit провайдера LLM' });
      }
      return send(502, { status: 'UNAVAILABLE', reason: `LLM недоступен: ${msg}` });
    } finally {
      concurrency.release();
    }
  });
}
