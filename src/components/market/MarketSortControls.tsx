import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { MarketSortField, MarketSortState, SortDirection } from '@/utils/marketSort';
import { describeSortState } from '@/utils/marketSort';

/**
 * Shared sorting affordances for every market universe table.
 *
 * Desktop: clickable `<th>` with an explicit direction icon and `aria-sort`.
 * Mobile:  a `<select>` + direction toggle, because on a 360–430px viewport
 *          the table scrolls horizontally and several sortable columns are
 *          `hidden md:table-cell` — i.e. their headers are unreachable.
 */

interface SortableHeaderCellProps<T> {
  field: MarketSortField<T>;
  state: MarketSortState | null;
  onSort: (key: string) => void;
  align?: 'left' | 'right';
  className?: string;
}

export function SortableHeaderCell<T>({
  field,
  state,
  onSort,
  align = 'left',
  className = '',
}: SortableHeaderCellProps<T>): React.ReactElement {
  const isActive = state?.key === field.key;
  const isAsc = state?.direction === 'asc';
  const alignClass = align === 'right' ? 'justify-end text-right' : 'justify-start text-left';
  return (
    <th
      scope="col"
      aria-sort={isActive ? (isAsc ? 'ascending' : 'descending') : 'none'}
      data-sort-key={field.key}
      data-sort-active={isActive ? 'true' : 'false'}
      onClick={() => onSort(field.key)}
      className={`py-2.5 px-2.5 cursor-pointer transition-colors hover:text-white ${alignClass} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span className="whitespace-nowrap">{field.label}</span>
        {isActive ? (
          isAsc
            ? <ArrowUp className="h-3 w-3 shrink-0 text-cyan-400" aria-hidden />
            : <ArrowDown className="h-3 w-3 shrink-0 text-cyan-400" aria-hidden />
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
        )}
      </span>
    </th>
  );
}

interface MobileSortControlProps<T> {
  fields: ReadonlyArray<MarketSortField<T>>;
  state: MarketSortState | null;
  onChange: (next: MarketSortState) => void;
  qa?: string;
  className?: string;
}

/**
 * Mobile-first sort control. Rendered `lg:hidden` by callers so the desktop
 * header stays the primary affordance on wide viewports.
 */
export function MobileSortControl<T>({
  fields,
  state,
  onChange,
  qa = 'market-sort',
  className = '',
}: MobileSortControlProps<T>): React.ReactElement {
  const activeKey = state?.key ?? fields[0]?.key ?? '';
  const direction: SortDirection = state?.direction ?? 'desc';
  const activeField = fields.find((f) => f.key === activeKey);
  const isText = activeField?.kind === 'text';

  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${className}`}
      data-qa={qa}
      role="group"
      aria-label="Сортировка таблицы"
    >
      <label className="shrink-0 font-sans text-[11px] font-semibold text-slate-400" htmlFor={`${qa}-field`}>
        Сортировка
      </label>
      <select
        id={`${qa}-field`}
        data-qa={`${qa}-field`}
        value={activeKey}
        onChange={(e) => onChange({ key: e.target.value, direction })}
        className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-surface-elevated px-2.5 py-1.5 font-sans text-xs text-white focus:border-cyan-400 focus:outline-none"
      >
        {fields.map((field) => (
          <option key={field.key} value={field.key}>
            {field.shortLabel ?? field.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-qa={`${qa}-direction`}
        aria-label={direction === 'asc' ? 'Сортировать по убыванию' : 'Сортировать по возрастанию'}
        title={describeSortState(fields, { key: activeKey, direction })}
        onClick={() => onChange({ key: activeKey, direction: direction === 'asc' ? 'desc' : 'asc' })}
        className="inline-flex min-h-[36px] min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-surface-elevated px-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-surface-hover hover:text-white"
      >
        {direction === 'asc'
          ? <ArrowUp className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
          : <ArrowDown className="h-3.5 w-3.5 text-cyan-400" aria-hidden />}
        <span className="font-mono text-[11px]" data-qa={`${qa}-direction-label`}>
          {isText ? (direction === 'asc' ? 'A→Z' : 'Z→A') : (direction === 'asc' ? '0→9' : '9→0')}
        </span>
      </button>
    </div>
  );
}
