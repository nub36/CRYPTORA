/**
 * CRYPTORA — Strategy Lab · верхние контролы (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * STRATEGY / MARKET / SYMBOL / TIMEFRAME / FROM / TO + Запустить/Сбросить.
 * Только сбор ввода; расчёт — на сервере.
 */

import React from 'react';
import { Play, RotateCcw, Loader2 } from 'lucide-react';
import type { LabStrategyMeta } from '@/services/strategyLab/registry';
import type { LabMarket, LabTimeframe } from '@/services/strategyLab/types';
import { LAB_TIMEFRAMES } from '@/services/strategyLab/types';

export interface LabControlsState {
  strategyId: string;
  market: LabMarket;
  symbol: string;
  timeframe: LabTimeframe;
  from: string; // datetime-local
  to: string; // datetime-local
}

interface LabControlsProps {
  strategies: LabStrategyMeta[];
  value: LabControlsState;
  onChange: <K extends keyof LabControlsState>(key: K, v: LabControlsState[K]) => void;
  onRun: () => void;
  onReset: () => void;
  loading: boolean;
}

const fieldCls =
  'rounded-md border border-white/[0.1] bg-surface-2 px-2 py-1.5 text-[13px] text-white outline-none focus:border-cyan-500/50';

export const LabControls: React.FC<LabControlsProps> = ({
  strategies,
  value,
  onChange,
  onRun,
  onReset,
  loading,
}) => {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 md:grid-cols-4 xl:grid-cols-7">
      <label className="flex flex-col gap-1 text-[11px] text-slate-400" data-lab-tutorial="strategy-selector">
        <span>Стратегия</span>
        <select
          className={fieldCls}
          value={value.strategyId}
          onChange={(e) => onChange('strategyId', e.target.value)}
        >
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-slate-400" data-lab-tutorial="market-selector">
        <span>Рынок</span>
        <select
          className={fieldCls}
          value={value.market}
          onChange={(e) => onChange('market', e.target.value as LabMarket)}
        >
          <option value="spot">Спот</option>
          <option value="futures">Фьючерсы</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-slate-400" data-lab-tutorial="symbol-selector">
        <span>Символ</span>
        <input
          className={`${fieldCls} font-mono`}
          value={value.symbol}
          spellCheck={false}
          placeholder="BTCUSDT"
          onChange={(e) => onChange('symbol', e.target.value.toUpperCase())}
        />
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-slate-400" data-lab-tutorial="timeframe-selector">
        <span>Таймфрейм</span>
        <select
          className={fieldCls}
          value={value.timeframe}
          onChange={(e) => onChange('timeframe', e.target.value as LabTimeframe)}
        >
          {LAB_TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-slate-400" data-lab-tutorial="date-range">
        <span>От</span>
        <input
          type="datetime-local"
          className={fieldCls}
          value={value.from}
          onChange={(e) => onChange('from', e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-slate-400">
        <span>До</span>
        <input
          type="datetime-local"
          className={fieldCls}
          value={value.to}
          onChange={(e) => onChange('to', e.target.value)}
        />
      </label>

      <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-1">
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          data-lab-tutorial="run-backtest"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-[13px] font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {loading ? 'Расчёт…' : 'Запустить бэктест'}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          title="Сбросить параметры к значениям по умолчанию"
          className="flex items-center justify-center gap-1.5 rounded-md border border-white/[0.1] bg-surface-2 px-3 py-2 text-[13px] text-slate-300 hover:bg-surface-elevated disabled:opacity-60"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
