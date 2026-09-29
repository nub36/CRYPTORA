/**
 * Ambient types for the aggregated USD-M snapshot store (see the .js module).
 * Values mirror the raw upstream strings; math stays in the client engine.
 */
export const BULK_TTL_MS: number;
export const OI_TTL_MS: number;
export const OI_HIST_TTL_MS: number;
export const OI_CONCURRENCY: number;
export const OI_HIST_CONCURRENCY: number;
export const OI_HIST_MAX_SYMBOLS: number;

export interface FuturesSnapshotStoreOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  universeCache?: { get(): Promise<{ value: { contracts: Array<Record<string, string>>; activeUsdtContracts: number; perpetualCount: number }; at: number; stale?: boolean }> };
  bulkTtlMs?: number;
  oiTtlMs?: number;
  oiHistTtlMs?: number;
  oiConcurrency?: number;
  oiHistConcurrency?: number;
  oiHistMaxSymbols?: number;
}

export interface FuturesSnapshotStore {
  snapshot(opts?: { awaitOpenInterest?: boolean }): Promise<any>;
  stats: Record<string, number>;
  reset(): void;
}

export function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ item: T; value?: R; error?: { message: string; rateLimited?: boolean } }>>;

export function compactOpenInterestHistory(hist: unknown): Array<{ symbol?: string; sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }> | null;

export function createFuturesMarketSnapshotStore(options?: FuturesSnapshotStoreOptions): FuturesSnapshotStore;
export function getFuturesMarketSnapshotStore(): FuturesSnapshotStore;
export function __resetFuturesMarketStoreForTests(store?: FuturesSnapshotStore | null): void;
export function futuresMarketSnapshotPayload(): Promise<any>;
