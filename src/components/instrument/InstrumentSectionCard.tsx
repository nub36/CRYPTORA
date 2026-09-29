import React from 'react';
import { Activity } from 'lucide-react';
import type { MarketType } from '@/types/market';

/**
 * ОБЩАЯ карточка секции инструмента для Spot и Futures (задача §2, §15, §17).
 *
 * Одна реализация состояний — `loading` / `ready` / `no-data` / `error` /
 * `unsupported` — на обе страницы. Раньше Spot-страница рисовала свои
 * «—»-заглушки, а Futures-страница вообще не имела блочных состояний, поэтому
 * одна недоступная вторичная метрика ломала представление целого раздела.
 *
 * Правила, которые здесь зашиты один раз:
 *  • отсутствующая метрика = «Нет данных», НИКОГДА не 0 и никогда не значение
 *    другого рынка;
 *  • у каждого состояния есть `data-qa`/`data-state`, поэтому тесты и
 *    mobile-аудит адресуют секции стабильно;
 *  • заголовок и отступы одинаковы на всех рынках, так что блок «Рыночная
 *    статистика» стоит на /futures/:symbol там же и выглядит так же, как на
 *    /coin/:symbol.
 */

export type InstrumentSectionStatus = 'loading' | 'ready' | 'no-data' | 'error' | 'unsupported';

export interface InstrumentSectionCardProps {
  title: string;
  /** Иконка заголовка (lucide). */
  icon?: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  status: InstrumentSectionStatus;
  market: MarketType;
  /** Стабильный хук для тестов и QA: `futures-market-statistics` и т.п. */
  qa: string;
  /** Подпись источника под заголовком: «Binance USD-M · 1ч». */
  sourceNote?: string;
  /** Текст состояния «нет данных» — конкретный для секции. */
  emptyMessage?: string;
  /** Текст состояния «инструмент не поддерживается рынком». */
  unsupportedMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const MARKET_LABEL: Record<MarketType, string> = {
  spot: 'Binance Spot',
  futures: 'Binance USD-M Futures',
};

export const InstrumentSectionCard: React.FC<InstrumentSectionCardProps> = ({
  title,
  icon: Icon = Activity,
  iconClassName = 'text-brand-cyan',
  status,
  market,
  qa,
  sourceNote,
  emptyMessage,
  unsupportedMessage,
  errorMessage,
  onRetry,
  headerRight,
  footer,
  className = '',
  children,
}) => (
  <section
    data-qa={qa}
    data-state={status}
    data-market={market}
    className={`space-y-2.5 rounded-lg border border-surface-border bg-surface p-3.5 font-sans ${className}`}
  >
    <header className="flex items-center justify-between gap-2 border-b border-surface-border pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} />
        <span className="truncate text-[13px] font-bold tracking-wide text-white">{title}</span>
      </div>
      {headerRight}
    </header>

    {sourceNote && (
      <p data-qa={`${qa}-source`} className="font-sans text-[11px] tracking-[0.08em] text-slate-500">
        {sourceNote}
      </p>
    )}

    {status === 'loading' && (
      <div role="status" data-qa={`${qa}-loading`} className="flex items-center gap-2 py-6 text-[13px] text-slate-400">
        <Activity className="h-3.5 w-3.5 animate-spin text-brand-cyan" aria-hidden />
        Загрузка данных {MARKET_LABEL[market]}…
      </div>
    )}

    {status === 'no-data' && (
      <p data-qa={`${qa}-empty`} className="py-6 text-center text-[13px] text-slate-500">
        {emptyMessage ?? 'Нет данных'}
      </p>
    )}

    {status === 'unsupported' && (
      <p data-qa={`${qa}-unsupported`} className="py-6 text-center text-[13px] text-slate-400">
        {unsupportedMessage ?? `Инструмент не торгуется на ${MARKET_LABEL[market]}.`}
      </p>
    )}

    {status === 'error' && (
      <div data-qa={`${qa}-error`} className="space-y-2 py-5 text-center">
        <p role="alert" className="text-[13px] text-rose-300">
          {errorMessage ?? `Источник ${MARKET_LABEL[market]} недоступен. Данные другого рынка не подставляются.`}
        </p>
        {onRetry && (
          <button
            type="button"
            data-qa={`${qa}-retry`}
            onClick={onRetry}
            className="min-h-[36px] rounded border border-surface-border px-3 font-sans text-xs text-white transition-colors hover:bg-white/[0.06]"
          >
            Повторить запрос
          </button>
        )}
      </div>
    )}

    {status === 'ready' && children}

    {status === 'ready' && footer}
  </section>
);

/** Значение недоступной метрики. Единый вид на обоих рынках. */
export const NoData: React.FC<{ title?: string }> = ({ title }) => (
  <span data-qa="metric-no-data" className="font-sans text-[11px] text-slate-500" title={title}>
    Нет данных
  </span>
);

export interface InstrumentMetricRowProps {
  label: string;
  value: React.ReactNode;
  /** Знак значения: подкрашивает зелёным/красным. */
  tone?: number | null;
  hint?: string;
  qa?: string;
  /** Правый суффикс: бейдж источника (OiDeltaBadge, «CoinGecko» и т.п.). */
  suffix?: React.ReactNode;
}

/**
 * Строка «метка → значение». Единственная реализация на обе страницы:
 * выравнивание, моноширинный столбец значений и tabular-nums описаны здесь,
 * поэтому Spot и Futures не могут разъехаться визуально.
 */
export const InstrumentMetricRow: React.FC<InstrumentMetricRowProps> = ({
  label,
  value,
  tone = null,
  hint,
  qa,
  suffix,
}) => (
  <div data-qa={qa} className="flex items-start justify-between gap-3 text-xs">
    <span className="text-slate-400" title={hint}>{label}</span>
    <span
      className={`text-right font-mono tabular-nums ${
        tone === null || tone === undefined
          ? 'font-semibold text-white'
          : tone >= 0
            ? 'font-bold text-brand-green'
            : 'font-bold text-brand-red'
      }`}
    >
      {value}
      {suffix}
    </span>
  </div>
);
