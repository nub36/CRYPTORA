/**
 * StructuredFacts — строгий контракт входных данных для AI-объяснения (docs/AI.md §3).
 *
 * Каждое поле ОБЯЗАНО приходить из детерминированного движка / источника.
 * Отсутствующее значение = undefined (не null, не "N/A", не DEMO).
 *
 * Provenance: каждая группа помечена origin:
 *   FACTUAL          — прямое значение из REST/WS API (Binance, KuCoin, mempool.space …)
 *   DERIVED          — вычислено детерминированным алгоритмом из FACTUAL данных
 *   MODEL_ESTIMATED  — эвристика/модель при недоступности FACTUAL
 *   UNAVAILABLE      — источник не ответил, данные отсутствуют
 */

// ---------------------------------------------------------------------------
// Origin enum
// ---------------------------------------------------------------------------
export type FactOrigin = 'FACTUAL' | 'DERIVED' | 'MODEL_ESTIMATED' | 'UNAVAILABLE';

// ---------------------------------------------------------------------------
// Market spot data
// ---------------------------------------------------------------------------
export interface SpotFacts {
  origin: 'FACTUAL';
  price: number;
  change24h: number;
  change1h?: number;
  change7d?: number;
  volume24h: number;
  high24h?: number;
  low24h?: number;
  marketCap?: number;
  /** Exchange or aggregated source identifier */
  source: string; // e.g. 'binance', 'kucoin'
}

// ---------------------------------------------------------------------------
// Derivatives data
// ---------------------------------------------------------------------------
export interface DerivativesFacts {
  origin: FactOrigin;
  openInterest?: number;
  openInterestDelta24h?: number;
  fundingRate8h?: number;
  basisPct?: number;
  markPrice?: number;
  indexPrice?: number;
}

// ---------------------------------------------------------------------------
// Liquidation data
// ---------------------------------------------------------------------------
export interface LiquidationFacts {
  origin: FactOrigin;
  longLiquidations24h?: number;
  shortLiquidations24h?: number;
  totalUsd24h?: number;
  /** How many WS exchanges are providing actual events */
  activeStreams?: number;
}

// ---------------------------------------------------------------------------
// Technical indicators
// ---------------------------------------------------------------------------
export interface IndicatorFacts {
  origin: FactOrigin;
  rsi14?: number;
  macd?: {
    macd: number;
    signal: number;
    hist: number;
  };
  sma20?: number;
  sma50?: number;
  sma200?: number;
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    bandwidthPct?: number;
  };
}

// ---------------------------------------------------------------------------
// Radar / anomalies
// ---------------------------------------------------------------------------
export interface AnomalyFact {
  type: string;        // e.g. VOLUME_SPIKE, VOLATILITY_EXPANSION
  metricValue?: string;
  severity?: string;   // HIGH, MEDIUM, INFO
}

export interface RadarFacts {
  origin: FactOrigin;
  anomalies: AnomalyFact[];
}

// ---------------------------------------------------------------------------
// Model-estimated data (liquidation zones, heatmap, leverage tiers)
// ---------------------------------------------------------------------------
export interface ModelFacts {
  origin: 'MODEL_ESTIMATED';
  liquidationZones?: {
    longZone?: number;
    shortZone?: number;
  };
  heatmapAvailable?: boolean;
  leverageTiersAvailable?: boolean;
}

// ---------------------------------------------------------------------------
// Main StructuredFacts contract
// ---------------------------------------------------------------------------
export interface StructuredFacts {
  /** Symbol as registered in CRYPTORA canonical registry (e.g. 'BTC', 'ETH') */
  symbol: string;
  /** ISO 8601 timestamp of when facts were collected */
  timestamp: string;

  spot: SpotFacts;
  derivatives?: DerivativesFacts;
  liquidations?: LiquidationFacts;
  indicators?: IndicatorFacts;
  radar?: RadarFacts;
  models?: ModelFacts;
}
