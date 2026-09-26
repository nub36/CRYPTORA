/**
 * SignalHistoryList — компактная лента серверных сигналов (§15).
 *
 * Источник — `GET /api/signals`, ограниченный и постраничный (`limit`/`offset`, `total`).
 * Клик по строке выбирает сигнал: переключает детали, линии уровней и график.
 */

import React from 'react';
import type { SignalUiModel } from '@/services/signals/ui/signalUiModel';
import { formatSignalTime } from '@/utils/serverSignalText';
import { Badge } from '@/components/common/Badge';

interface SignalHistoryListProps {
  models: SignalUiModel[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  title?: string;
}

export const SignalHistoryList: React.FC<SignalHistoryListProps> = ({
  models,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  selectedId,
  onSelect,
  title = 'История сигналов',
}) => {
  return (
    <section data-qa="signals-history" className="rounded-lg border border-surface-border bg-surface p-2 sm:p-2.5" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5 border-b border-surface-border/40">
        <span className="ui-card-title text-xs font-semibold tracking-wide text-slate-300">{title}</span>
        <span className="ui-helper font-mono text-[11px]">всего: {total}</span>
      </div>

      {models.length === 0 ? (
        <p className="ui-helper py-4 text-center text-slate-400">Сигналов пока нет — лента пустая, это не ошибка.</p>
      ) : (
        <ul className="mt-1.5 space-y-1" data-qa="signals-history-list">
          {models.map((m) => {
            const selected = m.id === selectedId;
            const isLong = m.direction === 'LONG';
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect(m.id)}
                  aria-pressed={selected}
                  data-qa="signal-card"
                  data-signal-id={m.id}
                  data-status={m.status}
                  data-direction={m.direction}
                  data-strategy={m.strategyId}
                  className={`group relative flex min-h-[42px] w-full flex-col justify-center gap-0.5 rounded border px-2 py-0.5 text-left transition-all ${
                    selected
                      ? 'border-l-4 border-l-brand-cyan border-brand-cyan/60 bg-brand-cyan/10 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]'
                      : 'border-l-2 border-l-transparent border-surface-border/40 bg-surface-elevated/30 hover:border-surface-border hover:bg-surface-hover'
                  }`}
                >
                  {/* Primary row: only the identity needed for rapid tape scanning. */}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 font-mono text-xs font-bold text-white transition-colors group-hover:text-cyan-300">
                      {m.pair}
                    </span>
                    <Badge
                      variant={isLong ? 'green' : 'red'}
                      size="xs"
                      className="shrink-0 px-1 py-0 text-[11px] font-bold tracking-tight"
                    >
                      {isLong ? '▲' : '▼'} {m.directionText}
                    </Badge>
                    <span className="shrink-0 rounded border border-surface-border/60 bg-surface-inset/80 px-1 text-[11px] font-mono text-slate-300">
                      {m.strategyShort}
                    </span>
                    <span className="shrink-0 text-[11px] font-mono text-slate-400">{m.timeframe}</span>
                  </div>

                  {/* Secondary row: lifecycle status and time; verbose entry prose stays in the inspector. */}
                  <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1 truncate text-slate-400">
                      <span
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          m.status === 'ACTIVE'
                            ? 'bg-cyan-400 animate-pulse'
                            : m.status === 'FILLED'
                            ? 'bg-emerald-400'
                            : 'bg-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{m.statusLabel}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400" data-qa="signal-card-time">
                      {formatSignalTime(m.signalCandleTs)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          data-qa="signals-history-more"
          className="mt-2 flex min-h-[34px] w-full items-center justify-center rounded border border-surface-border bg-surface-elevated/70 px-3 text-xs font-medium text-slate-300 transition-colors hover:border-surface-border-active hover:bg-surface-elevated hover:text-white disabled:opacity-50"
        >
          {loadingMore ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
};

export default SignalHistoryList;
