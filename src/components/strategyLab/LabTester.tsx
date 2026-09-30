/**
 * CRYPTORA — Strategy Lab · Strategy Tester (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Вкладки ОБЗОР / СДЕЛКИ / ОТКАЗЫ. Показывает ТОЛЬКО реально посчитанные
 * сервером значения; «—» там, где метрика не вычислима. Клик по сделке →
 * выбор (подсветка на графике + уровни).
 */

import React from 'react';
import type { LabReplayResult, LabMetrics } from '@/services/strategyLab/types';
import {
  formatInt,
  formatPercent,
  formatPrice,
  formatR,
  formatRatio,
  formatTime,
  sideLabel,
} from './labFormat';

export type LabTab = 'overview' | 'trades' | 'rejections';

interface LabTesterProps {
  result: LabReplayResult | null;
  tab: LabTab;
  onTabChange: (t: LabTab) => void;
  selectedTradeId: string | null;
  onSelectTrade: (id: string | null) => void;
}

const TABS: Array<{ id: LabTab; label: string; tut: string }> = [
  { id: 'overview', label: 'ОБЗОР', tut: 'overview' },
  { id: 'trades', label: 'СДЕЛКИ', tut: 'trades' },
  { id: 'rejections', label: 'ОТКАЗЫ', tut: 'rejections' },
];

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold text-white">{value}</div>
    </div>
  );
}

function Overview({ metrics }: { metrics: LabMetrics }) {
  return (
    <div
      data-lab-tutorial="overview"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
    >
      <MetricCard label="Всего кандидатов" value={formatInt(metrics.totalCandidates)} />
      <MetricCard label="Принято" value={formatInt(metrics.accepted)} />
      <MetricCard label="Отклонено" value={formatInt(metrics.rejected)} />
      <MetricCard label="Сделок" value={formatInt(metrics.trades)} />
      <MetricCard label="Разрешено" value={formatInt(metrics.resolved)} />
      <MetricCard label="Прибыльных" value={formatInt(metrics.profitable)} />
      <MetricCard label="Убыточных" value={formatInt(metrics.losing)} />
      <MetricCard label="Безубыток" value={formatInt(metrics.breakEven)} />
      <MetricCard label="Win Rate" value={formatPercent(metrics.winRate)} />
      <MetricCard label="Средний net R" value={formatR(metrics.averageNetR)} />
      <MetricCard label="Матожидание" value={formatR(metrics.expectancy)} />
      <MetricCard label="Profit Factor" value={formatRatio(metrics.profitFactor)} />
      <MetricCard label="Макс. просадка" value={formatR(metrics.maxDrawdownR)} />
    </div>
  );
}

function Trades({
  result,
  selectedTradeId,
  onSelectTrade,
}: {
  result: LabReplayResult;
  selectedTradeId: string | null;
  onSelectTrade: (id: string | null) => void;
}) {
  if (result.trades.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">Сделок нет.</p>;
  }
  return (
    <div data-lab-tutorial="trades" className="max-h-[360px] overflow-auto">
      <table className="w-full min-w-[720px] border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface-inset text-left text-[11px] text-slate-400">
          <tr>
            <th className="px-2 py-1.5">Время</th>
            <th className="px-2 py-1.5">Пара</th>
            <th className="px-2 py-1.5">Сторона</th>
            <th className="px-2 py-1.5 text-right">Вход</th>
            <th className="px-2 py-1.5 text-right">Стоп</th>
            <th className="px-2 py-1.5 text-right">Цель</th>
            <th className="px-2 py-1.5">Исход</th>
            <th className="px-2 py-1.5 text-right">Net R</th>
            <th className="px-2 py-1.5 text-right">Баров</th>
          </tr>
        </thead>
        <tbody>
          {result.trades.map((t) => {
            const selected = t.id === selectedTradeId;
            return (
              <tr
                key={t.id}
                onClick={() => onSelectTrade(selected ? null : t.id)}
                className={`cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.05] ${
                  selected ? 'bg-cyan-500/10' : ''
                }`}
              >
                <td className="px-2 py-1.5 font-mono text-slate-300">{formatTime(t.entryTime)}</td>
                <td className="px-2 py-1.5 font-mono">{result.meta.symbol}</td>
                <td
                  className={`px-2 py-1.5 font-semibold ${
                    t.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {sideLabel(t.side)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{formatPrice(t.entryPrice)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatPrice(t.stop)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatPrice(t.target)}</td>
                <td className="px-2 py-1.5">
                  <span className="text-slate-300">{t.outcome}</span>
                  <span className="ml-1 text-[11px] text-slate-500">{t.exitReason}</span>
                </td>
                <td
                  className={`px-2 py-1.5 text-right font-mono ${
                    t.netR > 0 ? 'text-emerald-400' : t.netR < 0 ? 'text-rose-400' : 'text-slate-300'
                  }`}
                >
                  {formatR(t.netR)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-300">{t.barsHeld}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Rejections({ result }: { result: LabReplayResult }) {
  if (result.rejections.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">Отказов нет.</p>;
  }
  return (
    <div data-lab-tutorial="rejections" className="max-h-[360px] overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-[12px]">
        <thead className="sticky top-0 bg-surface-inset text-left text-[11px] text-slate-400">
          <tr>
            <th className="px-2 py-1.5">Время</th>
            <th className="px-2 py-1.5">Сторона</th>
            <th className="px-2 py-1.5">Причина</th>
            <th className="px-2 py-1.5">Диагностика</th>
          </tr>
        </thead>
        <tbody>
          {result.rejections.map((r) => (
            <tr key={r.id} className="border-t border-white/[0.05]">
              <td className="px-2 py-1.5 font-mono text-slate-300">{formatTime(r.candleTime)}</td>
              <td
                className={`px-2 py-1.5 font-semibold ${
                  r.side === 'LONG' ? 'text-emerald-400' : r.side === 'SHORT' ? 'text-rose-400' : 'text-slate-300'
                }`}
              >
                {sideLabel(r.side)}
              </td>
              <td className="px-2 py-1.5 font-mono text-amber-300">{r.reason}</td>
              <td className="px-2 py-1.5 font-mono text-[11px] text-slate-400">
                {Object.entries(r.diagnostics)
                  .map(([k, v]) => `${k}=${typeof v === 'number' ? formatPrice(v) : v ?? '—'}`)
                  .join('  ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const LabTester: React.FC<LabTesterProps> = ({
  result,
  tab,
  onTabChange,
  selectedTradeId,
  onSelectTrade,
}) => {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-surface-inset/40">
      <div className="flex gap-1 border-b border-white/[0.08] px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-lab-tutorial={t.tut}
            onClick={() => onTabChange(t.id)}
            className={`rounded-t-md px-3 py-1.5 text-[12px] font-semibold tracking-wide transition-colors ${
              tab === t.id
                ? 'bg-white/[0.06] text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-3">
        {!result ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Результатов ещё нет — запустите бэктест.
          </p>
        ) : tab === 'overview' ? (
          <Overview metrics={result.metrics} />
        ) : tab === 'trades' ? (
          <Trades result={result} selectedTradeId={selectedTradeId} onSelectTrade={onSelectTrade} />
        ) : (
          <Rejections result={result} />
        )}
      </div>
    </div>
  );
};
