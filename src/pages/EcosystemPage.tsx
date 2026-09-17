import React, { useMemo } from 'react';
import { EcosystemService, NetworkEcosystem } from '@/services/analytics/EcosystemService';
import { Layers, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { formatCurrency, formatPercent } from '@/utils/formatters';

export const EcosystemPage: React.FC = () => {
  const networks = useMemo(() => EcosystemService.getNetworks(), []);
  const overview = useMemo(() => EcosystemService.getOverview(), []);

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-brand-purple" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              ЭКОСИСТЕМЫ И СЕТИ L2
            </h1>
            <Badge variant="purple" size="sm">
              TVL И МЕТРИКИ
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Сравнительный срез заблокированной стоимости (TVL), комиссионных сборов, пропускной способности (TPS) и стейблкоинов.
          </p>
        </div>

        <div className="text-xs font-mono text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded border border-purple-500/30">
          L1 & L2 МАСШТАБИРОВАНИЕ
        </div>
      </div>

      {/* Non-Execution Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Анализ он-чейн экономики и фундаментальной ценности сетей</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Сравнение совокупного объема TVL и генерируемых протоколами комиссий позволяет оценивать реальный фундаментальный спрос на пространство блоков. Платформа <strong>не предоставляет услуг обмена токенов или мостов</strong> и работает исключительно как аналитический терминал.
        </p>
      </div>

      {/* Macro Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Совокупный TVL экосистем</div>
          <div className="text-2xl font-bold text-white mt-1">
            ${(overview.totalTvlUsd / 1e9).toFixed(2)}B
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">В залогах смарт-контрактов</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Доля сетей L2</div>
          <div className="text-2xl font-bold text-brand-cyan mt-1">
            {overview.l2SharePct}%
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            ${(overview.l2TvlUsd / 1e9).toFixed(2)}B в роллапах
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Суточный доход от комиссий</div>
          <div className="text-2xl font-bold text-brand-green mt-1">
            ${(overview.totalDailyFeesUsd / 1e6).toFixed(2)}M
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Суммарные комиссии сетей</div>
        </div>

        <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
          <div className="text-[11px] text-slate-400">Лидер по пропускной способности</div>
          <div className="text-2xl font-bold text-purple-400 mt-1">Solana</div>
          <div className="text-[11px] text-slate-500 mt-0.5">1,850 TPS в реальном времени</div>
        </div>
      </div>

      {/* Networks Table */}
      <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
        <div className="flex items-center justify-between pb-2 border-b border-surface-border">
          <span className="font-bold text-white tracking-wide">
            Рейтинг блокчейн-сетей по TVL и метрикам активности
          </span>
          <span className="text-[11px] text-slate-500">
            Данные агрегированы по DeFi-протоколам
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[11px] text-slate-500 border-b border-surface-border">
              <tr>
                <th className="py-2.5 px-2">Сеть / Блокчейн</th>
                <th className="py-2.5 px-2 text-center">Слой</th>
                <th className="py-2.5 px-2 text-right">TVL (USD)</th>
                <th className="py-2.5 px-2 text-right">7d Динамика</th>
                <th className="py-2.5 px-2 text-right">Комиссии за сутки</th>
                <th className="py-2.5 px-2 text-right">Скорость (TPS)</th>
                <th className="py-2.5 px-2 text-right">Активные адреса</th>
                <th className="py-2.5 px-2 text-right">Стейблкоины</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-[11px]">
              {networks.map((net: NetworkEcosystem) => (
                <tr key={net.id} className="hover:bg-surface-elevated/40">
                  <td className="py-2.5 px-2 font-bold text-white flex items-center space-x-2">
                    <span>{net.name}</span>
                    <span className="text-[11px] text-slate-500 font-mono">({net.chainSymbol})</span>
                  </td>

                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                        net.layer === 'L2'
                          ? 'bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/30'
                          : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                      }`}
                    >
                      {net.layer}
                    </span>
                  </td>

                  <td className="py-2.5 px-2 text-right font-bold text-white font-mono tabular-nums">
                    {formatCurrency(net.tvlUsd, { compact: true })}
                  </td>

                  <td
                    className={`py-2.5 px-2 text-right font-bold ${
                      net.tvlChange7d >= 0 ? 'text-brand-green' : 'text-rose-400'
                    }`}
                  >
                    {formatPercent(net.tvlChange7d)}
                  </td>

                  <td className="py-2.5 px-2 text-right text-slate-300 font-mono tabular-nums">
                    {formatCurrency(net.dailyFeesUsd, { compact: true })}
                  </td>

                  <td className="py-2.5 px-2 text-right font-bold text-amber-400">
                    {net.tps.toFixed(1)}
                  </td>

                  <td className="py-2.5 px-2 text-right text-slate-300">
                    {net.activeAddresses24h.toLocaleString()}
                  </td>

                  <td className="py-2.5 px-2 text-right text-slate-300 font-mono tabular-nums">
                    {formatCurrency(net.stablecoinSupplyUsd, { compact: true })}
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
