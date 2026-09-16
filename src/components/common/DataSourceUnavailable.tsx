import React from 'react';
import { RadioTower, RefreshCw } from 'lucide-react';

interface DataSourceUnavailableProps {
  /** Что именно не получено от источника — подставляется в честный текст. */
  subject: string;
  /** Дополнительное пояснение (например, причина от провайдера). */
  detail?: string;
  compact?: boolean;
}

/**
 * DataSourceUnavailable — честное состояние «источник недоступен».
 *
 * LIVE-FIRST: когда фактический источник не отдал данные, терминал прямо сообщает
 * об этом и не подставляет значения из другого датасета. Переключателя режима в
 * интерфейсе нет: терминал всегда работает с фактическим источником.
 */
export const DataSourceUnavailable: React.FC<DataSourceUnavailableProps> = ({
  subject,
  detail,
  compact = false,
}) => {
  return (
    <div
      data-qa="source-unavailable"
      role="status"
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] ${
        compact ? 'px-3 py-2.5' : 'px-3.5 py-3.5'
      }`}
    >
      <div className="flex items-start space-x-2.5 min-w-0">
        <RadioTower className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-amber-200 font-sans">
            Фактический источник недоступен: {subject}
          </p>
          <p className="text-xs text-amber-200/70 font-sans mt-0.5">
            {detail ?? 'Данные не пришли от источника. Значения вместо фактических не подставляются.'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.location.reload()}
        aria-label={`Повторить запрос: ${subject}`}
        className="flex items-center space-x-1.5 self-start sm:self-auto px-2.5 py-1.5 rounded-md border border-white/[0.12] bg-surface-elevated text-[11px] font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors flex-shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Повторить запрос</span>
      </button>
    </div>
  );
};
