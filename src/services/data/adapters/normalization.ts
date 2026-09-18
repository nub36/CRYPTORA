import { AssetSummary, OHLCV, DataProvenance } from '@/types/market';
import { CanonicalAsset } from '@/services/data/registry/assetRegistry';
import { BinanceTicker24hr, BinanceKlineRaw, KuCoinStats24hrData, KuCoinCandleItem, KuCoinTickerItem } from './schemas';

export function normalizeBinanceTicker(
  ticker: BinanceTicker24hr,
  asset: CanonicalAsset,
  sparkline: number[] = []
): AssetSummary {
  const price = parseFloat(ticker.lastPrice) || 0;
  const change24h = parseFloat(ticker.priceChangePercent) || 0;
  const volume24h = parseFloat(ticker.quoteVolume) || 0;
  const marketCap = price * asset.circulatingSupply;

  const provenance: DataProvenance = {
    exchange: 'binance',
    market: 'spot',
    symbol: ticker.symbol,
    timestamp: ticker.closeTime,
    isFallback: false,
  };

  return {
    id: asset.symbol.toLowerCase(),
    symbol: asset.symbol,
    name: asset.name,
    category: asset.category,
    rank: asset.rank,
    price,
    change1h: null, // Computed from factual 1h klines by CandleHistoryService
    change24h: Number(change24h.toFixed(2)),
    change7d: null, // Computed from factual 1D klines by CandleHistoryService
    volume24h,
    marketCap,
    circulatingSupply: asset.circulatingSupply,
    sparkline: sparkline, // Filled by CandleHistoryService from real 1h klines
    isDemo: false,
    provenance,
  };
}

export function normalizeKuCoinStats(
  stats: KuCoinStats24hrData,
  asset: CanonicalAsset,
  sparkline: number[] = [],
  isFallback = true
): AssetSummary {
  const price = parseFloat(stats.last) || 0;
  // KuCoin changeRate is a decimal fraction (e.g. -0.0055 for -0.55%)
  const change24h = (parseFloat(stats.changeRate) || 0) * 100;
  const volume24h = parseFloat(stats.volValue) || 0;
  const marketCap = price * asset.circulatingSupply;

  const provenance: DataProvenance = {
    exchange: 'kucoin',
    market: 'spot',
    symbol: stats.symbol,
    timestamp: stats.time,
    isFallback,
  };

  return {
    id: asset.symbol.toLowerCase(),
    symbol: asset.symbol,
    name: asset.name,
    category: asset.category,
    rank: asset.rank,
    price,
    change1h: null, // Computed from factual klines by CandleHistoryService
    change24h: Number(change24h.toFixed(2)),
    change7d: null, // Computed from factual klines by CandleHistoryService
    volume24h,
    marketCap,
    circulatingSupply: asset.circulatingSupply,
    sparkline: sparkline,
    isDemo: false,
    provenance,
  };
}

export function normalizeKuCoinTickerItem(
  item: KuCoinTickerItem,
  asset: CanonicalAsset,
  timestamp: number,
  sparkline: number[] = [],
  isFallback = true
): AssetSummary {
  const price = parseFloat(item.last ?? '0') || 0;
  const change24h = (parseFloat(item.changeRate ?? '0') || 0) * 100;
  const volume24h = parseFloat(item.volValue ?? '0') || 0;
  const marketCap = price * asset.circulatingSupply;

  const provenance: DataProvenance = {
    exchange: 'kucoin',
    market: 'spot',
    symbol: item.symbol,
    timestamp,
    isFallback,
  };

  return {
    id: asset.symbol.toLowerCase(),
    symbol: asset.symbol,
    name: asset.name,
    category: asset.category,
    rank: asset.rank,
    price,
    change1h: null, // Computed from factual klines by CandleHistoryService
    change24h: Number(change24h.toFixed(2)),
    change7d: null, // Computed from factual klines by CandleHistoryService
    volume24h,
    marketCap,
    circulatingSupply: asset.circulatingSupply,
    sparkline: sparkline,
    isDemo: false,
    provenance,
  };
}

export function normalizeBinanceKlines(
  klines: BinanceKlineRaw[],
  symbol: string
): OHLCV[] {
  return klines.map((k) => ({
    time: Math.floor(k[0] / 1000), // ms -> seconds
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    provenance: {
      exchange: 'binance',
      market: 'spot',
      symbol,
      timestamp: k[6],
      isFallback: false,
    },
  }));
}

export function normalizeKuCoinCandles(
  candles: KuCoinCandleItem[],
  symbol: string,
  isFallback = true
): OHLCV[] {
  // KuCoin candles order: [time (s), open, close, high, low, volume, turnover]
  // KuCoin returns newest first, so we reverse it for ascending chronological order
  const chronological = [...candles].reverse();

  return chronological.map((c) => {
    const time = parseInt(c[0], 10);
    return {
      time,
      open: parseFloat(c[1]),
      high: parseFloat(c[3]), // High is index 3
      low: parseFloat(c[4]),  // Low is index 4
      close: parseFloat(c[2]), // Close is index 2
      volume: parseFloat(c[5]),
      provenance: {
        exchange: 'kucoin',
        market: 'spot',
        symbol,
        timestamp: time * 1000,
        isFallback,
      },
    };
  });
}

/**
 * Извлечь реальный спред из Binance 24hr ticker.
 *
 * Endpoint: GET /api/v3/ticker/24hr  (type=FULL, default)
 * DTO:       BinanceTicker24hr → bidPrice, askPrice
 * Data Source: Memory (order book) — bidPrice/askPrice являются текущими
 *              best bid / best ask, а НЕ значениями за 24-часовое окно.
 *
 * Гарантия: bidPrice и askPrice присутствуют в FULL-ответе (не в MINI).
 * Схема BinanceTicker24hr в schemas.ts помечает их optional() на случай
 * MINI-режима, но fetch24hrTicker() всегда запрашивает FULL (по умолчанию).
 *
 * Формула:
 *   spread    = bestAsk - bestBid
 *   mid       = (bestBid + bestAsk) / 2
 *   spreadBps = spread / mid * 10_000
 *
 * Не использует lastPrice, highPrice, lowPrice — только bid/ask из стакана.
 *
 * Класс: DERIVED FROM FACTUAL ORDER BOOK.
 * Возвращает null, если bid/ask отсутствуют или невалидны.
 */
export function extractBinanceSpread(ticker: BinanceTicker24hr): { spreadBps: number; bestBid: number; bestAsk: number } | null {
  const bid = parseFloat(ticker.bidPrice ?? '0');
  const ask = parseFloat(ticker.askPrice ?? '0');
  if (bid <= 0 || ask <= 0 || ask <= bid) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return {
    spreadBps: Number((((ask - bid) / mid) * 10_000).toFixed(2)),
    bestBid: bid,
    bestAsk: ask,
  };
}
