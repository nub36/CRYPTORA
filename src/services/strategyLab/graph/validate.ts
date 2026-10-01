/**
 * CRYPTORA — Strategy Lab · семантический валидатор блок-схемы (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * ОДИН общий валидатор для фронтенда и сервера (§10). Фронтенд использует его
 * для UX (подсветка совместимых портов, запрет «битого» провода, список ошибок),
 * сервер — как НЕЗАВИСИМУЮ проверку перед компиляцией: клиент не является
 * источником истины.
 *
 * Принимает НЕДОВЕРЕННЫЙ `unknown` (тело HTTP-запроса) и сам сужает типы.
 * Никакого eval/new Function: граф — это данные.
 *
 * Проверяются (§9):
 *   версия схемы, режим авторинга, имя, лимиты узлов/рёбер, стабильность и
 *   уникальность ID, неизвестный тип блока, неизвестный порт, направление
 *   порта, несовместимость типов портов, дубликаты рёбер, несколько рёбер в
 *   одиночный вход, самосоединение, циклы, незаполненные обязательные входы,
 *   некорректные параметры и поддерживаемость структуры компилятором.
 */

import {
  GRAPH_ID_PATTERN,
  GRAPH_LIMITS,
  GRAPH_SCHEMA_VERSION,
  type BlockType,
  type GraphEndpoint,
  type GraphValidationError,
  type GraphValidationResult,
  type StrategyGraph,
  type StrategyGraphEdge,
  type StrategyGraphNode,
} from './types';
import {
  BLOCK_REGISTRY,
  PORT_TYPE_LABELS,
  arePortTypesCompatible,
  getBlockDefinition,
  getBlockPort,
  isKnownBlockType,
} from './registry';

// ─────────────────────────────────────────────────────────────────────────────
// Индекс графа (используется валидатором и компилятором)
// ─────────────────────────────────────────────────────────────────────────────

export function endpointKey(nodeId: string, port: string): string {
  return `${nodeId}\u0000${port}`;
}

export interface GraphIndex {
  nodes: Map<string, StrategyGraphNode>;
  byType: Map<BlockType, StrategyGraphNode[]>;
  /** endpointKey(вход) → входящие рёбра */
  incoming: Map<string, StrategyGraphEdge[]>;
  /** endpointKey(выход) → исходящие рёбра */
  outgoing: Map<string, StrategyGraphEdge[]>;
}

export function buildGraphIndex(graph: StrategyGraph): GraphIndex {
  const nodes = new Map<string, StrategyGraphNode>();
  const byType = new Map<BlockType, StrategyGraphNode[]>();
  const incoming = new Map<string, StrategyGraphEdge[]>();
  const outgoing = new Map<string, StrategyGraphEdge[]>();

  for (const node of graph.nodes) {
    nodes.set(node.id, node);
    const list = byType.get(node.type);
    if (list) list.push(node);
    else byType.set(node.type, [node]);
  }
  for (const edge of graph.edges) {
    const inKey = endpointKey(edge.to.nodeId, edge.to.port);
    const outKey = endpointKey(edge.from.nodeId, edge.from.port);
    const inList = incoming.get(inKey);
    if (inList) inList.push(edge);
    else incoming.set(inKey, [edge]);
    const outList = outgoing.get(outKey);
    if (outList) outList.push(edge);
    else outgoing.set(outKey, [edge]);
  }
  return { nodes, byType, incoming, outgoing };
}

export function nodesOfType(index: GraphIndex, type: BlockType): StrategyGraphNode[] {
  return index.byType.get(type) ?? [];
}

export function incomingEdges(
  index: GraphIndex,
  nodeId: string,
  port: string
): StrategyGraphEdge[] {
  return index.incoming.get(endpointKey(nodeId, port)) ?? [];
}

export interface ResolvedSource {
  node: StrategyGraphNode;
  port: string;
  edge: StrategyGraphEdge;
}

