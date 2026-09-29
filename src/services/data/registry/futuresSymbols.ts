/**
 * CRYPTORA — Binance USD-M futures symbol mapping.
 *
 * Hard rules learned from the RC-1/RC-5 diagnosis:
 *
 *  1. The join key between exchangeInfo, `/fapi/v1/ticker/24hr`,
 *     `/fapi/v1/premiumIndex`, `/fapi/v1/openInterest` and `/fapi/v1/klines`
 *     is ALWAYS the contract symbol (`1000PEPEUSDT`), never the base ticker.
 *  2. A Spot universe must NEVER be joined to Futures by base symbol:
 *     `1000PEPEUSDT` (USD-M) corresponds to `PEPEUSDT` (Spot) at a 1000×
 *     multiplier, `BTCDOMUSDT` has no Spot instrument at all, and a Spot-only
 *     listing has no perpetual.
 *  3. Market type is explicit. It is never derived from the symbol string.
 */

/** Quote assets Binance USD-M lists. CRYPTORA's product filter keeps USDT only. */
export const USDM_QUOTE_ASSETS = ['USDT', 'USDC', 'BTC'] as const;

/**
 * Multiplier prefixes Binance uses for low-unit-price contracts.
 * Ordered longest-first so `1000000MOG` is not read as `1000` + `000MOG`.
 */
export const FUTURES_MULTIPLIER_PREFIXES: ReadonlyArray<{ prefix: string; multiplier: number }> = [
  { prefix: '1000000', multiplier: 1_000_000 },
  { prefix: '100000', multiplier: 100_000 },
  { prefix: '10000', multiplier: 10_000 },
  { prefix: '1000', multiplier: 1_000 },
  { prefix: '1M', multiplier: 1_000_000 },
];

export interface ParsedFuturesContract {
  contractSymbol: string;
  baseAsset: string;
  quoteAsset: string;
}

/**
 * Split a USD-M contract symbol into base/quote WITHOUT exchange metadata.
 *
 * This is a documented fallback used only when exchangeInfo is unavailable;
 * the authoritative `baseAsset` always comes from exchangeInfo (BTCDOMUSDT
 * would otherwise be indistinguishable from a "BTCDOM" quoted pair).
 * Delivery contracts (`BTCUSDT_250926`) are rejected: they are not perpetuals.
 */
export function parseFuturesContractSymbol(symbol: string): ParsedFuturesContract | null {
  const upper = String(symbol ?? '').toUpperCase().trim();
  if (!/^[A-Z0-9]{4,30}$/.test(upper)) return null; // rejects `_` delivery suffixes
  for (const quote of USDM_QUOTE_ASSETS) {
    if (!upper.endsWith(quote) || upper.length <= quote.length) continue;
    const base = upper.slice(0, -quote.length);
    if (!/^[A-Z0-9]{1,20}$/.test(base)) continue;
    return { contractSymbol: upper, baseAsset: base, quoteAsset: quote };
  }
  return null;
}

/**
 * Decompose a multiplier contract base.
 * `1000PEPE` → `{ multiplier: 1000, underlying: 'PEPE' }`;
 * `BTC` → `{ multiplier: 1, underlying: 'BTC' }`.
 */
export function parseFuturesMultiplier(baseAsset: string): { multiplier: number; underlying: string } {
  const base = String(baseAsset ?? '').toUpperCase().trim();
  for (const { prefix, multiplier } of FUTURES_MULTIPLIER_PREFIXES) {
    if (base.length > prefix.length && base.startsWith(prefix)) {
      const underlying = base.slice(prefix.length);
      if (/^[A-Z][A-Z0-9]*$/.test(underlying)) return { multiplier, underlying };
    }
  }
  return { multiplier: 1, underlying: base };
}

/** Display pair for the Futures table, e.g. `1000PEPE/USDT`. */
export function futuresDisplaySymbol(baseAsset: string, quoteAsset = 'USDT'): string {
  return `${String(baseAsset ?? '').toUpperCase()}/${quoteAsset.toUpperCase()}`;
}

/** Base ticker from a display pair (`1000PEPE/USDT` → `1000PEPE`). */
export function futuresDisplayBase(displaySymbol: string): string {
  return String(displaySymbol ?? '').split('/')[0]!.toUpperCase();
}

/**
 * Resolve the exchange contract symbol for a Futures route/base.
 *
 * Prefers the authoritative universe map; falls back to `${BASE}USDT` only
 * when the universe is unknown (degraded mode), and returns null when the
 * base is not a plausible ticker.
 */
export function resolveFuturesContractSymbol(
  baseOrContract: string,
  contractsByBase: ReadonlyMap<string, string> | null,
): string | null {
  const raw = String(baseOrContract ?? '').toUpperCase().trim();
  if (!raw) return null;
  if (contractsByBase) {
    const direct = contractsByBase.get(raw);
    if (direct) return direct;
    // The caller may already hold the contract symbol (`1000PEPEUSDT`).
    for (const contract of contractsByBase.values()) {
      if (contract === raw) return contract;
    }
    return null;
  }
  if (!/^[A-Z0-9]{1,20}$/.test(raw)) return null;
  return raw.endsWith('USDT') ? raw : `${raw}USDT`;
}
