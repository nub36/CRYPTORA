/**
 * CODE-FIRST LAB · безопасный язык стратегии (грамматика v2) + компилятор
 * черновика «индикаторы + код».
 */
import { describe, expect, it } from 'vitest';
import { CODE_LIMITS } from '@/services/strategyLab/code/types';
import { parse } from '@/services/strategyLab/code/parser';
import {
  DEFAULT_STRATEGY_CODE,
  CODE_API_VERSION,
  buildStarterCode,
} from '@/services/strategyLab/code/templates';
import {
  compileResearchDraft,
  defaultResearchDraft,
  indicatorIdentifier,
  buildIndicatorBindings,
  RESEARCH_DRAFT_API_VERSION,
} from '@/services/strategyLab/draft';

const attacks = [
  'process.env',
  "require('fs')",
  "import fs from 'fs'",
  "import('fs')",
  'fetch("x")',
  'while (true)',
  'for (let i=0;i<1;i++) {}',
  'eval("x")',
  'new Function("x")',
  'globalThis',
  'window',
  'this',
  'CLOSE.foo',
  '{}',
  '[1,2]',
  'RSI(CLOSE, 14)',
];

describe('M. безопасный ограниченный язык (грамматика v2)', () => {
  it('разбирает стартовый код, комментарии и ссылки на индикаторы', () => {
    expect(parse(`// комментарий\n${DEFAULT_STRATEGY_CODE}`).ok).toBe(true);
  });

  it('отклоняет матрицу атак', () => {
    for (const code of attacks) expect(parse(code).ok, code).toBe(false);
  });

  it('сообщает строку и столбец', () => {
    const r = parse('strategy("x", () => {\n  RSI(EMA_FAST);\n});');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ line: 2 });
  });

  it('держит лимиты исходника и токенов', () => {
    expect(parse('x'.repeat(CODE_LIMITS.maxSourceLength + 1)).ok).toBe(false);
    expect(parse('strategy("x",()=>{' + ' const a=EMA_FAST;'.repeat(2100) + '});').ok).toBe(false);
  });

  it('объявление индикатора в коде запрещено — период задаётся в UI', () => {
    const r = parse('strategy("x", () => {\n  const f = EMA(CLOSE, 20);\n});');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('ИНДИКАТОРЫ');
  });
});

describe('F/G/H. индикаторы ↔ код', () => {
  it('H. стартовый черновик компилируется без ошибок', () => {
    const draft = defaultResearchDraft();
    expect(draft.apiVersion).toBe(RESEARCH_DRAFT_API_VERSION);
    expect(CODE_API_VERSION).toBe(2);
    const compiled = compileResearchDraft(draft);
    expect(compiled.errors).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(compiled.definition).toMatchObject({
      long: { left: 'ema-fast', operator: 'crossesAbove', right: 'ema-slow' },
      short: { left: 'ema-fast', operator: 'crossesBelow', right: 'ema-slow' },
      stop: { type: 'atrMultiple', indicatorId: 'atr-main', multiplier: 1.5 },
      target: { type: 'rMultiple', multiple: 2 },
    });
  });

  it('F. код использует периоды из настроек индикаторов (без дублирования)', () => {
    const draft = defaultResearchDraft();
    draft.indicators[0].period = 7;
    draft.indicators[2].period = 21;
    const compiled = compileResearchDraft(draft);
    expect(compiled.definition?.indicators.find((i) => i.id === 'ema-fast')?.period).toBe(7);
    expect(compiled.definition?.indicators.find((i) => i.id === 'atr-main')?.period).toBe(21);
  });

  it('идентификаторы генерируются безопасно и детерминированно', () => {
    expect(indicatorIdentifier('ema-fast')).toBe('EMA_FAST');
    expect(indicatorIdentifier('atr main 14')).toBe('ATR_MAIN_14');
    expect(indicatorIdentifier('1x')).toBe('IND_1X');
    const bindings = buildIndicatorBindings([
      { id: 'ema-fast', type: 'EMA', period: 10 },
      { id: 'ema_fast', type: 'EMA', period: 20 },
    ]);
    expect(bindings.map((b) => b.identifier)).toEqual(['EMA_FAST', 'EMA_FAST_2']);
  });

  it('G. ссылка на несуществующий индикатор отклоняется по-русски', () => {
    const draft = defaultResearchDraft();
    draft.sourceCode = draft.sourceCode.replace('EMA_SLOW', 'EMA_MISSING');
    const compiled = compileResearchDraft(draft);
    expect(compiled.ok).toBe(false);
    expect(compiled.errors[0].message).toContain('EMA_MISSING');
    expect(compiled.errors[0].message).toContain('Неизвестная ссылка');
  });

  it('неверный тип индикатора отклоняется', () => {
    const draft = defaultResearchDraft();
    draft.sourceCode = draft.sourceCode.replace('multiply(ATR_MAIN, 1.5)', 'multiply(EMA_FAST, 1.5)');
    const compiled = compileResearchDraft(draft);
    expect(compiled.ok).toBe(false);
    expect(compiled.errors[0].message).toContain('ожидается ATR');
  });

  it('некорректные стоп/цель отклоняются', () => {
    const bad = defaultResearchDraft();
    bad.sourceCode = bad.sourceCode.replace('R(2)', 'R(0)');
    expect(compileResearchDraft(bad).ok).toBe(false);

    const noStop = defaultResearchDraft();
    noStop.sourceCode = noStop.sourceCode.replace('  STOP(multiply(ATR_MAIN, 1.5));\n', '');
    const r = compileResearchDraft(noStop);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('STOP');
  });

  it('детерминирован', () => {
    const a = compileResearchDraft(defaultResearchDraft());
    const b = compileResearchDraft(defaultResearchDraft());
    expect(a.definition).toEqual(b.definition);
  });
});

