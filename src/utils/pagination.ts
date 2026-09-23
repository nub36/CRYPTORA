/**
 * Pure pagination for large universes (500+ Spot assets, 500+ perpetuals).
 * Only the current page is rendered, so the DOM stays bounded regardless of
 * universe size (PR #13 P0: never render hundreds of heavy rows at once).
 */
export const DEFAULT_PAGE_SIZE = 50;

export interface Page<T> {
  rows: T[];
  page: number; // 1-based, clamped
  pageCount: number;
  total: number;
  from: number; // 1-based index of first row on page (0 when empty)
  to: number;
}

export function paginate<T>(rows: readonly T[], page: number, pageSize = DEFAULT_PAGE_SIZE): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: current, pageCount, total, from: total === 0 ? 0 : start + 1, to: start + slice.length };
}
