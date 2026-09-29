import React from 'react';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { Pagination } from '@/components/common/Pagination';
import type { Page } from '@/utils/pagination';

/**
 * Shared "market universe" table chrome for Spot and Futures.
 *
 * Extracted from MarketPage so the two routes cannot drift apart again:
 * identical section framing, spacing, typography, sticky header treatment,
 * horizontal-scroll behaviour, footer (count + pager + source status) and
 * loading / error / empty states.
 *
 * Column definitions stay in the pages — Spot and Futures show genuinely
 * different instruments, and forcing one column model on both would push
 * spot metrics onto derivatives rows (explicitly forbidden by the task).
 */

export type MarketTableStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface MarketTableShellProps<T> {
  label: string;
  title: string;
  /** Rendered in the section header meta slot. */
  meta?: React.ReactNode;
  className?: string;
  status: MarketTableStatus;
  /** Number of columns, used for the state row `colSpan`. */
  columnCount: number;
  head: React.ReactNode;
  children?: React.ReactNode;
  page: Page<T>;
  onPage: (page: number) => void;
  paginationQa: string;
  /** Footer left slot: "Найдено: N из M …". */
  footerSummary: React.ReactNode;
  /** Footer right slot: source/provenance status. */
  footerStatus?: React.ReactNode;
  /** Shown above the table (mobile sort control, chips, …). */
  toolbar?: React.ReactNode;
  emptyMessage?: string;
  errorMessage?: string;
  loadingMessage?: string;
  onRetry?: () => void;
  qa?: string;
}

export function MarketTableShell<T>({
  label,
  title,
  meta,
  className = '',
  status,
  columnCount,
  head,
  children,
  page,
  onPage,
  paginationQa,
  footerSummary,
  footerStatus,
  toolbar,
  emptyMessage = 'По вашему запросу инструменты не найдены.',
  errorMessage = 'Источник данных недоступен.',
  loadingMessage = 'Загрузка инструментов…',
  onRetry,
  qa = 'market-table',
}: MarketTableShellProps<T>): React.ReactElement {
  return (
    <TerminalSection label={label} title={title} meta={meta} className={`market-workspace ${className}`}>
      {toolbar && <div className="mb-2.5">{toolbar}</div>}
      <div className="market-table" data-qa={qa} data-status={status}>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-sans text-xs">
            <thead className="sticky top-0 z-10 select-none border-b border-surface-border bg-surface-elevated/80 font-sans text-[11px] text-slate-400">
              {head}
            </thead>
            <tbody className="divide-y divide-surface-border font-mono">
              {status === 'ready' ? children : (
                <tr>
                  <td colSpan={columnCount} className="py-12 text-center font-sans text-slate-500">
                    {status === 'loading' && (
                      <span role="status" data-qa={`${qa}-loading`}>{loadingMessage}</span>
                    )}
                    {status === 'empty' && (
                      <span role="status" data-qa={`${qa}-empty`}>{emptyMessage}</span>
                    )}
                    {status === 'error' && (
                      <span role="alert" data-qa={`${qa}-error`} className="inline-flex flex-wrap items-center justify-center gap-2 text-rose-300">
                        {errorMessage}
                        {onRetry && (
                          <button
                            type="button"
                            onClick={onRetry}
                            data-qa={`${qa}-retry`}
                            className="min-h-[32px] rounded-lg border border-white/[0.12] bg-surface-elevated px-3 py-1 text-xs font-semibold text-slate-200 transition-colors hover:bg-surface-hover hover:text-white"
                          >
                            Повторить
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border bg-surface-elevated/50 p-3 font-sans text-xs text-slate-400">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {footerSummary}
            <Pagination {...page} onPage={onPage} qa={paginationQa} />
          </div>
          {footerStatus}
        </div>
      </div>
    </TerminalSection>
  );
}
