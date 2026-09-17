/**
 * CandleHistoryService — shared candle cache for derived metrics.
 *
 * Provides real 1h/7d change and sparklines from factual Binance klines.
 * Features: concurrency limiting, TTL cache, AbortController, request dedup.
 *
 * Class: DERIVED_FROM_FACTUAL
 */

import { getCanonicalAssets } from './registry/assetRegistry';

export interface CandlePoint {
  time: number; // Unix seconds
  close: number;
}

export interface AssetCandleDerived {
  symbol: string;
  /** Real 1h change from 1h klines, or null if insufficient data. */
  change1h: number | null;
  /** Real 7d change from 1D klines, or null if insufficient data. */
  change7d: number | null;
  /** Sparkline closes (last 24 1h candles), or empty if unavailable. */
  sparkline: number[];
  /** Raw daily closes (last 8 1D candles) for beta/volatility computation. */
  dailyCloses: number[];
  /** Whether this asset's candle data came from a successful fetch (vs default nulls). */
  isLive: boolean;
}

interface CacheEntry {
  data: Map<string, AssetCandleDerived>;
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const MAX_CONCURRENT = 6; // Binance rate-limit friendly
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Run promises with concurrency limit.
 */
async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      try {
        const val = await tasks[i]();
        results[i] = { status: 'fulfilled', value: val };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

/**
 * Fetch klines from Binance REST. Returns array of [openTime, open, high, low, close, volume, closeTime].
 */
async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number,
  fetchFn: typeof fetch,
): Promise<Array<[number, string, string, string, string, string, number]>> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class CandleHistoryService {
  private static instance: CandleHistoryService | null = null;
  private cache: CacheEntry | null = null;
  private pending: Promise<Map<string, AssetCandleDerived>> | null = null;
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  static getInstance(): CandleHistoryService {
    if (!this.instance) {
      this.instance = new CandleHistoryService();
    }
    return this.instance;
  }

  /**
   * Get derived candle data (1h/7d change + sparklines) for all canonical assets.
   * Deduplicates concurrent requests; caches with TTL.
   */
  async getAll(forceRefresh = false): Promise<Map<string, AssetCandleDerived>> {
    const now = Date.now();

    // Return cache if fresh
    if (!forceRefresh && this.cache && now - this.cache.timestamp < CACHE_TTL_MS) {
      return this.cache.data;
    }

    // Deduplicate concurrent requests
    if (this.pending) {
      return this.pending;
    }

    this.pending = this.fetchAll();

    try {
      const result = await this.pending;
      this.cache = { data: result, timestamp: Date.now() };
      return result;
    } finally {
      this.pending = null;
    }
  }

  private async fetchAll(): Promise<Map<string, AssetCandleDerived>> {
    const assets = getCanonicalAssets().filter((a) => a.binanceSymbol);
    const result = new Map<string, AssetCandleDerived>();

    // Initialize with nulls
    for (const asset of assets) {
      result.set(asset.symbol, {
        symbol: asset.symbol,
        change1h: null,
        change7d: null,
        sparkline: [],
        dailyCloses: [],
        isLive: false,
      });
    }

    // Build tasks: fetch 1h klines (limit=25 for sparkline + 1h change) and 1D klines (limit=8 for 7d change)
    const tasks: Array<() => Promise<void>> = [];

    for (const asset of assets) {
      const bs = asset.binanceSymbol!;
      // 1h klines: 25 candles for sparkline + 1h change
      tasks.push(async () => {
        try {
          const raw = await fetchBinanceKlines(bs, '1h', 25, this.fetchFn);
          const entry = result.get(asset.symbol)!;

          if (raw.length >= 2) {
            entry.isLive = true;
            // 1h change: compare current price (last candle close) to previous candle close
            const prevClose = parseFloat(raw[raw.length - 2][4]);
            const currentClose = parseFloat(raw[raw.length - 1][4]);
            if (prevClose > 0 && Number.isFinite(prevClose) && Number.isFinite(currentClose)) {
              entry.change1h = Number((((currentClose - prevClose) / prevClose) * 100).toFixed(2));
            }
          }

          // Sparkline: last 24 1h candle closes
          entry.sparkline = raw
            .map((k) => parseFloat(k[4]))
            .filter((v) => Number.isFinite(v) && v > 0);
        } catch {
          // Individual asset failure → null, not crash
        }
      });

      // 1D klines: 8 candles for 7d change + daily closes for beta computation
      tasks.push(async () => {
        try {
          const raw = await fetchBinanceKlines(bs, '1d', 8, this.fetchFn);
          const entry = result.get(asset.symbol)!;

          // Store raw daily closes for beta/volatility computation (D7)
          entry.dailyCloses = raw
            .map((k) => parseFloat(k[4]))
            .filter((v) => Number.isFinite(v) && v > 0);

          if (raw.length >= 2) {
            // 7d change: compare latest close to the earliest available close (≤7 days ago)
            const oldestClose = parseFloat(raw[0][4]);
            const latestClose = parseFloat(raw[raw.length - 1][4]);
            if (oldestClose > 0 && Number.isFinite(oldestClose) && Number.isFinite(latestClose)) {
              entry.change7d = Number((((latestClose - oldestClose) / oldestClose) * 100).toFixed(2));
            }
          }
        } catch {
          // Individual asset failure → null
        }
      });
    }

    await runConcurrent(tasks, MAX_CONCURRENT);

    return result;
  }

  resetCache(): void {
    this.cache = null;
  }
}
