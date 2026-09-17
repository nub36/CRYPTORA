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
  /** Происхождение Δ OI: ACTUAL — из исторического ряда OI биржи; ESTIMATED — эвристика от изменения цены. */
  openInterestChangeSource: z.enum(['ACTUAL', 'ESTIMATED']).optional(),
  futuresVolume24h: z.number(), // USD
  longLiquidations24h: z.number(), // USD
  shortLiquidations24h: z.number(), // USD
  /**
   * Происхождение ликвидаций 24ч: ACTUAL — сумма фактических событий потока (окно 24ч конвейера);
   * ESTIMATED — эвристика движка деривативов; UNAVAILABLE — поток подключён, событий по инструменту нет (суммы = 0).
   */
  liquidationsSource: z.enum(['ACTUAL', 'ESTIMATED', 'UNAVAILABLE']).optional(),
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

/**
 * Достоверность среза ликвидаций.
 * Жёсткое требование проекта: агрегаты никогда не подставляются «оценочными
 * заглушками». Пока фактических событий нет, терминал обязан честно сообщить
 * об ожидании потока, а не показывать выдуманные миллионы.
 */
export const LiquidationDataStatusSchema = z.enum([
  'LIVE_STREAM', // поток фактических событий биржи подключен и события поступают
  'AWAITING_STREAM', // поток подключен, но фактических событий ещё не поступало
  'UNAVAILABLE', // поток недоступен (нет транспорта/сети/биржа недоступна)
  'DEMO', // демонстрационный детерминированный набор
]);
export type LiquidationDataStatus = z.infer<typeof LiquidationDataStatusSchema>;

export const LiquidationDataSchema = z.object({
  totalLong24h: z.number(),
  totalShort24h: z.number(),
  total24h: z.number(),
  /** Крупнейшее фактическое событие за 24ч; null — фактических событий не было. */
  largestEvent: LiquidationEventSchema.nullable(),
  /** Количество фактических событий в окне 24ч (0 — данных нет). */
  eventsCount24h: z.number().default(0),
  /** Время последнего фактического события (ISO UTC); null — событий не было. */
  lastEventAt: z.string().nullable().default(null),
  /** Статус источника фактических ликвидаций. */
  dataStatus: LiquidationDataStatusSchema.default('DEMO'),
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
  /**
   * Индекс страха и жадности. В LIVE — из Alternative.me (`source: 'alternative.me'`); если внешний источник
   * не ответил — `null` (значение не подставляется). В QA-фикстуре — `source: 'qa-fixture'`.
   */
  fearAndGreed: z
    .object({
      value: z.number(),
      sentiment: z.enum(['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']),
      source: z.enum(['alternative.me', 'qa-fixture']).optional(),
      timestamp: z.number().optional(),
    })
    .nullable(),
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
