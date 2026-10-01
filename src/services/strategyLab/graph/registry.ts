/**
 * CRYPTORA — Strategy Lab · реестр блоков блок-схемы (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * ЕДИНСТВЕННЫЙ источник истины о блоках: типы портов, параметры, русские
 * названия, категории и цветовой акцент. Реестр используют одинаково:
 *   • UI (палитра, узлы канвы, панель параметров);
 *   • валидатор (`validate.ts`) — фронтенд И сервер через общий Lab-бандл;
 *   • компилятор (`compile.ts`).
 *
 * Каждый блок — ОТДЕЛЬНЫЙ тип с собственной формой портов. Универсального
 * блока с выпадающим списком «тип» здесь нет и быть не должно.
 */

import {
  BLOCK_CATEGORIES,
  BLOCK_TYPES,
  type BlockCategory,
  type BlockType,
  type GraphNodeParams,
  type PortDirection,
  type PortType,
} from './types';

/** Цветовой акцент блока (§27). Конкретные классы задаёт UI-слой. */
export type BlockAccent = 'cyan' | 'blue' | 'violet' | 'amber' | 'green' | 'red';

export interface BlockPortSpec {
  id: string;
  /** Русская подпись порта. */
  label: string;
  type: PortType;
  /** Вход обязателен для валидного графа (только для входов). */
  required?: boolean;
  /** Вход принимает НЕСКОЛЬКО входящих рёбер (например STOP.signal: LONG+SHORT). */
  multi?: boolean;
  /** Точный русский текст ошибки «вход не подключён» (§17). */
  missingMessage?: string;
}

export interface BlockParamSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
  default: number;
  description: string;
}

export interface BlockDefinition {
  type: BlockType;
  category: BlockCategory;
  /** Русское отображаемое имя (§5). */
  label: string;
  description: string;
  accent: BlockAccent;
  inputs: readonly BlockPortSpec[];
  outputs: readonly BlockPortSpec[];
  params: readonly BlockParamSpec[];
}

export const BLOCK_CATEGORY_LABELS: Readonly<Record<BlockCategory, string>> = Object.freeze({
  DATA: 'ДАННЫЕ',
  INDICATORS: 'ИНДИКАТОРЫ',
  CONDITIONS: 'УСЛОВИЯ',
  VALUES: 'ЗНАЧЕНИЯ',
  ACTIONS: 'ДЕЙСТВИЯ',
  TRADE: 'СДЕЛКА',
});

export const PORT_TYPE_LABELS: Readonly<Record<PortType, string>> = Object.freeze({
  NUMBER_SERIES: 'числовой ряд',
  BOOL_SERIES: 'логический ряд',
  SCALAR: 'число',
  SIGNAL: 'сигнал',
  TARGET: 'цель',
});

const PERIOD_PARAM = (max: number, def: number): BlockParamSpec => ({
  id: 'period',
  label: 'Период',
  min: 1,
  max,
  step: 1,
  integer: true,
  default: def,
  description: 'Период индикатора в барах.',
});

