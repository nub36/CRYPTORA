import { z } from 'zod';
import { AdapterNetworkError, AdapterValidationError, AdapterRateLimitError } from './errors';

/**
 * CoinGecko Public API v3 — бесплатный, без ключа.
 * Rate limit: ~10-30 req/min (публичный). Кэшируем агрессивно.
 *
 * Используется ТОЛЬКО для supplementary metadata:
 *   - global market cap (весь крипторынок, не только наш universe)
 *   - ATH / ATL / ATH date / ATL date per asset
 *
 * Не заменяет Binance/KuCoin для цен — биржевые данные остаются от exchange providers.
 *
 * Endpoints:
 *   GET /api/v3/global → { data: { total_market_cap: {usd: N}, market_cap_change_percentage_24h_usd: N, ... } }
 *   GET /api/v3/coins/{id} → { ath: {usd: N}, ath_date: {usd: "..."}, atl: {usd: N}, atl_date: {usd: "..."}, ... }
 */

// --- Zod schemas for runtime validation ---

const CoinGeckoGlobalDataSchema = z.object({
  total_market_cap: z.record(z.number()).optional(),
  market_cap_change_percentage_24h_usd: z.number().optional(),
  active_cryptocurrencies: z.number().optional(),
  markets: z.number().optional(),
  updated_at: z.number().optional(),
  /** Market cap percentage by coin: { btc: 54.3, eth: 17.2, ... } */
  market_cap_percentage: z.record(z.number()).optional(),
});

const CoinGeckoGlobalResponseSchema = z.object({
  data: CoinGeckoGlobalDataSchema,
});

const CoinGeckoCoinMarketDataSchema = z.object({
  ath: z.record(z.number().nullable()).optional(),
  ath_date: z.record(z.string().nullable()).optional(),
  atl: z.record(z.number().nullable()).optional(),
  atl_date: z.record(z.string().nullable()).optional(),
  market_cap: z.record(z.number().nullable()).optional(),
  circulating_supply: z.number().nullable().optional(),
  total_supply: z.number().nullable().optional(),
  max_supply: z.number().nullable().optional(),
});

const CoinGeckoCoinResponseSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  market_data: CoinGeckoCoinMarketDataSchema.optional(),
  last_updated: z.string().optional(),
});

// --- Public types ---

export interface CoinGeckoGlobalData {
  totalMarketCapUsd: number;
  marketCapChange24hPct: number | null;
  activeCryptocurrencies: number;
  markets: number;
  /** Unix ms источника */
  updatedAt: number;
  source: 'coingecko';
  /** BTC dominance % of total crypto market cap (CoinGecko factual). */
  btcDominancePct: number | null;
  /** ETH dominance % of total crypto market cap (CoinGecko factual). */
  ethDominancePct: number | null;
}

export interface CoinGeckoAssetMeta {
  id: string;
  symbol: string;
  name: string;
  athUsd: number | null;
  athDateUsd: string | null;
  atlUsd: number | null;
  atlDateUsd: string | null;
  marketCapUsd: number | null;
  /** CoinGecko supply data — runtime validated, null when source returns null */
  totalSupply: number | null;
  maxSupply: number | null;
  /** ISO timestamp последнего обновления */
  lastUpdated: string | null;
  source: 'coingecko';
  /** Unix ms момента получения */
  receivedAt: number;
}

// --- Adapter class ---

