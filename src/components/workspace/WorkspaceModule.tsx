import React, { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import type { CoinWorkspaceModuleId } from '@/workspace/layout';

interface WorkspaceModuleProps {
  id: CoinWorkspaceModuleId;
  title: string;
  index: number;
  count: number;
  onMove: (id: CoinWorkspaceModuleId, dir: -1 | 1) => void;
  onDrop: (id: CoinWorkspaceModuleId, targetId: CoinWorkspaceModuleId) => void;
  children: React.ReactNode;
}

const DND_MIME = 'application/x-cryptora-workspace-module';

/**
 * Обёртка переставляемого модуля: drag-handle (HTML5 DnD) + клавиатурная альтернатива
 * (кнопки ▲/▼ и стрелки на фокусе ручки). Содержимое модуля не трогает.
 */
export const WorkspaceModule: React.FC<WorkspaceModuleProps> = ({ id, title, index, count, onMove, onDrop, children }) => {
  const [over, setOver] = useState(false);
  const canUp = index > 0;
  const canDown = index < count - 1;

  return (
    <section
      data-qa={`workspace-module-${id}`}
      data-workspace-module={id}
      aria-label={title}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!over) setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const src = e.dataTransfer.getData(DND_MIME) as CoinWorkspaceModuleId;
        setOver(false);
        if (src && src !== id) {
          e.preventDefault();
          onDrop(src, id);
        }
      }}
      className={`relative rounded-lg transition-shadow ${over ? 'ring-2 ring-brand-cyan/60 ring-offset-2 ring-offset-root' : ''}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <div
          role="button"
          tabIndex={0}
          draggable
          aria-label={`Переместить модуль «${title}» (позиция ${index + 1} из ${count}). Стрелки вверх/вниз — переставить`}
          title="Перетащите или используйте стрелки ↑/↓"
          data-qa={`workspace-handle-${id}`}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_MIME, id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && canUp) {
              e.preventDefault();
              onMove(id, -1);
            } else if (e.key === 'ArrowDown' && canDown) {
              e.preventDefault();
              onMove(id, 1);
            }
          }}
          className="flex cursor-grab select-none items-center gap-1.5 rounded px-1.5 py-1 text-[11px] font-sans text-slate-500 hover:bg-white/[0.05] hover:text-slate-300 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMove(id, -1)}
            disabled={!canUp}
            aria-label={`Модуль «${title}» выше`}
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(id, 1)}
            disabled={!canDown}
            aria-label={`Модуль «${title}» ниже`}
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {children}
    </section>
  );
};
