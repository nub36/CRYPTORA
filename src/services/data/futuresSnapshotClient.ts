import { z } from 'zod';

/**
 * Client for the aggregated server-side USD-M snapshot
 * (`GET /api/market/derivatives/futures`).
 *
 * The browser makes ONE request per poll instead of
 * 2 bulk + N per-symbol open-interest requests (root cause RC-1). The server
 * owns the sweep, the concurrency budget and the cache, so 500+ contracts no
 * longer translate into hundreds of browser requests.
 *
 * Every numeric metric stays a STRING here (exactly as the exchange returned
 * it) or `null`. Parsing and all derivatives math remain in DerivativesEngine,
 * so this transport cannot silently change a formula.
 */

export const FuturesSnapshotRowSchema = z.object({
  contractSymbol: z.string(),
  baseAsset: z.string(),
  contractType: z.string(),
  markPrice: z.string().nullable(),
  indexPrice: z.string().nullable(),
  lastFundingRate: z.string().nullable(),
  nextFundingTime: z.number().nullable(),
  premiumTime: z.number().nullable(),
  lastPrice: z.string().nullable(),
  priceChangePercent: z.string().nullable(),
  quoteVolume: z.string().nullable(),
  baseVolume: z.string().nullable(),
  openInterest: z.string().nullable(),
  openInterestHist: z
    .array(
      z.object({
        symbol: z.string(),
        sumOpenInterest: z.string(),
        sumOpenInterestValue: z.string(),
        timestamp: z.number(),
      }),
    )
    .nullable(),
});

export type FuturesSnapshotRow = z.infer<typeof FuturesSnapshotRowSchema>;

export const FuturesSnapshotCoverageSchema = z.object({
  contracts: z.number(),
  withPrice: z.number(),
  withChange24h: z.number(),
  withVolume: z.number(),
  withFunding: z.number(),
  withOpenInterest: z.number(),
  withOpenInterestDelta: z.number(),
  withoutPremium: z.number(),
  withoutTicker: z.number(),
  openInterestSweptAt: z.string().nullable(),
  openInterestFailures: z.number().nullable(),
  openInterestRateLimited: z.boolean(),
  openInterestHistSweptAt: z.string().nullable(),
  openInterestHistCovered: z.number(),
  openInterestHistFailures: z.number().nullable(),
  openInterestHistRateLimited: z.boolean(),
});

export type FuturesSnapshotCoverage = z.infer<typeof FuturesSnapshotCoverageSchema>;

export const FuturesSnapshotSchema = z.object({
  source: z.string(),
  filter: z.string(),
  fetchedAt: z.string(),
  /** Момент последнего обновления exchangeInfo-вселенной (сервер шлёт всегда). */
  universeFetchedAt: z.string().optional(),
  stale: z.boolean(),
  activeUsdtContracts: z.number(),
  perpetualCount: z.number(),
  coverage: FuturesSnapshotCoverageSchema,
  rows: z.array(FuturesSnapshotRowSchema),
});

export type FuturesSnapshot = z.infer<typeof FuturesSnapshotSchema>;

const DEFAULT_URL = '/api/market/derivatives/futures';
const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchFuturesSnapshot(
  fetchFn: typeof fetch = ((...args) => globalThis.fetch(...args)) as typeof fetch,
  url: string = DEFAULT_URL,
): Promise<FuturesSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`futures snapshot HTTP ${response.status}`);
    const parsed = FuturesSnapshotSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error(`futures snapshot schema: ${parsed.error.message}`);
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}
