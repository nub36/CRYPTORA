/**
 * SignalMarkerPopover — карточка / bottom sheet деталей сигнала по тапу на маркер (§4).
 *
 * Отображает:
 *   • пару (BTC/USDT), направление (LONG/SHORT), стратегию (V3.0), таймфрейм (1h);
 *   • время сигнала в часовом поясе устройства;
 *   • вход (коридор или цена), стоп, цели (TP1, TP2…);
 *   • статус (В позиции / Закрыт / etc.) и результат сделки (gross/net R);
 *   • кнопку «Показать уровни» / «Скрыть уровни» на графике;
 *   • кнопку закрытия (X) и закрытие по Esc / тапу вне карточки (§18).
 *
 * На mobile компонент докается как удобный bottom sheet в нижней части графика,
 * не перекрывая свечи и не выходя за границы экрана.
 */

import React, { useEffect, useRef } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import type { SignalUiModel } from '@/services/signals/ui/signalUiModel';
import { formatSignalTime, formatSignalPrice } from '@/utils/serverSignalText';
import { Badge } from '@/components/common/Badge';
import { SignalStatusChip } from './SignalStatusChip';

interface SignalMarkerPopoverProps {
  model: SignalUiModel | null;
  isOpen: boolean;
  onClose: () => void;
  showLevels: boolean;
  onToggleLevels: () => void;
}

export const SignalMarkerPopover: React.FC<SignalMarkerPopoverProps> = ({
  model,
  isOpen,
  onClose,
  showLevels,
  onToggleLevels,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Закрытие по Escape (§18)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !model) return null;

  const isQuarantined = model.provenanceStatus === 'MISMATCH' || model.provenanceStatus === 'UNKNOWN';

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Детали сигнала ${model.pair}`}
      data-qa="signal-marker-popover"
      data-testid="signal-marker-popover"
      data-signal-id={model.id}
      className="absolute bottom-0 inset-x-0 z-30 rounded-t-xl border-t border-x border-surface-border bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md sm:bottom-3 sm:left-3 sm:right-auto sm:max-w-sm sm:rounded-xl sm:border sm:p-3 animate-in slide-in-from-bottom duration-150"
    >
      {/* Mobile drag pill handle */}
      <div className="mx-auto -mt-1 mb-2 h-1 w-10 rounded-full bg-slate-600 sm:hidden" />

      {/* Header: Pair + Direction + Strategy + Timeframe + Close */}
      <div className="flex items-start justify-between gap-2 border-b border-surface-border/60 pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-white text-sm">{model.pair}</span>
          <Badge variant={model.direction === 'LONG' ? 'green' : 'red'} size="xs">
            {model.direction === 'LONG' ? '▲' : '▼'} {model.directionText}
          </Badge>
          <Badge variant="neutral" size="xs">{model.strategyShort}</Badge>
          <span className="rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-[11px] font-mono text-slate-300">
            {model.timeframe}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <SignalStatusChip status={model.status} size="xs" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть детали сигнала"
            data-qa="popover-close"
            data-testid="popover-close"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-surface-elevated hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Time in browser local timezone (§4, §11) */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>Сигнал: {formatSignalTime(model.signalCandleTs)}</span>
        {isQuarantined && (
          <span
            className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300 font-medium"
            data-qa="popover-quarantine-badge"
            data-testid="popover-quarantine-badge"
          >
            Карантин
          </span>
        )}
      </div>

      {/* Result if known */}
      {model.hasTrade && (
        <div className="mt-1 text-[11px] font-mono text-slate-300" data-qa="popover-result" data-testid="popover-result">
          <span className="text-slate-400">Результат: </span>
          <span className="text-emerald-400 font-semibold">{model.outcome.gross} gross</span>
          <span className="text-slate-400"> · </span>
          <span className="text-emerald-400 font-semibold">{model.outcome.net} net</span>
        </div>
      )}

      {/* Levels Grid: Entry, Stop, Targets */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-xs">
        {/* Entry */}
        <div className="rounded border border-surface-border/60 bg-surface-elevated/40 px-2 py-1.5">
          <div className="text-[11px] font-medium tracking-wide text-slate-400">Вход</div>
          <div className="font-mono font-semibold text-cyan-300 truncate" title={model.entry.text}>
            {model.entry.min !== null && model.entry.max !== null && model.entry.min !== model.entry.max
              ? `${formatSignalPrice(model.entry.min)} – ${formatSignalPrice(model.entry.max)}`
              : model.entry.text}
          </div>
        </div>

        {/* Stop */}
        <div className="rounded border border-surface-border/60 bg-surface-elevated/40 px-2 py-1.5">
          <div className="text-[11px] font-medium tracking-wide text-slate-400">Стоп</div>
          <div className="font-mono font-semibold text-rose-400 truncate" title={model.stop.text}>
            {model.stop.price !== null ? formatSignalPrice(model.stop.price) : '—'}
          </div>
        </div>

        {/* Targets */}
        {model.targets.map((t) => (
          <div
            key={t.index}
            className="rounded border border-surface-border/60 bg-surface-elevated/40 px-2 py-1.5"
          >
            <div className="text-[11px] font-medium tracking-wide text-slate-400">
              Цель {t.index + 1}
            </div>
            <div className="font-mono font-semibold text-emerald-400 truncate">
              {formatSignalPrice(t.price)}
            </div>
          </div>
        ))}
      </div>

      {/* Toggle Levels Button (§4: «Показать уровни» / «Скрыть уровни») */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-surface-border/40 pt-2.5">
        <button
          type="button"
          onClick={onToggleLevels}
          data-qa="popover-toggle-levels"
          data-testid="popover-toggle-levels"
          className={`flex min-h-[32px] w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
            showLevels
              ? 'border-brand-cyan/40 bg-brand-cyan/15 text-brand-cyan hover:bg-brand-cyan/25'
              : 'border-surface-border bg-surface-elevated text-slate-300 hover:text-white hover:bg-surface-elevated/80'
          }`}
        >
          {showLevels ? (
            <>
              <EyeOff className="h-3.5 w-3.5" />
              <span>Скрыть уровни на графике</span>
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" />
              <span>Показать уровни на графике</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default SignalMarkerPopover;
