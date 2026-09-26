import { normalizeScanSymbol } from '@/services/signals/scanUniverse';

export type ScopedSymbolFeed = {
  subscribeSymbolScoped(symbol: string): () => void;
};

export type ScopedSymbolReleases = Map<string, () => void>;

export function normalizeRadarUniverse(symbols: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const symbol = normalizeScanSymbol(raw);
    if (symbol && !seen.has(symbol)) {
      seen.add(symbol);
      out.push(symbol);
    }
  }
  return out;
}

/**
 * Delta-apply Radar-owned scoped WS leases.
 *
 * Existing leases shared with another Radar universe revision are retained; only
 * removed symbols are released and only new symbols are acquired. The feed still
 * owns refcount semantics, so releasing Radar leases cannot drop watchlist,
 * alert, or coin-page leases for the same symbol.
 */
export function syncRadarScopedSubscriptions(
  feed: ScopedSymbolFeed,
  leases: ScopedSymbolReleases,
  nextSymbols: readonly string[],
): string[] {
  const normalized = normalizeRadarUniverse(nextSymbols);
  const nextSet = new Set(normalized);

  for (const [symbol, release] of Array.from(leases.entries())) {
    if (!nextSet.has(symbol)) {
      release();
      leases.delete(symbol);
    }
  }

  for (const symbol of normalized) {
    if (!leases.has(symbol)) {
      leases.set(symbol, feed.subscribeSymbolScoped(symbol));
    }
  }

  return normalized;
}

export function releaseRadarScopedSubscriptions(leases: ScopedSymbolReleases): void {
  for (const release of Array.from(leases.values())) {
    release();
  }
  leases.clear();
}
