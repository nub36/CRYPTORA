/**
 * CRYPTORA — Strategy Lab · НАСТРОЙКИ ИНДИКАТОРОВ (CODE-FIRST, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Единственное место, где объявляются индикаторы (EMA, ATR): период, источник
 * цены, видимость на графике. Код стратегии только ССЫЛАЕТСЯ на них по
 * стабильному идентификатору (бейдж рядом с индикатором) — период нигде не
 * дублируется.
 *
 * Числовые поля используют LabNumericInput: значение можно свободно стирать и
 * набирать заново (исправленное поведение сохранено).
 */

import React, { useCallback, useState } from 'react';
import { Plus, Trash2, Sliders, Copy, Check } from 'lucide-react';
import type { IndicatorDefinition, IndicatorSource } from '@/services/strategyLab/types';
import { buildIndicatorBindings } from '@/services/strategyLab/draft/identifiers';
import { LabNumericInput } from './LabNumericInput';

interface LabIndicatorsPanelProps {
  name: string;
  indicators: IndicatorDefinition[];
  onNameChange: (name: string) => void;
  onChange: (indicators: IndicatorDefinition[]) => void;
  disabled?: boolean;
}

const inputCls =
  'rounded-md border border-white/[0.1] bg-surface-2 px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-cyan-500/50 disabled:opacity-50';

const SOURCES: { value: IndicatorSource; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'close', label: 'Close' },
];

