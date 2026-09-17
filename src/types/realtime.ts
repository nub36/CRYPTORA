import { z } from 'zod';
import { DataProvenanceSchema } from './market';

export type RealtimeConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export const TickerTickSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  priceChangePercent24h: z.number(),
  high24h: z.number(),
  low24h: z.number(),
  volume24h: z.number(),
  quoteVolume24h: z.number(),
  timestamp: z.number(),
  provenance: DataProvenanceSchema,
});

export type TickerTick = z.infer<typeof TickerTickSchema>;

export const TradeTickSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  price: z.number(),
  size: z.number(),
  side: z.enum(['buy', 'sell']),
  timestamp: z.number(),
  provenance: DataProvenanceSchema,
});

export type TradeTick = z.infer<typeof TradeTickSchema>;

export const OrderBookLevelSchema = z.tuple([z.number(), z.number()]);
export type OrderBookLevel = z.infer<typeof OrderBookLevelSchema>;

export const OrderBookSnapshotSchema = z.object({
  symbol: z.string(),
  bids: z.array(OrderBookLevelSchema),
  asks: z.array(OrderBookLevelSchema),
  timestamp: z.number(),
  provenance: DataProvenanceSchema,
});

export type OrderBookSnapshot = z.infer<typeof OrderBookSnapshotSchema>;

export type RealtimeChannel = 'ticker' | 'trades' | 'depth' | 'kline';

export interface RealtimeSubscription {
  channel: RealtimeChannel;
  symbols: string[];
}

/** Binance kline (candlestick) stream event — real-time candle update. */
export const KlineTickSchema = z.object({
  symbol: z.string(),
  interval: z.string(),
  openTime: z.number(),
  closeTime: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  isClosed: z.boolean(),
  timestamp: z.number(),
  provenance: DataProvenanceSchema,
});

export type KlineTick = z.infer<typeof KlineTickSchema>;
