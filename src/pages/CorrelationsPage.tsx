import React, { useEffect, useMemo, useState } from 'react';
import { buildCorrelationReport, type LiveCorrelationReport } from '@/services/analytics/CorrelationEngine';
import { Grid, ArrowUpDown, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { useMarketData } from '@/context/MarketDataContext';
import { getCanonicalAssets } from '@/services/data/registry/assetRegistry';

/** Набор для матрицы: BTC как бенчмарк + ведущие активы каталога (8 колонок — читаемо на 1024px). */
const CORRELATION_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'NEAR'] as const;
const WINDOW_DAYS = 30;

export const CorrelationsPage: React.FC = () => {
  const { provider, dataMode } = useMarketData();
  const [report, setReport] = useState<LiveCorrelationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const [isQaFixture, setIsQaFixture] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSourceUnavailable(false);
    const names = Object.fromEntries(getCanonicalAssets().map((a) => [a.symbol, a.name]));
    // Свечи 1D по каждому символу; отказ по символу исключает его из матрицы, а не подменяет данными.
    Promise.allSettled(CORRELATION_SYMBOLS.map((sym) => provider.getCandles(sym, '1D')))
      .then((results) => {
        if (!active) return;
        const closes: Record<string, number[]> = {};
        let anyFixture = false;
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled' || r.value.length === 0) return;
          const sorted = [...r.value].sort((a, b) => a.time - b.time);
          closes[CORRELATION_SYMBOLS[i]] = sorted.map((c) => c.close);
          if (sorted.some((c) => c.provenance?.exchange === 'synthetic-demo')) anyFixture = true;
        });
        const rep = buildCorrelationReport(closes, names, WINDOW_DAYS);
        if (!rep.assets.includes('BTC') || rep.assets.length < 2) {
          setSourceUnavailable(true);
          setReport(null);
        } else {
          setReport(rep);
          setIsQaFixture(anyFixture || dataMode !== 'live');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider, dataMode]);

  const assets = report?.assets ?? [];
  const matrix = report?.matrix ?? {};
  const betaRankings = useMemo(() => report?.betas ?? [], [report]);

  const getHeatColor = (val: number): string => {
    if (val === 1.0) return 'bg-brand-cyan/40 text-white font-bold';
    if (val >= 0.7) return 'bg-emerald-600/60 text-white font-bold';
    if (val >= 0.4) return 'bg-emerald-900/60 text-emerald-200';
    if (val > 0) return 'bg-surface-elevated text-slate-300';
    if (val <= -0.4) return 'bg-rose-900/70 text-rose-200 font-bold';
    return 'bg-rose-950/40 text-rose-300';
  };

  return (
    <div className="route-shell space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3" data-route="correlations" data-layout="comparison-matrix">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <Grid className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-sans text-white tracking-wide">
              Матрица корреляций и бета
            </h1>
            <Badge variant="cyan" size="sm">
              Макро и кросс-активы
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Матрица коэффициентов Пирсона по дневным лог-доходностям и чувствительность (Beta) альткоинов к Bitcoin — по фактическим свечам биржи.
          </p>
        </div>

        <div
          data-qa="correlations-source"
          className={`text-xs font-mono px-2.5 py-1 rounded border ${
            isQaFixture
              ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
              : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30'
          }`}
        >
          {report ? `${isQaFixture ? 'QA-СВЕЧИ' : 'LIVE-СВЕЧИ 1D'} · окно ${report.windowDays} дн. лог-доходностей` : 'Окно 30 дн. дневных лог-доходностей'}
        </div>
      </div>

      {sourceUnavailable && (
        <DataSourceUnavailable subject="дневные свечи для расчёта корреляций" />
      )}
      {report && report.excluded.length > 0 && (
        <div className="text-[11px] font-sans text-slate-400">
          Исключены из-за нехватки дневных свечей: <span className="font-mono">{report.excluded.join(', ')}</span>
        </div>
      )}

      {/* Non-Execution Notice */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-sans font-bold">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <span>Аналитическая ценность корреляционного анализа</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Корреляция позволяет избегать мнимой диверсификации портфеля (когда все активы имеют $r &gt; 0.85$ к BTC). Макро-бенчмарки (S&amp;P 500, золото, DXY) не показаны: у терминала нет их фактического источника, а справочные значения выдавать за расчёт нельзя. Терминал предоставляет аналитические расчёты без исполнения ордеров.
        </p>
      </div>

      {/* Main Grid: Correlation Matrix & Beta Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Correlation Heat Matrix (2 cols on lg) */}
        <div className="lg:col-span-2 bg-surface border border-surface-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="font-sans font-bold text-xs tracking-wide text-white">
              Матрица корреляций (Коэффициент Пирсона от -1.00 до +1.00)
            </span>
            <span className="text-[11px] font-sans text-slate-500">{loading ? 'Загрузка свечей…' : report ? `N=${report.windowDays} дн.` : '—'}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-center font-mono text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left text-slate-400 text-[11px]">Актив</th>
                  {assets.map((asset) => (
                    <th key={asset} className="p-2 text-slate-300 font-bold text-[11px]">
                      {asset}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/40">
                {assets.map((rowAsset) => (
                  <tr key={rowAsset}>
                    <td className="p-2 text-left font-bold text-white text-[11px] bg-surface-elevated/40">
                      {rowAsset}
                    </td>
                    {assets.map((colAsset) => {
                      const val = matrix[rowAsset]?.[colAsset] ?? 0;
                      return (
                        <td key={colAsset} className={`p-2 rounded-sm ${getHeatColor(val)}`}>
                          {val >= 0 ? '+' : ''}{val.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Scale Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-surface-border text-[11px] font-sans text-slate-400">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>Шкала:</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-900/70 text-rose-200 text-[11px]">Отрицательная (&lt;-0.4)</span>
              <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-slate-400 text-[11px]">Нейтральная (~0)</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-600/60 text-white text-[11px]">Высокая (&gt;+0.7)</span>
            </div>
            <span className="text-[11px] text-slate-500">Пересчёт при каждом открытии страницы</span>
          </div>
        </div>

        {/* Beta Rankings Table (1 col on lg) */}
        <div className="bg-surface border border-surface-border rounded-lg p-5 space-y-4 font-sans text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <div className="flex items-center space-x-1.5">
              <ArrowUpDown className="w-4 h-4 text-brand-purple" />
              <span className="font-bold text-white tracking-wide">
                Рейтинг чувствительности (Beta к BTC)
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
            Бета $\beta &gt; 1.0$ означает, что инструмент в среднем движется сильнее Bitcoin (повышенная волатильность), $\beta &lt; 1.0$ — защитные активы.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[11px] text-slate-500 border-b border-surface-border">
                <tr>
                  <th className="py-2 px-1">Актив</th>
                  <th className="py-2 px-1 text-center">Бета</th>
                  <th className="py-2 px-1 text-center">Корр.</th>
                  <th className="py-2 px-1 text-right">Волат. 30д</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/50 text-[11px]">
                {betaRankings.map((b) => (
                  <tr key={b.symbol} className="hover:bg-surface-elevated/40">
                    <td className="py-2 px-1">
                      <span className="font-bold text-white">{b.symbol}</span>
                      <span className="text-[11px] text-slate-500 block">{b.name}</span>
                    </td>
                    <td className="py-2 px-1 text-center">
                      <span
                        className={`font-black ${
                          b.betaToBtc > 1.3
                            ? 'text-purple-400'
                            : b.betaToBtc > 0.8
                            ? 'text-brand-cyan'
                            : b.betaToBtc < 0
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {b.betaToBtc.toFixed(2)}x
                      </span>
                    </td>
                    <td className="py-2 px-1 text-center text-slate-300">
                      {b.correlationToBtc >= 0 ? '+' : ''}{b.correlationToBtc.toFixed(2)}
                    </td>
                    <td className="py-2 px-1 text-right text-slate-400">
                      {b.volatility30d.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
