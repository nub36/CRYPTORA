/**
 * Typography invariants (UX-цикл п. 3, docs/DESIGN_SYSTEM.md §4):
 *  - минимальный кегль 11px: text-[9px] / text-[10px] запрещены во всём src;
 *  - mono — только для чисел/тикеров: className не сочетает font-mono с uppercase-заголовком.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../src');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk(SRC);

describe('typography invariants', () => {
  it('no text below 11px anywhere in src', () => {
    const hits = files.flatMap((f) => (/text-\[(?:[1-9]|10)px\]/.test(readFileSync(f, 'utf8')) ? [f.replace(SRC, 'src')] : []));
    expect(hits).toEqual([]);
  });
  it('monospace is never combined with an uppercase heading class', () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1]!;
        if (cls.includes('font-mono') && cls.includes('uppercase')) hits.push(`${f.replace(SRC, 'src')}: ${cls}`);
      }
    }
    expect(hits).toEqual([]);
  });
  it('ALL CAPS headings are the exception, not the rule (≤ 20 uppercase utilities across src)', () => {
    const n = files.reduce((a, f) => a + (readFileSync(f, 'utf8').match(/\buppercase\b/g)?.length ?? 0), 0);
    expect(n).toBeLessThanOrEqual(20);
  });
});
