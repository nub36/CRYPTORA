/**
 * CRYPTORA — Strategy Lab · Контролы рынка и запуск бэктеста
 * ---------------------------------------------------------------------------
 * Кнопка [Запустить бэктест] и выбор рынка (Spot / Futures), монеты через
 * SymbolPickerModal, таймфрейма и дат.
 *
 * ЕДИНЫЙ workflow сохранения живёт в верхней панели «СТРАТЕГИЯ» StrategyLabPage
 * (селектор «Мои стратегии», «+ Новая», «Сохранить», «Сохранить как...»).
 * Старые отключённые кнопки-заглушки [Создать стратегию]/[Сохранить стратегию]/
 * [Мои стратегии] удалены: они дублировали реальный workflow и на мобильном
 * сбивали пользователя с пути к настройкам индикаторов.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Play, Loader2, ChevronDown } from 'lucide-react';
import type { LabMarket, LabTimeframe } from '@/services/strategyLab/types';
import { LAB_TIMEFRAMES } from '@/services/strategyLab/types';
import type { LabDataCoverage } from '@/services/strategyLab/labClient';
import { SymbolPickerModal } from '@/components/common/SymbolPickerModal';
import { getSpotUniverse, getFuturesUniverse } from '@/services/data/registry/exchangeUniverse';
import { getCoinNames } from '@/services/data/registry/coinLogoRegistry';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';

export interface LabControlsState {
  market: LabMarket;
  symbol: string;
  timeframe: LabTimeframe;
  from: string; // datetime-local
  to: string; // datetime-local
}

interface LabControlsProps {
  value: LabControlsState;
  onChange: <K extends keyof LabControlsState>(key: K, v: LabControlsState[K]) => void;
  onRun: () => void;
  loading: boolean;
  coverage?: LabDataCoverage | null;
  /** Бэктест заблокирован извне (например, код стратегии не прошёл проверку). */
  runDisabled?: boolean;
}

const fieldCls =
  'rounded-md border border-white/[0.1] bg-surface-2 px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-cyan-500/50';

function formatCoverageDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

function formatDisplayPair(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes('/')) return s;
  if (s.endsWith('USDT')) {
    const base = s.slice(0, -4);
    return `${base}/USDT`;
  }
  return `${s}/USDT`;
}

export const LabControls: React.FC<LabControlsProps> = ({
  value,
  onChange,
  onRun,
  loading,
  coverage = null,
  runDisabled = false,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availableAssets, setAvailableAssets] = useState<{ symbol: string; name: string }[]>([]);

  // Загрузка доступных активов под выбранный рынок (Spot / Futures)
  useEffect(() => {
    let active = true;
    async function loadUniverse() {
      try {
        if (value.market === 'futures') {
          const fut = await getFuturesUniverse();
          if (!active) return;
          if (fut && fut.contracts.length > 0) {
            const tickers = fut.contracts.map((c) => c.symbol);
            const names = await getCoinNames(tickers);
            if (!active) return;
            setAvailableAssets(
              fut.contracts.map((c) => ({
                symbol: c.symbol,
                name: names.get(c.symbol) || c.baseAsset || c.symbol,
              }))
            );
            return;
          }
        } else {
          const spot = await getSpotUniverse();
          if (!active) return;
          if (spot && spot.symbols.length > 0) {
            const tickers = spot.symbols.map((s) => s.symbol);
            const names = await getCoinNames(tickers);
            if (!active) return;
            setAvailableAssets(
              spot.symbols.map((s) => ({
                symbol: s.symbol,
                name: names.get(s.symbol) || s.baseAsset || s.symbol,
              }))
            );
            return;
          }
        }
        // Fallback
        if (active) {
          setAvailableAssets(CANONICAL_ASSETS.map((a) => ({ symbol: a.symbol, name: a.name })));
        }
      } catch {
        if (active) {
          setAvailableAssets(CANONICAL_ASSETS.map((a) => ({ symbol: a.symbol, name: a.name })));
        }
      }
    }

    loadUniverse();
    return () => {
      active = false;
    };
  }, [value.market]);

  const handleSelectSymbol = useCallback(
    (baseSymbol: string) => {
      const cleanBase = baseSymbol.trim().toUpperCase();
      const rawSymbol = cleanBase.endsWith('USDT') ? cleanBase : `${cleanBase}USDT`;
      onChange('symbol', rawSymbol);
      setPickerOpen(false);
    },
    [onChange]
  );

  const displayPair = useMemo(() => formatDisplayPair(value.symbol), [value.symbol]);

  return (
    <div className="space-y-3">
      {/* ── 1. Запуск бэктеста (единственное действие уровня контролов) ──── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="ml-auto">
          <button
            type="button"
            onClick={onRun}
            disabled={loading || runDisabled}
            title={runDisabled ? 'Исправьте ошибки кода стратегии, чтобы запустить бэктест' : undefined}
            data-lab-tutorial="run-backtest"
            className="flex items-center gap-2 rounded-md border border-cyan-500/50 bg-cyan-500/20 px-4 py-2 text-[13px] font-bold text-cyan-200 hover:bg-cyan-500/30 active:scale-[0.98] transition-transform shadow-lg shadow-cyan-500/10 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-cyan-400" />}
            <span>{loading ? 'Расчёт…' : 'Запустить бэктест'}</span>
          </button>
        </div>
      </div>

      {/* ── 2. Параметры рынка и даты ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 sm:grid-cols-3 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
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

        <div className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>МОНЕТА</span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            data-lab-tutorial="symbol"
            className={`flex items-center justify-between ${fieldCls} hover:border-cyan-500/50`}
          >
            <span className="font-mono font-bold text-cyan-300">{displayPair}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
        </div>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
          <span>Таймфрейм</span>
          <select
            className={fieldCls}
            value={value.timeframe}
            data-lab-tutorial="timeframe"
            onChange={(e) => onChange('timeframe', e.target.value as LabTimeframe)}
          >
            {LAB_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-400">
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
      </div>

      {coverage && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[11px] text-slate-400"
          data-testid="strategy-lab-data-coverage"
        >
          {coverage.datasetAvailable && coverage.coverageFrom && coverage.coverageTo ? (
            <>
              <span className="font-semibold text-slate-300">История:</span>
              <span className="font-mono">
                {formatCoverageDate(coverage.coverageFrom)} — {formatCoverageDate(coverage.coverageTo)}
              </span>
              <span className="text-emerald-400">Локальный архив</span>
            </>
          ) : (
            <span className="text-slate-500">Локальный архив недоступен</span>
          )}
        </div>
      )}

      <SymbolPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectSymbol}
        title={`Выбор монеты (${value.market === 'spot' ? 'Спот' : 'Фьючерсы'})`}
        current={value.symbol}
        availableAssets={availableAssets}
      />
    </div>
  );
};
