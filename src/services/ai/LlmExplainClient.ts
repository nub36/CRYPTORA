/**
 * Клиент серверного эндпоинта /api/ai/explain (docs/AI.md §3–5).
 *
 * Ключ LLM живёт только на сервере.
 * Результат — структурированный AiExplanation или явное состояние ошибки.
 *
 * Endpoint: POST /api/ai/explain
 * Input:    StructuredFacts (validated both client-side and server-side)
 * Output:   AiExplainResponse
 */

import type { StructuredFacts } from './StructuredFacts';
import type { AiExplanation, AiExplainResponse, AiExplainStatus } from './AiOutputContract';
import { validateAiExplanation } from './AiOutputContract';
import type { MarketContextFact } from './AiExplanationEngine';

// Re-export for convenience
export type { AiExplanation, AiExplainResponse, AiExplainStatus };

/**
 * Convert legacy MarketContextFact (from AiExplanationEngine) to StructuredFacts.
 * Used by RadarPage which builds MarketContextFact for the deterministic engine
 * and passes the same facts to the LLM endpoint.
 */
export function marketContextFactToStructured(f: MarketContextFact): StructuredFacts {
  return {
    symbol: f.symbol,
    timestamp: new Date().toISOString(),
    spot: {
      origin: 'FACTUAL',
      price: f.price,
      change24h: f.change24h,
      volume24h: 0,
      source: 'binance',
    },
    ...(f.fundingRate8h !== undefined || f.openInterestDelta24h !== undefined
      ? {
          derivatives: {
            origin: 'FACTUAL' as const,
            ...(f.fundingRate8h !== undefined && { fundingRate8h: f.fundingRate8h }),
            ...(f.openInterestDelta24h !== undefined && { openInterestDelta24h: f.openInterestDelta24h }),
          },
        }
      : {}),
    ...(f.rsi14 !== undefined
      ? {
          indicators: {
            origin: 'DERIVED' as const,
            rsi14: f.rsi14,
          },
        }
      : {}),
    ...(f.anomalies && f.anomalies.length > 0
      ? {
          radar: {
            origin: 'FACTUAL' as const,
            anomalies: f.anomalies.map((a) => ({
              type: a.type,
              metricValue: a.metricValue,
              severity: a.severity,
            })),
          },
        }
      : {}),
  };
}

/**
 * Build StructuredFacts from CoinDetail data.
 * Each group gets its own origin tag based on how the data was obtained.
 */
