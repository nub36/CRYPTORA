import { lex } from './lexer';
import type { Expr, ParseResult, Statement } from './types';
/* Грамматика v2: индикаторы объявляются в UI, вызовов EMA()/ATR() в коде нет. */
const calls = new Set(['crossesAbove','crossesBelow','multiply','R']);
const legacyIndicatorCalls = new Set(['EMA','ATR']);
const actions = new Set(['LONG','SHORT','STOP','TAKE_PROFIT']);
export function parse(source: string): ParseResult {
 const result=lex(source); if(result.errors.length) return {ok:false,errors:result.errors}; const ts=result.tokens!; let i=0; const errors:any[]=[];
 const peek=()=>ts[i]; const take=()=>ts[i++]; const expect=(v:string)=>{if(peek().value!==v){errors.push({line:peek().line,column:peek().column,message:`Ожидался символ «${v}».`});return false}take();return true};
 const expression=():Expr|null=>{const t=take(); if(t.kind==='number') return {kind:'number',value:Number(t.value)}; if(t.kind!=='identifier'){errors.push({line:t.line,column:t.column,message:'Ожидалось выражение.'});return null} if(peek().value==='('){if(!calls.has(t.value)){errors.push({line:t.line,column:t.column,message:legacyIndicatorCalls.has(t.value)?`Индикатор «${t.value}» настраивается в разделе «ИНДИКАТОРЫ»; в коде используйте его имя без вызова.`:`Неизвестная функция «${t.value}».`});return null} take();const args:Expr[]=[];if(peek().value!==')'){while(true){const e=expression();if(e)args.push(e);if(peek().value!==',')break;take()}}expect(')');return {kind:'call',callee:t.value,args}} return {kind:'identifier',name:t.value};};
 if(!expect('strategy')||!expect('(')){return {ok:false,errors}} const name=take();if(name.kind!=='string')errors.push({line:name.line,column:name.column,message:'Ожидалось название стратегии.'}); expect(',');expect('(');expect(')');expect('=');expect('>');expect('{');const statements:Statement[]=[];
 while(peek().value!=='}'&&peek().kind!=='eof'){const t=take();if(t.value==='const'){const n=take();if(n.kind!=='identifier')errors.push({line:n.line,column:n.column,message:'Ожидалось имя переменной.'});expect('=');const e=expression();if(e)statements.push({kind:'const',name:n.value,expression:e});expect(';');} else if(actions.has(t.value)){expect('(');const e=expression();expect(')');expect(';');if(e)statements.push({kind:'action',action:t.value as any,expression:e});} else errors.push({line:t.line,column:t.column,message:`Неизвестная инструкция «${t.value}».`});}
 expect('}');expect(')');expect(';');if(peek().kind!=='eof')errors.push({line:peek().line,column:peek().column,message:'Недопустимый код после стратегии.'});return errors.length?{ok:false,errors}:{ok:true,program:{name:name.value,statements}};
}
