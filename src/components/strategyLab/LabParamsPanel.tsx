/**
 * CRYPTORA — Strategy Lab · панель параметров (frontend, RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Поля строятся ИЗ описателей выбранной стратегии (registry.fields).
 * Числовые поля используют LabNumericInput для корректного редактирования.
 */

import React from 'react';
import type { LabStrategyMeta, LabParamGroup } from '@/services/strategyLab/registry';
import type { ResearchConfig } from '@/services/strategyLab/types';
import { LabNumericInput } from './LabNumericInput';

const GROUP_TITLES: Record<LabParamGroup, string> = {
  indicators: 'Индикаторы',
  strategy: 'Параметры стратегии',
  execution: 'Исполнение',
};

const GROUP_ORDER: LabParamGroup[] = ['indicators', 'strategy', 'execution'];

function readValue(config: ResearchConfig, path: string): number {
  const [group, key] = path.split('.') as [keyof ResearchConfig, string];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config[group] as any)[key] as number;
}

interface LabParamsPanelProps {
  strategy: LabStrategyMeta | null;
  config: ResearchConfig;
  onChange: (path: string, value: number) => void;
  disabled?: boolean;
}

export const LabParamsPanel: React.FC<LabParamsPanelProps> = ({
  strategy,
  config,
  onChange,
  disabled,
}) => {
  if (!strategy) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-4 text-sm text-slate-400">
        Стратегия не выбрана.
      </div>
    );
  }

  return (
    <div
      data-lab-tutorial="research-parameters"
      className="space-y-4 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-white">Настройки стратегии</h3>
        <p className="mt-0.5 text-[11px] text-slate-400">{strategy.summary}</p>
      </div>

      {GROUP_ORDER.map((group) => {
        const fields = strategy.fields.filter((f) => f.group === group);
        if (fields.length === 0) return null;
        return (
          <div key={group} className="space-y-2">
            <div className="text-[11px] font-bold tracking-wide text-slate-400">
              {GROUP_TITLES[group]}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {fields.map((f) => (
                <label key={f.path} className="flex flex-col gap-1 text-[12px] text-slate-300">
                  <span title={f.description}>{f.label}</span>
                  <LabNumericInput
                    min={f.min}
                    max={f.max}
                    step={f.integer ? 1 : f.step}
                    integer={f.integer}
                    value={readValue(config, f.path)}
                    disabled={disabled}
                    onChange={(val) => onChange(f.path, val)}
                    className="rounded-md border border-white/[0.1] bg-surface-2 px-2 py-1.5 font-mono text-[13px] text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}

      <p className="border-t border-white/[0.08] pt-3 text-[11px] text-slate-500">
        Значения проверяются и применяются на сервере. Фронтенд ничего не рассчитывает.
      </p>
    </div>
  );
};
