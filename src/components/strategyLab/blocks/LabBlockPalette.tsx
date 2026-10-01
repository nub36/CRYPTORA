/**
 * CRYPTORA — Strategy Lab · палитра блоков (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * Открывается кнопкой «+ Блок». Категории и названия берутся из реестра, так
 * что палитра не может разойтись с валидатором и компилятором.
 *
 * Мобильность: крупные зоны нажатия, лист прокручивается, закрытие по кнопке
 * и по тапу вне панели.
 */

import React from 'react';
import { X } from 'lucide-react';
import {
  listBlocksByCategory,
  type BlockDefinition,
} from '@/services/strategyLab/graph/registry';
import type { BlockType } from '@/services/strategyLab/graph/types';
import { ACCENT_CLASSES } from './blockFlowAdapter';

export interface LabBlockPaletteProps {
  open: boolean;
  onClose: () => void;
  onPick: (type: BlockType) => void;
}

function portSummary(def: BlockDefinition): string {
  const inputs = def.inputs.map((p) => p.label).join(', ');
  const outputs = def.outputs.map((p) => p.label).join(', ');
  const parts: string[] = [];
  if (inputs) parts.push(`вход: ${inputs}`);
  if (outputs) parts.push(`выход: ${outputs}`);
  return parts.join(' · ');
}

export const LabBlockPalette: React.FC<LabBlockPaletteProps> = ({ open, onClose, onPick }) => {
  if (!open) return null;
  const groups = listBlocksByCategory();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрыть палитру блоков"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Палитра блоков"
        data-qa="lab-block-palette"
        className="relative max-h-[82vh] w-full max-w-[560px] overflow-y-auto rounded-t-xl border border-white/[0.1] bg-surface-elevated p-3 shadow-2xl sm:rounded-xl sm:p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold tracking-wide text-white">ДОБАВИТЬ БЛОК</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-white/[0.1] text-slate-300 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.category} data-qa={`lab-palette-group-${group.category}`}>
              <div className="mb-1.5 text-[11px] font-bold tracking-widest text-slate-400">
                {group.label}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.blocks.map((def) => {
                  const accent = ACCENT_CLASSES[def.accent];
                  return (
                    <button
                      key={def.type}
                      type="button"
                      data-qa={`lab-palette-block-${def.type}`}
                      onClick={() => onPick(def.type)}
                      className={`flex min-h-[56px] flex-col items-start gap-0.5 rounded-lg border ${accent.border} bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.07]`}
                    >
                      <span className={`text-[13px] font-semibold ${accent.text}`}>{def.label}</span>
                      <span className="text-[11px] leading-tight text-slate-400">
                        {portSummary(def) || 'без портов'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LabBlockPalette;
