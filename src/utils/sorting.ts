export type SortDirection = 'asc' | 'desc';

export interface SortConfig<T> {
  key: keyof T;
  direction: SortDirection;
}

export function sortData<T>(data: T[], config: SortConfig<T> | null): T[] {
  if (!config) return data;

  return [...data].sort((a, b) => {
    const valA = a[config.key];
    const valB = b[config.key];

    if (valA === valB) return 0;
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    let comparison = 0;
    if (typeof valA === 'number' && typeof valB === 'number') {
      comparison = valA - valB;
    } else {
      comparison = String(valA).localeCompare(String(valB));
    }

    return config.direction === 'asc' ? comparison : -comparison;
  });
}
