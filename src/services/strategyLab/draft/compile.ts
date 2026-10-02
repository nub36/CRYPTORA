/**
 * CRYPTORA — Strategy Lab · компилятор code-first черновика (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * ЕДИНСТВЕННЫЙ путь исполнения Lab:
 *
 *   индикаторы + код → безопасный лексер/парсер → каноническое
 *   `StrategyDraftDefinition` → существующий движок (evaluateDraftStrategy →
 *   executionSimulator → метрики/события) → график.
 *
 * Второго движка стратегий НЕ существует: компиляция выполняется ОДИН раз за
 * реплей, а не на каждый бар. Никакого eval / new Function / VM: код — это
 * данные, разобранные собственным лексером и парсером.
 *
 * Тот же компилятор исполняется сервером (через labEntry.ts/labCoreBundle.js),
 * поэтому фронтенд НЕ является источником истины: сервер независимо повторяет
 * разбор кода и проверку ссылок на индикаторы.
 */

import { parse } from '../code/parser';
import type { CodeError, Expr, Statement } from '../code/types';
import type {
  IndicatorDefinition,
  LogicRule,
  StrategyDraftDefinition,
} from '../types';
import { buildIndicatorBindings } from './identifiers';
import { DEFAULT_DRAFT_EXECUTION, type StrategyResearchDraft } from './types';

export interface DraftCompileResult {
  ok: boolean;
  definition?: StrategyDraftDefinition;
  errors: CodeError[];
}

/** Bounded recursive condition language: safe for server compilation and replay. */
export const MAX_CONDITION_DEPTH = 8;
export const MAX_CONDITION_NODES = 64;

/** Позиция недоступна в AST (минимальный AST v1) — отчитываемся по строке 1. */
const AT_START = { line: 1, column: 1 };

class CompileFailure extends Error {
  constructor(readonly error: CodeError) {
    super(error.message);
  }
}

function fail(message: string): never {
  throw new CompileFailure({ ...AT_START, message });
}

