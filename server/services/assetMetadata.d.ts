export interface AssetMeta { name: string; logo: string | null; coingeckoId?: string }
export const METADATA_TTL_MS: number;
export const METADATA_PAGES: number;
export const PINNED_IDS: Readonly<Record<string, string>>;
export function buildMetadataMap(rows: unknown): Record<string, AssetMeta>;
export class AssetMetadataCache {
  constructor(opts?: { fetchFn?: (...a: any[]) => Promise<any>; now?: () => number; pages?: number; pageDelayMs?: number; ttlMs?: number });
  get(): Promise<any>;
  [key: string]: any;
}
export function getAssetMetadataCache(): AssetMetadataCache;
export function __resetAssetMetadataCacheForTests(injected?: AssetMetadataCache | null): void;
export function assetMetadataPayload(): Promise<Record<string, any>>;
