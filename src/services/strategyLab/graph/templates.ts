/**
 * CRYPTORA — Strategy Lab · стартовые блок-схемы (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * «EMA Trend» — рабочий стартовый шаблон, графовый эквивалент текущей стратегии
 * по умолчанию (`defaultDraftDefinition`):
 *
 *   Цена закрытия → EMA Fast / EMA Slow
 *   EMA Fast + EMA Slow → Пересечение вверх → LONG
 *   EMA Fast + EMA Slow → Пересечение вниз  → SHORT
 *   ATR(14) × Число(1.5) → Стоп (риск)
 *   Число(2) → R → Тейк-профит (цель)
 *
 * Идентификаторы блоков совпадают с идентификаторами индикаторов текущего
 * Draft (`ema-fast`, `ema-slow`, `atr`), поэтому компиляция шаблона даёт
 * ПОБАЙТОВО то же определение (кроме названия) — это и есть основа паритета.
 *
 * Координаты заданы только для раскладки на холсте и на расчёты не влияют.
 */

import { GRAPH_SCHEMA_VERSION, type StrategyGraph } from './types';

export const EMA_TREND_TEMPLATE_NAME = 'EMA Trend';

/** Глубокая копия графа (канонические данные, без ссылок на UI-объекты). */
export function cloneStrategyGraph(graph: StrategyGraph): StrategyGraph {
  return {
    schemaVersion: graph.schemaVersion,
    name: graph.name,
    authoringMode: graph.authoringMode,
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      params: { ...n.params },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      from: { nodeId: e.from.nodeId, port: e.from.port },
      to: { nodeId: e.to.nodeId, port: e.to.port },
    })),
    ...(graph.execution ? { execution: { ...graph.execution } } : {}),
  };
}

/** Стартовая блок-схема «EMA Trend» (детерминированная, без Date.now). */
export function createEmaTrendTemplate(name = EMA_TREND_TEMPLATE_NAME): StrategyGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    name,
    authoringMode: 'blocks',
    nodes: [
      { id: 'close', type: 'CLOSE', position: { x: 0, y: 170 }, params: {} },
      { id: 'ema-fast', type: 'EMA', position: { x: 250, y: 40 }, params: { period: 20 } },
      { id: 'ema-slow', type: 'EMA', position: { x: 250, y: 220 }, params: { period: 50 } },
      { id: 'cross-up', type: 'CROSSES_ABOVE', position: { x: 520, y: 20 }, params: {} },
      { id: 'cross-down', type: 'CROSSES_BELOW', position: { x: 520, y: 220 }, params: {} },
      { id: 'long', type: 'LONG', position: { x: 790, y: 30 }, params: {} },
      { id: 'short', type: 'SHORT', position: { x: 790, y: 210 }, params: {} },
      { id: 'atr', type: 'ATR', position: { x: 250, y: 420 }, params: { period: 14 } },
      { id: 'stop-multiplier', type: 'NUMBER', position: { x: 250, y: 560 }, params: { value: 1.5 } },
      { id: 'stop-risk', type: 'MULTIPLY', position: { x: 520, y: 450 }, params: {} },
      { id: 'stop', type: 'STOP', position: { x: 1050, y: 390 }, params: {} },
      { id: 'target-value', type: 'NUMBER', position: { x: 520, y: 680 }, params: { value: 2 } },
      { id: 'target-r', type: 'R', position: { x: 790, y: 680 }, params: {} },
      { id: 'take-profit', type: 'TAKE_PROFIT', position: { x: 1050, y: 600 }, params: {} },
    ],
    edges: [
      { id: 'e-close-fast', from: { nodeId: 'close', port: 'value' }, to: { nodeId: 'ema-fast', port: 'price' } },
      { id: 'e-close-slow', from: { nodeId: 'close', port: 'value' }, to: { nodeId: 'ema-slow', port: 'price' } },
      { id: 'e-fast-up', from: { nodeId: 'ema-fast', port: 'value' }, to: { nodeId: 'cross-up', port: 'a' } },
      { id: 'e-slow-up', from: { nodeId: 'ema-slow', port: 'value' }, to: { nodeId: 'cross-up', port: 'b' } },
      { id: 'e-fast-down', from: { nodeId: 'ema-fast', port: 'value' }, to: { nodeId: 'cross-down', port: 'a' } },
      { id: 'e-slow-down', from: { nodeId: 'ema-slow', port: 'value' }, to: { nodeId: 'cross-down', port: 'b' } },
      { id: 'e-up-long', from: { nodeId: 'cross-up', port: 'condition' }, to: { nodeId: 'long', port: 'condition' } },
      { id: 'e-down-short', from: { nodeId: 'cross-down', port: 'condition' }, to: { nodeId: 'short', port: 'condition' } },
      { id: 'e-long-stop', from: { nodeId: 'long', port: 'signal' }, to: { nodeId: 'stop', port: 'signal' } },
      { id: 'e-short-stop', from: { nodeId: 'short', port: 'signal' }, to: { nodeId: 'stop', port: 'signal' } },
      { id: 'e-long-tp', from: { nodeId: 'long', port: 'signal' }, to: { nodeId: 'take-profit', port: 'signal' } },
      { id: 'e-short-tp', from: { nodeId: 'short', port: 'signal' }, to: { nodeId: 'take-profit', port: 'signal' } },
      { id: 'e-atr-mul', from: { nodeId: 'atr', port: 'value' }, to: { nodeId: 'stop-risk', port: 'a' } },
      { id: 'e-mult-mul', from: { nodeId: 'stop-multiplier', port: 'value' }, to: { nodeId: 'stop-risk', port: 'b' } },
      { id: 'e-mul-stop', from: { nodeId: 'stop-risk', port: 'value' }, to: { nodeId: 'stop', port: 'risk' } },
      { id: 'e-value-r', from: { nodeId: 'target-value', port: 'value' }, to: { nodeId: 'target-r', port: 'multiple' } },
      { id: 'e-r-tp', from: { nodeId: 'target-r', port: 'target' }, to: { nodeId: 'take-profit', port: 'target' } },
    ],
    execution: { feeBps: 5, slippageBps: 2 },
  };
}

export interface LabGraphTemplateMeta {
  id: string;
  name: string;
  summary: string;
  create: () => StrategyGraph;
}

export const LAB_GRAPH_TEMPLATES: readonly LabGraphTemplateMeta[] = Object.freeze([
  {
    id: 'ema-trend',
    name: EMA_TREND_TEMPLATE_NAME,
    summary:
      'Пересечение EMA 20/50 по цене закрытия, стоп ATR(14) × 1.5, цель 2R. Полный эквивалент текущей стратегии по умолчанию.',
    create: () => createEmaTrendTemplate(),
  },
]);