export function compileResearchDraft(draft: StrategyResearchDraft): DraftCompileResult {
  const errors: CodeError[] = [];

  // ── 1. Индикаторы: источник объявлений ──────────────────────────────────
  if (!Array.isArray(draft.indicators) || draft.indicators.length === 0) {
    return { ok: false, errors: [{ ...AT_START, message: 'Добавьте хотя бы один индикатор в разделе «ИНДИКАТОРЫ».' }] };
  }
  const seenIds = new Set<string>();
  for (const ind of draft.indicators) {
    if (seenIds.has(ind.id)) {
      errors.push({ ...AT_START, message: `Дублирующийся идентификатор индикатора: ${ind.id}.` });
    }
    seenIds.add(ind.id);
    if (ind.type === 'ORDER_BLOCK') {
      if (!Number.isInteger(ind.lookback) || ind.lookback < 1 || ind.lookback > 20) {
        errors.push({ ...AT_START, message: `Order Block «${ind.name || ind.id}»: Lookback должен быть целым числом от 1 до 20.` });
      }
      if (!Number.isFinite(ind.displacementMultiplier) || ind.displacementMultiplier < 0.1 || ind.displacementMultiplier > 10) {
        errors.push({ ...AT_START, message: `Order Block «${ind.name || ind.id}»: Displacement ATR должен быть от 0.1 до 10.` });
      }
      if (!ind.atrIndicatorId) {
        errors.push({ ...AT_START, message: `Order Block «${ind.name || ind.id}»: выберите ATR для импульса.` });
      }
    } else if (ind.type === 'MARKET_STRUCTURE') {
      if (!Number.isInteger(ind.leftBars) || ind.leftBars < 1 || ind.leftBars > 10) {
        errors.push({ ...AT_START, message: `Market Structure «${ind.name || ind.id}»: левые свечи должны быть целым числом от 1 до 10.` });
      }
      if (!Number.isInteger(ind.rightBars) || ind.rightBars < 1 || ind.rightBars > 10) {
        errors.push({ ...AT_START, message: `Market Structure «${ind.name || ind.id}»: правые свечи должны быть целым числом от 1 до 10.` });
      }
    } else if (!Number.isFinite(ind.period) || ind.period < 1) {
      errors.push({ ...AT_START, message: `Индикатор «${ind.name || ind.id}»: период должен быть целым числом ≥ 1.` });
    }
  }
  if (errors.length) return { ok: false, errors };

  const byDraftId = new Map(draft.indicators.map((ind) => [ind.id, ind]));
  for (const ind of draft.indicators) {
    if (ind.type !== 'ORDER_BLOCK') continue;
    const atr = byDraftId.get(ind.atrIndicatorId);
    if (!atr || atr.type !== 'ATR') {
      errors.push({ ...AT_START, message: `Order Block «${ind.name || ind.id}»: ATR для импульса должен ссылаться на настроенный индикатор ATR.` });
    }
  }
  if (errors.length) return { ok: false, errors };

  const bindings = buildIndicatorBindings(draft.indicators);
  const byIdentifier = new Map(bindings.map((b) => [b.identifier, b.indicator]));

  // ── 2. Код: безопасный разбор ───────────────────────────────────────────
  const parsed = parse(draft.sourceCode ?? '');
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const consts = new Map<string, Expr>();
  const resolveExpr = (expr: Expr, seen: Set<string> = new Set()): Expr => {
    if (expr.kind === 'identifier' && consts.has(expr.name)) {
      if (seen.has(expr.name)) fail(`Циклическая ссылка переменной «${expr.name}».`);
      seen.add(expr.name);
      return resolveExpr(consts.get(expr.name)!, seen);
    }
    return expr;
  };

  const indicatorOf = (expr: Expr, role: string): IndicatorDefinition => {
    const e = resolveExpr(expr);
    if (e.kind !== 'identifier') fail(`${role}: ожидалась ссылка на индикатор.`);
    const indicator = byIdentifier.get(e.name);
    if (!indicator) {
      fail(
        `Неизвестная ссылка «${e.name}». Доступные индикаторы: ${
          bindings.map((b) => b.identifier).join(', ') || '—'
        }.`
      );
    }
    return indicator;
  };

  const numberOf = (expr: Expr, role: string): number => {
    const e = resolveExpr(expr);
    if (e.kind !== 'number' || !Number.isFinite(e.value)) fail(`${role}: ожидалось число.`);
    return e.value;
  };

  const expectType = (indicator: IndicatorDefinition, type: IndicatorDefinition['type'], role: string): void => {
    if (indicator.type !== type) {
      fail(`${role}: индикатор «${indicator.name || indicator.id}» имеет тип ${indicator.type}, ожидается ${type}.`);
    }
  };

  const conditionRule = (expr: Expr, role: string, depth = 1, nodeCount: { value: number } = { value: 0 }): LogicRule => {
    if (depth > MAX_CONDITION_DEPTH) {
      fail(`${role}: превышена максимальная глубина условий (${MAX_CONDITION_DEPTH}).`);
    }
    nodeCount.value += 1;
    if (nodeCount.value > MAX_CONDITION_NODES) {
      fail(`${role}: превышено максимальное число условий (${MAX_CONDITION_NODES}).`);
    }

    const e = resolveExpr(expr);
    if (e.kind !== 'call') fail(`${role}: ожидается условие стратегии.`);

    if (e.callee === 'all' || e.callee === 'any') {
      if (e.args.length < 2) fail(`${role}: ${e.callee} принимает не менее двух условий.`);
      return {
        kind: e.callee,
        conditions: e.args.map((child) => conditionRule(child, role, depth + 1, nodeCount)),
      };
    }
    if (e.callee === 'not') {
      if (e.args.length !== 1) fail(`${role}: not принимает ровно одно условие.`);
      return { kind: 'not', condition: conditionRule(e.args[0], role, depth + 1, nodeCount) };
    }
    if (e.callee === 'crossesAbove' || e.callee === 'crossesBelow') {
      if (e.args.length !== 2) fail(`${role}: функция принимает два индикатора.`);
      const left = indicatorOf(e.args[0], role); const right = indicatorOf(e.args[1], role);
      expectType(left, 'EMA', role); expectType(right, 'EMA', role);
      return { kind: 'cross', left: left.id, operator: e.callee, right: right.id };
    }
    if (e.callee === 'above' || e.callee === 'below') {
      if (e.args.length !== 2) fail(`${role}: функция принимает индикатор и порог.`);
      const ind = indicatorOf(e.args[0], role); const threshold = numberOf(e.args[1], role);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) fail(`${role}: порог должен быть от 0 до 100.`);
      expectType(ind, 'RSI', role);
      return { kind: 'threshold', left: ind.id, right: ind.id, indicatorId: ind.id, operator: e.callee, threshold };
    }
    if (e.callee === 'fractalHigh' || e.callee === 'fractalLow') {
      if (e.args.length !== 1) fail(`${role}: функция принимает один индикатор.`);
      const ind = indicatorOf(e.args[0], role); expectType(ind, 'FRACTALS', role);
      return { kind: 'fractal', left: ind.id, right: ind.id, indicatorId: ind.id, operator: e.callee };
    }
    if (
      e.callee === 'swingHigh' ||
      e.callee === 'swingLow' ||
      e.callee === 'bullishBOS' ||
      e.callee === 'bearishBOS' ||
      e.callee === 'bullishCHoCH' ||
      e.callee === 'bearishCHoCH'
    ) {
      if (e.args.length !== 1) fail(`${role}: функция принимает один индикатор Market Structure.`);
      const ind = indicatorOf(e.args[0], role); expectType(ind, 'MARKET_STRUCTURE', role);
      return { kind: 'marketStructure', indicatorId: ind.id, operator: e.callee };
    }
    if (
      e.callee === 'bullishOrderBlock' ||
      e.callee === 'bearishOrderBlock' ||
      e.callee === 'insideBullishOrderBlock' ||
      e.callee === 'insideBearishOrderBlock' ||
      e.callee === 'bullishOrderBlockRetest' ||
      e.callee === 'bearishOrderBlockRetest'
    ) {
      if (e.args.length !== 1) fail(`${role}: функция принимает один индикатор Order Block.`);
      const ind = indicatorOf(e.args[0], role); expectType(ind, 'ORDER_BLOCK', role);
      return { kind: 'orderBlock', indicatorId: ind.id, operator: e.callee };
    }
    fail(`${role}: неизвестное условие.`);
  };

  let long: LogicRule | null = null;
  let short: LogicRule | null = null;
  let stop: StrategyDraftDefinition['stop'] | null = null;
  let target: StrategyDraftDefinition['target'] | null = null;

  try {
    for (const statement of parsed.program.statements as Statement[]) {
      if (statement.kind === 'const') {
        if (consts.has(statement.name)) fail(`Переменная «${statement.name}» объявлена повторно.`);
        if (byIdentifier.has(statement.name)) {
          fail(`Переменная «${statement.name}» конфликтует с именем индикатора.`);
        }
        consts.set(statement.name, statement.expression);
        continue;
      }
      switch (statement.action) {
        case 'LONG':
          if (long) fail('LONG(...) можно объявить только один раз.');
          long = conditionRule(statement.expression, 'LONG');
          break;
        case 'SHORT':
          if (short) fail('SHORT(...) можно объявить только один раз.');
          short = conditionRule(statement.expression, 'SHORT');
          break;
        case 'STOP': {
          if (stop) fail('STOP(...) можно объявить только один раз.');
          const e = resolveExpr(statement.expression);
          let atr: IndicatorDefinition;
          let multiplier: number;
          if (e.kind === 'call' && e.callee === 'multiply') {
            if (e.args.length !== 2) fail('STOP: multiply(индикатор, число) принимает два аргумента.');
            atr = indicatorOf(e.args[0], 'STOP');
            multiplier = numberOf(e.args[1], 'STOP');
          } else {
            atr = indicatorOf(e, 'STOP');
            multiplier = 1;
          }
          expectType(atr, 'ATR', 'STOP');
          if (!(multiplier > 0) || multiplier > 100) fail('STOP: множитель должен быть больше 0 и не больше 100.');
          stop = { type: 'atrMultiple', indicatorId: atr.id, multiplier };
          break;
        }
        case 'TAKE_PROFIT': {
          if (target) fail('TAKE_PROFIT(...) можно объявить только один раз.');
          const e = resolveExpr(statement.expression);
          if (e.kind !== 'call' || e.callee !== 'R' || e.args.length !== 1) {
            fail('TAKE_PROFIT: ожидается R(кратность).');
          }
          const multiple = numberOf(e.args[0], 'TAKE_PROFIT');
          if (!(multiple > 0) || multiple > 100) fail('TAKE_PROFIT: кратность R должна быть больше 0 и не больше 100.');
          target = { type: 'rMultiple', multiple };
          break;
        }
        default:
          fail('Неизвестное действие в коде стратегии.');
      }
    }

    if (!long) fail('В коде не объявлен LONG(...).');
    if (!short) fail('В коде не объявлен SHORT(...).');
    if (!stop) fail('В коде не объявлен STOP(...).');
    if (!target) fail('В коде не объявлен TAKE_PROFIT(...).');
  } catch (e) {
    if (e instanceof CompileFailure) return { ok: false, errors: [e.error] };
    throw e;
  }

  /*
   * Индикаторы определения: только реально используемые кодом, в КАНОНИЧЕСКОМ
   * порядке (LONG левый/правый, SHORT левый/правый, затем ATR стопа), чтобы
   * результат не зависел от порядка правок в UI.
   */
  const orderedIds: string[] = [];
  const byId = new Map(draft.indicators.map((i) => [i.id, i]));
  const addIndicatorWithDependencies = (id: string) => {
    if (orderedIds.includes(id)) return;
    const ind = byId.get(id)!;
    orderedIds.push(id);
    // The referenced ATR is an explicit mathematical dependency of the Order
    // Block and must survive canonical indicator pruning even when STOP() uses
    // another ATR indicator.
    if (ind.type === 'ORDER_BLOCK') addIndicatorWithDependencies(ind.atrIndicatorId);
  };
  const conditionIds = (condition: LogicRule): string[] => {
    if (condition.kind === 'all' || condition.kind === 'any') {
      return condition.conditions.flatMap(conditionIds);
    }
    if (condition.kind === 'not') return conditionIds(condition.condition);
    if ('left' in condition && 'right' in condition) return [condition.left, condition.right];
    return [condition.indicatorId];
  };
  for (const id of [...conditionIds(long), ...conditionIds(short), stop.indicatorId]) {
    addIndicatorWithDependencies(id);
  }
  const indicators: IndicatorDefinition[] = orderedIds.map((id) => {
    const ind = byId.get(id)!;
    if (ind.type === 'ORDER_BLOCK') {
      return {
        id: ind.id,
        type: 'ORDER_BLOCK' as const,
        name: ind.name || 'Order Block',
        lookback: ind.lookback,
        displacementMultiplier: ind.displacementMultiplier,
        atrIndicatorId: ind.atrIndicatorId,
        visible: ind.visible ?? true,
      };
    }
    if (ind.type === 'MARKET_STRUCTURE') {
      return {
        id: ind.id,
        type: 'MARKET_STRUCTURE' as const,
        name: ind.name || 'Market Structure',
        leftBars: ind.leftBars,
        rightBars: ind.rightBars,
        visible: ind.visible ?? true,
      };
    }
    return ind.type === 'EMA'
      ? {
          id: ind.id,
          type: 'EMA' as const,
          name: ind.name || `EMA ${ind.period}`,
          period: ind.period,
          source: ind.source ?? 'close',
          visible: ind.visible ?? true,
        }
      : {
          id: ind.id,
          type: ind.type,
          name: ind.name || `${ind.type} ${ind.period}`,
          period: ind.period,
          source: ind.source ?? 'close',
          visible: ind.visible ?? false,
        };
  });

  return {
    ok: true,
    errors: [],
    definition: {
      name: parsed.program.name || draft.name,
      indicators,
      long,
      short,
      stop,
      target,
      execution: {
        feeBps: draft.execution?.feeBps ?? DEFAULT_DRAFT_EXECUTION.feeBps,
        slippageBps: draft.execution?.slippageBps ?? DEFAULT_DRAFT_EXECUTION.slippageBps,
      },
    },
  };
}

/** Короткое русское сообщение об ошибках кода (для серверного ответа). */
export function formatCodeErrors(errors: CodeError[], limit = 3): string {
  return errors
    .slice(0, limit)
    .map((e) => `Строка ${e.line}, столбец ${e.column}: ${e.message}`)
    .join(' ');
}
