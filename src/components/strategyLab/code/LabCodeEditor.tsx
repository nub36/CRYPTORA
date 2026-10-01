/**
 * CRYPTORA — Strategy Lab · редактор кода стратегии (RESEARCH ONLY)
 * Безопасный ограниченный язык: код разбирается собственным лексером/парсером,
 * никакого eval / new Function / VM.
 */
import React from 'react'; import {LabCodeErrors} from './LabCodeErrors'; import type {CodeError} from '@/services/strategyLab/code';
export const LabCodeEditor:React.FC<{value:string;onChange:(v:string)=>void;errors?:CodeError[];showStatus?:boolean;disabled?:boolean}> = ({value,onChange,errors=[],showStatus=true,disabled})=><div className="min-w-0 rounded-lg border border-white/[.08] bg-slate-950 p-3"><textarea value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} spellCheck={false} autoCapitalize="off" autoCorrect="off" data-qa="lab-code-editor" className="h-[300px] w-full resize-y overflow-x-auto whitespace-pre rounded bg-slate-950 p-3 font-mono text-sm leading-6 text-cyan-100 outline-none" aria-label="Код стратегии" /> {(showStatus || errors.length > 0) && <LabCodeErrors errors={errors}/>}</div>;
