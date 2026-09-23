import React from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/utils/formatters';

interface AnalyticsSetupsPreviewProps {
  btcPrice: number | null;
  btcPriceSource: string | null;
  openInterestUsd: number | null;
  openInterestSource: string | null;
  openInterestDelta24h: number | null;
  openInterestDeltaSource: string | null;
  fundingRate8h: number | null;
  fundingSource: string | null;
  rsi14: number | null;
  rsiSource: string | null;
  isDemoMode: boolean;
}

const Fact: React.FC<{ label: string; value: string; source: string }> = ({ label, value, source }) => (
  <div className="min-w-0 rounded-lg border border-white/[0.06] bg-surface-elevated/55 p-2.5">
    <div className="text-[11px] font-medium text-slate-500">{label}</div>
    <div className="mt-1 truncate font-mono text-xs font-semibold tabular-nums text-slate-100" data-testid="analytics-fact-value">{value}</div>
    <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{source}</div>
  </div>
);

const valueOrDash = (value: number | null, format: (number: number) => string) =>
  value != null && Number.isFinite(value) ? format(value) : '—';

export const AnalyticsSetupsPreview: React.FC<AnalyticsSetupsPreviewProps> = ({
  btcPrice,
  btcPriceSource,
  openInterestUsd,
  openInterestSource,
  openInterestDelta24h,
  openInterestDeltaSource,
  fundingRate8h,
  fundingSource,
  rsi14,
  rsiSource,
  isDemoMode,
}) => (
  <section className="bg-surface border border-white/[0.08] rounded-xl p-3.5 sm:p-4 flex flex-col shadow-panel" data-qa="analytics-setups-preview" data-testid="analytics-setups-preview">
    <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-white/[0.06]">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-amber-400" />
        <h2 className="font-bold text-sm text-white font-sans tracking-wide">Аналитические сетапы (превью)</h2>
      </div>
      <span className="shrink-0 rounded border border-amber-400/25 bg-amber-400/[0.08] px-2 py-1 text-[11px] font-semibold text-amber-300">
        {isDemoMode ? 'QA · НЕ СИГНАЛ' : 'НЕТ SETUP · НЕ СИГНАЛ'}
      </span>
    </div>

    <p className="mb-3 rounded-lg border border-white/[0.06] bg-surface-inset/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
      Это текущие входные рыночные факты, а не торговая рекомендация. Ценовой диапазон входа и уровень инвалидации не рассчитываются: setup-алгоритм к этому превью не подключён.
      {isDemoMode && <strong className="ml-1 text-amber-300">QA-данные, не live.</strong>}
    </p>

    <div className="grid grid-cols-2 gap-2" data-qa="analytics-live-facts">
      <Fact
        label="BTC spot price"
        value={valueOrDash(btcPrice, (value) => formatCurrency(value))}
        source={btcPriceSource ?? 'Источник недоступен'}
      />
      <Fact
        label="OI · USD / Δ24h"
        value={`${valueOrDash(openInterestUsd, (value) => formatCurrency(value, { compact: true }))} / ${valueOrDash(openInterestDelta24h, (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`)}`}
        source={`${openInterestSource ?? 'OI недоступен'}; Δ24h: ${openInterestDeltaSource ?? 'история OI недоступна'}`}
      />
      <Fact
        label="Funding · 8h"
        value={valueOrDash(fundingRate8h, (value) => `${value > 0 ? '+' : ''}${value.toFixed(4)}%`)}
        source={fundingSource ?? 'Funding недоступен'}
      />
      <Fact
        label="RSI-14 · candles"
        value={valueOrDash(rsi14, (value) => value.toFixed(2))}
        source={rsiSource ?? 'Недостаточно свечей / источник недоступен'}
      />
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
      <div className="rounded-lg border border-white/[0.06] px-2.5 py-2 text-slate-500">
        <span className="block text-slate-400">Entry range</span>
        Не рассчитан — нет подключённого алгоритма
      </div>
      <div className="rounded-lg border border-white/[0.06] px-2.5 py-2 text-slate-500">
        <span className="block text-slate-400">Invalidation</span>
        Не рассчитан — нет подключённого алгоритма
      </div>
    </div>

    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
      Подтверждения и опровержения не оцениваются без сформированного setup. RSI вычисляется по Wilder RSI-14; значения не заменяются нулями или демонстрационными числами.
    </p>
    <Link
      to="/signals"
      className="mt-auto flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-surface-elevated px-3 py-2 text-xs font-semibold text-cyan-400 transition-colors hover:border-cyan-500/30 hover:bg-surface-hover hover:text-white"
    >
      Алгоритмические сетапы и методология <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  </section>
);
