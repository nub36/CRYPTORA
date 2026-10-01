/**
 * CRYPTORA — Strategy Lab · чистые операции редактирования блок-схемы
 * ---------------------------------------------------------------------------
 * Вся логика редактора живёт ЗДЕСЬ, а не в React: добавление блока, соединение,
 * удаление блока/связи, изменение параметра и перемещение. Компоненты канвы —
 * тонкий слой отображения, поэтому поведение редактора тестируется без DOM и
 * одинаково работает мышью и пальцем.
 *
 * Все функции иммутабельны и детерминированы: никакого Date.now/Math.random,
 * идентификаторы выводятся из уже существующих.
 */

import {
  GRAPH_LIMITS,
  type BlockType,
  type GraphEndpoint,
  type GraphPosition,
  type GraphValidationError,
  type StrategyGraph,
  type StrategyGraphEdge,
  type StrategyGraphNode,
} from './types';
import { BLOCK_REGISTRY, defaultBlockParams, getBlockDefinition } from './registry';
import { canConnect } from './validate';

export type GraphMutation<T = unknown> =
  | ({ ok: true; graph: StrategyGraph } & T)
  | { ok: false; error: GraphValidationError };

function fail(error: GraphValidationError): { ok: false; error: GraphValidationError } {
  return { ok: false, error };
}

/** Детерминированный свободный ID вида `ema-1`, `ema-2`, … */
export function nextNodeId(graph: StrategyGraph, type: BlockType): string {
  const prefix = type.toLowerCase().replace(/_/g, '-');
  const taken = new Set(graph.nodes.map((n) => n.id));
  let i = 1;
  while (taken.has(`${prefix}-${i}`)) i += 1;
  return `${prefix}-${i}`;
}

/** Детерминированный свободный ID связи вида `edge-1`, `edge-2`, … */
export function nextEdgeId(graph: StrategyGraph): string {
  const taken = new Set(graph.edges.map((e) => e.id));
  let i = 1;
  while (taken.has(`edge-${i}`)) i += 1;
  return `edge-${i}`;
}

export function addBlockNode(
  graph: StrategyGraph,
  type: BlockType,
  position: GraphPosition
): GraphMutation<{ nodeId: string }> {
  if (!getBlockDefinition(type)) {
    return fail({ code: 'UNKNOWN_BLOCK_TYPE', message: `Неизвестный тип блока: ${String(type)}` });
  }
  if (graph.nodes.length >= GRAPH_LIMITS.maxNodes) {
    return fail({
      code: 'MAX_NODES',
      message: `Слишком много блоков: максимум ${GRAPH_LIMITS.maxNodes}.`,
    });
  }
  const id = nextNodeId(graph, type);
  const node: StrategyGraphNode = {
    id,
    type,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    params: defaultBlockParams(type),
  };
  return { ok: true, graph: { ...graph, nodes: [...graph.nodes, node] }, nodeId: id };
}

export function connectPorts(
  graph: StrategyGraph,
  from: GraphEndpoint,
  to: GraphEndpoint
): GraphMutation<{ edgeId: string }> {
  const problem = canConnect(graph, from, to);
  if (problem) return fail(problem);
  const edge: StrategyGraphEdge = {
    id: nextEdgeId(graph),
    from: { nodeId: from.nodeId, port: from.port },
    to: { nodeId: to.nodeId, port: to.port },
  };
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] }, edgeId: edge.id };
}

export function removeEdge(graph: StrategyGraph, edgeId: string): StrategyGraph {
  if (!graph.edges.some((e) => e.id === edgeId)) return graph;
  return { ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) };
}

/** Удаление блока удаляет и ВСЕ присоединённые к нему связи. */
export function removeNode(graph: StrategyGraph, nodeId: string): StrategyGraph {
  if (!graph.nodes.some((n) => n.id === nodeId)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId),
  };
}

export function setNodeParam(
  graph: StrategyGraph,
  nodeId: string,
  paramId: string,
  value: number
): StrategyGraph {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return graph;
  const spec = BLOCK_REGISTRY[node.type].params.find((p) => p.id === paramId);
  if (!spec) return graph;
  if (typeof value !== 'number' || !Number.isFinite(value)) return graph;
  let next = spec.integer ? Math.round(value) : value;
  if (next < spec.min) next = spec.min;
  if (next > spec.max) next = spec.max;
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId ? { ...n, params: { ...n.params, [paramId]: next } } : n
    ),
  };
}

/** Перемещение блока — ТОЛЬКО UI-координаты, расчёты не затрагиваются. */
export function moveNode(
  graph: StrategyGraph,
  nodeId: string,
  position: GraphPosition
): StrategyGraph {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return graph;
  const clamp = (v: number) =>
    Math.max(-GRAPH_LIMITS.maxAbsPosition, Math.min(GRAPH_LIMITS.maxAbsPosition, Math.round(v)));
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId ? { ...n, position: { x: clamp(position.x), y: clamp(position.y) } } : n
    ),
  };
}

export function renameGraph(graph: StrategyGraph, name: string): StrategyGraph {
  return { ...graph, name: name.slice(0, GRAPH_LIMITS.maxNameLength) };
}
