import React, { useEffect, useState } from 'react';
import { useMarketData } from '@/context/MarketDataContext';
import { LiquidationData } from '@/types/market';
import { formatCurrency, formatTimestamp } from '@/utils/formatters';
import { Flame, ShieldAlert, Clock } from 'lucide-react';

export const LiquidationsPage: React.FC = () => {
  const { provider } = useMarketData();
  const [data, setData] = useState<LiquidationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    provider.getLiquidations().then((res) => {
      setData(res);
      setLoading(false);
    });
  }, [provider]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-mono text-sm">
        <Flame className="w-5 h-5 animate-spin mr-2 text-rose-500" />
        Загрузка аналитики ликвидаций...
      </div>
    );
  }

  const longPct = ((data.totalLong24h / data.total24h) * 100).toFixed(1);
  const shortPct = ((data.totalShort24h / data.total24h) * 100).toFixed(1);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3 font-mono">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-wide">
              КАРТА И ПОТОК ЛИКВИДАЦИЙ (LIQUIDATIONS)
            </h1>
            <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              ДЕМОНСТРАЦИОННЫЙ СРЕЗ
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Демонстрационный мониторинг принудительно закрытых маржинальных позиций по биржам.
          </p>
        </div>

        <div className="text-xs text-slate-400 font-sans">
          Всего ликвидировано за 24ч:{' '}
          <strong className="text-white font-mono">{formatCurrency(data.total24h, { compact: true })}</strong>
        </div>
      </div>

      {/* CRITICAL METHODOLOGY DISCLAIMER */}
      <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs font-sans text-slate-300 space-y-1.5">
        <div className="flex items-center space-x-2 text-amber-400 font-mono font-bold">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          <span>КРИТИЧЕСКИЙ ПРИНЦИП: ACTUAL LIQUIDATION EVENT ≠ ESTIMATED LIQUIDATION LEVEL</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-300">
          <strong>Фактическое событие ликвидации (Actual Event):</strong> Публичный биржевой ордер принудительного закрытия позиции при наступлении маржин-колла. Это подтвержденный свершившийся факт.<br />
          <strong>Расчетный ликвидационный уровень (Estimated / Model Level):</strong> Математическая гипотетическая модель, построенная на оценке открытого интереса и стандартных плеч (10x, 25x, 50x, 100x). Трейдеры могут довносить обеспечение, закрывать сделки лимитными ордерами или хеджироваться на других площадках. CRYPTORA не обладает и не заявляет доступ к скрытым персональным ликвидационным уровням пользователей бирж. Любая тепловая карта уровней обязана маркироваться как <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300 font-mono">ESTIMATED / MODEL</code>.
        </p>
      </div>

      {/* Aggregate Long/Short Ratio Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface border border-surface-border rounded-lg p-4">
          <div className="text-xs text-slate-400">Ликвидировано Long (24h)</div>
          <div className="text-xl font-black text-brand-green mt-1">
            {formatCurrency(data.totalLong24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{longPct}% от общего объема</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4">
          <div className="text-xs text-slate-400">Ликвидировано Short (24h)</div>
          <div className="text-xl font-black text-brand-red mt-1">
            {formatCurrency(data.totalShort24h, { compact: true })}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{shortPct}% от общего объема (Шорт-сквиз)</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4">
          <div className="text-xs text-slate-400">Крупнейшее единичное событие</div>
          <div className="text-xl font-black text-white mt-1">
            {formatCurrency(data.largestEvent.amountUsd, { compact: true })}
          </div>
          <div className="text-[11px] text-rose-400 mt-0.5">
            {data.largestEvent.symbol} ({data.largestEvent.side}) на {data.largestEvent.exchange}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-surface border border-surface-border rounded-lg p-3">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-brand-green font-bold">Longs: {longPct}%</span>
          <span className="text-brand-red font-bold">Shorts: {shortPct}%</span>
        </div>
        <div className="w-full h-3 rounded-full overflow-hidden flex bg-slate-800">
          <div className="bg-brand-green h-full" style={{ width: `${longPct}%` }} />
          <div className="bg-brand-red h-full" style={{ width: `${shortPct}%` }} />
        </div>
      </div>

      {/* Timeline & Breakdowns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Timeline Visualization (8 cols) */}
        <div className="lg:col-span-8 bg-surface border border-surface-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-brand-cyan" />
              <span>Хронология ликвидаций по 3-часовым барам (24H Timeline)</span>
            </span>
            <span className="text-[10px] text-slate-500">UTC Bars</span>
          </div>

          {/* Bar Chart Simulation */}
          <div className="h-56 flex items-end justify-between pt-6 px-2 gap-2">
            {data.timeline.map((bar, idx) => {
              const maxBar = 35000000;
              const longHeight = (bar.longUsd / maxBar) * 160;
              const shortHeight = (bar.shortUsd / maxBar) * 160;

              return (
                <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <div className="w-full flex items-end justify-center space-x-1 mb-1">
                    {/* Long bar */}
                    <div
                      style={{ height: `${Math.max(4, longHeight)}px` }}
                      className="w-1/2 bg-brand-green/80 rounded-t group-hover:bg-brand-green transition-colors"
                      title={`Longs: ${formatCurrency(bar.longUsd, { compact: true })}`}
                    />
                    {/* Short bar */}
                    <div
                      style={{ height: `${Math.max(4, shortHeight)}px` }}
                      className="w-1/2 bg-brand-red/80 rounded-t group-hover:bg-brand-red transition-colors"
                      title={`Shorts: ${formatCurrency(bar.shortUsd, { compact: true })}`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 group-hover:text-white">
                    {bar.timestamp}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center space-x-6 text-[11px] pt-2 border-t border-surface-border text-slate-400">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-brand-green rounded"></span>
              <span>Long Liquidations</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 bg-brand-red rounded"></span>
              <span>Short Liquidations</span>
            </div>
          </div>
        </div>

        {/* Exchange & Asset Breakdowns (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Exchange Breakdown */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-2 border-b border-surface-border">
              Распределение по биржам
            </div>
            <div className="space-y-2 text-xs">
              {data.exchangeBreakdown.map((ex) => (
                <div key={ex.exchange} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-white font-semibold">{ex.exchange}</span>
                    <span className="text-slate-300">
                      {formatCurrency(ex.totalUsd, { compact: true })} ({ex.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="bg-brand-cyan h-full rounded-full"
                      style={{ width: `${ex.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Asset Liquidation Totals */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-2 border-b border-surface-border">
              Топ активов по ликвидациям
            </div>
            <div className="space-y-1.5 text-xs">
              {data.assetBreakdown.slice(0, 5).map((ab) => (
                <div
                  key={ab.symbol}
                  className="flex items-center justify-between p-1.5 rounded bg-surface-elevated/40"
                >
                  <span className="font-bold text-white">{ab.symbol}</span>
                  <div className="text-right">
                    <span className="font-bold text-slate-200">
                      {formatCurrency(ab.totalUsd, { compact: true })}
                    </span>
                    <span className="text-[10px] text-rose-400 block">
                      Shorts: {formatCurrency(ab.shortUsd, { compact: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Actual Events Feed Table */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Flame className="w-4 h-4 text-rose-500" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Демонстрационный журнал событий ликвидаций (Demo Event Log)
            </span>
          </div>
          <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
            DEMO DATASET
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-slate-400 text-[11px] border-b border-surface-border">
              <tr>
                <th className="py-2">Время</th>
                <th className="py-2">Инструмент</th>
                <th className="py-2">Сторона</th>
                <th className="py-2 text-right">Объем (USD)</th>
                <th className="py-2 text-right">Цена исполнения</th>
                <th className="py-2 text-right">Биржа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {data.recentEvents.map((event) => (
                <tr key={event.id} className="hover:bg-surface-hover">
                  <td className="py-2 text-slate-400">{formatTimestamp(event.timestamp)}</td>
                  <td className="py-2 font-bold text-white">{event.symbol}</td>
                  <td className="py-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        event.side === 'LONG'
                          ? 'bg-emerald-950 text-brand-green border border-emerald-500/30'
                          : 'bg-rose-950 text-brand-red border border-rose-500/30'
                      }`}
                    >
                      {event.side}
                    </span>
                  </td>
                  <td className="py-2 text-right font-bold text-white">
                    {formatCurrency(event.amountUsd, { compact: true })}
                  </td>
                  <td className="py-2 text-right text-slate-300">
                    {formatCurrency(event.price)}
                  </td>
                  <td className="py-2 text-right text-brand-cyan">{event.exchange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
