import React from 'react';
import { Database } from 'lucide-react';

/**
 * Явная маркировка страниц, чьи данные — статический справочный набор в коде
 * (не обновляется из внешнего источника). Инвариант: фикстуры и справочники
 * никогда не выдаются за LIVE.
 */
export const StaticDatasetNotice: React.FC<{ what: string; source?: string; qa?: string }> = ({ what, source, qa }) => (
  <div
    data-qa={qa ?? 'static-dataset-notice'}
    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-sans text-amber-200"
  >
    <Database className="h-3.5 w-3.5 shrink-0 text-amber-300" />
    <span className="font-mono font-semibold tracking-wide text-amber-300">СТАТИЧЕСКИЙ НАБОР</span>
    <span>
      {what} — справочные значения, зашитые в код; они не запрашиваются из внешнего источника и не обновляются в реальном времени.
      {source ? ` Подключение источника: ${source}.` : ''}
    </span>
  </div>
);
