/**
 * SignalHistoryList — лента последних серверных сигналов выбранной монеты (§15).
 *
 * Источник — тот же `GET /api/signals?symbol=…`, ограниченный и постраничный
 * (`limit`/`offset`, `total` из ответа). «Бесконечной истории одним запросом»
 * нет: «Показать ещё» догружает следующую страницу через контракт API.
 *
 * Клик по строке выбирает сигнал: переключает детали и линии уровней на графике.
 * Порядок — как отдаёт сервер (новые сверху); на клиенте не пересортировывается.
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
}

export const SignalHistoryList: React.FC<SignalHistoryListProps> = ({
  models,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  selectedId,
  onSelect,
}) => {
  return (
    <section data-qa="signals-history" className="rounded-lg border border-surface-border bg-surface p-3" aria-label="История сигналов">
      <div className="flex items-center justify-between gap-2">
        <span className="ui-card-title">История сигналов</span>
        <span className="ui-helper">всего: {total}</span>
      </div>

      {models.length === 0 ? (
        <p className="ui-helper mt-2 text-center">Сигналов пока нет — лента пустая, это не ошибка.</p>
      ) : (
        <ul className="mt-2 space-y-1.5" data-qa="signals-history-list">
          {models.map((m) => {
            const selected = m.id === selectedId;
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
                  className={`flex w-full flex-col gap-1 rounded border px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? 'border-surface-border-active bg-brand-cyan/10'
                      : 'border-surface-border/60 bg-surface-elevated/40 hover:border-surface-border'
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={m.direction === 'LONG' ? 'green' : 'red'} size="xs">
                      {m.direction === 'LONG' ? '▲' : '▼'} {m.directionText}
                    </Badge>
                    <Badge variant="neutral" size="xs">{m.strategyShort}</Badge>
                    <span className="text-[11px] font-mono text-slate-400">{m.timeframe}</span>
                    <span className="ml-auto text-[11px] text-slate-400" data-qa="signal-card-time">
                      {formatSignalTime(m.signalCandleTs)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="ui-helper truncate">{m.statusLabel}</span>
                    {m.stop.price !== null && (
                      <span className="ui-num shrink-0 text-[11px] text-slate-300">стоп {m.stop.text}</span>
                    )}
                  </span>
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
          className="mt-2 flex min-h-[40px] w-full items-center justify-center rounded border border-surface-border bg-surface-elevated px-3 text-xs text-slate-300 transition-colors hover:text-white disabled:opacity-50"
        >
          {loadingMore ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
};

export default SignalHistoryList;
