/**
 * CRYPTORA — one sorting model for every market universe table (Spot + Futures).
 *
 * Replaces the two previously incompatible implementations:
 *   - `sortMarketUniverse()` (Spot): quote-aware, nulls-last only by accident;
 *   - `sortData()` (Futures): not stable, `String(x).localeCompare` applied to
 *     numbers, and no notion of "missing" versus "zero".
 *
 * Contract (task §7):
 *   - numeric fields sort by NUMBER, never by formatted string;
 *   - `null` / `undefined` / `NaN` ("Нет данных") always sink to the BOTTOM,
 *     in both directions;
 *   - the sort is STABLE for equal values (ties keep the incoming order, which
 *     callers pre-seed with a deterministic catalog order);
 *   - sorting is a pure function of (rows, field, direction), so callers can
 *     run it strictly AFTER filters/search and BEFORE pagination.
 */

export type SortDirection = 'asc' | 'desc';

export type SortValue = number | string | null | undefined;

export interface MarketSortField<T> {
  /** Stable id used in state, URLs and `data-` attributes. */
  key: string;
  /** Header / mobile-control label. */
  label: string;
  /** Short label for the mobile control when the header label is long. */
  shortLabel?: string;
  kind: 'numeric' | 'text';
  /** Raw (unformatted) value used for comparison. */
  value: (row: T) => SortValue;
  /** Direction applied on the FIRST click of this field. */
  defaultDirection?: SortDirection;
}

export interface MarketSortState {
  key: string;
  direction: SortDirection;
}

/** A value that must sink to the bottom regardless of direction. */
export function isMissingSortValue(value: SortValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // "—" and "Нет данных" are rendering artefacts; if one ever reaches the
    // comparator it must behave as missing rather than sort alphabetically.
    return trimmed === '' || trimmed === '—' || trimmed === '-' || trimmed === 'Нет данных';
  }
  return false;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Compare two already-extracted values. Missing values are always last.
 * Returns a number suitable for `Array.prototype.sort`.
 */
export function compareSortValues(
  a: SortValue,
  b: SortValue,
  direction: SortDirection,
  kind: 'numeric' | 'text' = 'numeric',
): number {
  const aMissing = isMissingSortValue(a);
  const bMissing = isMissingSortValue(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let comparison: number;
  if (kind === 'numeric') {
    const na = typeof a === 'number' ? a : Number.parseFloat(String(a));
    const nb = typeof b === 'number' ? b : Number.parseFloat(String(b));
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
    if (!Number.isFinite(na)) return 1;
    if (!Number.isFinite(nb)) return -1;
    comparison = na - nb;
  } else {
    comparison = collator.compare(String(a), String(b));
  }
  if (comparison === 0) return 0;
  return direction === 'asc' ? comparison : -comparison;
}

/**
 * Stable sort of `rows` by the field identified by `state.key`.
 * Unknown keys return a copy of the input untouched (never throws on a stale
 * persisted sort key).
 */
export function sortMarketRows<T>(
  rows: readonly T[],
  fields: ReadonlyArray<MarketSortField<T>>,
  state: MarketSortState | null,
): T[] {
  if (!state) return [...rows];
  const field = fields.find((f) => f.key === state.key);
  if (!field) return [...rows];
  // Decorate-sort-undecorate keeps the sort stable on every engine and avoids
  // recomputing accessors O(n log n) times.
  return rows
    .map((row, index) => ({ row, index, value: field.value(row) }))
    .sort((a, b) => compareSortValues(a.value, b.value, state.direction, field.kind) || a.index - b.index)
    .map((entry) => entry.row);
}

/** Click semantics: same field toggles direction, a new field starts at its default. */
export function nextSortState<T>(
  current: MarketSortState | null,
  fields: ReadonlyArray<MarketSortField<T>>,
  key: string,
): MarketSortState {
  if (current && current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  const field = fields.find((f) => f.key === key);
  return { key, direction: field?.defaultDirection ?? 'desc' };
}

/** Human-readable description of the active sort (mobile control + a11y). */
export function describeSortState<T>(
  fields: ReadonlyArray<MarketSortField<T>>,
  state: MarketSortState | null,
): string {
  if (!state) return 'Без сортировки';
  const field = fields.find((f) => f.key === state.key);
  if (!field) return 'Без сортировки';
  const suffix = field.kind === 'text'
    ? (state.direction === 'asc' ? 'А → Я' : 'Я → А')
    : (state.direction === 'asc' ? 'по возрастанию' : 'по убыванию');
  return `${field.label}: ${suffix}`;
}