const REGISTRY: Record<BlockType, BlockDefinition> = {
  CLOSE: {
    type: 'CLOSE',
    category: 'DATA',
    label: 'Цена закрытия',
    description: 'Ряд цен закрытия выбранного инструмента и таймфрейма.',
    accent: 'cyan',
    inputs: [],
    outputs: [{ id: 'value', label: 'Цена', type: 'NUMBER_SERIES' }],
    params: [],
  },
  EMA: {
    type: 'EMA',
    category: 'INDICATORS',
    label: 'EMA',
    description: 'Экспоненциальная скользящая средняя по подключённому ряду цены.',
    accent: 'violet',
    inputs: [
      {
        id: 'price',
        label: 'Цена',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'EMA: не подключён вход цены',
      },
    ],
    outputs: [{ id: 'value', label: 'Значение', type: 'NUMBER_SERIES' }],
    params: [PERIOD_PARAM(1000, 20)],
  },
  ATR: {
    type: 'ATR',
    category: 'INDICATORS',
    label: 'ATR',
    description: 'Average True Range (Wilder) — волатильность для дистанции стопа.',
    accent: 'violet',
    inputs: [],
    outputs: [{ id: 'value', label: 'Значение', type: 'NUMBER_SERIES' }],
    params: [PERIOD_PARAM(500, 14)],
  },
  CROSSES_ABOVE: {
    type: 'CROSSES_ABOVE',
    category: 'CONDITIONS',
    label: 'Пересечение вверх',
    description: 'Истина на баре, где ряд A пересекает ряд B снизу вверх.',
    accent: 'amber',
    inputs: [
      {
        id: 'a',
        label: 'A',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'Пересечение вверх: не подключён вход A',
      },
      {
        id: 'b',
        label: 'B',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'Пересечение вверх: не подключён вход B',
      },
    ],
    outputs: [{ id: 'condition', label: 'Условие', type: 'BOOL_SERIES' }],
    params: [],
  },
  CROSSES_BELOW: {
    type: 'CROSSES_BELOW',
    category: 'CONDITIONS',
    label: 'Пересечение вниз',
    description: 'Истина на баре, где ряд A пересекает ряд B сверху вниз.',
    accent: 'amber',
    inputs: [
      {
        id: 'a',
        label: 'A',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'Пересечение вниз: не подключён вход A',
      },
      {
        id: 'b',
        label: 'B',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'Пересечение вниз: не подключён вход B',
      },
    ],
    outputs: [{ id: 'condition', label: 'Условие', type: 'BOOL_SERIES' }],
    params: [],
  },
  NUMBER: {
    type: 'NUMBER',
    category: 'VALUES',
    label: 'Число',
    description: 'Числовая константа (множитель стопа, кратность R).',
    accent: 'blue',
    inputs: [],
    outputs: [{ id: 'value', label: 'Значение', type: 'SCALAR' }],
    params: [
      {
        id: 'value',
        label: 'Значение',
        min: 0.01,
        max: 100,
        step: 0.1,
        integer: false,
        default: 1,
        description: 'Числовая константа от 0.01 до 100.',
      },
    ],
  },
  MULTIPLY: {
    type: 'MULTIPLY',
    category: 'VALUES',
    label: 'Умножить',
    description: 'Умножает числовой ряд на числовую константу.',
    accent: 'blue',
    inputs: [
      {
        id: 'a',
        label: 'Ряд',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'Умножить: не подключён числовой ряд',
      },
      {
        id: 'b',
        label: 'Множитель',
        type: 'SCALAR',
        required: true,
        missingMessage: 'Умножить: не подключён множитель',
      },
    ],
    outputs: [{ id: 'value', label: 'Результат', type: 'NUMBER_SERIES' }],
    params: [],
  },
  R: {
    type: 'R',
    category: 'VALUES',
    label: 'R',
    description: 'Цель в единицах риска: кратность R от дистанции до стопа.',
    accent: 'blue',
    inputs: [
      {
        id: 'multiple',
        label: 'Кратность',
        type: 'SCALAR',
        required: true,
        missingMessage: 'R: не подключена кратность',
      },
    ],
    outputs: [{ id: 'target', label: 'Цель', type: 'TARGET' }],
    params: [],
  },
  LONG: {
    type: 'LONG',
    category: 'ACTIONS',
    label: 'LONG',
    description: 'Открывает длинную сторону по истинному условию.',
    accent: 'green',
    inputs: [
      {
        id: 'condition',
        label: 'Условие',
        type: 'BOOL_SERIES',
        required: true,
        missingMessage: 'LONG: не подключено условие',
      },
    ],
    outputs: [{ id: 'signal', label: 'Сигнал', type: 'SIGNAL' }],
    params: [],
  },
  SHORT: {
    type: 'SHORT',
    category: 'ACTIONS',
    label: 'SHORT',
    description: 'Открывает короткую сторону по истинному условию.',
    accent: 'red',
    inputs: [
      {
        id: 'condition',
        label: 'Условие',
        type: 'BOOL_SERIES',
        required: true,
        missingMessage: 'SHORT: не подключено условие',
      },
    ],
    outputs: [{ id: 'signal', label: 'Сигнал', type: 'SIGNAL' }],
    params: [],
  },
  STOP: {
    type: 'STOP',
    category: 'TRADE',
    label: 'Стоп',
    description: 'Защитный стоп: дистанция от цены входа задаётся числовым рядом риска.',
    accent: 'red',
    inputs: [
      {
        id: 'signal',
        label: 'Сигнал',
        type: 'SIGNAL',
        required: true,
        multi: true,
        missingMessage: 'Стоп: не подключён сигнал',
      },
      {
        id: 'risk',
        label: 'Риск',
        type: 'NUMBER_SERIES',
        required: true,
        missingMessage: 'Стоп: не подключён риск',
      },
    ],
    outputs: [],
    params: [],
  },
  TAKE_PROFIT: {
    type: 'TAKE_PROFIT',
    category: 'TRADE',
    label: 'Тейк-профит',
    description: 'Цель сделки в единицах риска R.',
    accent: 'green',
    inputs: [
      {
        id: 'signal',
        label: 'Сигнал',
        type: 'SIGNAL',
        required: true,
        multi: true,
        missingMessage: 'Тейк-профит: не подключён сигнал',
      },
      {
        id: 'target',
        label: 'Цель',
        type: 'TARGET',
        required: true,
        missingMessage: 'Тейк-профит: не подключена цель',
      },
    ],
    outputs: [],
    params: [],
  },
};

export const BLOCK_REGISTRY: Readonly<Record<BlockType, BlockDefinition>> = Object.freeze(REGISTRY);

export function isKnownBlockType(type: unknown): type is BlockType {
  return typeof type === 'string' && (BLOCK_TYPES as readonly string[]).includes(type);
}

export function getBlockDefinition(type: unknown): BlockDefinition | undefined {
  return isKnownBlockType(type) ? BLOCK_REGISTRY[type] : undefined;
}

export function getBlockPort(
  type: BlockType,
  portId: string,
  direction: PortDirection
): BlockPortSpec | undefined {
  const def = BLOCK_REGISTRY[type];
  const list = direction === 'input' ? def.inputs : def.outputs;
  return list.find((p) => p.id === portId);
}

/** СТРОГАЯ совместимость портов: типы обязаны совпадать (§7). */
export function arePortTypesCompatible(from: PortType, to: PortType): boolean {
  return from === to;
}

/** Параметры блока по умолчанию — детерминированы, без Date.now/Math.random. */
export function defaultBlockParams(type: BlockType): GraphNodeParams {
  const params: GraphNodeParams = {};
  for (const p of BLOCK_REGISTRY[type].params) params[p.id] = p.default;
  return params;
}

export interface BlockCategoryGroup {
  category: BlockCategory;
  label: string;
  blocks: BlockDefinition[];
}

/** Палитра, сгруппированная по категориям в фиксированном порядке. */
export function listBlocksByCategory(): BlockCategoryGroup[] {
  return BLOCK_CATEGORIES.map((category) => ({
    category,
    label: BLOCK_CATEGORY_LABELS[category],
    blocks: BLOCK_TYPES.map((t) => BLOCK_REGISTRY[t]).filter((b) => b.category === category),
  }));
}
