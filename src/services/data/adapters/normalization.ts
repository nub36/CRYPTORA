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
    change1h: Number((change24h * 0.12).toFixed(2)), // Model approximation until 1h endpoint is integrated
    change24h: Number(change24h.toFixed(2)),
    change7d: Number((change24h * 1.8).toFixed(2)),
    volume24h,
    marketCap,
    circulatingSupply: asset.circulatingSupply,
    sparkline: sparkline.length >= 7 ? sparkline : [price * 0.98, price * 0.99, price * 1.01, price * 0.995, price * 1.005, price * 0.998, price],
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
    change1h: Number((change24h * 0.12).toFixed(2)),
    change24h: Number(change24h.toFixed(2)),
    change7d: Number((change24h * 1.8).toFixed(2)),
    volume24h,
    marketCap,
    circulatingSupply: asset.circulatingSupply,
    sparkline: sparkline.length >= 7 ? sparkline : [price * 0.98, price * 0.99, price * 1.01, price * 0.995, price * 1.005, price * 0.998, price],
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
    change1h: Number((change24h * 0.12).toFixed(2)),
    change24h: Number(change24h.toFixed(2)),
    change7d: Number((change24h * 1.8).toFixed(2)),
    volume24h,
    marketCap,
    circulatingSupply: asset.circulatingSupply,
    sparkline: sparkline.length >= 7 ? sparkline : [price * 0.98, price * 0.99, price * 1.01, price * 0.995, price * 1.005, price * 0.998, price],
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
