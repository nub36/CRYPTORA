/**
 * CRYPTORA — Strategy Lab · блок-схема стратегии: канонические типы (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * RESEARCH ONLY. Модуль не участвует в production-стратегиях (V2.8/V3.0/V3.3/
 * V3.4), production-сигналах, scheduler или БД — это изолированный контур
 * Strategy Lab.
 *
 * `StrategyGraph` — ЕДИНСТВЕННАЯ каноническая модель блок-схемы. Она не зависит
 * ни от React, ни от какой-либо UI-библиотеки. Пользовательский блок-редактор
 * УДАЛЁН: граф остался только как ВНУТРЕННЕЕ IR компилятора/валидатора и не
 * является пользовательской функцией.
 *
 * `position` — ЧИСТО UI-поле. Математика стратегии обязана быть независимой от
 * координат: компилятор строит определение по рёбрам, а не по раскладке.
 *
 * Граф — это ДАННЫЕ. Никакого eval / new Function / пользовательского JS.
 */

/** Версия схемы графа. Инкрементируется только при несовместимых изменениях. */
export const GRAPH_SCHEMA_VERSION = 1 as const;

/** Режимы авторинга стратегии в Lab. `code` зарезервирован под CODE-1. */
export const LAB_AUTHORING_MODES = ['blocks', 'simple', 'code'] as const;
export type LabAuthoringMode = (typeof LAB_AUTHORING_MODES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Типы портов
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Типы портов. Совместимость СТРОГАЯ (равенство типов): «почти подходящие»
 * соединения запрещены и на фронтенде, и на сервере.
 *
 *   NUMBER_SERIES — числовой ряд по барам (цена, EMA, ATR, произведение);
 *   BOOL_SERIES   — логический ряд по барам (условие пересечения);
 *   SCALAR        — одно число (параметрическая константа);
 *   SIGNAL        — торговое намерение стороны (LONG/SHORT);
 *   TARGET        — описание цели (кратность R).
 */
export const PORT_TYPES = [
  'NUMBER_SERIES',
  'BOOL_SERIES',
  'SCALAR',
  'SIGNAL',
  'TARGET',
] as const;
export type PortType = (typeof PORT_TYPES)[number];

export type PortDirection = 'input' | 'output';

// ─────────────────────────────────────────────────────────────────────────────
// Категории и типы блоков
// ─────────────────────────────────────────────────────────────────────────────

export const BLOCK_CATEGORIES = [
  'DATA',
  'INDICATORS',
  'CONDITIONS',
  'VALUES',
  'ACTIONS',
  'TRADE',
] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

/** Блоки V1. Каждый блок — ОТДЕЛЬНЫЙ тип, а не «универсальный блок с dropdown». */
export const BLOCK_TYPES = [
  'CLOSE',
  'EMA',
  'ATR',
  'CROSSES_ABOVE',
  'CROSSES_BELOW',
  'NUMBER',
  'MULTIPLY',
  'R',
  'LONG',
  'SHORT',
  'STOP',
  'TAKE_PROFIT',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Канонический граф
// ─────────────────────────────────────────────────────────────────────────────

/** UI-координата блока. На расчёты не влияет НИКОГДА. */
export interface GraphPosition {
  x: number;
  y: number;
}

/** Параметры блока — только конечные числа (данные, не код). */
export type GraphNodeParams = Record<string, number>;

export interface StrategyGraphNode {
  id: string;
  type: BlockType;
  /** UI-only. */
  position: GraphPosition;
  params: GraphNodeParams;
}

export interface GraphEndpoint {
  nodeId: string;
  port: string;
}

export interface StrategyGraphEdge {
  id: string;
  from: GraphEndpoint;
  to: GraphEndpoint;
}

/** Параметры исполнения (комиссия/проскальзывание) — вне блоков, как в Draft. */
export interface StrategyGraphExecution {
  feeBps: number;
  slippageBps: number;
}

export interface StrategyGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  name: string;
  authoringMode: 'blocks';
  nodes: StrategyGraphNode[];
  edges: StrategyGraphEdge[];
  execution?: StrategyGraphExecution;
}

// ─────────────────────────────────────────────────────────────────────────────
// Жёсткие лимиты
// ─────────────────────────────────────────────────────────────────────────────

export const GRAPH_LIMITS = Object.freeze({
  maxNodes: 64,
  maxEdges: 128,
  maxNameLength: 100,
  maxIdLength: 64,
  /** Диапазон UI-координат: защита от NaN/Infinity и абсурдных значений. */
  maxAbsPosition: 1_000_000,
});

/** Стабильные ID: только латиница/цифры/дефис/подчёркивание, 1..64 символа. */
export const GRAPH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Ошибки валидации
// ─────────────────────────────────────────────────────────────────────────────

export type GraphErrorCode =
  | 'GRAPH_NOT_OBJECT'
  | 'SCHEMA_VERSION'
  | 'AUTHORING_MODE'
  | 'GRAPH_NAME'
  | 'NODES_NOT_ARRAY'
  | 'EDGES_NOT_ARRAY'
  | 'EMPTY_GRAPH'
  | 'MAX_NODES'
  | 'MAX_EDGES'
  | 'INVALID_NODE_ID'
  | 'DUPLICATE_NODE_ID'
  | 'UNKNOWN_BLOCK_TYPE'
  | 'INVALID_POSITION'
  | 'INVALID_PARAMS'
  | 'UNKNOWN_PARAM'
  | 'MISSING_PARAM'
  | 'INVALID_PARAM_VALUE'
  | 'INVALID_EDGE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'UNKNOWN_EDGE_NODE'
  | 'UNKNOWN_PORT'
  | 'INCOMPATIBLE_PORTS'
  | 'SELF_CONNECTION'
  | 'DUPLICATE_EDGE'
  | 'SINGLE_INPUT_PORT'
  | 'CYCLE'
  | 'MISSING_REQUIRED_INPUT'
  | 'MISSING_BLOCK'
  | 'DUPLICATE_BLOCK'
  | 'UNSUPPORTED_SOURCE'
  | 'SAME_CONDITION_INPUTS'
  | 'INVALID_EXECUTION';

export interface GraphValidationError {
  code: GraphErrorCode;
  /** Человекочитаемое сообщение на русском — показывается пользователю как есть. */
  message: string;
  nodeId?: string;
  edgeId?: string;
  port?: string;
}

export interface GraphValidationResult {
  ok: boolean;
  errors: GraphValidationError[];
}
