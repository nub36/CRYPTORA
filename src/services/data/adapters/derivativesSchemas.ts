import { z } from 'zod';

export const BinanceFuturesPremiumIndexSchema = z.object({
  symbol: z.string(),
  markPrice: z.string(),
  indexPrice: z.string(),
  lastFundingRate: z.string(),
  nextFundingTime: z.number(),
  interestRate: z.string().optional().nullable(),
  time: z.number(),
});

export type BinanceFuturesPremiumIndex = z.infer<typeof BinanceFuturesPremiumIndexSchema>;

export const BinanceFuturesOpenInterestSchema = z.object({
  symbol: z.string(),
  openInterest: z.string(),
  time: z.number(),
});

export type BinanceFuturesOpenInterest = z.infer<typeof BinanceFuturesOpenInterestSchema>;

export const BinanceFuturesTicker24hrSchema = z.object({
  symbol: z.string(),
  priceChange: z.string(),
  priceChangePercent: z.string(),
  lastPrice: z.string(),
  volume: z.string(),
  quoteVolume: z.string(),
  openTime: z.number().optional().nullable(),
  closeTime: z.number().optional().nullable(),
});

export type BinanceFuturesTicker24hr = z.infer<typeof BinanceFuturesTicker24hrSchema>;

/** /futures/data/openInterestHist — фактические исторические значения OI (публичный endpoint). */
export const BinanceFuturesOpenInterestHistItemSchema = z.object({
  symbol: z.string(),
  sumOpenInterest: z.string(),
  sumOpenInterestValue: z.string(),
  timestamp: z.number(),
});
export const BinanceFuturesOpenInterestHistSchema = z.array(BinanceFuturesOpenInterestHistItemSchema);
export type BinanceFuturesOpenInterestHistItem = z.infer<typeof BinanceFuturesOpenInterestHistItemSchema>;
