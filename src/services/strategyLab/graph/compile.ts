/**
 * CRYPTORA — Strategy Lab · компилятор блок-схемы (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * BLOCKS-1 НЕ вводит второй движок стратегий. Блок-схема компилируется в уже
 * существующий `StrategyDraftDefinition`, который исполняет существующий
 * `evaluateDraftStrategy` → `executionSimulator` → metrics/events:
 *
 *   StrategyGraph → validate → compileGraphToDraftDefinition → текущий движок.
 *
 * Поэтому ПОБАРОВОГО интерпретатора графа не существует: компиляция происходит
 * один раз на реплей, а не на каждый бар (§28).
 *
 * Семантика сохраняется ТОЧНО (§13–§15):
 *   • ATR × Число → MULTIPLY → STOP.risk  ⇒  stop { type:'atrMultiple', multiplier };
 *   • Число → R → TAKE_PROFIT.target      ⇒  target { type:'rMultiple', multiple };
 *   • CROSSES_ABOVE → LONG, CROSSES_BELOW → SHORT  ⇒  long/short LogicRule.
 *
 * Координаты блоков (`position`) в компиляции НЕ участвуют: порядок берётся из
 * массива `nodes`, а связи — из рёбер.
 */

import type {
  IndicatorDefinition,
  LogicRule,
  StrategyDraftDefinition,
} from '../types';
import {
  buildGraphIndex,
  nodesOfType,
  resolveSource,
  validateStrategyGraph,
  type GraphIndex,
} from './validate';
import type {
  GraphValidationError,
  StrategyGraph,
  StrategyGraphNode,
} from './types';

/** Значения по умолчанию совпадают с текущим Draft-конструктором (паритет). */
export const GRAPH_DEFAULT_EXECUTION = Object.freeze({ feeBps: 5, slippageBps: 2 });

export class GraphCompileError extends Error {
  readonly errors: GraphValidationError[];
  constructor(errors: GraphValidationError[]) {
    super(errors[0]?.message ?? 'Блок-схема некорректна');
    this.name = 'GraphCompileError';
    this.errors = errors;
  }
}

function conditionRule(index: GraphIndex, actionNode: StrategyGraphNode): LogicRule {
  const condition = resolveSource(index, actionNode.id, 'condition');
  if (!condition) throw new GraphCompileError([internal(`${actionNode.id}: нет условия`)]);
  const a = resolveSource(index, condition.node.id, 'a');
  const b = resolveSource(index, condition.node.id, 'b');
  if (!a || !b) throw new GraphCompileError([internal(`${condition.node.id}: нет входов условия`)]);
  return {
    left: a.node.id,
    operator: condition.node.type === 'CROSSES_ABOVE' ? 'crossesAbove' : 'crossesBelow',
    right: b.node.id,
  };
}

function internal(detail: string): GraphValidationError {
  return {
    code: 'UNSUPPORTED_SOURCE',
    message: `Блок-схема не может быть скомпилирована: ${detail}.`,
  };
}

/**
 * Скомпилировать валидную блок-схему в существующее декларативное определение.
 * Бросает `GraphCompileError`, если граф не прошёл общий валидатор.
 */
export function compileGraphToDraftDefinition(graph: StrategyGraph): StrategyDraftDefinition {
  const validation = validateStrategyGraph(graph);
  if (!validation.ok) throw new GraphCompileError(validation.errors);

  const index = buildGraphIndex(graph);
  const longNode = nodesOfType(index, 'LONG')[0];
  const shortNode = nodesOfType(index, 'SHORT')[0];
  const stopNode = nodesOfType(index, 'STOP')[0];
  const tpNode = nodesOfType(index, 'TAKE_PROFIT')[0];

  const long = conditionRule(index, longNode);
  const short = conditionRule(index, shortNode);

  // ── Стоп: ATR либо ATR × Число ──────────────────────────────────────────
  const risk = resolveSource(index, stopNode.id, 'risk');
  if (!risk) throw new GraphCompileError([internal('стоп без риска')]);
  let atrNodeId: string;
  let multiplier: number;
  if (risk.node.type === 'ATR') {
    atrNodeId = risk.node.id;
    multiplier = 1;
  } else {
    const series = resolveSource(index, risk.node.id, 'a');
    const factor = resolveSource(index, risk.node.id, 'b');
    if (!series || !factor) throw new GraphCompileError([internal('неполный блок «Умножить»')]);
    atrNodeId = series.node.id;
    multiplier = factor.node.params.value;
  }

  // ── Цель: Число → R ─────────────────────────────────────────────────────
  const target = resolveSource(index, tpNode.id, 'target');
  if (!target) throw new GraphCompileError([internal('тейк-профит без цели')]);
  const multipleSource = resolveSource(index, target.node.id, 'multiple');
  if (!multipleSource) throw new GraphCompileError([internal('блок R без кратности')]);
  const rMultiple = multipleSource.node.params.value;

  /*
   * Индикаторы: только реально используемые. Порядок КАНОНИЧЕСКИЙ — по роли в
   * стратегии (LONG левый/правый, SHORT левый/правый, затем ATR), а не по
   * порядку массива узлов и тем более не по координатам. Поэтому результат
   * компиляции не зависит ни от раскладки на холсте, ни от истории правок.
   */
  if ((long.kind && long.kind !== 'cross') || (short.kind && short.kind !== 'cross')) {
    throw new GraphCompileError([internal('блок-схема поддерживает только EMA-пересечения')]);
  }
  const orderedIds: string[] = [];
  for (const id of [long.left, long.right, short.left, short.right, atrNodeId]) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  const indicators: IndicatorDefinition[] = [];
  for (const id of orderedIds) {
    const node = index.nodes.get(id);
    if (!node) throw new GraphCompileError([internal(`индикатор ${id} не найден`)]);
    if (node.type === 'EMA') {
      indicators.push({
        id: node.id,
        type: 'EMA',
        name: `EMA ${node.params.period}`,
        period: node.params.period,
        source: 'close',
        visible: true,
      });
    } else if (node.type === 'ATR') {
      indicators.push({
        id: node.id,
        type: 'ATR',
        name: `ATR ${node.params.period}`,
        period: node.params.period,
        visible: false,
      });
    }
  }

  return {
    name: graph.name,
    indicators,
    long,
    short,
    stop: { type: 'atrMultiple', indicatorId: atrNodeId, multiplier },
    target: { type: 'rMultiple', multiple: rMultiple },
    execution: {
      feeBps: graph.execution?.feeBps ?? GRAPH_DEFAULT_EXECUTION.feeBps,
      slippageBps: graph.execution?.slippageBps ?? GRAPH_DEFAULT_EXECUTION.slippageBps,
    },
  };
}
