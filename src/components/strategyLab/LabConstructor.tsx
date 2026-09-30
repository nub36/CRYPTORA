/**
 * CRYPTORA — Strategy Lab · Визуальный конструктор стратегий (Phase 2A)
 * ---------------------------------------------------------------------------
 * Позволяет собирать стратегию из индикаторов (EMA, ATR), задавать условия
 * LONG/SHORT (пересечения), параметры стопа (ATR × mult) и цели (Target R).
 * Все числовые поля используют LabNumericInput, который позволяет свободно
 * стирать и вводить значения.
 */

import React, { useCallback } from 'react';
import { Plus, Trash2, Sliders, ArrowUpRight, ArrowDownRight, ShieldCheck, Target } from 'lucide-react';
import type {
  StrategyDraftDefinition,
  IndicatorDefinition,
  LogicOperator,
} from '@/services/strategyLab/types';
import { LabNumericInput } from './LabNumericInput';

interface LabConstructorProps {
  definition: StrategyDraftDefinition;
  onChange: (def: StrategyDraftDefinition) => void;
  disabled?: boolean;
}

const inputCls =
  'rounded-md border border-white/[0.1] bg-surface-2 px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-cyan-500/50 disabled:opacity-50';

export const LabConstructor: React.FC<LabConstructorProps> = ({
  definition,
  onChange,
  disabled = false,
}) => {
  // Обновление названия
  const handleNameChange = useCallback(
    (name: string) => {
      onChange({ ...definition, name });
    },
    [definition, onChange]
  );

  // Добавление EMA
  const handleAddEma = useCallback(() => {
    const nextNum = definition.indicators.filter((i) => i.type === 'EMA').length + 1;
    const period = nextNum === 1 ? 20 : nextNum === 2 ? 50 : nextNum === 3 ? 200 : 20 * nextNum;
    const newId = `ema-${Date.now()}`;
    const newInd: IndicatorDefinition = {
      id: newId,
      type: 'EMA',
      name: `EMA ${period}`,
      period,
      source: 'close',
      visible: true,
    };
    onChange({
      ...definition,
      indicators: [...definition.indicators, newInd],
    });
  }, [definition, onChange]);

  // Добавление ATR
  const handleAddAtr = useCallback(() => {
    const nextNum = definition.indicators.filter((i) => i.type === 'ATR').length + 1;
    const period = 14;
    const newId = `atr-${Date.now()}`;
    const newInd: IndicatorDefinition = {
      id: newId,
      type: 'ATR',
      name: nextNum === 1 ? 'ATR 14' : `ATR 14 (${nextNum})`,
      period,
      visible: false,
    };
    onChange({
      ...definition,
      indicators: [...definition.indicators, newInd],
    });
  }, [definition, onChange]);

  // Изменение индикатора
  const handleUpdateIndicator = useCallback(
    (id: string, updates: Partial<IndicatorDefinition>) => {
      const nextIndicators = definition.indicators.map((ind) =>
        ind.id === id ? { ...ind, ...updates } : ind
      );
      onChange({
        ...definition,
        indicators: nextIndicators,
      });
    },
    [definition, onChange]
  );

  // Удаление индикатора
  const handleDeleteIndicator = useCallback(
    (id: string) => {
      if (definition.indicators.length <= 1) return;
      const nextIndicators = definition.indicators.filter((ind) => ind.id !== id);
      const emaList = nextIndicators.filter((i) => i.type === 'EMA');
      const atrList = nextIndicators.filter((i) => i.type === 'ATR');

      // Корректировка правил при удалении индикаторов
      let nextLong = { ...definition.long };
      let nextShort = { ...definition.short };
      let nextStop = { ...definition.stop };

      if (nextLong.left === id && emaList.length > 0) {
        nextLong.left = emaList[0].id;
      }
      if (nextLong.right === id && emaList.length > 1) {
        nextLong.right = emaList[1].id;
      } else if (nextLong.right === id && emaList.length > 0) {
        nextLong.right = emaList[0].id;
      }

      if (nextShort.left === id && emaList.length > 0) {
        nextShort.left = emaList[0].id;
      }
      if (nextShort.right === id && emaList.length > 1) {
        nextShort.right = emaList[1].id;
      } else if (nextShort.right === id && emaList.length > 0) {
        nextShort.right = emaList[0].id;
      }

      if (nextStop.indicatorId === id && atrList.length > 0) {
        nextStop.indicatorId = atrList[0].id;
      }

      onChange({
        ...definition,
        indicators: nextIndicators,
        long: nextLong,
        short: nextShort,
        stop: nextStop,
      });
    },
    [definition, onChange]
  );

  const emaIndicators = definition.indicators.filter((i) => i.type === 'EMA');
  const atrIndicators = definition.indicators.filter((i) => i.type === 'ATR');

  return (
    <div className="space-y-4">
      {/* ── 1. Название стратегии ────────────────────────────────────────── */}
      <div className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 sm:p-4">
        <label className="flex flex-col gap-1.5" data-lab-tutorial="strategy-name">
          <span className="text-[12px] font-semibold text-slate-300">Название стратегии</span>
          <input
            type="text"
            data-lab-tutorial="strategy-name"
            className={`${inputCls} font-medium`}
            value={definition.name}
            onChange={(e) => handleNameChange(e.target.value)}
            disabled={disabled}
            placeholder="Например: EMA 20/50 Cross + ATR Stop"
          />
        </label>
      </div>

      {/* ── 2. Блок Индикаторы ─────────────────────────────────────────── */}
      <div
        className="space-y-3 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 sm:p-4"
        data-lab-tutorial="indicator-settings"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">ИНДИКАТОРЫ</span>
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-mono text-slate-400">
              {definition.indicators.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddEma}
              disabled={disabled}
              data-lab-tutorial="add-indicator"
              className="flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[12px] font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              + EMA
            </button>
            <button
              type="button"
              onClick={handleAddAtr}
              disabled={disabled}
              className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[12px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              + ATR
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          {definition.indicators.map((ind) => {
            const isEma = ind.type === 'EMA';
            return (
              <div
                key={ind.id}
                className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-surface-2/60 p-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                      isEma ? 'bg-cyan-500/20 text-cyan-300' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {ind.type}
                  </span>
                  <input
                    type="text"
                    aria-label={`Название ${ind.type}`}
                    value={ind.name ?? `${ind.type} ${ind.period}`}
                    onChange={(e) => handleUpdateIndicator(ind.id, { name: e.target.value })}
                    disabled={disabled}
                    className="w-28 rounded border border-white/[0.08] bg-surface-inset/60 px-2 py-1 text-[12px] text-white outline-none focus:border-cyan-500/50"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[12px] text-slate-400">
                    <span>Период:</span>
                    <LabNumericInput
                      value={ind.period}
                      integer
                      min={1}
                      max={1000}
                      disabled={disabled}
                      aria-label="Период"
                      onChange={(period) => handleUpdateIndicator(ind.id, { period })}
                      className="w-16 rounded border border-white/[0.08] bg-surface-inset/60 px-2 py-1 font-mono text-[12px] text-white outline-none focus:border-cyan-500/50"
                    />
                  </label>

                  {isEma && (
                    <label className="flex items-center gap-1.5 text-[12px] text-slate-400">
                      <span>Источник:</span>
                      <select
                        value={ind.source ?? 'close'}
                        disabled={disabled}
                        onChange={(e) =>
                          handleUpdateIndicator(ind.id, {
                            source: e.target.value as IndicatorDefinition['source'],
                          })
                        }
                        className="rounded border border-white/[0.08] bg-surface-inset/60 px-1.5 py-1 text-[12px] text-white outline-none focus:border-cyan-500/50"
                      >
                        <option value="close">Закрытие</option>
                        <option value="open">Открытие</option>
                        <option value="high">High</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                  )}

                  <label className="flex items-center gap-1.5 text-[12px] text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={ind.visible ?? true}
                      disabled={disabled}
                      onChange={(e) => handleUpdateIndicator(ind.id, { visible: e.target.checked })}
                      className="rounded border-white/20 bg-surface-2 text-cyan-500 focus:ring-0"
                    />
                    <span>На графике</span>
                  </label>

                  {definition.indicators.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteIndicator(ind.id)}
                      disabled={disabled}
                      title="Удалить индикатор"
                      className="p-1 text-slate-400 hover:text-rose-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3. Блок Логика стратегии ───────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 sm:p-4">
        <div className="border-b border-white/[0.08] pb-2">
          <h3 className="text-sm font-semibold text-white">ЛОГИКА СТРАТЕГИИ</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Декларативные правила пересечения индикаторов без кода.
          </p>
        </div>

        {/* LONG Rule */}
        <div
          className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"
          data-lab-tutorial="long-rule"
        >
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-400">
            <ArrowUpRight className="h-4 w-4" />
            <span>Условие LONG</span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              <span>Индикатор слева</span>
              <select
                className={inputCls}
                value={definition.long.left}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    long: { ...definition.long, left: e.target.value },
                  })
                }
              >
                {emaIndicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.name || `${ind.type} ${ind.period}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              <span>Оператор</span>
              <select
                className={inputCls}
                value={definition.long.operator}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    long: { ...definition.long, operator: e.target.value as LogicOperator },
                  })
                }
              >
                <option value="crossesAbove">пересекает вверх</option>
                <option value="crossesBelow">пересекает вниз</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              <span>Индикатор справа</span>
              <select
                className={inputCls}
                value={definition.long.right}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    long: { ...definition.long, right: e.target.value },
                  })
                }
              >
                {emaIndicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.name || `${ind.type} ${ind.period}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* SHORT Rule */}
        <div
          className="space-y-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3"
          data-lab-tutorial="short-rule"
        >
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-rose-400">
            <ArrowDownRight className="h-4 w-4" />
            <span>Условие SHORT</span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              <span>Индикатор слева</span>
              <select
                className={inputCls}
                value={definition.short.left}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    short: { ...definition.short, left: e.target.value },
                  })
                }
              >
                {emaIndicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.name || `${ind.type} ${ind.period}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              <span>Оператор</span>
              <select
                className={inputCls}
                value={definition.short.operator}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    short: { ...definition.short, operator: e.target.value as LogicOperator },
                  })
                }
              >
                <option value="crossesBelow">пересекает вниз</option>
                <option value="crossesAbove">пересекает вверх</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              <span>Индикатор справа</span>
              <select
                className={inputCls}
                value={definition.short.right}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    short: { ...definition.short, right: e.target.value },
                  })
                }
              >
                {emaIndicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.name || `${ind.type} ${ind.period}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* ── 4. Блок Стоп и Цель ────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 sm:p-4">
        <div className="border-b border-white/[0.08] pb-2">
          <h3 className="text-sm font-semibold text-white">СТОП И ЦЕЛЬ</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Управление рисками и параметрами исполнения.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Стоп-лосс */}
          <div
            className="space-y-2 rounded-lg border border-white/[0.06] bg-surface-2/40 p-3"
            data-lab-tutorial="stop"
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-300">
              <ShieldCheck className="h-4 w-4" />
              <span>Стоп-лосс (SL)</span>
            </div>

            <div className="flex items-center gap-2">
              <select
                className={`flex-1 ${inputCls}`}
                value={definition.stop.indicatorId}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...definition,
                    stop: { ...definition.stop, indicatorId: e.target.value },
                  })
                }
              >
                {atrIndicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.name || `${ind.type} ${ind.period}`}
                  </option>
                ))}
              </select>

              <span className="text-slate-400 font-bold">×</span>

              <div className="w-24">
                <LabNumericInput
                  value={definition.stop.multiplier}
                  min={0.1}
                  max={20}
                  step={0.1}
                  disabled={disabled}
                  onChange={(multiplier) =>
                    onChange({
                      ...definition,
                      stop: { ...definition.stop, multiplier },
                    })
                  }
                  className={`w-full ${inputCls} font-mono`}
                />
              </div>
            </div>
          </div>

          {/* Тейк-профит */}
          <div
            className="space-y-2 rounded-lg border border-white/[0.06] bg-surface-2/40 p-3"
            data-lab-tutorial="target"
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-300">
              <Target className="h-4 w-4" />
              <span>Цель (TP)</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <LabNumericInput
                  value={definition.target.multiple}
                  min={0.1}
                  max={20}
                  step={0.1}
                  disabled={disabled}
                  onChange={(multiple) =>
                    onChange({
                      ...definition,
                      target: { ...definition.target, multiple },
                    })
                  }
                  className={`w-full ${inputCls} font-mono`}
                />
              </div>
              <span className="font-mono text-sm font-semibold text-slate-300">R</span>
            </div>
          </div>
        </div>

        {/* Исполнение (комиссии и проскальзывание) */}
        <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Комиссия (bps)</span>
            <LabNumericInput
              value={definition.execution?.feeBps ?? 5}
              min={0}
              max={100}
              step={0.1}
              disabled={disabled}
              onChange={(feeBps) =>
                onChange({
                  ...definition,
                  execution: {
                    feeBps,
                    slippageBps: definition.execution?.slippageBps ?? 2,
                  },
                })
              }
              className={`${inputCls} font-mono`}
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Проскальзывание (bps)</span>
            <LabNumericInput
              value={definition.execution?.slippageBps ?? 2}
              min={0}
              max={100}
              step={0.1}
              disabled={disabled}
              onChange={(slippageBps) =>
                onChange({
                  ...definition,
                  execution: {
                    feeBps: definition.execution?.feeBps ?? 5,
                    slippageBps,
                  },
                })
              }
              className={`${inputCls} font-mono`}
            />
          </label>
        </div>
      </div>
    </div>
  );
};
