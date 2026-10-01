import { CODE_LIMITS, type CodeError } from './types';
export type Token = { kind: 'identifier'|'number'|'string'|'symbol'|'eof'; value: string; line: number; column: number };
export function lex(source: string): { tokens?: Token[]; errors: CodeError[] } {
 if (source.length > CODE_LIMITS.maxSourceLength) return { errors: [{line:1,column:1,message:`Код превышает лимит ${CODE_LIMITS.maxSourceLength} байт.`}] };
 const out: Token[]=[]; const errors: CodeError[]=[]; let i=0,line=1,col=1;
 const advance=(n=1)=>{while(n--){if(source[i++]==='\n'){line++;col=1}else col++}};
 while(i<source.length){const c=source[i]; if(/\s/.test(c)){advance();continue} if(c==='/'&&source[i+1]==='/'){while(i<source.length&&source[i] !== '\n')advance();continue}
  const l=line, p=col; if(/[A-Za-z_$]/.test(c)){let s='';while(i<source.length&&/[A-Za-z0-9_$]/.test(source[i])){s+=source[i];advance()}out.push({kind:'identifier',value:s,line:l,column:p});continue}
  if(/[0-9]/.test(c)||c==='.'&&/[0-9]/.test(source[i+1])){let s='';while(i<source.length&&/[0-9.eE+-]/.test(source[i])&&!(/[+-]/.test(source[i])&&!/[eE]/.test(source[i-1]))) {s+=source[i];advance()} if(!Number.isFinite(Number(s)))errors.push({line:l,column:p,message:'Некорректное число.'}); else out.push({kind:'number',value:s,line:l,column:p});continue}
  if(c==='"'||c==="'"){const q=c;advance();let s='';while(i<source.length&&source[i]!==q){if(source[i]==='\n'){errors.push({line:l,column:p,message:'Незакрытая строка.'});break}s+=source[i];advance()} if(source[i]===q)advance();out.push({kind:'string',value:s,line:l,column:p});continue}
  if('{}();=,>'.includes(c)){out.push({kind:'symbol',value:c,line:l,column:p});advance();continue}
  errors.push({line:l,column:p,message:`Недопустимый символ «${c}».`});advance();
  if(errors.length>50)break;
 }
 out.push({kind:'eof',value:'',line,column:col}); if(out.length>CODE_LIMITS.maxTokens)return {errors:[{line:1,column:1,message:`Слишком много токенов (лимит ${CODE_LIMITS.maxTokens}).`}]}; return {tokens:out,errors};
}
