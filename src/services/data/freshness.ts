/**
 * Freshness Contract — shared data-freshness semantics for all sources.
 *
 * Every data source reports freshness via `FreshnessInfo`. The UI uses
 * `status` (FRESH / STALE / RECONNECTING / UNAVAILABLE) to decide what
 * to show, and `ageMs` for compact provenance displays.
 *
 * Class: FACTUAL (deterministic computation from timestamps).
 */

// ── Thresholds per source category ────────────────────────────────────────

export type SourceCategory =
  | 'ws-ticker'        // WS ticker price: seconds
  | 'ws-orderbook'     // WS order book: seconds
  | 'ws-kline'         // WS candle: seconds
  | 'ws-liquidation'   // WS liquidation stream: seconds
  | 'rest-futures'     // REST futures (premiumIndex, OI): tens of seconds
  | 'rest-candles'     // REST klines: tens of seconds
  | 'rest-metadata'    // CoinGecko / metadata: minutes OK
  | 'rest-global'      // CoinGecko global: minutes OK
  | 'rest-onchain'     // mempool.space: minutes OK
  | 'derived';         // computed values: inherit from inputs

/** Default stale thresholds in milliseconds per source category. */
export const STALE_THRESHOLDS_MS: Record<SourceCategory, number> = {
  'ws-ticker':       10_000,   // 10s
  'ws-orderbook':    10_000,   // 10s
  'ws-kline':        15_000,   // 15s
  'ws-liquidation':  15_000,   // 15s
  'rest-futures':    60_000,   // 60s
  'rest-candles':    120_000,  // 2min
  'rest-metadata':   300_000,  // 5min
  'rest-global':     300_000,  // 5min
  'rest-onchain':    120_000,  // 2min
  'derived':         120_000,  // 2min (inherited from inputs)
};

// ── Freshness status ──────────────────────────────────────────────────────

export type FreshnessStatus =
  | 'FRESH'           // data is recent per category threshold
  | 'STALE'           // data older than threshold but still available
  | 'RECONNECTING'    // WS disconnected, attempting reconnect
  | 'UNAVAILABLE';    // no data at all

// ── Freshness info ────────────────────────────────────────────────────────

export interface FreshnessInfo {
  /** When the source produced the data (Unix ms). 0 = unknown. */
  sourceTimestamp: number;
  /** When our system received the data (Unix ms). */
  receivedAt: number;
  /** Age in ms: now - max(sourceTimestamp, receivedAt). */
  ageMs: number;
  /** Computed freshness status. */
  status: FreshnessStatus;
  /** Source category (for debugging / UI popover). */
  category: SourceCategory;
}

// ── Compute freshness ─────────────────────────────────────────────────────

/**
 * Compute FreshnessInfo from a source timestamp and category.
 * Call this whenever data arrives or on a periodic tick.
 */
export function computeFreshness(
  sourceTimestamp: number,
  category: SourceCategory,
  receivedAt?: number,
  isConnected?: boolean,
): FreshnessInfo {
  const now = Date.now();
  const recv = receivedAt ?? now;
  const effectiveTs = sourceTimestamp > 0 ? sourceTimestamp : recv;
  const ageMs = now - effectiveTs;
  const threshold = STALE_THRESHOLDS_MS[category];

  let status: FreshnessStatus;
  if (!isConnected && isConnected !== undefined) {
    status = 'RECONNECTING';
  } else if (sourceTimestamp === 0 && receivedAt === undefined) {
    status = 'UNAVAILABLE';
  } else if (ageMs <= threshold) {
    status = 'FRESH';
  } else {
    status = 'STALE';
  }

  return { sourceTimestamp, receivedAt: recv, ageMs, status, category };
}

/**
 * Create an UNAVAILABLE FreshnessInfo for a given category.
 */
export function unavailableFreshness(category: SourceCategory): FreshnessInfo {
  return {
    sourceTimestamp: 0,
    receivedAt: 0,
    ageMs: Infinity,
    status: 'UNAVAILABLE',
    category,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────

/** Compact age string for UI: "2с", "45с", "3мин", "1ч" */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}мин`;
  const hours = Math.floor(minutes / 60);
  return `${hours}ч`;
}

/** Status label for UI badges. */
export function freshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case 'FRESH': return 'Актуально';
    case 'STALE': return 'Устарело';
    case 'RECONNECTING': return 'Переподключение';
    case 'UNAVAILABLE': return 'Нет данных';
  }
}

/** Status color class for UI. */
export function freshnessColorClass(status: FreshnessStatus): string {
  switch (status) {
    case 'FRESH': return 'text-emerald-400';
    case 'STALE': return 'text-amber-400';
    case 'RECONNECTING': return 'text-amber-400';
    case 'UNAVAILABLE': return 'text-slate-500';
  }
}
