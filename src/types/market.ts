import { z } from 'zod';

export type Timeframe = '15m' | '1h' | '4h' | '1D' | '1W';

export type AssetCategory = 'all' | 'l1' | 'defi' | 'l2' | 'ai' | 'meme';

export const DataProvenanceSchema = z.object({
  exchange: z.enum(['binance', 'kucoin', 'synthetic-demo']),
  market: z.enum(['spot', 'futures']),
  symbol: z.string(),
  timestamp: z.number(),
  isFallback: z.boolean().optional(),
});

export type DataProvenance = z.infer<typeof DataProvenanceSchema>;

export const OHLCVSchema = z.object({
  time: z.number(), // Unix timestamp in seconds
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  provenance: DataProvenanceSchema.optional(),
});

export type OHLCV = z.infer<typeof OHLCVSchema>;

export const AssetSummarySchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  category: z.enum(['l1', 'defi', 'l2', 'ai', 'meme']),
  rank: z.number(),
  price: z.number(),
  change1h: z.number(),
  change24h: z.number(),
  change7d: z.number(),
  volume24h: z.number(),
  marketCap: z.number(),
  circulatingSupply: z.number(),
  sparkline: z.array(z.number()),
  isDemo: z.boolean().default(true),
  provenance: DataProvenanceSchema.optional(),
});

export type AssetSummary = z.infer<typeof AssetSummarySchema>;

export const TechnicalIndicatorsSchema = z.object({
  rsi14: z.number(),
  macd: z.object({
    macd: z.number(),
    signal: z.number(),
    hist: z.number(),
  }),
  sma20: z.number(),
  sma50: z.number(),
  sma200: z.number(),
  bollinger: z.object({
    upper: z.number(),
    middle: z.number(),
    lower: z.number(),
  }),
});

export type TechnicalIndicators = z.infer<typeof TechnicalIndicatorsSchema>;

export const TradingPairSchema = z.object({
  exchange: z.string(),
  pair: z.string(),
  price: z.number(),
  volume24h: z.number(),
  spreadPct: z.number(),
});

export type TradingPair = z.infer<typeof TradingPairSchema>;

export const AssetDetailSchema = AssetSummarySchema.extend({
  description: z.string(),
  ath: z.number(),
  athDate: z.string(),
  atl: z.number(),
  atlDate: z.string(),
  high24h: z.number(),
  low24h: z.number(),
  indicators: TechnicalIndicatorsSchema,
  pairs: z.array(TradingPairSchema),
});

export type AssetDetail = z.infer<typeof AssetDetailSchema>;

export const FuturesAssetSchema = z.object({
  symbol: z.string(),
  markPrice: z.number(),
  indexPrice: z.number(),
  fundingRate: z.number(), // in % (e.g. 0.01%)
  predictedFundingRate: z.number(),
  annualizedFundingRate: z.number(),
  openInterest: z.number(), // USD
  openInterestChange1h: z.number(), // %
  openInterestChange24h: z.number(), // %
  futuresVolume24h: z.number(), // USD
  longLiquidations24h: z.number(), // USD
  shortLiquidations24h: z.number(), // USD
  basisPct: z.number(), // %
  isDemo: z.boolean().default(true),
  provenance: DataProvenanceSchema.optional(),
});

export type FuturesAsset = z.infer<typeof FuturesAssetSchema>;

export const LiquidationEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(), // ISO UTC
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  amountUsd: z.number(),
  price: z.number(),
  exchange: z.string(),
  isDemo: z.boolean().default(true),
});

export type LiquidationEvent = z.infer<typeof LiquidationEventSchema>;

export const LiquidationDataSchema = z.object({
  totalLong24h: z.number(),
  totalShort24h: z.number(),
  total24h: z.number(),
  largestEvent: LiquidationEventSchema,
  recentEvents: z.array(LiquidationEventSchema),
  assetBreakdown: z.array(
    z.object({
      symbol: z.string(),
      totalUsd: z.number(),
      longUsd: z.number(),
      shortUsd: z.number(),
    })
  ),
  exchangeBreakdown: z.array(
    z.object({
      exchange: z.string(),
      totalUsd: z.number(),
      percentage: z.number(),
    })
  ),
  timeline: z.array(
    z.object({
      timestamp: z.string(),
      longUsd: z.number(),
      shortUsd: z.number(),
    })
  ),
  isDemo: z.boolean().default(true),
});

export type LiquidationData = z.infer<typeof LiquidationDataSchema>;

export const RadarEventTypeSchema = z.enum([
  'VOLUME_SPIKE',
  'OI_SPIKE',
  'FUNDING_EXTREME',
  'LIQUIDATION_BURST',
  'PRICE_MOVE',
  'VOLATILITY_EXPANSION',
]);

export type RadarEventType = z.infer<typeof RadarEventTypeSchema>;

export const RadarSeveritySchema = z.enum(['HIGH', 'MEDIUM', 'INFO']);
export type RadarSeverity = z.infer<typeof RadarSeveritySchema>;

export const RadarEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  symbol: z.string(),
  type: RadarEventTypeSchema,
  severity: RadarSeveritySchema,
  metricValue: z.string(),
  observation: z.string(),
  isDemo: z.boolean().default(true),
  provenance: DataProvenanceSchema.optional(),
  metadata: z.record(z.any()).optional(),
});

export type RadarEvent = z.infer<typeof RadarEventSchema>;

export const MarketOverviewDataSchema = z.object({
  totalMarketCap: z.number(),
  marketCapChange24h: z.number(),
  totalVolume24h: z.number(),
  volumeChange24h: z.number(),
  btcDominance: z.number(),
  ethDominance: z.number(),
  fearAndGreed: z.object({
    value: z.number(),
    sentiment: z.enum(['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']),
  }),
  marketBreadth: z.object({
    advancing: z.number(),
    declining: z.number(),
    unchanged: z.number(),
  }),
  isDemo: z.boolean().default(true),
  timestamp: z.string(),
});

export type MarketOverviewData = z.infer<typeof MarketOverviewDataSchema>;

export interface ScreenerFilters {
  query?: string;
  category?: AssetCategory;
  minPriceChange24h?: number;
  maxPriceChange24h?: number;
  minVolume24h?: number;
  minMarketCap?: number;
  minOIChange24h?: number;
  fundingFilter?: 'all' | 'positive' | 'negative';
  minRsi?: number;
  maxRsi?: number;
}