export function buildCoinDetailFacts(params: {
  symbol: string;
  price: number;
  change24h: number;
  change1h?: number;
  change7d?: number;
  volume24h: number;
  high24h?: number;
  low24h?: number;
  marketCap?: number;
  source?: string;
  // Derivatives
  openInterest?: number;
  openInterestDelta24h?: number;
  fundingRate8h?: number;
  basisPct?: number;
  markPrice?: number;
  indexPrice?: number;
  derivativesOrigin?: 'FACTUAL' | 'DERIVED' | 'MODEL_ESTIMATED' | 'UNAVAILABLE';
  // Liquidations
  longLiquidations24h?: number;
  shortLiquidations24h?: number;
  liquidationsOrigin?: 'FACTUAL' | 'DERIVED' | 'MODEL_ESTIMATED' | 'UNAVAILABLE';
  // Indicators
  rsi14?: number;
  macd?: { macd: number; signal: number; hist: number };
  sma20?: number;
  sma50?: number;
  sma200?: number;
  bollinger?: { upper: number; middle: number; lower: number; bandwidthPct?: number };
  indicatorsOrigin?: 'FACTUAL' | 'DERIVED' | 'MODEL_ESTIMATED' | 'UNAVAILABLE';
  // Radar
  anomalies?: Array<{ type: string; metricValue?: string; severity?: string }>;
  radarOrigin?: 'FACTUAL' | 'DERIVED' | 'MODEL_ESTIMATED' | 'UNAVAILABLE';
  // Models
  liquidationZones?: { longZone?: number; shortZone?: number };
  heatmapAvailable?: boolean;
  leverageTiersAvailable?: boolean;
}): StructuredFacts {
  const facts: StructuredFacts = {
    symbol: params.symbol,
    timestamp: new Date().toISOString(),
    spot: {
      origin: 'FACTUAL',
      price: params.price,
      change24h: params.change24h,
      volume24h: params.volume24h,
      source: params.source ?? 'binance',
      ...(params.change1h !== undefined && { change1h: params.change1h }),
      ...(params.change7d !== undefined && { change7d: params.change7d }),
      ...(params.high24h !== undefined && { high24h: params.high24h }),
      ...(params.low24h !== undefined && { low24h: params.low24h }),
      ...(params.marketCap !== undefined && { marketCap: params.marketCap }),
    },
  };

  // Derivatives
  if (params.openInterest !== undefined || params.fundingRate8h !== undefined || params.openInterestDelta24h !== undefined) {
    facts.derivatives = {
      origin: params.derivativesOrigin ?? 'FACTUAL',
      ...(params.openInterest !== undefined && { openInterest: params.openInterest }),
      ...(params.openInterestDelta24h !== undefined && { openInterestDelta24h: params.openInterestDelta24h }),
      ...(params.fundingRate8h !== undefined && { fundingRate8h: params.fundingRate8h }),
      ...(params.basisPct !== undefined && { basisPct: params.basisPct }),
      ...(params.markPrice !== undefined && { markPrice: params.markPrice }),
      ...(params.indexPrice !== undefined && { indexPrice: params.indexPrice }),
    };
  }

  // Liquidations
  if (params.longLiquidations24h !== undefined || params.shortLiquidations24h !== undefined) {
    facts.liquidations = {
      origin: params.liquidationsOrigin ?? 'FACTUAL',
      ...(params.longLiquidations24h !== undefined && { longLiquidations24h: params.longLiquidations24h }),
      ...(params.shortLiquidations24h !== undefined && { shortLiquidations24h: params.shortLiquidations24h }),
    };
  }

  // Indicators
  if (params.rsi14 !== undefined || params.macd !== undefined || params.sma20 !== undefined) {
    facts.indicators = {
      origin: params.indicatorsOrigin ?? 'DERIVED',
      ...(params.rsi14 !== undefined && { rsi14: params.rsi14 }),
      ...(params.macd !== undefined && { macd: params.macd }),
      ...(params.sma20 !== undefined && { sma20: params.sma20 }),
      ...(params.sma50 !== undefined && { sma50: params.sma50 }),
      ...(params.sma200 !== undefined && { sma200: params.sma200 }),
      ...(params.bollinger !== undefined && { bollinger: params.bollinger }),
    };
  }

  // Radar
  if (params.anomalies && params.anomalies.length > 0) {
    facts.radar = {
      origin: params.radarOrigin ?? 'FACTUAL',
      anomalies: params.anomalies,
    };
  }

  // Models
  if (params.liquidationZones || params.heatmapAvailable || params.leverageTiersAvailable) {
    facts.models = {
      origin: 'MODEL_ESTIMATED',
      ...(params.liquidationZones && { liquidationZones: params.liquidationZones }),
      ...(params.heatmapAvailable !== undefined && { heatmapAvailable: params.heatmapAvailable }),
      ...(params.leverageTiersAvailable !== undefined && { leverageTiersAvailable: params.leverageTiersAvailable }),
    };
  }

  return facts;
}

/**
 * Send StructuredFacts to /api/ai/explain and get structured explanation.
 */
export async function requestLlmExplanation(
  facts: StructuredFacts,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
  endpoint = '/api/ai/explain',
): Promise<AiExplainResponse> {
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(facts),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 503) {
      return { status: 'NOT_CONFIGURED', configured: false };
    }
    if (res.status === 429) {
      return { status: 'RATE_LIMITED', reason: String(json.reason ?? 'Rate limited') };
    }
    if (res.status === 422) {
      return { status: 'REJECTED', reason: String(json.reason ?? 'Grounding failed') };
    }
    if (res.status === 504) {
      return { status: 'TIMEOUT', reason: String(json.reason ?? 'Timeout') };
    }
    if (!res.ok) {
      return { status: 'UNAVAILABLE', reason: String(json.error ?? json.reason ?? `HTTP ${res.status}`) };
    }

    // Validate structured explanation
    if (json.explanation && validateAiExplanation(json.explanation)) {
      return {
        status: 'OK',
        explanation: json.explanation as AiExplanation,
        model: String(json.model ?? ''),
        generatedAt: String(json.generatedAt ?? ''),
      };
    }

    // Fallback: legacy text response from older server
    if (typeof json.text === 'string') {
      return {
        status: 'OK',
        explanation: {
          summary: json.text as string,
          keyObservations: [],
          supportingFacts: [],
          counterEvidence: [],
          dataLimitations: [],
          riskNotes: [],
        },
        model: String(json.model ?? ''),
        generatedAt: String(json.generatedAt ?? ''),
      };
    }

    return { status: 'UNAVAILABLE', reason: 'Invalid response format' };
  } catch (e) {
    return { status: 'UNAVAILABLE', reason: e instanceof Error ? e.message : String(e) };
  }
}
