export interface SpotUniverseSymbol { symbol: string; exchangeSymbol: string; baseAsset: string }
export interface FuturesContract { symbol: string; exchangeSymbol: string; baseAsset: string; contractType: string }
export interface FuturesUniverse { activeUsdtContracts: number; perpetualCount: number; contracts: FuturesContract[] }
export const UNIVERSE_TTL_MS: number;
export const UNIVERSE_STALE_MAX_MS: number;
export function isSpotTradingAllowed(s: unknown): boolean;
export function filterActiveSpotUsdt(exchangeInfo: unknown): SpotUniverseSymbol[];
export function filterActiveUsdmFutures(exchangeInfo: unknown): FuturesUniverse;
export class UniverseCache<T = any> {
  constructor(opts: { url: string; transform: (body: any) => T; fetchFn?: (...a: any[]) => Promise<any>; now?: () => number; ttlMs?: number });
  upstreamRequests: number;
  get(): Promise<{ value: T; at: number; stale: boolean }>;
}
export function getSpotUniverseCache(): UniverseCache<SpotUniverseSymbol[]>;
export function getFuturesUniverseCache(): UniverseCache<FuturesUniverse>;
export function __resetUniverseCachesForTests(overrides?: { spot?: UniverseCache<any>; futures?: UniverseCache<any> }): void;
export function spotUniversePayload(): Promise<Record<string, any>>;
export function futuresUniversePayload(): Promise<Record<string, any>>;
export function getActiveSpotBaseSet(): Promise<Set<string> | null>;
