/**
 * CRYPTORA — Strategy Lab · блок на холсте (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * Один React-компонент рисует ЛЮБОЙ блок, но форма блока (порты, параметры,
 * цвет) целиком берётся из реестра: это не «универсальный блок с dropdown», а
 * отрисовка конкретного типа. Добавление нового типа блока не требует правок
 * здесь — только записи в реестре.
 *
 * Мобильность (§4, §26): у каждого порта крупная зона нажатия (≥20px) и
 * обработчик tap. Никакой функциональности «только по наведению» нет —
 * всё доступно и мышью, и пальцем.
 */

import React, { createContext, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BLOCK_REGISTRY } from '@/services/strategyLab/graph/registry';
import type { GraphEndpoint, PortDirection } from '@/services/strategyLab/graph/types';
import {
  ACCENT_CLASSES,
  PORT_TYPE_COLORS,
  encodeHandleId,
  endpointHighlightKey,
  type LabBlockFlowNode,
} from './blockFlowAdapter';

export interface BlockInteractionContextValue {
  /** Активный выход в режиме tap-to-connect (мобильный сценарий). */
  pendingFrom: GraphEndpoint | null;
  /** Ключи входов, в которые МОЖНО соединить активный выход. */
  highlighted: ReadonlySet<string>;
  onPortTap: (endpoint: GraphEndpoint, direction: PortDirection) => void;
  disabled: boolean;
}

const DEFAULT_INTERACTION: BlockInteractionContextValue = {
  pendingFrom: null,
  highlighted: new Set<string>(),
  onPortTap: () => {},
  disabled: false,
};

export const BlockInteractionContext =
  createContext<BlockInteractionContextValue>(DEFAULT_INTERACTION);

export function useBlockInteraction(): BlockInteractionContextValue {
  return useContext(BlockInteractionContext);
}

const PORT_HIT_SIZE = 22;

export const LabBlockNode: React.FC<NodeProps<LabBlockFlowNode>> = ({ id, data, selected }) => {
  const def = BLOCK_REGISTRY[data.blockType];
  const accent = ACCENT_CLASSES[def.accent];
  const { pendingFrom, highlighted, onPortTap, disabled } = useBlockInteraction();

  const handleStyle = (color: string, active: boolean): React.CSSProperties => ({
    position: 'relative',
    width: PORT_HIT_SIZE,
    height: PORT_HIT_SIZE,
    minWidth: PORT_HIT_SIZE,
    minHeight: PORT_HIT_SIZE,
    borderRadius: 9999,
    background: active ? color : 'rgba(15,23,42,0.9)',
    border: `2px solid ${color}`,
    boxShadow: active ? `0 0 0 4px ${color}33` : 'none',
    transform: 'none',
    top: 'auto',
    left: 'auto',
    right: 'auto',
    bottom: 'auto',
  });

  return (
    <div
      data-qa="lab-block-node"
      data-block-type={data.blockType}
      data-block-id={id}
      className={[
        'min-w-[164px] max-w-[232px] rounded-lg border bg-surface-2/95 shadow-lg backdrop-blur-sm',
        data.invalid ? 'border-rose-500/70 ring-1 ring-rose-500/40' : accent.border,
        selected ? 'ring-2 ring-cyan-400/70' : '',
      ].join(' ')}
    >
      <div
        className={`flex items-center justify-between gap-2 rounded-t-[7px] px-2.5 py-1.5 ${accent.header}`}
      >
        <span className={`truncate text-[12px] font-bold tracking-wide ${accent.text}`}>
          {def.label}
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} aria-hidden="true" />
      </div>

      {def.params.length > 0 && (
        <div className="border-b border-white/[0.06] px-2.5 py-1.5">
          {def.params.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-400">{p.label}</span>
              <span className="font-mono text-slate-100" data-qa={`lab-block-param-${p.id}`}>
                {data.params[p.id]}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 px-1.5 py-2">
        {def.inputs.map((port) => {
          const key = endpointHighlightKey({ nodeId: id, port: port.id });
          const isTarget = highlighted.has(key);
          const color = PORT_TYPE_COLORS[port.type];
          return (
            <div
              key={`in-${port.id}`}
              className={[
                'flex items-center gap-2 rounded-md py-0.5 pr-2',
                isTarget ? 'bg-cyan-400/10 ring-1 ring-cyan-400/60' : '',
              ].join(' ')}
            >
              <Handle
                type="target"
                id={encodeHandleId('input', port.id)}
                position={Position.Left}
                isConnectable={!disabled}
                style={handleStyle(color, isTarget)}
                data-qa="lab-block-port"
                data-port-direction="input"
                data-port-id={port.id}
                data-port-node={id}
                data-port-compatible={isTarget ? 'true' : 'false'}
                aria-label={`Вход ${port.label} блока ${def.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPortTap({ nodeId: id, port: port.id }, 'input');
                }}
              />
              <span className="truncate text-[11px] text-slate-300">{port.label}</span>
            </div>
          );
        })}

        {def.outputs.map((port) => {
          const isPending =
            pendingFrom != null && pendingFrom.nodeId === id && pendingFrom.port === port.id;
          const color = PORT_TYPE_COLORS[port.type];
          return (
            <div
              key={`out-${port.id}`}
              className={[
                'flex items-center justify-end gap-2 rounded-md py-0.5 pl-2',
                isPending ? 'bg-cyan-400/10 ring-1 ring-cyan-400/60' : '',
              ].join(' ')}
            >
              <span className="truncate text-[11px] text-slate-300">{port.label}</span>
              <Handle
                type="source"
                id={encodeHandleId('output', port.id)}
                position={Position.Right}
                isConnectable={!disabled}
                style={handleStyle(color, isPending)}
                data-qa="lab-block-port"
                data-port-direction="output"
                data-port-id={port.id}
                data-port-node={id}
                data-port-pending={isPending ? 'true' : 'false'}
                aria-label={`Выход ${port.label} блока ${def.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPortTap({ nodeId: id, port: port.id }, 'output');
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LabBlockNode;
