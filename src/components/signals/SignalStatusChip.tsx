/**
 * SignalStatusChip — человеческий статус сигнала + объяснение его источника.
 *
 * Статус берётся ИСКЛЮЧИТЕЛЬНО из серверного журнала. Фронтенд не проверяет
 * рынок и не «дорисовывает» состояние: если сервер не зафиксировал результат,
 * чип остаётся нейтральным и объясняет это (§10 Signals V2).
 */

import React, { useState } from 'react';
import { Badge } from '../common/Badge';
import { STATUS_SOURCE_NOTE, serverStatusLabel, serverStatusTone } from '@/utils/serverSignalText';

interface SignalStatusChipProps {
  status: string | null;
  /** Размер подписи (compact по умолчанию). */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const SignalStatusChip: React.FC<SignalStatusChipProps> = ({ status, size = 'xs', className = '' }) => {
  const [noteOpen, setNoteOpen] = useState(false);
  const label = status ? serverStatusLabel(status) : 'Статус не указан';
  const tone = status ? serverStatusTone(status) : 'neutral';

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <Badge variant={tone} size={size}>
        {label}
      </Badge>
      <button
        type="button"
        aria-label="Откуда берётся статус сигнала"
        aria-expanded={noteOpen}
        title={STATUS_SOURCE_NOTE}
        onClick={() => setNoteOpen((v) => !v)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-surface-border text-[11px] leading-none text-slate-500 transition-colors hover:border-surface-border-active hover:text-cyan-300"
      >
        i
      </button>
      {noteOpen && (
        <span className="ui-helper w-full" data-qa="signals-status-source-note">
          {STATUS_SOURCE_NOTE}
        </span>
      )}
    </span>
  );
};

export default SignalStatusChip;
