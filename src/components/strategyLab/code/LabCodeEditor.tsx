import React from 'react';
import type { CodeError } from '@/services/strategyLab/code/types';
import { LabCodeErrors } from './LabCodeErrors';

/** Compact safe-DSL hint kept beside the code editor, not a separate docs surface. */
export const LabCodeEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  errors?: CodeError[];
  showStatus?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, errors = [], showStatus = true, disabled }) => (
  <div className="min-w-0 rounded-lg border border-white/[.08] bg-slate-950 p-3">
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      data-qa="lab-code-editor"
      className="h-[300px] w-full resize-y overflow-x-auto whitespace-pre rounded bg-slate-950 p-3 font-mono text-sm leading-6 text-cyan-100 outline-none"
      aria-label="Код стратегии"
    />
    <p className="mt-2 text-[11px] leading-5 text-slate-400" data-qa="lab-code-composition-help">
      Логика: <code>all</code> — все условия, <code>any</code> — хотя бы одно условие, <code>not</code> — отрицание.
      {' '}Order Block: <code>insideBullishOrderBlock</code>/<code>insideBearishOrderBlock</code> — закрытие свечи внутри действующей зоны;
      {' '}<code>bullishOrderBlockRetest</code>/<code>bearishOrderBlockRetest</code> — первое возвращение цены в подтверждённую зону Order Block.
      {' '}Market Structure: <code>swingHigh</code>/<code>swingLow</code> — подтверждённые swing-точки; <code>bullishBOS</code>/<code>bearishBOS</code> — пробой по закрытию в направлении структуры; <code>bullishCHoCH</code>/<code>bearishCHoCH</code> — пробой по закрытию против структуры. Swing-точка доступна только после подтверждения правыми свечами.
    </p>
    {(showStatus || errors.length > 0) && <LabCodeErrors errors={errors} />}
  </div>
);