export const LabIndicatorsPanel: React.FC<LabIndicatorsPanelProps> = ({
  name,
  indicators,
  onNameChange,
  onChange,
  disabled = false,
}) => {
  const bindings = buildIndicatorBindings(indicators);
  const [copied, setCopied] = useState<string | null>(null);

  /*
     Копирование идентификатора: сначала Clipboard API, затем честный fallback
     через скрытое поле + document.execCommand (без новых зависимостей).
     Если скопировать не удалось — идентификатор остаётся выделённым текстом,
     его всегда можно скопировать вручную.
  */
  const copyIdentifier = useCallback((identifier: string) => {
    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = identifier;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        return true;
      } catch {
        return false;
      }
    };
    const done = (ok: boolean) => {
      if (!ok) return;
      setCopied(identifier);
      window.setTimeout(() => setCopied((c) => (c === identifier ? null : c)), 1500);
    };
    const clipboard = navigator?.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(identifier).then(
        () => done(true),
        () => done(fallback())
      );
      return;
    }
    done(fallback());
  }, []);

  const addEma = useCallback(() => {
    const n = indicators.filter((i) => i.type === 'EMA').length + 1;
    const period = n === 1 ? 20 : n === 2 ? 50 : n === 3 ? 200 : 20 * n;
    onChange([
      ...indicators,
      {
        id: `ema-${n}-${indicators.length + 1}`,
        type: 'EMA',
        name: `EMA ${period}`,
        period,
        source: 'close',
        visible: true,
      },
    ]);
  }, [indicators, onChange]);

  const addAtr = useCallback(() => {
    const n = indicators.filter((i) => i.type === 'ATR').length + 1;
    onChange([
      ...indicators,
      {
        id: `atr-${n}-${indicators.length + 1}`,
        type: 'ATR',
        name: n === 1 ? 'ATR 14' : `ATR 14 (${n})`,
        period: 14,
        visible: false,
      },
    ]);
  }, [indicators, onChange]);

  const update = useCallback(
    (id: string, patch: Partial<IndicatorDefinition>) => {
      onChange(indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },
    [indicators, onChange]
  );

  const remove = useCallback(
    (id: string) => {
      if (indicators.length <= 1) return;
      onChange(indicators.filter((i) => i.id !== id));
    },
    [indicators, onChange]
  );

  return (
    <div className="min-w-0 space-y-4" data-qa="lab-indicators-panel">
      <div>
        <label className="mb-1 block text-[11px] tracking-wider text-slate-400">
          Название стратегии
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
          aria-label="Название стратегии"
          data-lab-tutorial="strategy-name"
          className={`w-full ${inputCls}`}
        />
      </div>

      <section
        className="rounded-lg border border-white/[.08] bg-surface-1 p-3"
        data-lab-tutorial="indicator-settings"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <h3 className="text-[12px] font-bold tracking-wider text-slate-200">
              ИНДИКАТОРЫ
            </h3>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addEma}
              disabled={disabled}
              data-lab-tutorial="add-indicator"
              data-qa="lab-add-ema"
              className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> EMA
            </button>
            <button
              type="button"
              onClick={addAtr}
              disabled={disabled}
              data-qa="lab-add-atr"
              className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> ATR
            </button>
          </div>
        </div>

        <p className="mb-3 text-[11px] text-slate-400">
          Период и источник задаются только здесь. В коде используйте идентификатор «Код:» —
          он привязан к индикатору навсегда и не меняется при переименовании.
        </p>

        <div className="space-y-3">
          {bindings.map(({ identifier, indicator }) => (
            <div
              key={indicator.id}
              data-qa="lab-indicator-row"
              className="rounded-md border border-white/[.07] bg-surface-2/60 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-bold text-cyan-300">
                  {indicator.type}
                </span>
                <span className="text-[11px] text-slate-400">Код:</span>
                <button
                  type="button"
                  onClick={() => copyIdentifier(identifier)}
                  data-qa="lab-indicator-identifier"
                  aria-label={`Копировать идентификатор ${identifier}`}
                  title="Нажмите, чтобы скопировать идентификатор для кода стратегии"
                  className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300 hover:bg-slate-800"
                >
                  <code>{identifier}</code>
                  {copied === identifier ? (
                    <Check className="h-3 w-3 text-emerald-400" aria-hidden />
                  ) : (
                    <Copy className="h-3 w-3 text-slate-400" aria-hidden />
                  )}
                  <span className="sr-only">{copied === identifier ? 'Скопировано' : 'Копировать'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(indicator.id)}
                  disabled={disabled || indicators.length <= 1}
                  aria-label={`Удалить индикатор ${indicator.name || indicator.id}`}
                  className="ml-auto rounded p-1 text-slate-400 hover:text-rose-300 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Название</label>
                  <input
                    type="text"
                    value={indicator.name ?? ''}
                    onChange={(e) => update(indicator.id, { name: e.target.value })}
                    disabled={disabled}
                    aria-label={`Название индикатора ${identifier}`}
                    className={`w-full ${inputCls}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">Период</label>
                  <LabNumericInput
                    value={indicator.period}
                    onChange={(period) => update(indicator.id, { period })}
                    min={1}
                    max={1000}
                    integer
                    disabled={disabled}
                    aria-label={`Период индикатора ${identifier}`}
                    className={`w-full ${inputCls}`}
                  />
                </div>
                {indicator.type === 'EMA' && (
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Источник</label>
                    <select
                      value={indicator.source ?? 'close'}
                      onChange={(e) =>
                        update(indicator.id, { source: e.target.value as IndicatorSource })
                      }
                      disabled={disabled}
                      aria-label={`Источник индикатора ${identifier}`}
                      className={`w-full ${inputCls}`}
                    >
                      {SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/*
                ATR не имеет отдельной панели на графике Lab (см. LabChart),
                поэтому чекбокс показывается только там, где отображение
                действительно поддержано — для EMA.
              */}
              {indicator.type === 'EMA' ? (
                <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={indicator.visible ?? false}
                    onChange={(e) => update(indicator.id, { visible: e.target.checked })}
                    disabled={disabled}
                    aria-label={`Показывать на графике ${identifier}`}
                  />
                  Показывать на графике
                </label>
              ) : (
                <p className="mt-2 text-[11px] text-slate-500">
                  ATR используется для расчёта стопа и не рисуется поверх цены.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default LabIndicatorsPanel;
