import { AssetSummary, OHLCV, DataProvenance } from '@/types/market';
import { CanonicalAsset } from '@/services/data/registry/assetRegistry';
import { BinanceTicker24hr, BinanceKlineRaw, KuCoinStats24hrData, KuCoinCandleItem, KuCoinTickerItem } from './schemas';
import { normalizeBinanceKlineSeries } from '../../../../shared/market/candleSeries.js';

/** Normalize a USDT spot ticker without canonical CoinGecko metadata. Unknown
 * supply/cap stay as zero sentinels and are rendered as unavailable, never inferred. */
export function normalizeUnregisteredBinanceTicker(
  ticker: BinanceTicker24hr,
): AssetSummary | null {
  const exchangeSymbol = ticker.symbol.toUpperCase();
  if (!exchangeSymbol.endsWith('USDT')) return null;
  const symbol = exchangeSymbol.slice(0, -4);
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) return null;

  const parseFinite = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    id: symbol.toLowerCase(),
    symbol,
    name: symbol,
    category: 'other',
    rank: Number.MAX_SAFE_INTEGER,
    price: parseFinite(ticker.lastPrice),
    change1h: null,
    change24h: Number(parseFinite(ticker.priceChangePercent).toFixed(2)),
    change7d: null,
    volume24h: parseFinite(ticker.quoteVolume),
    marketCap: 0,
    circulatingSupply: 0,
    sparkline: [],
    isDemo: false,
    provenance: {
      exchange: 'binance',
      market: 'spot',
      symbol: exchangeSymbol,
      timestamp: ticker.closeTime,
      isFallback: false,
    },
    high24h: parseFinite(ticker.highPrice) || undefined,
    low24h: parseFinite(ticker.lowPrice) || undefined,
  };
}

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
    high24h: parseFloat(ticker.highPrice) || undefined,
    low24h: parseFloat(ticker.lowPrice) || undefined,
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
    high24h: parseFloat(stats.high) || undefined,
    low24h: parseFloat(stats.low) || undefined,
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
    high24h: item.high ? parseFloat(item.high) : undefined,
    low24h: item.low ? parseFloat(item.low) : undefined,
  };
}

/**
 * Normalize Binance klines (Spot `/api/v3/klines` or USD-M `/fapi/v1/klines`).
 *
 * Delegates to `shared/market/candleSeries.js` — the SAME implementation the
 * read-only diagnostic harness (`npm run diagnose:charts`) exercises, so the
 * harness validates the product's path instead of a copy of it.
 *
 * Malformed rows (NaN/Infinity, non-positive OHLC, high < body, low > body,
 * duplicate or backwards timestamps) are REJECTED, not repaired: a broken
 * candle must never reach lightweight-charts and look like a loaded chart.
 *
 * @param market which market these candles came from. It is an explicit
 *   argument rather than a guess from `symbol`, and lands in
 *   `provenance.market` so a Futures chart is provably not Spot data.
 */
export function normalizeBinanceKlines(
  klines: BinanceKlineRaw[] | unknown[],
  symbol: string,
  market: 'spot' | 'futures' = 'spot',
): OHLCV[] {
  const { candles, rejected } = normalizeBinanceKlineSeries(klines, { symbol, market, exchange: 'binance' });
  if (rejected.length > 0) {
    console.warn(
      `[market-data] ${market} ${symbol}: отброшено ${rejected.length} некорректных свечей`,
      rejected.slice(0, 5),
    );
  }
  return candles as OHLCV[];
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
  // NaN-гвард: parseFloat('') = NaN, а NaN <= 0 ложно — иначе NaN-спред утекал бы в UI.
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask <= bid) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return {
    spreadBps: Number((((ask - bid) / mid) * 10_000).toFixed(2)),
    bestBid: bid,
    bestAsk: ask,
  };
}

/**
 * Нормализация стакана USD-M (`GET /fapi/v1/depth`) в канонический
 * `OrderBookSnapshot` (задача §4).
 *
 * Контракт:
 *  • `provenance.market = 'futures'` и `provenance.symbol` = символ КОНТРАКТА
 *    (`1000PEPEUSDT`) — по нему в UI видно, что книга фьючерсная, а не спотовая;
 *  • уровни с нулевым/нечисловым количеством отбрасываются: биржа присылает
 *    их как «удалить уровень», рисовать их как ликвидность нельзя;
 *  • bids сортируются по убыванию цены, asks — по возрастанию, поэтому
 *    `bids[0]`/`asks[0]` — это всегда best bid/ask, а спред неотрицателен;
 *  • время снапшота: `T` (matching engine) → `E` (event) → локальные часы,
 *    чтобы «возраст» книги считался по бирже, когда она его прислала.
 */
export function normalizeFuturesDepth(
  depth: { bids: [string, string][]; asks: [string, string][]; lastUpdateId?: number; E?: number | null; T?: number | null },
  params: { contractSymbol: string; displaySymbol: string },
): import('@/types/realtime').OrderBookSnapshot {
  const levels = (rows: [string, string][]): [number, number][] =>
    rows
      .map(([price, qty]): [number, number] => [Number.parseFloat(price), Number.parseFloat(qty)])
      .filter(([price, qty]) => Number.isFinite(price) && Number.isFinite(qty) && price > 0 && qty > 0);

  const bids = levels(depth.bids ?? []).sort((a, b) => b[0] - a[0]);
  const asks = levels(depth.asks ?? []).sort((a, b) => a[0] - b[0]);
  const exchangeTime = Number(depth.T ?? depth.E ?? 0);
  const timestamp = Number.isFinite(exchangeTime) && exchangeTime > 0 ? exchangeTime : Date.now();

  return {
    symbol: params.displaySymbol,
    bids,
    asks,
    timestamp,
    provenance: {
      exchange: 'binance',
      market: 'futures',
      symbol: params.contractSymbol,
      timestamp,
      isFallback: false,
    },
  };
}
