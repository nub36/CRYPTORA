export const DEFAULT_STRATEGY_LAB_DATA_ROOT: string;
export const LOCAL_MANIFEST_SCHEMA_VERSION: number;

export class LocalHistoricalError extends Error {
  code: string;
  constructor(message: string, code?: string);
}

export interface LocalHistoricalParams {
  market: 'spot' | 'futures';
  symbol: string;
  timeframe: string;
  fromMs: number;
  toMs: number;
}

export interface LocalHistoricalOptions {
  root?: string;
  nowMs?: number;
  inspection?: unknown;
}

export function readLocalManifest(options?: LocalHistoricalOptions): Promise<any>;
export function inspectLocalSeriesCoverage(
  params: LocalHistoricalParams,
  options?: LocalHistoricalOptions
): Promise<any>;
export function readLocalHistoricalCandles(
  params: LocalHistoricalParams,
  options?: LocalHistoricalOptions
): Promise<any>;
export function getLocalDatasetCoverage(options?: LocalHistoricalOptions): Promise<any>;
