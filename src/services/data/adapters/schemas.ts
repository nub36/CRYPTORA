import { z } from 'zod';

// ==========================================
// BINANCE SPOT SCHEMAS
// ==========================================

export const BinanceTicker24hrSchema = z.object({
  symbol: z.string(),
  priceChange: z.string(),
  priceChangePercent: z.string(),
  weightedAvgPrice: z.string().optional(),
  prevClosePrice: z.string().optional(),
  lastPrice: z.string(),
  lastQty: z.string().optional(),
  bidPrice: z.string().optional(),
  askPrice: z.string().optional(),
  openPrice: z.string(),
  highPrice: z.string(),
  lowPrice: z.string(),
  volume: z.string(),
  quoteVolume: z.string(),
  openTime: z.number(),
  closeTime: z.number(),
  count: z.number().optional(),
});

export type BinanceTicker24hr = z.infer<typeof BinanceTicker24hrSchema>;

export const BinanceKlineRawSchema = z.tuple([
  z.number(), // 0: open time
  z.string(), // 1: open
  z.string(), // 2: high
  z.string(), // 3: low
  z.string(), // 4: close
  z.string(), // 5: volume
  z.number(), // 6: close time
  z.string(), // 7: quote asset volume
  z.number(), // 8: number of trades
  z.string(), // 9: taker buy base asset volume
  z.string(), // 10: taker buy quote asset volume
  z.string().optional(), // 11: ignore
]);

export type BinanceKlineRaw = z.infer<typeof BinanceKlineRawSchema>;
export const BinanceKlinesResponseSchema = z.array(BinanceKlineRawSchema);

// ==========================================
// KUCOIN SPOT SCHEMAS
// ==========================================

export const KuCoinStats24hrDataSchema = z.object({
  time: z.number(),
  symbol: z.string(),
  buy: z.string().optional().nullable(),
  sell: z.string().optional().nullable(),
  changeRate: z.string(),
  changePrice: z.string().optional().nullable(),
  high: z.string(),
  low: z.string(),
  vol: z.string(),
  volValue: z.string(),
  last: z.string(),
  averagePrice: z.string().optional().nullable(),
});

export type KuCoinStats24hrData = z.infer<typeof KuCoinStats24hrDataSchema>;

export const KuCoinStatsResponseSchema = z.object({
  code: z.string(),
  data: KuCoinStats24hrDataSchema,
});

export const KuCoinTickerItemSchema = z.object({
  symbol: z.string(),
  symbolName: z.string().optional(),
  buy: z.string().optional().nullable(),
  sell: z.string().optional().nullable(),
  changeRate: z.string().optional().nullable(),
  changePrice: z.string().optional().nullable(),
  high: z.string().optional().nullable(),
  low: z.string().optional().nullable(),
  vol: z.string().optional().nullable(),
  volValue: z.string().optional().nullable(),
  last: z.string().optional().nullable(),
  averagePrice: z.string().optional().nullable(),
});

export type KuCoinTickerItem = z.infer<typeof KuCoinTickerItemSchema>;

export const KuCoinAllTickersResponseSchema = z.object({
  code: z.string(),
  data: z.object({
    time: z.number(),
    ticker: z.array(KuCoinTickerItemSchema),
  }),
});

// KuCoin candles order: [time (s), open, close, high, low, volume, turnover]
export const KuCoinCandleItemSchema = z.tuple([
  z.string(), // 0: start time (seconds as string)
  z.string(), // 1: open
  z.string(), // 2: close
  z.string(), // 3: high
  z.string(), // 4: low
  z.string(), // 5: volume
  z.string(), // 6: turnover
]);

export type KuCoinCandleItem = z.infer<typeof KuCoinCandleItemSchema>;

export const KuCoinCandlesResponseSchema = z.object({
  code: z.string(),
  data: z.array(KuCoinCandleItemSchema),
});
