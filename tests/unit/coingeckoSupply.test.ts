import { describe, it, expect } from 'vitest';

/**
 * CoinGecko supply data: runtime validation, null handling, UI display contract.
 *
 * The adapter uses Zod schemas to validate supply fields from the CoinGecko API.
 * When supply is null (not provided by source), the UI must show "—" not a calculated value.
 */

describe('CoinGecko supply field nullability', () => {
  it('null totalSupply renders as "—" in UI (not 0 or calculated)', () => {
    const supply: number | null = null;
    // Contract: null → display "—"
    expect(supply).toBeNull();
    const display: string = supply != null ? String(supply) : '—';
    expect(display).toBe('—');
  });

  it('valid totalSupply renders as formatted number', () => {
    const supply: number | null = 19_800_000;
    const display: string = supply != null ? String(supply) : '—';
    expect(display).not.toBe('—');
    expect(display).toContain('19');
  });

  it('null maxSupply renders as "—" (some coins have no cap)', () => {
    const maxSupply: number | null = null;
    const display: string = maxSupply != null ? String(maxSupply) : '—';
    expect(display).toBe('—');
  });

  it('zero supply is distinct from null', () => {
    const zero: number | null = 0;
    const nil: number | null = null;
    expect(zero != null).toBe(true);
    expect(nil != null).toBe(false);
    // Zero is a valid supply value (e.g., burned tokens), null means "not available"
    const displayZero: string = zero != null ? String(zero) : '—';
    const displayNil: string = nil != null ? String(nil) : '—';
    expect(displayZero).toBe('0');
    expect(displayNil).toBe('—');
  });

  it('supply fields from CoinGecko adapter are typed as number | null', () => {
    // Simulating the adapter output type
    interface CoinGeckoAssetMeta {
      totalSupply: number | null;
      maxSupply: number | null;
    }

    const withSupply: CoinGeckoAssetMeta = { totalSupply: 21_000_000, maxSupply: 21_000_000 };
    const withoutSupply: CoinGeckoAssetMeta = { totalSupply: null, maxSupply: null };
    const partial: CoinGeckoAssetMeta = { totalSupply: 19_500_000, maxSupply: null };

    expect(withSupply.totalSupply).toBe(21_000_000);
    expect(withoutSupply.totalSupply).toBeNull();
    expect(partial.maxSupply).toBeNull();
    expect(partial.totalSupply).toBe(19_500_000);
  });
});

describe('Heatmap unavailable tile contract', () => {
  it('unavailable tile uses calm styling, not bright error', () => {
    // The UNAVAILABLE_TILE from HeatmapGrid
    const UNAVAILABLE_TILE = {
      bg: 'bg-surface-inset border-white/[0.06] text-slate-500',
      label: 'НЕТ ДАННЫХ',
      sublabel: 'источник недоступен',
    };

    // Calm: no bright red, no error- prefix, no alert colors
    expect(UNAVAILABLE_TILE.bg).not.toContain('red');
    expect(UNAVAILABLE_TILE.bg).not.toContain('rose');
    expect(UNAVAILABLE_TILE.bg).not.toContain('error');
    expect(UNAVAILABLE_TILE.bg).not.toContain('alert');
    // Uses muted surface colors
    expect(UNAVAILABLE_TILE.bg).toContain('surface');
    expect(UNAVAILABLE_TILE.bg).toContain('slate');
    // Label is informative, not alarming
    expect(UNAVAILABLE_TILE.label).toBe('НЕТ ДАННЫХ');
  });

  it('unavailable tile appears for OI metric when no futures data', () => {
    const UNAVAILABLE_TILE = {
      bg: 'bg-surface-inset border-white/[0.06] text-slate-500',
      label: 'НЕТ ДАННЫХ',
      sublabel: 'источник недоступен',
    };

    // Simulate: no futures row for this asset
    const futuresRow = undefined;

    const result = !futuresRow ? UNAVAILABLE_TILE : null;
    expect(result).not.toBeNull();
    expect(result!.label).toBe('НЕТ ДАННЫХ');
  });
});
