/**
 * Frozen engine settings — replaces Suslik's `Settings` class (which imported
 * kysely / the production database). The archive has NO database dependency.
 *
 * Values are read from the verbatim copy of
 *   artifacts/research/v2-real-20260915-080338/settings.json
 *   sha256 92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9
 * (`SETTINGS_REGISTRY` defaults via `Settings.fromDefaults()`, deliberately not
 * the operator-editable DB rows). Integrity is asserted by unit tests.
 */

import settingsJson from '../results/v2-real-20260915-080338/settings.json' with { type: 'json' };

export const FROZEN_SETTINGS_SHA256 =
  '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9';

interface SettingsFile {
  runId: string;
  strategyCommit: string;
  settingsCount: number;
  settings: Record<string, unknown>;
}

const file = settingsJson as unknown as SettingsFile;

function num(key: string): number {
  const v = file.settings[key];
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`frozen setting ${key} missing or not numeric`);
  }
  return n;
}

/** The subset of the frozen registry that archived strategies consume. */
export const FROZEN_ENGINE = Object.freeze({
  runId: file.runId,
  strategyCommit: file.strategyCommit,
  settingsCount: file.settingsCount,
  /** `engine.swing_lookback` — pivot strength; confirmedIndex = index + strength. */
  swingLookback: Math.floor(num('engine.swing_lookback')),
  /** `risk.atr_period` — Wilder ATR period. */
  atrPeriod: Math.floor(num('risk.atr_period')),
  /** `v2.volume_period` — RVOL averaging window (excludes current bar). */
  volumePeriod: Math.floor(num('v2.volume_period')),
  /** `v2.displacement_min_body_atr` — V3.3 zone creation (frozen registry default). */
  displacementMinBodyAtr: num('v2.displacement_min_body_atr'),
  /** `v2.fvg_min_size_atr` — V3.3 FVG minimum size. */
  fvgMinSizeAtr: num('v2.fvg_min_size_atr'),
  /** `outcome.timeout_bars` — V2 baseline timeout (V3.0 overrides with its own 50). */
  outcomeTimeoutBars: Math.floor(num('outcome.timeout_bars')),
  /** `v2.stop_buffer_atr` — V2 baseline stop buffer (V3.0 overrides with 0.15). */
  v2StopBufferAtr: num('v2.stop_buffer_atr'),
  /** `outcome.sl_priority_on_ambiguous_bar` */
  slPriorityOnAmbiguousBar: file.settings['outcome.sl_priority_on_ambiguous_bar'] === true,
});

export type FrozenEngine = typeof FROZEN_ENGINE;
