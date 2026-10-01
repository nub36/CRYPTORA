/**
 * CRYPTORA — Strategy Lab · переключатель режима авторинга (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * [ БЛОК-СХЕМА ] [ ПРОСТОЙ КОНСТРУКТОР ] [ КОД ]
 *
 * Существующий визуальный конструктор НЕ удаляется: это отдельный режим со
 * своим черновиком (`StrategyDraftDefinition`). Переключение режима НИКОГДА не
 * переинтерпретирует стратегию молча — каждый режим хранит собственный
 * черновик (§23).
 *
 * Режим «КОД» зарезервирован под CODE-1 и помечен как недоступный: архитектура
 * (список режимов, раздельные черновики, граф без зависимости от React Flow)
 * уже готова к его добавлению, парсер в этом PR не реализуется.
 */

import React from 'react';
import { Code2, Network, SlidersHorizontal } from 'lucide-react';
import type { LabAuthoringMode } from '@/services/strategyLab/graph/types';

export interface LabAuthoringModeOption {
  mode: LabAuthoringMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
  hint: string;
}

export const LAB_AUTHORING_MODE_OPTIONS: readonly LabAuthoringModeOption[] = Object.freeze([
  {
    mode: 'blocks',
    label: 'БЛОК-СХЕМА',
    icon: Network,
    available: true,
    hint: 'Узловой редактор: блоки и типизированные связи.',
  },
  {
    mode: 'simple',
    label: 'ПРОСТОЙ КОНСТРУКТОР',
    icon: SlidersHorizontal,
    available: true,
    hint: 'Прежний конструктор на формах — работает без изменений.',
  },
  {
    mode: 'code',
    label: 'КОД',
    icon: Code2,
    available: true,
    hint: 'Ограниченный декларативный язык стратегии.',
  },
]);

export interface LabAuthoringModeSwitchProps {
  mode: LabAuthoringMode;
  onChange: (mode: LabAuthoringMode) => void;
  disabled?: boolean;
}

export const LabAuthoringModeSwitch: React.FC<LabAuthoringModeSwitchProps> = ({
  mode,
  onChange,
  disabled = false,
}) => (
  <div
    role="tablist"
    aria-label="Режим создания стратегии"
    data-qa="lab-authoring-mode"
    className="flex w-full min-w-0 flex-wrap gap-1.5 rounded-lg border border-white/[0.08] bg-surface-inset/40 p-1.5"
  >
    {LAB_AUTHORING_MODE_OPTIONS.map((option) => {
      const Icon = option.icon;
      const active = option.mode === mode;
      return (
        <button
          key={option.mode}
          type="button"
          role="tab"
          aria-selected={active}
          aria-disabled={!option.available}
          title={option.hint}
          data-qa={`lab-authoring-mode-${option.mode}`}
          disabled={disabled || !option.available}
          onClick={() => option.available && onChange(option.mode)}
          className={[
            'flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-bold tracking-wide transition-colors',
            active
              ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/40'
              : 'text-slate-400 hover:bg-white/[0.05]',
            !option.available ? 'cursor-not-allowed opacity-45' : '',
          ].join(' ')}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{option.label}</span>
          {!option.available && <span className="text-[11px] font-normal">скоро</span>}
        </button>
      );
    })}
  </div>
);

export default LabAuthoringModeSwitch;
