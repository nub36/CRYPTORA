import React, { useEffect, useState } from 'react';
import { EcosystemService, type EcosystemReport, type NetworkEcosystem } from '@/services/analytics/EcosystemService';
import { Layers, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { formatCurrency, formatPercent } from '@/utils/formatters';

/**
 * Экосистемы: TVL по сетям из DeFiLlama (публичный API). Показываются только метрики,
 * которые отдаёт источник; комиссий/TPS/адресов/стейблкоинов здесь нет — источника нет.
 */
export const EcosystemPage: React.FC = () => {
  const [report, setReport] = useState<EcosystemReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    EcosystemService.fetchReport()
      .then((r) => {
        if (!active) return;
        setReport(r);
        setUnavailable(r.networks.length === 0);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const overview = report?.overview;

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-brand-purple" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">Экосистемы и сети L2</h1>
            <Badge variant="purple" size="sm">
              TVL по сетям
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Заблокированная стоимость (TVL) в DeFi-протоколах по сетям L1 / L2 и её динамика за 7 дней.
          </p>
        </div>
        <div
          data-qa="ecosystem-source"
          data-state={report ? 'live' : unavailable ? 'unavailable' : 'loading'}
          className={`text-xs font-mono px-2.5 py-1 rounded border ${
            report ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-400 bg-white/[0.06] border-white/[0.12]'
          }`}
        >
          {report ? `LIVE · DEFILLAMA · ${new Date(report.fetchedAt).toLocaleTimeString('ru-RU')}` : loading ? 'Загрузка…' : 'ИСТОЧНИК НЕДОСТУПЕН'}
        </div>
      </div>

      {unavailable && !loading && <DataSourceUnavailable subject="TVL по сетям (DeFiLlama)" />}

      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Что здесь показано и чего нет</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          TVL — сумма стоимости активов в смарт-контрактах DeFi-протоколов сети по методологии DeFiLlama; это не капитализация сети и не
          «объём экономики». Комиссии, TPS, активные адреса и предложение стейблкоинов не показываются: у терминала нет их фактического
          источника. Платформа <strong>не предоставляет услуг обмена токенов или мостов</strong>.
        </p>
      </div>

      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
            <div className="text-[11px] text-slate-400">TVL отслеживаемых сетей</div>
            <div className="text-2xl font-bold text-white mt-1 font-mono tabular-nums">{formatCurrency(overview.totalTvlUsd, { compact: true })}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{report?.networks.length} сетей из каталога</div>
          </div>
          <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
            <div className="text-[11px] text-slate-400">Доля сетей L2</div>
            <div className="text-2xl font-bold text-brand-cyan mt-1 font-mono tabular-nums">{overview.l2SharePct}%</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{formatCurrency(overview.l2TvlUsd, { compact: true })} в роллапах</div>
          </div>
          <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
            <div className="text-[11px] text-slate-400">TVL всех сетей источника</div>
            <div className="text-2xl font-bold text-white mt-1 font-mono tabular-nums">{formatCurrency(overview.allChainsTvlUsd, { compact: true })}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">все цепочки DeFiLlama</div>
          </div>
          <div className="bg-surface border border-surface-border rounded-lg p-4 font-sans">
            <div className="text-[11px] text-slate-400">Покрытие каталога</div>
            <div className="text-2xl font-bold text-white mt-1 font-mono tabular-nums">
              {overview.allChainsTvlUsd > 0 ? ((overview.totalTvlUsd / overview.allChainsTvlUsd) * 100).toFixed(1) : '0.0'}%
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">доля отслеживаемых сетей в общем TVL</div>
          </div>
        </div>
      )}

      <div className="bg-surface border border-surface-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-surface-border">
          <span className="text-xs font-bold text-white font-sans">Рейтинг сетей по TVL</span>
          <span className="text-[11px] text-slate-500 font-sans">Δ7д — по дневному ряду TVL источника</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead className="text-[11px] text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="py-2.5 px-2">Сеть</th>
                <th className="py-2.5 px-2 text-center">Слой</th>
                <th className="py-2.5 px-2 text-right">TVL (USD)</th>
                <th className="py-2.5 px-2 text-right">Δ 7д</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border/50 text-[11px]">
              {report?.networks.map((net: NetworkEcosystem) => (
                <tr key={net.id} className="hover:bg-surface-elevated/40" data-qa="ecosystem-row">
                  <td className="py-2.5 px-2 font-bold text-white">
                    {net.name} <span className="text-[11px] text-slate-500 font-mono">({net.chainSymbol})</span>
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
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-white">{formatCurrency(net.tvlUsd, { compact: true })}</td>
                  <td
                    className={`py-2.5 px-2 text-right font-mono tabular-nums ${
                      net.tvlChange7d === null ? 'text-slate-500' : net.tvlChange7d >= 0 ? 'text-brand-green' : 'text-rose-400'
                    }`}
                  >
                    {net.tvlChange7d === null ? '—' : formatPercent(net.tvlChange7d)}
                  </td>
                </tr>
              ))}
              {!loading && (!report || report.networks.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    Данные источника не получены.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
