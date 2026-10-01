import React from 'react'; import type { CodeError } from '@/services/strategyLab/code';
export const LabCodeErrors:React.FC<{errors:CodeError[]}> = ({errors}) => errors.length ? <div className="mt-2 space-y-1 text-xs text-rose-300">{errors.map((e,i)=><div key={i}>Строка {e.line}, столбец {e.column}: {e.message}</div>)}</div> : <div className="mt-2 text-xs text-emerald-300">✓ Код корректен</div>;
