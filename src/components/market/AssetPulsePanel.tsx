import React from 'react';
import { Link } from 'react-router-dom';
import { Flame, Layers, Gauge, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { AssetPulse, AssetLiquidationSource } from '@/services/liquidations/LiquidationPulse';
import { formatCurrency, formatPercent, formatTimestamp } from '@/utils/formatters';
import { Badge } from '@/components/common/Badge';

interface AssetPulsePanelProps {
  pulse: AssetPulse;
}

const SOURCE_BADGE: Record<AssetLiquidationSource, { label: string; variant: 'green' | 'amber' | 'cyan' | 'neutral' }> = {
  FACTUAL: { label: 'FACTUAL · BINANCE', variant: 'green' },
  DEMO: { label: 'DEMO DATASET', variant: 'amber' },
  ESTIMATED: { label: 'ESTIMATED · MODEL', variant: 'cyan' },
  UNAVAILABLE: { label: 'НЕТ ДАННЫХ', variant: 'neutral' },
};

/**
 * AssetPulsePanel — компактный Derivatives / Liquidation Pulse по текущему активу.
 *
 * Это СНИМОК (snapshot), а не дубль нижних детальных секций: здесь только то, что
 * даёт мгновенную картину по инструменту — ликвидации за 24ч с долями, значимые
 * события, открытый интерес, фандинг, базис и производный индикатор перекоса.
 * Каждый блок несёт явную маркировку происхождения данных (FACTUAL / DEMO / ESTIMATED).
 */
export const AssetPulsePanel: React.FC<AssetPulsePanelProps> = ({ pulse }) => {
  const { liquidation, derivatives, imbalance } = pulse;
  const source = SOURCE_BADGE[liquidation.source];
  const isDemoInputs = derivatives?.isDemo ?? false;

  return (
    <aside className="flex flex-col gap-2.5" aria-label="Derivatives and liquidation pulse">
      {/* Ликвидации по активу */}
      <section className="rounded-lg border border-surface-border bg-surface p-3 space-y-2">
        <header className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Flame className="w-4 h-4 text-rose-400" />
            <span className="text-[13px] font-bold uppercase tracking-wider text-white font-mono">
              Liquidation Pulse
            </span>
          </div>
          <Badge variant={source.variant}>{source.label}</Badge>
        </header>

        {liquidation.totalUsd > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="rounded border border-emerald-500/25 bg-emerald-950/20 px-2 py-1.5">
                <div className="text-[11px] text-emerald-300/90 uppercase tracking-wide">Long 24h</div>
                <div className="text-base font-bold text-emerald-300 tabular-nums">
                  {formatCurrency(liquidation.longUsd, { compact: true })}
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  {liquidation.longSharePct}% объема
                </div>
              </div>
              <div className="rounded border border-rose-500/25 bg-rose-950/20 px-2 py-1.5">
                <div className="text-[11px] text-rose-300/90 uppercase tracking-wide">Short 24h</div>
                <div className="text-base font-bold text-rose-300 tabular-nums">
                  {formatCurrency(liquidation.shortUsd, { compact: true })}
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  {liquidation.shortSharePct}% объема
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-slate-400">
                <span className="text-emerald-300">Longs {liquidation.longSharePct}%</span>
                <span className="text-rose-300">Shorts {liquidation.shortSharePct}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden flex bg-[#111a30]">
                <div className="bg-emerald-500 h-full" style={{ width: `${liquidation.longSharePct}%` }} />
                <div className="bg-rose-500 h-full" style={{ width: `${liquidation.shortSharePct}%` }} />
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Всего за 24ч: {formatCurrency(liquidation.totalUsd, { compact: true })}
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-400 font-sans leading-relaxed">{liquidation.note}</p>
        )}

        {liquidation.totalUsd > 0 && liquidation.note && (
          <p className="text-[11px] text-slate-500 font-sans leading-relaxed flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>{liquidation.note}</span>
          </p>
        )}

        {liquidation.topEvents.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">
              Значимые события
            </div>
            {liquidation.topEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between rounded bg-surface-elevated/60 border border-white/[0.05] px-2 py-1 font-mono"
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <Badge variant={event.side === 'LONG' ? 'green' : 'red'}>{event.side}</Badge>
                  <span className="text-[11px] text-slate-400 truncate">
                    {formatTimestamp(event.timestamp)} · {event.exchange}
                  </span>
                </div>
                <span className="text-xs font-bold text-white tabular-nums flex-shrink-0">
                  {formatCurrency(event.amountUsd, { compact: true })}
                </span>
              </div>
            ))}
          </div>
        )}

        <Link
          to="/liquidations"
          className="inline-flex items-center space-x-1 text-[11px] font-mono text-brand-cyan hover:underline"
        >
          <span>Карта и поток ликвидаций</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </section>

      {/* Деривативы по активу */}
      <section className="rounded-lg border border-surface-border bg-surface p-3 space-y-2">
        <header className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-brand-purple" />
            <span className="text-[13px] font-bold uppercase tracking-wider text-white font-mono">
              Деривативы
            </span>
          </div>
          <Badge variant={isDemoInputs ? 'amber' : 'green'}>
            {isDemoInputs ? 'DEMO' : 'LIVE · BINANCE FUTURES'}
          </Badge>
        </header>

        {derivatives ? (
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Открытый интерес (OI)</span>
              <span className="font-bold text-white tabular-nums">
                {formatCurrency(derivatives.openInterestUsd, { compact: true })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">OI Δ за 24ч</span>
              <span
                className={`font-bold tabular-nums ${
                  derivatives.openInterestChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {formatPercent(derivatives.openInterestChange24h)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Фандинг (8ч)</span>
              <span
                className={`font-bold tabular-nums ${
                  derivatives.fundingRate8h >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {derivatives.fundingRate8h >= 0 ? '+' : ''}
                {derivatives.fundingRate8h.toFixed(4)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Базис (basis)</span>
              <span className="font-bold text-slate-200 tabular-nums">
                {derivatives.basisPct >= 0 ? '+' : ''}
                {derivatives.basisPct.toFixed(3)}%
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            По этому активу нет бессрочного фьючерсного контракта в источнике данных.
          </p>
        )}

        <Link
          to="/futures"
          className="inline-flex items-center space-x-1 text-[11px] font-mono text-brand-cyan hover:underline"
        >
          <span>Все фьючерсы и фандинг</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </section>

      {/* Производный индикатор перекоса */}
      <section className="rounded-lg border border-surface-border bg-surface p-3 space-y-2">
        <header className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Gauge className="w-4 h-4 text-brand-sky" />
            <span className="text-[13px] font-bold uppercase tracking-wider text-white font-mono">
              Перекос потока
            </span>
          </div>
          <Badge variant="cyan">DERIVED</Badge>
        </header>

        {imbalance ? (
          <>
            <div className="flex items-baseline justify-between font-mono">
              <span className="text-sm font-bold text-white">{imbalance.label}</span>
              <span
                className={`text-lg font-black tabular-nums ${
                  imbalance.score > 0
                    ? 'text-emerald-400'
                    : imbalance.score < 0
                      ? 'text-rose-400'
                      : 'text-slate-300'
                }`}
              >
                {imbalance.score > 0 ? '+' : ''}
                {imbalance.score}
              </span>
            </div>

            {/* Двусторонняя шкала: −100 (лонги) … +100 (шорты) */}
            <div className="relative h-2 rounded-full bg-[#111a30] overflow-hidden">
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
              <div
                className={`absolute inset-y-0 ${imbalance.score >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{
                  left: imbalance.score >= 0 ? '50%' : `${50 + imbalance.score / 2}%`,
                  width: `${Math.abs(imbalance.score) / 2}%`,
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-slate-400">
              <span className="flex justify-between">
                <span>Ликвидации</span>
                <span className="text-slate-300 tabular-nums">{imbalance.components.liquidation}</span>
              </span>
              <span className="flex justify-between">
                <span>Фандинг</span>
                <span className="text-slate-300 tabular-nums">{imbalance.components.funding}</span>
              </span>
              <span className="flex justify-between">
                <span>OI</span>
                <span className="text-slate-300 tabular-nums">{imbalance.components.openInterest}</span>
              </span>
              <span className="flex justify-between">
                <span>Цена 24ч</span>
                <span className="text-slate-300 tabular-nums">{imbalance.components.price}</span>
              </span>
            </div>

            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Производный индикатор на фиксированных весах (ликвидации 40, фандинг 25, OI 15, цена 20).
              Не является торговым сигналом.
              {imbalance.basedOnDemo && ' В расчете есть демонстрационные или модельные входные метрики.'}
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-400 font-sans leading-relaxed">
            Индикатор не рассчитывается: недостаточно входных данных по активу.
          </p>
        )}
      </section>
    </aside>
  );
};
