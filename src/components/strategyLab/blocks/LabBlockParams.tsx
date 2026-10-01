/**
 * CRYPTORA — Strategy Lab · параметры выбранного блока (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * Компактная панель: на мобильном — нижний лист, на десктопе — карточка рядом
 * с холстом. Числовые поля — существующий `LabNumericInput`, поэтому баг ввода
 * чисел (свободное стирание, «1.», «0.05») не возвращается.
 *
 * Изменения параметров правят ТОЛЬКО черновик графа — ни бэктеста, ни запросов
 * к серверу здесь не происходит.
 */

import React from 'react';
import { Trash2, X } from 'lucide-react';
import { BLOCK_REGISTRY } from '@/services/strategyLab/graph/registry';
import type { StrategyGraphNode } from '@/services/strategyLab/graph/types';
import { LabNumericInput } from '../LabNumericInput';

export interface LabBlockParamsProps {
  node: StrategyGraphNode | null;
  disabled?: boolean;
  onParamChange: (nodeId: string, paramId: string, value: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

export const LabBlockParams: React.FC<LabBlockParamsProps> = ({
  node,
  disabled = false,
  onParamChange,
  onDeleteNode,
  onClose,
}) => {
  if (!node) {
    return (
      <div
        data-qa="lab-block-params-empty"
        className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3 text-[12px] text-slate-400"
      >
        Выберите блок на холсте, чтобы изменить его параметры.
      </div>
    );
  }

  const def = BLOCK_REGISTRY[node.type];

  return (
    <div
      data-qa="lab-block-params"
      data-block-id={node.id}
      className="rounded-lg border border-white/[0.08] bg-surface-inset/40 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-white">{def.label}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">{node.id}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-qa="lab-block-delete"
            onClick={() => onDeleteNode(node.id)}
            disabled={disabled}
            aria-label={`Удалить блок ${def.label}`}
            className="flex h-9 min-w-[36px] items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 px-2 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Снять выделение блока"
            className="flex h-9 min-w-[36px] items-center justify-center rounded-md border border-white/[0.1] px-2 text-slate-300 hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {def.params.length === 0 ? (
        <p className="text-[12px] text-slate-400">У этого блока нет параметров.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {def.params.map((spec) => (
            <label key={spec.id} className="flex flex-col gap-1 text-[12px] text-slate-300">
              <span title={spec.description}>{spec.label}</span>
              <LabNumericInput
                value={node.params[spec.id]}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                integer={spec.integer}
                disabled={disabled}
                aria-label={`${def.label}: ${spec.label}`}
                onChange={(value) => onParamChange(node.id, spec.id, value)}
                className="min-h-[38px] rounded-md border border-white/[0.1] bg-surface-2 px-2 py-1.5 font-mono text-[13px] text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
              />
            </label>
          ))}
        </div>
      )}

      <p className="mt-2 border-t border-white/[0.08] pt-2 text-[11px] text-slate-500">
        {def.description}
      </p>
    </div>
  );
};

export default LabBlockParams;
