/**
 * Immutable registry of archived strategy versions.
 * Each entry is its own module — no shared mutable params, no `if (version)`.
 * Step 1 imports V3.0 only; further versions (V2.1…V2.8, V3.1 FALSIFIED) follow
 * in later steps and are listed as PLANNED so the UI never hides negative results.
 */

import type { StrategyDefinition } from './types';
import { V30_DEFINITION } from './definitions/v3_0-htf-liquidation-trap/definition';
import { V31_DEFINITION } from './definitions/v3_1-htf-trend-pullback/definition';

export const STRATEGY_ARCHIVE: readonly StrategyDefinition[] = Object.freeze([V30_DEFINITION, V31_DEFINITION]);

export interface PlannedEntry {
  version: string;
  name: string;
  sourceVerdict: string;
}

/**
 * Versions found in the source archive but not yet imported (to prevent survivor bias in the UI).
 * Source of truth: docs/STRATEGY_ARCHIVE.md @2d8a3dd — 13 rows. The frozen V2 engine baseline run
 * (`results/v2-real-20260915-080338`) is the reference/settings source, not a strategy row.
 */
export const STRATEGY_ARCHIVE_PLANNED: readonly PlannedEntry[] = Object.freeze([
  { version: '2.1a', name: 'Structural Limit Entry', sourceVerdict: 'REJECTED_ON_TRAIN' },
  { version: '2.1b', name: 'Confirmed-Extreme Corridor Entry', sourceVerdict: 'REJECTED_ON_TRAIN' },
  { version: '2.2', name: 'HTF Spot/Futures Engine', sourceVerdict: 'REJECTED_ON_TRAIN' },
  { version: '2.3', name: 'Sniper Reversal', sourceVerdict: 'REJECTED_ON_TRAIN' },
  { version: '2.4', name: 'Asymmetric Sniper', sourceVerdict: 'FAILED_VALIDATION' },
  { version: '2.5', name: 'Trailing Stop + Breakeven', sourceVerdict: 'CRITERION_PASSED_NET_NEGATIVE' },
  { version: '2.6', name: 'Sniper + Trailing', sourceVerdict: 'REJECTED_ON_TRAIN' },
  { version: '2.7', name: 'Fixed-RR Target Optimisation', sourceVerdict: 'REJECTED_ON_TRAIN' },
  { version: '2.8', name: 'Zero-fee Sniper + Trailing', sourceVerdict: 'VALIDATED_GROSS_ONLY' },
  { version: '3.2', name: 'HTF Volume Climax & Absorption', sourceVerdict: 'FALSIFIED_ON_TRAIN (+2 EMA50 variants UNPROMOTED)' },
  { version: '3.3', name: 'HTF Zone Mitigation & LTF Squeeze', sourceVerdict: 'TRAIN_ONLY (not validated)' },
]);

/** Total archive rows = imported + planned (derived, never hard-coded elsewhere). */
export const STRATEGY_ARCHIVE_TOTAL_ROWS = STRATEGY_ARCHIVE.length + STRATEGY_ARCHIVE_PLANNED.length;

export function getStrategyDefinition(id: string): StrategyDefinition | undefined {
  return STRATEGY_ARCHIVE.find((d) => d.id === id);
}
