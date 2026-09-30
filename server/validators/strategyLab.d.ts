import { z } from 'zod';
import {
  indicatorSchema,
  logicRuleSchema,
  stopSchema,
  targetSchema,
  executionSchema,
  strategyDefinitionSchema,
  researchConfigSchema,
  replayRequestSchema,
} from './strategyLab.js';

export const LAB_TIMEFRAMES: readonly string[];
export const LAB_TF_MS: Readonly<Record<string, number>>;
export const REST_MAX_CANDLES: number;
export const LOCAL_MAX_CANDLES: number;
/** @deprecated Alias for REST_MAX_CANDLES. */
export const LAB_MAX_CANDLES: number;

export {
  indicatorSchema,
  logicRuleSchema,
  stopSchema,
  targetSchema,
  executionSchema,
  strategyDefinitionSchema,
  researchConfigSchema,
  replayRequestSchema,
};

export type IndicatorParsed = z.infer<typeof indicatorSchema>;
export type LogicRuleParsed = z.infer<typeof logicRuleSchema>;
export type StopParsed = z.infer<typeof stopSchema>;
export type TargetParsed = z.infer<typeof targetSchema>;
export type ExecutionParsed = z.infer<typeof executionSchema>;
export type StrategyDefinitionParsed = z.infer<typeof strategyDefinitionSchema>;
export type ResearchConfigParsed = z.infer<typeof researchConfigSchema>;
export type ReplayRequestParsed = z.infer<typeof replayRequestSchema>;

export function parseReplayRequest(body: unknown): ReplayRequestParsed;
