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
  /**
   * 24h high/low ПЕРПЕТУАЛА. Поля опциональные: агрегированный серверный
   * снапшот старой версии их не присылает, и это должно давать «Нет данных»,
   * а не падение валидации всего тикера (задача §5, §15).
   */
  highPrice: z.string().optional().nullable(),
  lowPrice: z.string().optional().nullable(),
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

/**
 * USD-M `/fapi/v1/klines` returns the same tuple shape as Spot `/api/v3/klines`.
 * A dedicated schema keeps the Futures transport independent from the Spot one
 * so the two can never be silently swapped (RC-6).
 */
export const BinanceFuturesKlineRawSchema = z.tuple([
  z.number(), // 0: open time (ms)
  z.string(), // 1: open
  z.string(), // 2: high
  z.string(), // 3: low
  z.string(), // 4: close
  z.string(), // 5: volume (base)
  z.number(), // 6: close time (ms)
  z.string(), // 7: quote asset volume
  z.number(), // 8: number of trades
  z.string(), // 9: taker buy base volume
  z.string(), // 10: taker buy quote volume
  z.string().optional(), // 11: ignore
]);
export type BinanceFuturesKlineRaw = z.infer<typeof BinanceFuturesKlineRawSchema>;
export const BinanceFuturesKlinesResponseSchema = z.array(BinanceFuturesKlineRawSchema);

export const BinanceFuturesExchangeInfoSchema = z.object({
  serverTime: z.number(),
  symbols: z.array(
    z.object({
      symbol: z.string(),
      pair: z.string(),
      contractType: z.string(),
      deliveryDate: z.number(),
      onboardDate: z.number(),
      status: z.string(),
      quoteAsset: z.string(),
    }),
  ),
});
export type BinanceFuturesExchangeInfo = z.infer<typeof BinanceFuturesExchangeInfoSchema>;

/**
 * `GET /fapi/v1/depth` — стакан USD-M (задача §4).
 *
 * Уровни приходят как пары строк `[price, qty]`; `lastUpdateId` — версия книги
 * (по нему видно, что снапшот обновился), `E`/`T` — время события и матчинга
 * на бирже, они есть только у фьючерсного стакана (у спота их нет).
 */
export const BinanceFuturesDepthLevelSchema = z.tuple([z.string(), z.string()]);
export const BinanceFuturesDepthSchema = z.object({
  lastUpdateId: z.number(),
  E: z.number().optional().nullable(),
  T: z.number().optional().nullable(),
  bids: z.array(BinanceFuturesDepthLevelSchema),
  asks: z.array(BinanceFuturesDepthLevelSchema),
});
export type BinanceFuturesDepth = z.infer<typeof BinanceFuturesDepthSchema>;
