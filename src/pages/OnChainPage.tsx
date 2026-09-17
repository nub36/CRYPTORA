import React, { useEffect, useState } from 'react';
import { OnChainService, type OnChainReport } from '@/services/analytics/OnChainService';
import { Network, ArrowDownRight, ArrowUpRight, ShieldCheck, Database } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';

/**
 * Он-чейн Bitcoin: фактические метрики сети из mempool.space (публичный API).
 * Никаких «сигналов модели», MVRV/NUPL и «биржевых потоков» — источника для них нет.
 */
export const OnChainPage: React.FC = () => {
  const [report, setReport] = useState<OnChainReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    OnChainService.fetchReport()
      .then((r) => {
        if (active) setReport(r);
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

  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Network className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">Он-чейн: сеть Bitcoin</h1>
            <Badge variant="amber" size="sm">
              BTC
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Хешрейт, сложность и ретаргет, высота блокчейна, мемпул и рекомендованные комиссии — из фактического узла.
          </p>
        </div>
        <div
          data-qa="onchain-source"
          data-state={report ? 'live' : unavailable ? 'unavailable' : 'loading'}
          className={`text-xs font-mono px-2.5 py-1 rounded border ${
            report ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-400 bg-white/[0.06] border-white/[0.12]'
          }`}
        >
          {report ? `LIVE · MEMPOOL.SPACE · ${new Date(report.fetchedAt).toLocaleTimeString('ru-RU')}` : loading ? 'Загрузка…' : 'ИСТОЧНИК НЕДОСТУПЕН'}
        </div>
      </div>

      {unavailable && !loading && <DataSourceUnavailable subject="метрики сети Bitcoin (mempool.space)" />}

      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Что здесь показано и чего нет</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Показаны только величины, которые отдаёт публичный узел mempool.space. Оценочные индикаторы (MVRV, NUPL, SOPR), стейкинг ETH и
          «биржевые притоки/оттоки» не показываются — у терминала нет их фактического источника, а модельные «сигналы» не публикуются.
          CRYPTORA не исполняет сделки.
        </p>
      </div>

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {report.metrics.map((m) => (
            <div
              key={m.id}
              data-qa="onchain-metric"
              className="bg-surface border border-surface-border rounded-lg p-5 font-sans text-xs space-y-3 shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-surface-border">
                  <span className="font-bold text-white tracking-wide">{m.name}</span>
                  <Badge variant="amber" size="xs">
                    BTC
                  </Badge>
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-black text-white font-mono tabular-nums">{m.value}</span>
                  {m.change !== null && (
                    <span
                      className={`text-xs font-bold flex items-center font-mono tabular-nums ${
                        m.change >= 0 ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {m.change >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                      {m.change >= 0 ? '+' : ''}
                      {m.change}% {m.changeLabel && <span className="text-slate-500 ml-1 font-sans font-normal">({m.changeLabel})</span>}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-2 leading-relaxed">{m.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-brand-cyan" />
              <span className="font-bold text-white tracking-wide">Рекомендованные комиссии</span>
            </div>
            <span className="text-[11px] text-slate-500">sat/vB, оценка источника по текущему мемпулу</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {(
              [
                ['Ближайший блок', report.fees.fastestFee],
                ['~30 мин', report.fees.halfHourFee],
                ['~1 час', report.fees.hourFee],
                ['Эконом', report.fees.economyFee],
                ['Минимум', report.fees.minimumFee],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="bg-surface-elevated/40 border border-surface-border rounded p-3">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-lg font-bold text-white font-mono tabular-nums mt-1">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !report && (
        <div className="py-8 text-center text-slate-500 text-xs font-sans">Данные источника не получены.</div>
      )}
    </div>
  );
};
