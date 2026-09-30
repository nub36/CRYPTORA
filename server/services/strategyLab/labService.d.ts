export const REST_MAX_CANDLES: number;
export const LOCAL_MAX_CANDLES: number;

export class LabRequestError extends Error {
  status: number;
  code: string;
  constructor(message: string, status?: number, code?: string);
}

export function listStrategies(): Promise<any[]>;
export function estimateRequestedCandles(parsed: any): number;
export function selectHistoricalCandles(parsed: any, options?: any): Promise<any>;
export function runReplay(parsed: any, options?: any): Promise<any>;
