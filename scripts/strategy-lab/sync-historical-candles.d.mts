export interface HistoricalSeriesPlan {
  market: 'spot' | 'futures';
  symbol: string;
  timeframe: '5m' | '15m' | '30m' | '1h' | '4h';
  intervalMs: number;
  fromMs: number;
  toMs: number;
  expectedCount: number;
  relativePath: string;
}

export interface HistoricalPlan {
  root: string;
  fromMs: number;
  toMs: number;
  from: string;
  to: string;
  series: HistoricalSeriesPlan[];
  seriesCount: number;
  candleCount: number;
}

export const DEFAULT_DATA_ROOT: string;
export const DEFAULT_FROM: string;
export const DEFAULT_TO: string;
export const MARKETS: readonly ('spot' | 'futures')[];
export const SYMBOLS: readonly string[];
export const TIMEFRAMES: readonly string[];
export const TIMEFRAME_MS: Readonly<Record<string, number>>;
export const BINANCE_ENDPOINTS: Readonly<Record<'spot' | 'futures', string>>;
export const BINANCE_PAGE_LIMIT: number;
export const MAX_RETRIES: number;
export const MANIFEST_SCHEMA_VERSION: number;

export class HistoricalSyncError extends Error {
  code: string;
}

export function parseCliArgs(argv?: string[]): Record<string, unknown>;
export function expectedCandleCount(fromMs: number, toMs: number, timeframe: string): number;
export function buildPlan(options?: Record<string, unknown>): HistoricalPlan;
export function endpointForMarket(market: string): string;
export function normalizeBinanceKline(row: unknown): unknown[];
export function validateSeriesRows(
  rows: unknown[],
  series: HistoricalSeriesPlan,
  options?: { nowMs?: number }
): { candleCount: number; firstOpenTime: number | null; lastOpenTime: number | null };
export function downloadSeries(
  series: HistoricalSeriesPlan,
  options?: Record<string, unknown>
): Promise<unknown[][]>;
export function atomicWriteFile(filePath: string, contents: string | Uint8Array): Promise<void>;
export function atomicWriteJson(filePath: string, value: unknown): Promise<{ sha256: string; bytes: number }>;
export function validateArchive(plan: HistoricalPlan): Promise<Record<string, unknown>>;
export function syncHistoricalCandles(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function main(argv?: string[]): Promise<Record<string, unknown>>;
