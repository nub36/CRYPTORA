/**
 * CRYPTORA — Strategy Lab · indicator settings (CODE-FIRST, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Indicator settings are the only source of configuration. Strategy code refers
 * to the stable identifier derived from each internal id; display-name changes
 * never change code bindings.
 */

import React, { useCallback, useState } from 'react';
import { Plus, Trash2, Sliders, Copy, Check } from 'lucide-react';
import type {
  IndicatorDefinition,
  IndicatorSource,
  OrderBlockIndicatorDefinition,
  MarketStructureIndicatorDefinition,
  FvgIndicatorDefinition,
} from '@/services/strategyLab/types';
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

const isOrderBlock = (indicator: IndicatorDefinition): indicator is OrderBlockIndicatorDefinition =>
  indicator.type === 'ORDER_BLOCK';
const isMarketStructure = (indicator: IndicatorDefinition): indicator is MarketStructureIndicatorDefinition =>
  indicator.type === 'MARKET_STRUCTURE';
const isFvg = (indicator: IndicatorDefinition): indicator is FvgIndicatorDefinition =>
  indicator.type === 'FVG';

export const LabIndicatorsPanel: React.FC<LabIndicatorsPanelProps> = ({
  name,
  indicators,
  onNameChange,
  onChange,
  disabled = false,
}) => {
  const bindings = buildIndicatorBindings(indicators);
  const atrBindings = bindings.filter(({ indicator }) => indicator.type === 'ATR');
  const hasAtr = atrBindings.length > 0;
  const [copied, setCopied] = useState<string | null>(null);

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
      window.setTimeout(() => setCopied((current) => (current === identifier ? null : current)), 1500);
    };
    const clipboard = navigator?.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(identifier).then(() => done(true), () => done(fallback()));
      return;
    }
    done(fallback());
  }, []);

  const addEma = useCallback(() => {
    const n = indicators.filter((indicator) => indicator.type === 'EMA').length + 1;
    const period = n === 1 ? 20 : n === 2 ? 50 : n === 3 ? 200 : 20 * n;
    onChange([
      ...indicators,
      { id: `ema-${n}-${indicators.length + 1}`, type: 'EMA', name: `EMA ${period}`, period, source: 'close', visible: true },
    ]);
  }, [indicators, onChange]);

  const addAtr = useCallback(() => {
    const n = indicators.filter((indicator) => indicator.type === 'ATR').length + 1;
    onChange([
      ...indicators,
      { id: `atr-${n}-${indicators.length + 1}`, type: 'ATR', name: n === 1 ? 'ATR 14' : `ATR 14 (${n})`, period: 14, visible: false },
    ]);
  }, [indicators, onChange]);

  const addRsi = useCallback(() => {
    const n = indicators.filter((indicator) => indicator.type === 'RSI').length + 1;
    onChange([
      ...indicators,
      { id: `rsi-${n}-${indicators.length + 1}`, type: 'RSI', name: 'RSI 14', period: 14, source: 'close', visible: false },
    ]);
  }, [indicators, onChange]);

  const addFractals = useCallback(() => {
    const n = indicators.filter((indicator) => indicator.type === 'FRACTALS').length + 1;
    onChange([
      ...indicators,
      { id: `fractals-${n}-${indicators.length + 1}`, type: 'FRACTALS', name: 'Williams Fractals', period: 5, source: 'high', visible: true },
    ]);
  }, [indicators, onChange]);

  const addMarketStructure = useCallback(() => {
    const n = indicators.filter(isMarketStructure).length + 1;
    onChange([
      ...indicators,
      {
        id: n === 1 ? 'market-structure-main' : `market-structure-${n}`,
        type: 'MARKET_STRUCTURE',
        name: n === 1 ? 'Market Structure' : `Market Structure ${n}`,
        leftBars: 2,
        rightBars: 2,
        visible: true,
      },
    ]);
  }, [indicators, onChange]);

  const addFvg = useCallback(() => {
    const n = indicators.filter(isFvg).length + 1;
    onChange([
      ...indicators,
      {
        id: n === 1 ? 'fvg-main' : `fvg-${n}`,
        type: 'FVG',
        name: n === 1 ? 'Fair Value Gap' : `Fair Value Gap ${n}`,
        visible: true,
      },
    ]);
  }, [indicators, onChange]);

  const addOrderBlock = useCallback(() => {
    const firstAtr = indicators.find((indicator) => indicator.type === 'ATR');
    if (!firstAtr) return;
    const n = indicators.filter(isOrderBlock).length + 1;
    onChange([
      ...indicators,
      {
        id: n === 1 ? 'order-block-main' : `order-block-${n}`,
        type: 'ORDER_BLOCK',
        name: n === 1 ? 'Order Block' : `Order Block ${n}`,
        lookback: 5,
        displacementMultiplier: 1,
        atrIndicatorId: firstAtr.id,
        visible: true,
      },
    ]);
  }, [indicators, onChange]);

  const update = useCallback(
    (id: string, patch: Partial<IndicatorDefinition>) => {
      onChange(indicators.map((indicator) => (
        indicator.id === id ? ({ ...indicator, ...patch } as IndicatorDefinition) : indicator
      )));
    },
    [indicators, onChange]
  );

  const isReferencedAtr = useCallback(
    (id: string) => indicators.some((indicator) => isOrderBlock(indicator) && indicator.atrIndicatorId === id),
    [indicators]
  );

  const remove = useCallback(
    (id: string) => {
      const indicator = indicators.find((entry) => entry.id === id);
      if (!indicator || indicators.length <= 1 || (indicator.type === 'ATR' && isReferencedAtr(id))) return;
      onChange(indicators.filter((entry) => entry.id !== id));
    },
    [indicators, isReferencedAtr, onChange]
  );

  return (
    <div className="min-w-0 space-y-4" data-qa="lab-indicators-panel">
      <div>
        <label className="mb-1 block text-[11px] tracking-wider text-slate-400">Название стратегии</label>
        <input
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          disabled={disabled}
          aria-label="Название стратегии"
          data-lab-tutorial="strategy-name"
          className={`w-full ${inputCls}`}
        />
      </div>

      <section className="rounded-lg border border-white/[.08] bg-surface-1 p-3" data-lab-tutorial="indicator-settings">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <h3 className="text-[12px] font-bold tracking-wider text-slate-200">ИНДИКАТОРЫ</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addEma} disabled={disabled} data-lab-tutorial="add-indicator" data-qa="lab-add-ema" className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> EMA</button>
            <button type="button" onClick={addAtr} disabled={disabled} data-qa="lab-add-atr" className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> ATR</button>
            <button type="button" onClick={addRsi} disabled={disabled} data-qa="lab-add-rsi" className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> RSI</button>
            <button type="button" onClick={addFractals} disabled={disabled} data-qa="lab-add-fractals" className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Фракталы</button>
            <button type="button" onClick={addMarketStructure} disabled={disabled} data-qa="lab-add-market-structure" className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Market Structure</button>
            <button type="button" onClick={addFvg} disabled={disabled} data-qa="lab-add-fvg" className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Fair Value Gap</button>
            <button
              type="button"
              onClick={addOrderBlock}
              disabled={disabled || !hasAtr}
              data-qa="lab-add-order-block"
              title={hasAtr ? 'Добавить Order Block' : 'Для Order Block сначала добавьте индикатор ATR.'}
              className="inline-flex items-center gap-1 rounded border border-cyan-400/30 px-2.5 py-1 text-[12px] text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Order Block
            </button>
          </div>
        </div>

        {!hasAtr && <p className="mb-3 text-[11px] text-amber-300">Для Order Block сначала добавьте индикатор ATR.</p>}
        <p className="mb-3 text-[11px] text-slate-400">Период и источник задаются только здесь. В коде используйте идентификатор «Код:» — он привязан к индикатору навсегда и не меняется при переименовании.</p>

        <div className="space-y-3">
          {bindings.map(({ identifier, indicator }) => {
            const referencedAtr = indicator.type === 'ATR' && isReferencedAtr(indicator.id);
            const deleteDisabled = disabled || indicators.length <= 1 || referencedAtr;
            return (
              <div key={indicator.id} data-qa="lab-indicator-row" className="rounded-md border border-white/[.07] bg-surface-2/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-bold text-cyan-300">{indicator.type === 'ORDER_BLOCK' ? 'ORDER BLOCK' : indicator.type === 'MARKET_STRUCTURE' ? 'MARKET STRUCTURE' : indicator.type === 'FVG' ? 'FAIR VALUE GAP' : indicator.type}</span>
                  <span className="text-[11px] text-slate-400">Код:</span>
                  <button type="button" onClick={() => copyIdentifier(identifier)} data-qa="lab-indicator-identifier" aria-label={`Копировать идентификатор ${identifier}`} title="Нажмите, чтобы скопировать идентификатор для кода стратегии" className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300 hover:bg-slate-800">
                    <code>{identifier}</code>
                    {copied === identifier ? <Check className="h-3 w-3 text-emerald-400" aria-hidden /> : <Copy className="h-3 w-3 text-slate-400" aria-hidden />}
                    <span className="sr-only">{copied === identifier ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                  <button type="button" onClick={() => remove(indicator.id)} disabled={deleteDisabled} aria-label={`Удалить индикатор ${indicator.name || indicator.id}`} title={referencedAtr ? 'ATR используется в настройках Order Block.' : 'Удалить индикатор'} className="ml-auto rounded p-1 text-slate-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>

                {isOrderBlock(indicator) ? (
                  <>
                    <p className="mb-3 text-[11px] text-slate-400">Order Block подтверждается сильным импульсом после противоположной свечи.</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div><label className="mb-1 block text-[11px] text-slate-400">Название</label><input type="text" value={indicator.name ?? ''} onChange={(event) => update(indicator.id, { name: event.target.value })} disabled={disabled} aria-label={`Название индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      <div><label className="mb-1 block text-[11px] text-slate-400" title="Сколько предыдущих свечей проверять для поиска последней противоположной свечи.">Lookback</label><LabNumericInput value={indicator.lookback} onChange={(lookback) => update(indicator.id, { lookback } as Partial<IndicatorDefinition>)} min={1} max={20} integer disabled={disabled} aria-label={`Lookback индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      <div><label className="mb-1 block text-[11px] text-slate-400" title="Тело свечи подтверждения должно быть не меньше указанной доли ATR.">Displacement ATR</label><LabNumericInput value={indicator.displacementMultiplier} onChange={(displacementMultiplier) => update(indicator.id, { displacementMultiplier } as Partial<IndicatorDefinition>)} min={0.1} max={10} step={0.1} disabled={disabled} aria-label={`Displacement ATR индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      <div><label className="mb-1 block text-[11px] text-slate-400" title="Этот ATR используется для оценки силы импульса Order Block.">ATR для импульса</label><select value={indicator.atrIndicatorId} onChange={(event) => update(indicator.id, { atrIndicatorId: event.target.value } as Partial<IndicatorDefinition>)} disabled={disabled} aria-label={`ATR для импульса ${identifier}`} className={`w-full ${inputCls}`}>{atrBindings.map((binding) => <option key={binding.indicator.id} value={binding.indicator.id}>{binding.indicator.name || 'ATR'} — {binding.identifier}</option>)}</select></div>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={indicator.visible ?? false} onChange={(event) => update(indicator.id, { visible: event.target.checked })} disabled={disabled} aria-label={`Показывать на графике ${identifier}`} />Показывать на графике</label>
                    <p className="mt-1 text-[11px] text-slate-500">Скрывает зоны только на графике. Расчёт стратегии не меняется.</p>
                  </>
                ) : isFvg(indicator) ? (
                  <>
                    <p className="mb-3 text-[11px] text-slate-400">Fair Value Gap — трёхсвечный разрыв: бычий, когда low свечи C выше high свечи A; медвежий — зеркально. Параметров расчёта нет: геометрия фиксирована, зона подтверждается только закрытием свечи C.</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div><label className="mb-1 block text-[11px] text-slate-400">Название</label><input type="text" value={indicator.name ?? ''} onChange={(event) => update(indicator.id, { name: event.target.value })} disabled={disabled} aria-label={`Название индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={indicator.visible ?? false} onChange={(event) => update(indicator.id, { visible: event.target.checked })} disabled={disabled} aria-label={`Показывать на графике ${identifier}`} />Показывать на графике</label>
                    <p className="mt-1 text-[11px] text-slate-500">Скрывает зоны только на графике. Расчёт стратегии не меняется.</p>
                  </>
                ) : isMarketStructure(indicator) ? (
                  <>
                    <p className="mb-3 text-[11px] text-slate-400">Структура рынка строится по подтверждённым swing-максимумам и минимумам. Swing-точка становится доступна стратегии только после подтверждения правыми свечами.</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div><label className="mb-1 block text-[11px] text-slate-400">Название</label><input type="text" value={indicator.name ?? ''} onChange={(event) => update(indicator.id, { name: event.target.value })} disabled={disabled} aria-label={`Название индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      <div><label className="mb-1 block text-[11px] text-slate-400">Левые свечи</label><LabNumericInput value={indicator.leftBars} onChange={(leftBars) => update(indicator.id, { leftBars } as Partial<IndicatorDefinition>)} min={1} max={10} integer disabled={disabled} aria-label={`Левые свечи индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      <div><label className="mb-1 block text-[11px] text-slate-400">Правые свечи</label><LabNumericInput value={indicator.rightBars} onChange={(rightBars) => update(indicator.id, { rightBars } as Partial<IndicatorDefinition>)} min={1} max={10} integer disabled={disabled} aria-label={`Правые свечи индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={indicator.visible ?? false} onChange={(event) => update(indicator.id, { visible: event.target.checked })} disabled={disabled} aria-label={`Показывать на графике ${identifier}`} />Показывать на графике</label>
                    <p className="mt-1 text-[11px] text-slate-500">BOS — пробой уровня по закрытию в направлении текущей структуры. CHoCH — пробой по закрытию против текущей структуры.</p>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div><label className="mb-1 block text-[11px] text-slate-400">Название</label><input type="text" value={indicator.name ?? ''} onChange={(event) => update(indicator.id, { name: event.target.value })} disabled={disabled} aria-label={`Название индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      <div><label className="mb-1 block text-[11px] text-slate-400">Период</label><LabNumericInput value={indicator.period} onChange={(period) => update(indicator.id, { period })} min={1} max={1000} integer disabled={disabled} aria-label={`Период индикатора ${identifier}`} className={`w-full ${inputCls}`} /></div>
                      {(indicator.type === 'EMA' || indicator.type === 'RSI') && <div><label className="mb-1 block text-[11px] text-slate-400">Источник</label><select value={indicator.source ?? 'close'} onChange={(event) => update(indicator.id, { source: event.target.value as IndicatorSource })} disabled={disabled} aria-label={`Источник индикатора ${identifier}`} className={`w-full ${inputCls}`}>{SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select></div>}
                    </div>
                    {indicator.type === 'EMA' || indicator.type === 'FRACTALS' ? <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={indicator.visible ?? false} onChange={(event) => update(indicator.id, { visible: event.target.checked })} disabled={disabled} aria-label={`Показывать на графике ${identifier}`} />Показывать на графике</label> : <p className="mt-2 text-[11px] text-slate-500">{indicator.type === 'RSI' ? 'RSI используется для расчёта и не рисуется на ценовой шкале.' : 'ATR используется для расчёта стопа и не рисуется поверх цены.'}</p>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default LabIndicatorsPanel;
