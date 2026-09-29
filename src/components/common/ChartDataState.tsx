import React from 'react';
import { AlertTriangle, Ban, Loader2, RotateCcw } from 'lucide-react';

/**
 * Explicit chart data states (task §6).
 *
 * A chart must never render an empty/broken canvas that looks like a loaded
 * chart, and a missing series must never be masked with synthetic candles.
 * Every state below is a first-class, testable UI state.
 */
export type ChartDataStatus =
  | 'loading'
  | 'ready'
  | 'no-data'
  | 'unsupported'
  | 'unavailable';

export interface ChartDataStateProps {
  status: ChartDataStatus;
  /** Display symbol, used in the copy. */
  symbol?: string;
  market?: 'spot' | 'futures';
  onRetry?: () => void;
  qa?: string;
  className?: string;
}

const MARKET_LABEL: Record<'spot' | 'futures', string> = {
  spot: 'Binance Spot',
  futures: 'Binance USD-M Futures',
};

export const ChartDataState: React.FC<ChartDataStateProps> = ({
  status,
  symbol,
  market = 'spot',
  onRetry,
  qa = 'chart-data-state',
  className = '',
}) => {
  if (status === 'ready') return null;

  const source = MARKET_LABEL[market];
  const pair = symbol ? `${symbol} ` : '';

  if (status === 'loading') {
    return (
      <div
        role="status"
        data-qa={qa}
        data-chart-state="loading"
        className={`flex items-center gap-2 rounded-md border border-white/[0.08] bg-surface-elevated/60 px-3 py-2 font-sans text-xs text-slate-300 ${className}`}
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-cyan" aria-hidden />
        Загрузка свечей {pair}({source})…
      </div>
    );
  }

  const config = status === 'unsupported'
    ? {
        icon: Ban,
        tone: 'border-slate-500/25 bg-slate-500/[0.06] text-slate-300',
        iconTone: 'text-slate-400',
        title: 'Пара не поддерживается',
        body: `${pair}отсутствует в активной вселенной ${source}. График не строится — данные другого рынка не подставляются.`,
        retry: false,
      }
    : status === 'no-data'
      ? {
          icon: AlertTriangle,
          tone: 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200',
          iconTone: 'text-amber-300',
          title: 'Нет данных для графика',
          body: `${source} не вернул ни одной свечи по ${pair || 'инструменту'}. Синтетические свечи не рисуются.`,
          retry: true,
        }
      : {
          icon: AlertTriangle,
          tone: 'border-rose-500/25 bg-rose-500/[0.06] text-rose-200',
          iconTone: 'text-rose-300',
          title: 'Источник временно недоступен',
          body: `${source} не ответил на запрос свечей ${pair}. Это не ошибка инструмента — повторите попытку.`,
          retry: true,
        };

  const Icon = config.icon;

  return (
    <div
      role="alert"
      data-qa={qa}
      data-chart-state={status}
      className={`flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 font-sans text-xs ${config.tone} ${className}`}
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${config.iconTone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{config.title}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{config.body}</div>
      </div>
      {config.retry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-qa={`${qa}-retry`}
          className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.14] bg-white/[0.06] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Повторить
        </button>
      )}
    </div>
  );
};
