import { lex } from './lexer';
import type { Expr, ParseResult, Statement } from './types';

/* Грамматика v2: индикаторы объявляются в UI, вызовов EMA()/ATR() в коде нет. */
const calls = new Set([
  'crossesAbove', 'crossesBelow', 'above', 'below', 'fractalHigh', 'fractalLow',
  'bullishOrderBlock', 'bearishOrderBlock',
  'insideBullishOrderBlock', 'insideBearishOrderBlock',
  'bullishOrderBlockRetest', 'bearishOrderBlockRetest',
  'bullishFvg', 'bearishFvg',
  'insideBullishFvg', 'insideBearishFvg',
  'bullishFvgRetest', 'bearishFvgRetest',
  'swingHigh', 'swingLow', 'bullishBOS', 'bearishBOS', 'bullishCHoCH', 'bearishCHoCH',
  'all', 'any', 'not', 'multiply', 'R',
]);
const legacyIndicatorCalls = new Set(['EMA', 'ATR']);
const actions = new Set(['LONG', 'SHORT', 'STOP', 'TAKE_PROFIT']);

/** Parser guard independent of the stricter canonical condition-tree limit. */
const MAX_EXPRESSION_DEPTH = 64;

export function parse(source: string): ParseResult {
  const result = lex(source);
  if (result.errors.length) return { ok: false, errors: result.errors };

  const tokens = result.tokens!;
  let index = 0;
  const errors: Array<{ line: number; column: number; message: string }> = [];
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const expect = (value: string) => {
    if (peek().value !== value) {
      errors.push({ line: peek().line, column: peek().column, message: `Ожидался символ «${value}».` });
      return false;
    }
    take();
    return true;
  };

  const expression = (depth = 0): Expr | null => {
    const token = take();
    if (depth > MAX_EXPRESSION_DEPTH) {
      errors.push({
        line: token.line,
        column: token.column,
        message: `Превышена максимальная глубина выражения (${MAX_EXPRESSION_DEPTH}).`,
      });
      return null;
    }
    if (token.kind === 'number') return { kind: 'number', value: Number(token.value) };
    if (token.kind !== 'identifier') {
      errors.push({ line: token.line, column: token.column, message: 'Ожидалось выражение.' });
      return null;
    }
    if (peek().value !== '(') return { kind: 'identifier', name: token.value };
    if (!calls.has(token.value)) {
      errors.push({
        line: token.line,
        column: token.column,
        message: legacyIndicatorCalls.has(token.value)
          ? `Индикатор «${token.value}» настраивается в разделе «ИНДИКАТОРЫ»; в коде используйте его имя без вызова.`
          : `Неизвестная функция «${token.value}».`,
      });
      return null;
    }

    take();
    const args: Expr[] = [];
    if (peek().value !== ')') {
      while (true) {
        const argument = expression(depth + 1);
        if (argument) args.push(argument);
        if (peek().value !== ',') break;
        take();
      }
    }
    expect(')');
    return { kind: 'call', callee: token.value, args };
  };

  if (!expect('strategy') || !expect('(')) return { ok: false, errors };
  const name = take();
  if (name.kind !== 'string') {
    errors.push({ line: name.line, column: name.column, message: 'Ожидалось название стратегии.' });
  }
  expect(',');
  expect('(');
  expect(')');
  expect('=');
  expect('>');
  expect('{');

  const statements: Statement[] = [];
  while (peek().value !== '}' && peek().kind !== 'eof') {
    const token = take();
    if (token.value === 'const') {
      const nameToken = take();
      if (nameToken.kind !== 'identifier') {
        errors.push({ line: nameToken.line, column: nameToken.column, message: 'Ожидалось имя переменной.' });
      }
      expect('=');
      const parsedExpression = expression();
      if (parsedExpression) statements.push({ kind: 'const', name: nameToken.value, expression: parsedExpression });
      expect(';');
    } else if (actions.has(token.value)) {
      expect('(');
      const parsedExpression = expression();
      expect(')');
      expect(';');
      if (parsedExpression) statements.push({ kind: 'action', action: token.value as 'LONG' | 'SHORT' | 'STOP' | 'TAKE_PROFIT', expression: parsedExpression });
    } else {
      errors.push({ line: token.line, column: token.column, message: `Неизвестная инструкция «${token.value}».` });
    }
  }
  expect('}');
  expect(')');
  expect(';');
  if (peek().kind !== 'eof') {
    errors.push({ line: peek().line, column: peek().column, message: 'Недопустимый код после стратегии.' });
  }
  return errors.length ? { ok: false, errors } : { ok: true, program: { name: name.value, statements } };
}
