import React, { useMemo } from 'react';
import { OnChainService } from '@/services/analytics/OnChainService';
import { Network, ArrowDownRight, ArrowUpRight, ShieldCheck, Database } from 'lucide-react';
import { Badge } from '@/components/common/Badge';

export const OnChainPage: React.FC = () => {
  const metrics = useMemo(() => OnChainService.getMacroMetrics(), []);
  const flows = useMemo(() => OnChainService.getExchangeFlows(), []);

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Network className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Он-чейн и макро-метрики
            </h1>
            <Badge variant="green" size="sm">
              Фундаментальная оценка
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Фундаментальные он-чейн индикаторы блокчейна: MVRV Z-Score, NUPL, биржевые нетфлоу, хешрейт и стейкинг.
          </p>
        </div>

        <div className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/30">
          Сетевой слой (макро L1)
        </div>
      </div>

      {/* Analytical Invariant Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Он-чейн аналитика vs Краткосрочный шум</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Он-чейн метрики позволяют оценивать макро-циклы движения капитала институциональных держателей и майнеров независимо от сиюминутных колебаний биржевых стаканов. CRYPTORA предоставляет объективные аналитические данные без торгового исполнения.
        </p>
      </div>

      {/* Macro Valuation Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div
            key={m.id}
            className="bg-surface border border-surface-border rounded-lg p-5 font-sans text-xs space-y-3 shadow-md hover:border-slate-700 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-surface-border">
                <span className="font-bold text-white tracking-wide">{m.name}</span>
                <Badge variant={m.symbol === 'BTC' ? 'amber' : 'purple'} size="xs">
                  {m.symbol}
                </Badge>
              </div>

              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-2xl font-black text-white">{m.value}</span>
                <span
                  className={`text-xs font-bold flex items-center ${
                    m.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {m.change24h >= 0 ? (
                    <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                  )}
                  {m.change24h >= 0 ? '+' : ''}{m.change24h}% (24h)
                </span>
              </div>

              <p className="text-[11px] text-slate-400 font-sans mt-2 leading-relaxed">
                {m.interpretation}
              </p>
            </div>

            <div className="pt-2 border-t border-surface-border/50 flex items-center justify-between text-[11px] text-slate-500">
              <span>Сигнал модели:</span>
              <span
                className={`font-bold font-mono px-2 py-0.5 rounded ${
                  m.signal === 'BULLISH'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {m.signal}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Exchange Netflows Table */}
      <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-brand-cyan" />
            <span className="font-bold text-white tracking-wide">
              Суточные потоки биткоинов на биржах
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Отрицательный нетфлоу = отток на холодное хранение (аккумуляция)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[11px] text-slate-500 border-b border-surface-border">
              <tr>
                <th className="py-2 px-2">Биржа</th>
                <th className="py-2 px-2 text-right">Приток (BTC)</th>
                <th className="py-2 px-2 text-right">Отток (BTC)</th>
                <th className="py-2 px-2 text-right">Чистый нетфлоу (BTC)</th>
                <th className="py-2 px-2 text-right">Эквивалент ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-[11px]">
              {flows.map((f) => (
                <tr key={f.exchange} className="hover:bg-surface-elevated/40">
                  <td className="py-2.5 px-2 font-bold text-white">{f.exchange}</td>
                  <td className="py-2.5 px-2 text-right text-slate-300">
                    +{f.inflowBtc.toLocaleString()} BTC
                  </td>
                  <td className="py-2.5 px-2 text-right text-slate-300">
                    -{f.outflowBtc.toLocaleString()} BTC
                  </td>
                  <td
                    className={`py-2.5 px-2 text-right font-black ${
                      f.netflowBtc <= 0 ? 'text-brand-green' : 'text-rose-400'
                    }`}
                  >
                    {f.netflowBtc > 0 ? '+' : ''}{f.netflowBtc.toLocaleString()} BTC
                  </td>
                  <td
                    className={`py-2.5 px-2 text-right font-bold ${
                      f.netflowUsd <= 0 ? 'text-brand-green' : 'text-rose-400'
                    }`}
                  >
                    {f.netflowUsd > 0 ? '+' : ''}${Math.abs(f.netflowUsd).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
