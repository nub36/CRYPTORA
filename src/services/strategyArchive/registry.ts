/**
 * Immutable registry of archived strategy versions.
 * Each entry is its own module — no shared mutable params, no `if (version)`.
 * C1–C6 import V2.2…V2.8 and V3.0…V3.3; V2.1a/V2.1b follow in C7 and are listed as PLANNED
 * so the UI never hides negative results.
 */

import type { StrategyDefinition } from './types';
import { V30_DEFINITION } from './definitions/v3_0-htf-liquidation-trap/definition';
import { V31_DEFINITION } from './definitions/v3_1-htf-trend-pullback/definition';
import { V32_DEFINITION } from './definitions/v3_2-volume-climax/definition';
import { V33_DEFINITION } from './definitions/v3_3-htf-zone-mitigation/definition';
import { V22_DEFINITION } from './definitions/v2_2-htf-spot-engine/definition';
import { V23_DEFINITION } from './definitions/v2_3-sniper-reversal/definition';
import { V24_DEFINITION } from './definitions/v2_4-asymmetric-sniper/definition';
import { V25_DEFINITION } from './definitions/v2_5-trailing-stop/definition';
import { V26_DEFINITION } from './definitions/v2_6-sniper-trailing/definition';
import { V27_DEFINITION } from './definitions/v2_7-rr-optimization/definition';
import { V28_DEFINITION } from './definitions/v2_8-zero-fee-sniper-trailing/definition';

export const STRATEGY_ARCHIVE: readonly StrategyDefinition[] = Object.freeze([
  V22_DEFINITION, V23_DEFINITION, V24_DEFINITION, V25_DEFINITION, V26_DEFINITION,
  V27_DEFINITION, V28_DEFINITION, V30_DEFINITION, V31_DEFINITION, V32_DEFINITION, V33_DEFINITION,
]);

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
]);

/** Total archive rows = imported + planned (derived, never hard-coded elsewhere). */
export const STRATEGY_ARCHIVE_TOTAL_ROWS = STRATEGY_ARCHIVE.length + STRATEGY_ARCHIVE_PLANNED.length;

export function getStrategyDefinition(id: string): StrategyDefinition | undefined {
  return STRATEGY_ARCHIVE.find((d) => d.id === id);
}
