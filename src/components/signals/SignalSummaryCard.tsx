/**
 * SignalSummaryCard — главная сводка выбранного/последнего сигнала (§9, §11).
 *
 * Компактный ответ человеческим языком: монета, направление, стратегия, таймфрейм,
 * компактная полоса цен: ВХОД | СТОП | TP1 | TP2... и статус.
 */

import React from 'react';
import type { SignalUiModel } from '@/services/signals/ui/signalUiModel';
import { formatSignalTime } from '@/utils/serverSignalText';
import { Badge } from '@/components/common/Badge';
import { SignalStatusChip } from './SignalStatusChip';

interface SignalSummaryCardProps {
  model: SignalUiModel | null;
}

export const SignalSummaryCard: React.FC<SignalSummaryCardProps> = ({ model }) => {
  if (!model) return null;

  const targets = model.targets;

  return (
    <section
      data-qa="signals-summary"
      data-signal-id={model.id}
      data-status={model.status}
      data-direction={model.direction}
      className="rounded-lg border border-surface-border bg-surface p-3 space-y-2.5"
      aria-label={`Текущий сигнал ${model.pair}`}
    >
      {/* Top Identity Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border/40 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-bold text-white tracking-tight">{model.pair}</span>
          <Badge variant={model.direction === 'LONG' ? 'green' : 'red'} size="sm" className="font-bold">
            {model.direction === 'LONG' ? '▲' : '▼'} {model.directionText}
          </Badge>
          <Badge variant="neutral" size="sm">{model.strategyText}</Badge>
          <span className="rounded border border-surface-border bg-surface-elevated px-2 py-0.5 text-xs font-mono text-slate-300">
            {model.timeframe}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            {formatSignalTime(model.signalCandleTs)}
          </span>
        </div>
        <SignalStatusChip status={model.status} size="sm" />
      </div>

      {/* Outcome line if trade is closed */}
      {model.hasTrade && (
        <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2.5 py-1" data-qa="signals-summary-result">
          <span className="font-sans text-slate-300">Результат:</span>
          <span className="font-bold">{model.outcome.gross} (gross)</span>
          <span className="text-slate-400">·</span>
          <span className="font-bold">{model.outcome.net} (net)</span>
          {model.outcome.pnlPct && <span className="text-slate-400">({model.outcome.pnlPct})</span>}
        </div>
      )}

      {/* Compact Price Strip: ENTRY | STOP | TP1 | TP2 | TP3... */}
      <div className="flex flex-wrap items-stretch gap-1.5 sm:gap-2">
        {/* Entry */}
        <div className="flex-1 min-w-[100px] rounded border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5">
          <div className="text-[11px] font-sans font-medium tracking-wide text-cyan-300/80">
            {model.entry.max !== null && model.entry.min !== null && model.entry.min !== model.entry.max ? 'Вход (зона)' : 'Вход'}
          </div>
          <div className="font-mono text-xs sm:text-sm font-bold text-cyan-300 truncate mt-0.5">
            {model.entry.text}
          </div>
        </div>

        {/* Stop */}
        <div className="flex-1 min-w-[100px] rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5">
          <div className="text-[11px] font-sans font-medium tracking-wide text-rose-300/80">
            Стоп
          </div>
          <div className="font-mono text-xs sm:text-sm font-bold text-rose-400 truncate mt-0.5">
            {model.stop.text}
          </div>
        </div>

        {/* Targets */}
        {targets.slice(0, 3).map((t) => (
          <div key={t.index} className="flex-1 min-w-[100px] rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5">
            <div className="text-[11px] font-sans font-medium tracking-wide text-emerald-300/80 truncate">
              {t.label}
            </div>
            <div className="font-mono text-xs sm:text-sm font-bold text-emerald-400 truncate mt-0.5">
              {t.text}
            </div>
          </div>
        ))}

        {targets.length > 3 && (
          <div className="flex-1 min-w-[90px] rounded border border-surface-border bg-surface-elevated px-2 py-1.5 flex flex-col justify-center">
            <div className="text-[11px] text-slate-400">Ещё: +{targets.length - 3}</div>
            <div className="text-xs text-slate-300 font-semibold">в деталях</div>
          </div>
        )}
      </div>

      {targets.length === 0 && (
        <p className="ui-helper mt-1 text-amber-300" data-qa="signals-summary-no-targets">
          Сервер не передал целей для этого сигнала — уровни не достраиваются.
        </p>
      )}
    </section>
  );
};

export default SignalSummaryCard;
