/**
 * Read-only replacement for svechnoy-suslik-v2 `Settings.fromDefaults()` (src/core/settings.ts @ 4839074,
 * sha256 8ba45d2e…, which imports the production database and is NOT ported).
 *
 * Values come from the frozen registry snapshot `results/v2-real-20260915-080338/settings.json`
 * (sha256 92311c4f…, `settingsCount` keys) — the same snapshot the source research runs used.
 * ARCHIVE-ONLY. Immutable. No database, no environment, no overrides.
 */

import settingsJson from '../../results/v2-real-20260915-080338/settings.json' with { type: 'json' };

interface SettingsFile { settings: Record<string, unknown> }
const file = settingsJson as unknown as SettingsFile;

export class Settings {
  private constructor(private readonly values: Readonly<Record<string, unknown>>) {}

  /** The frozen registry defaults — the only constructor the archive exposes. */
  static fromFrozenSnapshot(): Settings {
    return new Settings(Object.freeze({ ...file.settings }));
  }

  num(key: string): number {
    const v = this.values[key];
    const n = typeof v === 'string' ? Number(v) : (v as number);
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`frozen setting ${key} missing or not numeric`);
    return n;
  }

  bool(key: string): boolean {
    const v = this.values[key];
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw new Error(`frozen setting ${key} missing or not boolean`);
  }

  str(key: string): string {
    const v = this.values[key];
    if (v === undefined || v === null) throw new Error(`frozen setting ${key} missing`);
    return String(v);
  }
}