describe('3. стартовый шаблон ↔ идентификаторы карточек индикаторов', () => {
  it('шаблон ссылается РОВНО на идентификаторы, показанные в UI, и компилируется без ошибок', () => {
    const draft = defaultResearchDraft();
    const shown = buildIndicatorBindings(draft.indicators).map((b) => b.identifier);
    expect(shown).toEqual(['EMA_FAST', 'EMA_SLOW', 'ATR_MAIN']);

    // Каждый идентификатор из кода существует среди показанных (без ATR/atr-main рассинхрона).
    const codeWithoutStrings = draft.sourceCode.replace(/"[^"]*"/g, '""');
    const referenced = Array.from(new Set(codeWithoutStrings.match(/\b[A-Z][A-Z0-9_]*\b/g) ?? []))
      .filter((t) => !['LONG', 'SHORT', 'STOP', 'TAKE_PROFIT', 'R'].includes(t));
    expect(referenced.sort()).toEqual([...shown].sort());
    for (const id of shown) expect(DEFAULT_STRATEGY_CODE).toContain(id);

    expect(compileResearchDraft(draft).errors).toEqual([]);
  });

  it('4. сброс стратегии даёт дефолтные индикаторы + согласованный стартовый код', () => {
    const fresh = defaultResearchDraft('Новая стратегия');
    expect(fresh.sourceCode).toBe(buildStarterCode('Новая стратегия'));
    expect(fresh.sourceCode).toContain('strategy("Новая стратегия"');
    expect(fresh.indicators.map((i) => i.id)).toEqual(['ema-fast', 'ema-slow', 'atr-main']);
    expect(compileResearchDraft(fresh).ok).toBe(true);
    expect(JSON.stringify(fresh)).not.toMatch(/authoringMode|graph|nodes|edges/i);
  });

  it('1. переименование подписи НЕ меняет идентификатор и не ломает код', () => {
    const draft = defaultResearchDraft();
    const before = buildIndicatorBindings(draft.indicators).map((b) => b.identifier);
    const renamed = {
      ...draft,
      indicators: draft.indicators.map((i) => ({ ...i, name: `Переименовано ${i.id}` })),
    };
    const after = buildIndicatorBindings(renamed.indicators).map((b) => b.identifier);
    expect(after).toEqual(before);
    const compiled = compileResearchDraft(renamed);
    expect(compiled.ok).toBe(true);
    expect(compiled.definition?.stop.indicatorId).toBe('atr-main');
  });
});
