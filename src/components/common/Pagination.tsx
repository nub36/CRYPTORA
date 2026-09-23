import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
  qa?: string;
}

/** Compact pager for virtualised-by-page tables. */
export const Pagination: React.FC<PaginationProps> = ({ page, pageCount, from, to, total, onPage, qa = 'pagination' }) => {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center gap-2 font-sans text-[11px] text-slate-400" data-qa={qa}>
      <span className="tabular-nums">{from}–{to} из {total}</span>
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label="Предыдущая страница"
        data-qa={`${qa}-prev`}
        className="rounded border border-white/[0.08] p-1 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="tabular-nums" data-qa={`${qa}-label`}>{page} / {pageCount}</span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        aria-label="Следующая страница"
        data-qa={`${qa}-next`}
        className="rounded border border-white/[0.08] p-1 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