/** Первый (и для одиночного входа — единственный) источник входного порта. */
export function resolveSource(
  index: GraphIndex,
  nodeId: string,
  port: string
): ResolvedSource | null {
  const edges = incomingEdges(index, nodeId, port);
  if (edges.length === 0) return null;
  const edge = edges[0];
  const node = index.nodes.get(edge.from.nodeId);
  if (!node) return null;
  return { node, port: edge.from.port, edge };
}

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательное
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function label(type: BlockType): string {
  return BLOCK_REGISTRY[type].label;
}

function err(
  code: GraphValidationError['code'],
  message: string,
  extra: Omit<GraphValidationError, 'code' | 'message'> = {}
): GraphValidationError {
  return { code, message, ...extra };
}

function fail(errors: GraphValidationError[]): GraphValidationResult {
  return { ok: false, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Фаза A: оболочка графа и узлы
// ─────────────────────────────────────────────────────────────────────────────

function validateEnvelope(input: unknown, errors: GraphValidationError[]): boolean {
  if (!isPlainObject(input)) {
    errors.push(err('GRAPH_NOT_OBJECT', 'Блок-схема повреждена: ожидался объект графа.'));
    return false;
  }
  if (input.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    errors.push(
      err(
        'SCHEMA_VERSION',
        `Неподдерживаемая версия блок-схемы: ожидается ${GRAPH_SCHEMA_VERSION}.`
      )
    );
  }
  if (input.authoringMode !== 'blocks') {
    errors.push(err('AUTHORING_MODE', 'Режим авторинга блок-схемы должен быть «blocks».'));
  }
  if (
    typeof input.name !== 'string' ||
    input.name.trim().length === 0 ||
    input.name.length > GRAPH_LIMITS.maxNameLength
  ) {
    errors.push(
      err('GRAPH_NAME', `Укажите название стратегии (до ${GRAPH_LIMITS.maxNameLength} символов).`)
    );
  }
  if (!Array.isArray(input.nodes)) {
    errors.push(err('NODES_NOT_ARRAY', 'Блок-схема повреждена: список блоков отсутствует.'));
  }
  if (!Array.isArray(input.edges)) {
    errors.push(err('EDGES_NOT_ARRAY', 'Блок-схема повреждена: список связей отсутствует.'));
  }
  if (input.execution !== undefined) {
    const exec = input.execution;
    const okExec =
      isPlainObject(exec) &&
      typeof exec.feeBps === 'number' &&
      Number.isFinite(exec.feeBps) &&
      exec.feeBps >= 0 &&
      exec.feeBps <= 100 &&
      typeof exec.slippageBps === 'number' &&
      Number.isFinite(exec.slippageBps) &&
      exec.slippageBps >= 0 &&
      exec.slippageBps <= 100;
    if (!okExec) {
      errors.push(
        err('INVALID_EXECUTION', 'Параметры исполнения вне допустимого диапазона (0…100 bps).')
      );
    }
  }
  return errors.length === 0;
}

function validateNodes(nodes: unknown[], errors: GraphValidationError[]): void {
  if (nodes.length === 0) {
    errors.push(err('EMPTY_GRAPH', 'Блок-схема пуста: добавьте блоки.'));
    return;
  }
  if (nodes.length > GRAPH_LIMITS.maxNodes) {
    errors.push(
      err('MAX_NODES', `Слишком много блоков: максимум ${GRAPH_LIMITS.maxNodes}.`)
    );
  }

  const seen = new Set<string>();
  for (const raw of nodes) {
    if (!isPlainObject(raw)) {
      errors.push(err('INVALID_NODE_ID', 'Блок повреждён: ожидался объект блока.'));
      continue;
    }
    const id = raw.id;
    if (typeof id !== 'string' || !GRAPH_ID_PATTERN.test(id)) {
      errors.push(
        err('INVALID_NODE_ID', `Некорректный идентификатор блока: ${String(id)}`)
      );
      continue;
    }
    if (seen.has(id)) {
      errors.push(err('DUPLICATE_NODE_ID', `Дублирующийся идентификатор блока: ${id}`, { nodeId: id }));
      continue;
    }
    seen.add(id);

    if (!isKnownBlockType(raw.type)) {
      errors.push(
        err('UNKNOWN_BLOCK_TYPE', `Неизвестный тип блока: ${String(raw.type)}`, { nodeId: id })
      );
      continue;
    }
    const def = BLOCK_REGISTRY[raw.type];

    const pos = raw.position;
    if (
      !isPlainObject(pos) ||
      typeof pos.x !== 'number' ||
      typeof pos.y !== 'number' ||
      !Number.isFinite(pos.x) ||
      !Number.isFinite(pos.y) ||
      Math.abs(pos.x) > GRAPH_LIMITS.maxAbsPosition ||
      Math.abs(pos.y) > GRAPH_LIMITS.maxAbsPosition
    ) {
      errors.push(
        err('INVALID_POSITION', `${def.label}: некорректная позиция блока на холсте.`, {
          nodeId: id,
        })
      );
    }

    const params = raw.params;
    if (!isPlainObject(params)) {
      errors.push(err('INVALID_PARAMS', `${def.label}: параметры блока повреждены.`, { nodeId: id }));
      continue;
    }
    const known = new Set(def.params.map((p) => p.id));
    for (const key of Object.keys(params)) {
      if (!known.has(key)) {
        errors.push(
          err('UNKNOWN_PARAM', `${def.label}: неизвестный параметр «${key}».`, { nodeId: id })
        );
      }
    }
    for (const spec of def.params) {
      const value = params[spec.id];
      if (value === undefined) {
        errors.push(
          err('MISSING_PARAM', `${def.label}: не задан параметр «${spec.label}».`, { nodeId: id })
        );
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(
          err('INVALID_PARAM_VALUE', `${def.label}: «${spec.label}» должен быть числом.`, {
            nodeId: id,
          })
        );
        continue;
      }
      if (spec.integer && !Number.isInteger(value)) {
        errors.push(
          err('INVALID_PARAM_VALUE', `${def.label}: «${spec.label}» должен быть целым числом.`, {
            nodeId: id,
          })
        );
        continue;
      }
      if (value < spec.min || value > spec.max) {
        errors.push(
          err(
            'INVALID_PARAM_VALUE',
            `${def.label}: «${spec.label}» вне диапазона ${spec.min}…${spec.max}.`,
            { nodeId: id }
          )
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Фаза B: рёбра
// ─────────────────────────────────────────────────────────────────────────────

function validateEdges(
  edges: unknown[],
  nodes: Map<string, StrategyGraphNode>,
  errors: GraphValidationError[]
): void {
  if (edges.length > GRAPH_LIMITS.maxEdges) {
    errors.push(err('MAX_EDGES', `Слишком много связей: максимум ${GRAPH_LIMITS.maxEdges}.`));
  }

  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  const inputUsage = new Map<string, number>();

  for (const raw of edges) {
    if (!isPlainObject(raw)) {
      errors.push(err('INVALID_EDGE_ID', 'Связь повреждена: ожидался объект связи.'));
      continue;
    }
    const id = raw.id;
    if (typeof id !== 'string' || !GRAPH_ID_PATTERN.test(id)) {
      errors.push(err('INVALID_EDGE_ID', `Некорректный идентификатор связи: ${String(id)}`));
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(err('DUPLICATE_EDGE_ID', `Дублирующийся идентификатор связи: ${id}`, { edgeId: id }));
      continue;
    }
    seenIds.add(id);

    const from = raw.from;
    const to = raw.to;
    if (
      !isPlainObject(from) ||
      !isPlainObject(to) ||
      typeof from.nodeId !== 'string' ||
      typeof from.port !== 'string' ||
      typeof to.nodeId !== 'string' ||
      typeof to.port !== 'string'
    ) {
      errors.push(err('UNKNOWN_EDGE_NODE', `Связь ${id}: некорректные концы связи.`, { edgeId: id }));
      continue;
    }

    const fromNode = nodes.get(from.nodeId);
    const toNode = nodes.get(to.nodeId);
    if (!fromNode) {
      errors.push(
        err('UNKNOWN_EDGE_NODE', `Связь ${id}: неизвестный блок ${from.nodeId}.`, { edgeId: id })
      );
      continue;
    }
    if (!toNode) {
      errors.push(
        err('UNKNOWN_EDGE_NODE', `Связь ${id}: неизвестный блок ${to.nodeId}.`, { edgeId: id })
      );
      continue;
    }
    if (from.nodeId === to.nodeId) {
      errors.push(
        err('SELF_CONNECTION', `${label(fromNode.type)}: блок нельзя соединить сам с собой.`, {
          edgeId: id,
          nodeId: from.nodeId,
        })
      );
      continue;
    }

    const outPort = getBlockPort(fromNode.type, from.port, 'output');
    if (!outPort) {
      errors.push(
        err('UNKNOWN_PORT', `${label(fromNode.type)}: неизвестный выход «${from.port}».`, {
          edgeId: id,
          nodeId: from.nodeId,
          port: from.port,
        })
      );
      continue;
    }
    const inPort = getBlockPort(toNode.type, to.port, 'input');
    if (!inPort) {
      errors.push(
        err('UNKNOWN_PORT', `${label(toNode.type)}: неизвестный вход «${to.port}».`, {
          edgeId: id,
          nodeId: to.nodeId,
          port: to.port,
        })
      );
      continue;
    }

    if (!arePortTypesCompatible(outPort.type, inPort.type)) {
      errors.push(
        err(
          'INCOMPATIBLE_PORTS',
          `Нельзя соединить ${outPort.type} с ${inPort.type}` +
            ` (${PORT_TYPE_LABELS[outPort.type]} → ${PORT_TYPE_LABELS[inPort.type]}).`,
          { edgeId: id, nodeId: to.nodeId, port: to.port }
        )
      );
      continue;
    }

    const pairKey = `${endpointKey(from.nodeId, from.port)}→${endpointKey(to.nodeId, to.port)}`;
    if (seenPairs.has(pairKey)) {
      errors.push(
        err('DUPLICATE_EDGE', `Такая связь уже существует: ${label(fromNode.type)} → ${label(toNode.type)}.`, {
          edgeId: id,
        })
      );
      continue;
    }
    seenPairs.add(pairKey);

    const inKey = endpointKey(to.nodeId, to.port);
    const used = (inputUsage.get(inKey) ?? 0) + 1;
    inputUsage.set(inKey, used);
    if (!inPort.multi && used > 1) {
      errors.push(
        err(
          'SINGLE_INPUT_PORT',
          `${label(toNode.type)}: вход «${inPort.label}» принимает только одну связь.`,
          { edgeId: id, nodeId: to.nodeId, port: to.port }
        )
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Фаза C: циклы
// ─────────────────────────────────────────────────────────────────────────────

/** Поиск цикла по направленным рёбрам (итеративный DFS, без рекурсии). */
export function hasGraphCycle(graph: StrategyGraph): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from.nodeId);
    if (list && adjacency.has(edge.to.nodeId)) list.push(edge.to.nodeId);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adjacency.keys()) color.set(id, WHITE);

  for (const start of adjacency.keys()) {
    if (color.get(start) !== WHITE) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    color.set(start, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = adjacency.get(frame.id) ?? [];
      if (frame.next >= neighbours.length) {
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const next = neighbours[frame.next++];
      const state = color.get(next);
      if (state === GREY) return true;
      if (state === WHITE) {
        color.set(next, GREY);
        stack.push({ id: next, next: 0 });
      }
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Фаза D: обязательные входы
// ─────────────────────────────────────────────────────────────────────────────

function validateRequiredInputs(
  graph: StrategyGraph,
  index: GraphIndex,
  errors: GraphValidationError[]
): void {
  for (const node of graph.nodes) {
    const def = BLOCK_REGISTRY[node.type];
    for (const port of def.inputs) {
      if (!port.required) continue;
      if (incomingEdges(index, node.id, port.id).length === 0) {
        errors.push(
          err(
            'MISSING_REQUIRED_INPUT',
            port.missingMessage ?? `${def.label}: не подключён вход «${port.label}»`,
            { nodeId: node.id, port: port.id }
          )
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Фаза E: структура, поддерживаемая компилятором (§11, §13–§15)
// ─────────────────────────────────────────────────────────────────────────────

function requireSingle(
  index: GraphIndex,
  type: BlockType,
  errors: GraphValidationError[]
): StrategyGraphNode | null {
  const list = nodesOfType(index, type);
  if (list.length === 0) {
    errors.push(err('MISSING_BLOCK', `В блок-схеме нет блока «${label(type)}».`));
    return null;
  }
  if (list.length > 1) {
    errors.push(
      err('DUPLICATE_BLOCK', `Блок «${label(type)}» может быть только один.`, {
        nodeId: list[1].id,
      })
    );
    return null;
  }
  return list[0];
}

function validateSemantics(index: GraphIndex, errors: GraphValidationError[]): void {
  // Каждый EMA считается по цене закрытия (паритет с текущим Draft-движком).
  for (const node of nodesOfType(index, 'EMA')) {
    const src = resolveSource(index, node.id, 'price');
    if (src && src.node.type !== 'CLOSE') {
      errors.push(
        err(
          'UNSUPPORTED_SOURCE',
          'EMA: вход цены должен быть подключён к блоку «Цена закрытия».',
          { nodeId: node.id, port: 'price' }
        )
      );
    }
  }

  const longNode = requireSingle(index, 'LONG', errors);
  const shortNode = requireSingle(index, 'SHORT', errors);
  const stopNode = requireSingle(index, 'STOP', errors);
  const tpNode = requireSingle(index, 'TAKE_PROFIT', errors);

  // Условие стороны: пересечение двух РАЗНЫХ EMA.
  const checkAction = (
    node: StrategyGraphNode | null,
    expected: BlockType
  ): void => {
    if (!node) return;
    const src = resolveSource(index, node.id, 'condition');
    if (!src) return; // уже отмечено как MISSING_REQUIRED_INPUT
    if (src.node.type !== 'CROSSES_ABOVE' && src.node.type !== 'CROSSES_BELOW') {
      errors.push(
        err(
          'UNSUPPORTED_SOURCE',
          `${label(node.type)}: условие должно быть блоком пересечения.`,
          { nodeId: node.id, port: 'condition' }
        )
      );
      return;
    }
    if (src.node.type !== expected) {
      errors.push(
        err(
          'UNSUPPORTED_SOURCE',
          `${label(node.type)}: ожидается условие «${label(expected)}».`,
          { nodeId: node.id, port: 'condition' }
        )
      );
      return;
    }
    const a = resolveSource(index, src.node.id, 'a');
    const b = resolveSource(index, src.node.id, 'b');
    for (const [portId, resolved] of [
      ['a', a],
      ['b', b],
    ] as const) {
      if (resolved && resolved.node.type !== 'EMA') {
        errors.push(
          err(
            'UNSUPPORTED_SOURCE',
            `${label(src.node.type)}: вход ${portId.toUpperCase()} должен быть подключён к EMA.`,
            { nodeId: src.node.id, port: portId }
          )
        );
      }
    }
    if (a && b && a.node.id === b.node.id) {
      errors.push(
        err(
          'SAME_CONDITION_INPUTS',
          `${label(src.node.type)}: входы A и B должны быть разными индикаторами.`,
          { nodeId: src.node.id }
        )
      );
    }
  };

  checkAction(longNode, 'CROSSES_ABOVE');
  checkAction(shortNode, 'CROSSES_BELOW');

  // Стоп: ATR либо ATR × Число (§13). Обобщённое исполнение риска пока не вводим.
  if (stopNode) {
    const risk = resolveSource(index, stopNode.id, 'risk');
    if (risk) {
      if (risk.node.type === 'ATR') {
        /* дистанция = ATR × 1 */
      } else if (risk.node.type === 'MULTIPLY') {
        const a = resolveSource(index, risk.node.id, 'a');
        const b = resolveSource(index, risk.node.id, 'b');
        if (a && a.node.type !== 'ATR') {
          errors.push(
            err('UNSUPPORTED_SOURCE', 'Умножить: числовой ряд стопа должен быть ATR.', {
              nodeId: risk.node.id,
              port: 'a',
            })
          );
        }
        if (b && b.node.type !== 'NUMBER') {
          errors.push(
            err('UNSUPPORTED_SOURCE', 'Умножить: множитель стопа должен быть блоком «Число».', {
              nodeId: risk.node.id,
              port: 'b',
            })
          );
        }
      } else {
        errors.push(
          err(
            'UNSUPPORTED_SOURCE',
            'Стоп: риск должен быть ATR или ATR × Число.',
            { nodeId: stopNode.id, port: 'risk' }
          )
        );
      }
    }
  }

  // Цель: Число → R → Тейк-профит (§14).
  if (tpNode) {
    const target = resolveSource(index, tpNode.id, 'target');
    if (target) {
      if (target.node.type !== 'R') {
        errors.push(
          err('UNSUPPORTED_SOURCE', 'Тейк-профит: цель должна задаваться блоком «R».', {
            nodeId: tpNode.id,
            port: 'target',
          })
        );
      } else {
        const multiple = resolveSource(index, target.node.id, 'multiple');
        if (multiple && multiple.node.type !== 'NUMBER') {
          errors.push(
            err('UNSUPPORTED_SOURCE', 'R: кратность должна задаваться блоком «Число».', {
              nodeId: target.node.id,
              port: 'multiple',
            })
          );
        }
      }
    }
  }

  // Обе стороны обязаны быть подключены и к стопу, и к тейк-профиту: текущий
  // Draft-движок требует и LONG, и SHORT правила с общими стопом и целью (§15).
  for (const action of [longNode, shortNode]) {
    if (!action) continue;
    for (const [trade, portId] of [
      [stopNode, 'signal'],
      [tpNode, 'signal'],
    ] as const) {
      if (!trade) continue;
      const connected = incomingEdges(index, trade.id, portId).some(
        (e) => e.from.nodeId === action.id
      );
      if (!connected) {
        errors.push(
          err(
            'MISSING_REQUIRED_INPUT',
            `${label(action.type)}: сигнал не подключён к блоку «${label(trade.type)}».`,
            { nodeId: action.id, port: 'signal' }
          )
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Публичный вход
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Полная проверка блок-схемы. Фазы идут по возрастанию строгости: пока граф
 * структурно некорректен, семантические проверки не запускаются (иначе ошибки
 * каскадом множатся и пользователь не видит настоящую причину).
 */
export function validateStrategyGraph(input: unknown): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  if (!validateEnvelope(input, errors)) return fail(errors);

  const graph = input as StrategyGraph;
  validateNodes(graph.nodes as unknown[], errors);
  if (errors.length > 0) return fail(errors);

  const nodeMap = new Map<string, StrategyGraphNode>();
  for (const node of graph.nodes) nodeMap.set(node.id, node);

  validateEdges(graph.edges as unknown[], nodeMap, errors);
  if (errors.length > 0) return fail(errors);

  if (hasGraphCycle(graph)) {
    return fail([err('CYCLE', 'Обнаружен цикл в блок-схеме')]);
  }

  const index = buildGraphIndex(graph);
  validateRequiredInputs(graph, index, errors);
  if (errors.length > 0) return fail(errors);

  validateSemantics(index, errors);
  if (errors.length > 0) return fail(errors);

  return { ok: true, errors: [] };
}

/** Короткая сводка ошибок для сообщений сервера/UI. */
export function formatGraphErrors(errors: GraphValidationError[], limit = 3): string {
  if (errors.length === 0) return '';
  const head = errors.slice(0, limit).map((e) => e.message);
  const rest = errors.length - head.length;
  return rest > 0 ? `${head.join(' ')} (ещё ошибок: ${rest})` : head.join(' ');
}

/**
 * Проверка ОДНОГО потенциального соединения — для UX (подсветка совместимых
 * входов и запрет «битого» провода). Возвращает `null`, если соединение
 * допустимо; иначе — конкретную ошибку.
 */
export function canConnect(
  graph: StrategyGraph,
  from: GraphEndpoint,
  to: GraphEndpoint
): GraphValidationError | null {
  if (graph.edges.length >= GRAPH_LIMITS.maxEdges) {
    return err('MAX_EDGES', `Слишком много связей: максимум ${GRAPH_LIMITS.maxEdges}.`);
  }
  const index = buildGraphIndex(graph);
  const fromNode = index.nodes.get(from.nodeId);
  const toNode = index.nodes.get(to.nodeId);
  if (!fromNode || !toNode) {
    return err('UNKNOWN_EDGE_NODE', 'Связь ссылается на несуществующий блок.');
  }
  if (from.nodeId === to.nodeId) {
    return err('SELF_CONNECTION', `${label(fromNode.type)}: блок нельзя соединить сам с собой.`);
  }
  const outPort = getBlockPort(fromNode.type, from.port, 'output');
  if (!outPort) {
    return err('UNKNOWN_PORT', `${label(fromNode.type)}: неизвестный выход «${from.port}».`);
  }
  const inPort = getBlockPort(toNode.type, to.port, 'input');
  if (!inPort) {
    return err('UNKNOWN_PORT', `${label(toNode.type)}: неизвестный вход «${to.port}».`);
  }
  if (!arePortTypesCompatible(outPort.type, inPort.type)) {
    return err(
      'INCOMPATIBLE_PORTS',
      `Нельзя соединить ${outPort.type} с ${inPort.type}` +
        ` (${PORT_TYPE_LABELS[outPort.type]} → ${PORT_TYPE_LABELS[inPort.type]}).`
    );
  }
  const existing = incomingEdges(index, to.nodeId, to.port);
  if (existing.some((e) => e.from.nodeId === from.nodeId && e.from.port === from.port)) {
    return err(
      'DUPLICATE_EDGE',
      `Такая связь уже существует: ${label(fromNode.type)} → ${label(toNode.type)}.`
    );
  }
  if (!inPort.multi && existing.length > 0) {
    return err(
      'SINGLE_INPUT_PORT',
      `${label(toNode.type)}: вход «${inPort.label}» принимает только одну связь.`
    );
  }
  const probe: StrategyGraph = {
    ...graph,
    edges: [...graph.edges, { id: '__probe__', from, to }],
  };
  if (hasGraphCycle(probe)) {
    return err('CYCLE', 'Обнаружен цикл в блок-схеме');
  }
  return null;
}

/** Все входы, куда ДОПУСТИМО тянуть провод из указанного выхода (§4 tap-to-connect). */
export function listCompatibleInputs(
  graph: StrategyGraph,
  from: GraphEndpoint
): GraphEndpoint[] {
  const targets: GraphEndpoint[] = [];
  for (const node of graph.nodes) {
    const def = getBlockDefinition(node.type);
    if (!def) continue;
    for (const port of def.inputs) {
      const candidate: GraphEndpoint = { nodeId: node.id, port: port.id };
      if (canConnect(graph, from, candidate) === null) targets.push(candidate);
    }
  }
  return targets;
}
