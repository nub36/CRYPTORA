/**
 * CRYPTORA — Strategy Lab Validators · Type Declarations (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Companion .d.ts for server/validators/strategyLab.js (mirrors the auth.d.ts
 * pattern) so TypeScript consumers/tests get types without importing the JS
 * implementation as `any`.
 */

import { z } from 'zod';

export declare const LAB_TIMEFRAMES: readonly ['1m', '5m', '15m', '1h', '4h', '1d'];
export type LabTimeframe = (typeof LAB_TIMEFRAMES)[number];

export declare const LAB_TF_MS: Readonly<Record<LabTimeframe, number>>;
export declare const LAB_MAX_CANDLES: number;

export interface LabResearchConfig {
  indicators: { emaFast: number; emaSlow: number; atrPeriod: number };
  strategy: { stopAtrMult: number; targetR: number };
  execution: { feeBps: number; slippageBps: number };
}

export interface LabReplayRequest {
  strategyId: string;
  market: 'spot' | 'futures';
  symbol: string;
  timeframe: LabTimeframe;
  from: number;
  to: number;
  researchConfig: LabResearchConfig;
}

export declare const replayRequestSchema: z.ZodType<LabReplayRequest>;

export declare function parseReplayRequest(body: unknown): LabReplayRequest;
