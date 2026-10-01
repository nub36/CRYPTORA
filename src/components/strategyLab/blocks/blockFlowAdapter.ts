/**
 * CRYPTORA — Strategy Lab · адаптер StrategyGraph ↔ React Flow (BLOCKS-1)
 * ---------------------------------------------------------------------------
 * КАНОНИЧЕСКАЯ модель стратегии — `StrategyGraph` (src/services/strategyLab/graph).
 * Объекты @xyflow/react НИКОГДА не сохраняются как модель: они существуют
 * только на время отрисовки. Этот модуль — единственное место перевода между
 * ними, поэтому будущий режим «КОД» (CODE-1) сможет работать с тем же графом
 * без React Flow вообще.
 *
 * Идентификаторы ручек (handles) кодируются как `in:<port>` / `out:<port>`,
 * чтобы один и тот же порт на входе и выходе не конфликтовал.
 */

import type { Edge, Node } from '@xyflow/react';
import {
  BLOCK_REGISTRY,
  type BlockAccent,
} from '@/services/strategyLab/graph/registry';
import type {
  BlockType,
  GraphEndpoint,
  PortDirection,
  PortType,
  StrategyGraph,
} from '@/services/strategyLab/graph/types';

export const LAB_BLOCK_NODE_TYPE = 'labBlock';

export interface LabBlockNodeData extends Record<string, unknown> {
  blockType: BlockType;
  params: Record<string, number>;
  /** Есть ли у блока ошибки валидации — для красной рамки. */
  invalid: boolean;
}

export type LabBlockFlowNode = Node<LabBlockNodeData, typeof LAB_BLOCK_NODE_TYPE>;

export function encodeHandleId(direction: PortDirection, port: string): string {
  return `${direction === 'input' ? 'in' : 'out'}:${port}`;
}

export function decodeHandleId(
  handleId: string | null | undefined
): { direction: PortDirection; port: string } | null {
  if (!handleId) return null;
  const sep = handleId.indexOf(':');
  if (sep <= 0) return null;
  const prefix = handleId.slice(0, sep);
  const port = handleId.slice(sep + 1);
  if (!port) return null;
  if (prefix === 'in') return { direction: 'input', port };
  if (prefix === 'out') return { direction: 'output', port };
  return null;
}

/** Цвет провода по типу данных порта-источника (§27, тёмный терминальный стиль). */
export const PORT_TYPE_COLORS: Readonly<Record<PortType, string>> = Object.freeze({
  NUMBER_SERIES: '#22d3ee',
  BOOL_SERIES: '#fbbf24',
  SCALAR: '#60a5fa',
  SIGNAL: '#a78bfa',
  TARGET: '#34d399',
});

export const ACCENT_CLASSES: Readonly<
  Record<BlockAccent, { border: string; header: string; text: string; dot: string }>
> = Object.freeze({
  cyan: {
    border: 'border-cyan-400/40',
    header: 'bg-cyan-500/15',
    text: 'text-cyan-200',
    dot: 'bg-cyan-400',
  },
  blue: {
    border: 'border-sky-400/40',
    header: 'bg-sky-500/15',
    text: 'text-sky-200',
    dot: 'bg-sky-400',
  },
  violet: {
    border: 'border-violet-400/40',
    header: 'bg-violet-500/15',
    text: 'text-violet-200',
    dot: 'bg-violet-400',
  },
  amber: {
    border: 'border-amber-400/40',
    header: 'bg-amber-500/15',
    text: 'text-amber-200',
    dot: 'bg-amber-400',
  },
  green: {
    border: 'border-emerald-400/45',
    header: 'bg-emerald-500/15',
    text: 'text-emerald-200',
    dot: 'bg-emerald-400',
  },
  red: {
    border: 'border-rose-400/45',
    header: 'bg-rose-500/15',
    text: 'text-rose-200',
    dot: 'bg-rose-400',
  },
});

export interface FlowProjectionOptions {
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  /** ID блоков с ошибками валидации. */
  invalidNodeIds?: ReadonlySet<string>;
}

/** StrategyGraph → узлы React Flow (представление, не модель). */
export function graphToFlowNodes(
  graph: StrategyGraph,
  options: FlowProjectionOptions = {}
): LabBlockFlowNode[] {
  const invalid = options.invalidNodeIds;
  return graph.nodes.map((node) => ({
    id: node.id,
    type: LAB_BLOCK_NODE_TYPE,
    position: { x: node.position.x, y: node.position.y },
    selected: options.selectedNodeId === node.id,
    data: {
      blockType: node.type,
      params: { ...node.params },
      invalid: invalid ? invalid.has(node.id) : false,
    },
  }));
}

/** StrategyGraph → рёбра React Flow. */
export function graphToFlowEdges(
  graph: StrategyGraph,
  options: FlowProjectionOptions = {}
): Edge[] {
  return graph.edges.map((edge) => {
    const fromNode = graph.nodes.find((n) => n.id === edge.from.nodeId);
    const portType = fromNode
      ? BLOCK_REGISTRY[fromNode.type].outputs.find((p) => p.id === edge.from.port)?.type
      : undefined;
    const color = portType ? PORT_TYPE_COLORS[portType] : '#64748b';
    const selected = options.selectedEdgeId === edge.id;
    return {
      id: edge.id,
      source: edge.from.nodeId,
      sourceHandle: encodeHandleId('output', edge.from.port),
      target: edge.to.nodeId,
      targetHandle: encodeHandleId('input', edge.to.port),
      type: 'smoothstep',
      selected,
      style: {
        stroke: color,
        strokeWidth: selected ? 3.5 : 2,
        opacity: selected ? 1 : 0.85,
      },
    } satisfies Edge;
  });
}

export interface FlowConnectionLike {
  source?: string | null;
  sourceHandle?: string | null;
  target?: string | null;
  targetHandle?: string | null;
}

/**
 * Соединение React Flow → концы канонического ребра. `null`, если React Flow
 * прислал неполное/развёрнутое соединение (например, тянули из входа в выход).
 */
export function connectionToEndpoints(
  connection: FlowConnectionLike
): { from: GraphEndpoint; to: GraphEndpoint } | null {
  if (!connection.source || !connection.target) return null;
  const source = decodeHandleId(connection.sourceHandle);
  const target = decodeHandleId(connection.targetHandle);
  if (!source || !target) return null;
  if (source.direction !== 'output' || target.direction !== 'input') return null;
  return {
    from: { nodeId: connection.source, port: source.port },
    to: { nodeId: connection.target, port: target.port },
  };
}

/** Ключ подсветки совместимого входа при tap-to-connect. */
export function endpointHighlightKey(endpoint: GraphEndpoint): string {
  return `${endpoint.nodeId}|${endpoint.port}`;
}