export class CoinGeckoAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  // Separate caches with different TTLs
  private globalCache: { data: CoinGeckoGlobalData; timestamp: number } | null = null;
  private coinCache = new Map<string, { data: CoinGeckoAssetMeta; timestamp: number }>();

  private readonly globalTtlMs = 5 * 60 * 1000; // 5 min — global data updates slowly
  private readonly coinTtlMs = 10 * 60 * 1000;  // 10 min — ATH/ATL never changes fast

  constructor(config: { baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.coingecko.com';
    this.fetchFn = config.fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.status === 429) {
        throw new AdapterRateLimitError('coingecko', 429);
      }
      if (!res.ok) {
        throw new AdapterNetworkError('coingecko', new Error(`HTTP ${res.status}`));
      }
      const json = await res.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new AdapterValidationError('coingecko', parsed.error.message);
      }
      return parsed.data;
    } catch (e) {
      if (e instanceof AdapterNetworkError || e instanceof AdapterValidationError || e instanceof AdapterRateLimitError) throw e;
      throw new AdapterNetworkError('coingecko', e instanceof Error ? e : new Error(String(e)));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Глобальная капитализация всего крипторынка.
   * CoinGecko /api/v3/global — публичный, без ключа.
   */
  public async fetchGlobal(): Promise<CoinGeckoGlobalData> {
    const now = Date.now();
    if (this.globalCache && now - this.globalCache.timestamp < this.globalTtlMs) {
      return this.globalCache.data;
    }

    const raw = await this.get('/api/v3/global', CoinGeckoGlobalResponseSchema);
    const d = raw.data;
    const totalMarketCapUsd = d.total_market_cap?.usd ?? 0;

    const pct = d.market_cap_percentage;
    const btcDom = pct?.btc ?? null;
    const ethDom = pct?.eth ?? null;

    const result: CoinGeckoGlobalData = {
      totalMarketCapUsd,
      marketCapChange24hPct: d.market_cap_change_percentage_24h_usd ?? null,
      activeCryptocurrencies: d.active_cryptocurrencies ?? 0,
      markets: d.markets ?? 0,
      updatedAt: (d.updated_at ?? 0) * 1000,
      source: 'coingecko',
      btcDominancePct: btcDom != null && Number.isFinite(btcDom) ? Number(btcDom.toFixed(1)) : null,
      ethDominancePct: ethDom != null && Number.isFinite(ethDom) ? Number(ethDom.toFixed(1)) : null,
    };

    this.globalCache = { data: result, timestamp: now };
    return result;
  }

  /**
   * Метаданные конкретной монеты (ATH/ATL/market cap).
   * CoinGecko ID (не тикер!) — deterministic mapping в assetRegistry.
   */
  public async fetchCoinMeta(coingeckoId: string): Promise<CoinGeckoAssetMeta> {
    const now = Date.now();
    const cached = this.coinCache.get(coingeckoId);
    if (cached && now - cached.timestamp < this.coinTtlMs) {
      return cached.data;
    }

    const raw = await this.get(
      `/api/v3/coins/${encodeURIComponent(coingeckoId)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
      CoinGeckoCoinResponseSchema,
    );

    const md = raw.market_data;
    const receivedAt = Date.now();

    const result: CoinGeckoAssetMeta = {
      id: raw.id,
      symbol: raw.symbol,
      name: raw.name,
      athUsd: md?.ath?.usd ?? null,
      athDateUsd: md?.ath_date?.usd ?? null,
      atlUsd: md?.atl?.usd ?? null,
      atlDateUsd: md?.atl_date?.usd ?? null,
      marketCapUsd: md?.market_cap?.usd ?? null,
      totalSupply: md?.total_supply ?? null,
      maxSupply: md?.max_supply ?? null,
      lastUpdated: raw.last_updated ?? null,
      source: 'coingecko',
      receivedAt,
    };

    this.coinCache.set(coingeckoId, { data: result, timestamp: now });
    return result;
  }

  /**
   * Batch: получить метаданные нескольких монет одним запросом.
   * CoinGecko /api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,...
   * Rate limit friendly: один запрос вместо N.
   */
  public async fetchCoinsMarket(ids: string[]): Promise<Map<string, CoinGeckoAssetMeta>> {
    if (ids.length === 0) return new Map();

    const now = Date.now();
    // Check cache first
    const result = new Map<string, CoinGeckoAssetMeta>();
    const toFetch: string[] = [];

    for (const id of ids) {
      const cached = this.coinCache.get(id);
      if (cached && now - cached.timestamp < this.coinTtlMs) {
        result.set(id, cached.data);
      } else {
        toFetch.push(id);
      }
    }

    if (toFetch.length === 0) return result;

    // Use /coins/markets for batch (up to 250 ids per request)
    const BatchItemSchema = z.object({
      id: z.string(),
      symbol: z.string(),
      name: z.string(),
      ath: z.number().nullable(),
      ath_date: z.string().nullable(),
      atl: z.number().nullable(),
      atl_date: z.string().nullable(),
      market_cap: z.number().nullable(),
      total_supply: z.number().nullable().optional(),
      max_supply: z.number().nullable().optional(),
      last_updated: z.string().nullable(),
    });
    const BatchSchema = z.array(BatchItemSchema);

    try {
      const raw = await this.get(
        `/api/v3/coins/markets?vs_currency=usd&ids=${toFetch.join(',')}&order=market_cap_desc&per_page=${toFetch.length}&page=1&sparkline=false`,
        BatchSchema,
      );
      const receivedAt = Date.now();
      for (const item of raw) {
        const meta: CoinGeckoAssetMeta = {
          id: item.id,
          symbol: item.symbol,
          name: item.name,
          athUsd: item.ath,
          athDateUsd: item.ath_date,
          atlUsd: item.atl,
          atlDateUsd: item.atl_date,
          marketCapUsd: item.market_cap,
          totalSupply: item.total_supply ?? null,
          maxSupply: item.max_supply ?? null,
          lastUpdated: item.last_updated,
          source: 'coingecko',
          receivedAt,
        };
        this.coinCache.set(item.id, { data: meta, timestamp: now });
        result.set(item.id, meta);
      }
    } catch {
      // Batch failed — try individual fetches for remaining ids
      // But don't fail the whole operation; just skip those that aren't cached
    }

    return result;
  }

  public resetCache(): void {
    this.globalCache = null;
    this.coinCache.clear();
  }
}
