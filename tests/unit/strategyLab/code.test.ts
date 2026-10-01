import { describe, expect, it } from 'vitest';
import { CODE_LIMITS } from '@/services/strategyLab/code/types';
import { parse } from '@/services/strategyLab/code/parser';
import { codeToGraph } from '@/services/strategyLab/code/toGraph';
import { graphToCode } from '@/services/strategyLab/code/fromGraph';
import { EMA_TREND_CODE } from '@/services/strategyLab/code/templates';

const attacks = ["process.env", "require('fs')", "import fs from 'fs'", "import('fs')", 'fetch("x")', 'while (true)', 'for (let i=0;i<1;i++) {}', 'eval("x")', 'new Function("x")', 'globalThis', 'window', 'this', 'CLOSE.foo', '{}', '[1,2]', 'RSI(CLOSE, 14)'];
describe('CODE-1 restricted language', () => {
 it('parses starter, comments, whitespace and references', () => { const r=parse(`// comment\n${EMA_TREND_CODE}`); expect(r.ok).toBe(true); });
 it('rejects security matrix', () => { for (const code of attacks) expect(parse(code).ok, code).toBe(false); });
 it('reports line and column', () => { const r=parse('strategy("x", () => {\n  RSI(CLOSE);\n});'); expect(r.ok).toBe(false); if(!r.ok) expect(r.errors[0]).toMatchObject({line:2}); });
 it('rejects limits', () => { expect(parse('x'.repeat(CODE_LIMITS.maxSourceLength+1)).ok).toBe(false); expect(parse('strategy("x",()=>{'+' const a=CLOSE;'.repeat(2100)+'});').ok).toBe(false); });
 it('is deterministic and roundtrips semantics', () => { const a=codeToGraph(EMA_TREND_CODE), b=codeToGraph(EMA_TREND_CODE); expect(a.graph).toEqual(b.graph); expect(a.graph).toBeTruthy(); const c=codeToGraph(graphToCode(a.graph!)); expect(c.graph?.nodes.map(n=>n.type).sort()).toEqual(a.graph?.nodes.map(n=>n.type).sort()); expect(c.graph?.nodes.filter(n=>n.type==='LONG').length).toBe(1); expect(c.graph?.nodes.filter(n=>n.type==='SHORT').length).toBe(1); });
});
