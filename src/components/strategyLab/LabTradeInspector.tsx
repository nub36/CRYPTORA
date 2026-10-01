/**
 * CRYPTORA — Strategy Lab · инспектор выбранной сделки (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Компактная карточка выбранной сделки (§7): только ФАКТИЧЕСКИЕ данные из
 * backtest-результата — метаданные запроса, таймстемпы/цены исполнения,
 * исход, R-результат и условия стратегии на сигнальном баре (готовые series
 * движка, без пересчёта). Закрывается крестиком (сброс выбора).
 *
 * Мобильный контракт (§16): без горизонтального overflow (grid + min-w-0 +
 * break-words), tap-цели ≥ обычных кнопок, ничего не перекрывает график.
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type {
  LabReplayResult,
  LabTrade,
  StrategyDraftDefinition,
} from '@/services/strategyLab/types';
import {
  formatPrice,
  formatR,
  formatTime,
  reasonLabel,
  sideLabel,
} from './labFormat';
import { getLabSignalDiagnostics } from './labSignalDiagnostics';

interface LabTradeInspectorProps {
  result: LabReplayResult;
  trade: LabTrade;
  definition: StrategyDraftDefinition | null | undefined;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 break-words font-mono text-[12px] text-slate-200">{children}</div>
    </div>
  );
}

export const LabTradeInspector: React.FC<LabTradeInspectorProps> = ({
  result,
  trade,
  definition,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  // Выбор сделки из таблицы ниже по странице: карточка прокручивается в поле
  // зрения (nearest — без резких прыжков). jsdom/старые браузеры — безопасно.
  const tradeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (tradeIdRef.current === trade.id) return;
    tradeIdRef.current = trade.id;
    try {
      ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } catch {
      /* scrollIntoView недоступен — карточка остаётся на месте */
    }
  }, [trade.id]);

  const marketLabel = result.meta.market === 'futures' ? 'Фьючерсы' : 'Спот';
  const diagnostics = getLabSignalDiagnostics(result, trade, definition);

  return (
    <div
      ref={ref}
      data-qa="lab-trade-inspector"
      className="mt-2 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] p-2.5 sm:p-3"
    >
      {/* Заголовок: сторона · монета · рынок · таймфрейм + закрытие */}
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={`text-[13px] font-bold ${
                trade.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {sideLabel(trade.side)}
            </span>
            <span className="truncate text-[13px] font-semibold text-white">
              {result.meta.symbol}
            </span>
            <span className="text-[11px] text-slate-400">{marketLabel}</span>
            <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
              {result.meta.timeframe}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
            id: {trade.id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть карточку сделки"
          data-qa="lab-trade-inspector-close"
          className="shrink-0 rounded border border-white/10 bg-white/[0.04] p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Факты сделки: сигнал / вход / стоп / цель / выход */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        <Row label="Сигнал">{formatTime(trade.signalTime)}</Row>
        <Row label="Вход">
          <div>{formatTime(trade.entryTime)}</div>
          <div className="text-cyan-300">{formatPrice(trade.entryPrice)}</div>
        </Row>
        <Row label="Стоп (SL)">
          <div className="text-rose-300">{formatPrice(trade.stop)}</div>
        </Row>
        <Row label="Цель (TP)">
          <div className="text-emerald-300">{formatPrice(trade.target)}</div>
        </Row>
        <Row label="Выход">
          <div>{formatTime(trade.exitTime)}</div>
          <div>{formatPrice(trade.exitPrice)}</div>
          <div className="text-[11px] text-slate-400">{reasonLabel(trade.exitReason)}</div>
        </Row>
      </div>

      {/* Результат */}
      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-white/[0.06] pt-2">
        <Row label="Gross R">
          <span className={trade.grossR > 0 ? 'text-emerald-400' : trade.grossR < 0 ? 'text-rose-400' : ''}>
            {formatR(trade.grossR)}
          </span>
        </Row>
        <Row label="Net R">
          <span className={trade.netR > 0 ? 'text-emerald-400' : trade.netR < 0 ? 'text-rose-400' : ''}>
            {formatR(trade.netR)}
          </span>
        </Row>
        <Row label="Баров в сделке">{trade.barsHeld}</Row>
      </div>

      {/* Условия стратегии на сигнальном баре (готовые series движка) */}
      {(diagnostics.ruleRows.length > 0 || diagnostics.stopRow) && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">
            Условия на сигнальном баре
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-300">
            {diagnostics.ruleRows.map((row) => (
              <span key={row.label} data-qa="lab-inspector-indicator">
                {row.label}: {row.value === null ? '—' : formatPrice(row.value)}
              </span>
            ))}
            {diagnostics.stopRow && (
              <span data-qa="lab-inspector-indicator">
                {diagnostics.stopRow.label}:{' '}
                {diagnostics.stopRow.value === null ? '—' : formatPrice(diagnostics.stopRow.value)}
              </span>
            )}
            {diagnostics.crossText && (
              <span className="text-cyan-300" data-qa="lab-inspector-cross">
                {diagnostics.crossText} ✓
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
