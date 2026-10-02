/**
 * CRYPTORA — Strategy Lab · валидация запросов (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Серверная валидация — ОБЯЗАТЕЛЬНА (§12): фронтенд не является источником
 * истины. Zod-схема отклоняет неизвестные таймфреймы, некорректный draft definition /
 * config и базовую корректность диапазона. Источник-специфичный потолок свечей
 * применяется сервисом только после проверки покрытия локального архива.
 *
 * ZodError глобально превращается в 400 (server/middleware/errorHandler.js).
 */

import { z } from 'zod';

/** Разрешённые таймфреймы Lab (зеркало src/services/strategyLab/types.ts). */
export const LAB_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

/** Длительность бара в мс — для проверки диапазона. */
export const LAB_TF_MS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** Лимиты применяются ПОСЛЕ выбора источника в Lab-сервисе. */
export const REST_MAX_CANDLES = 5000;
export const LOCAL_MAX_CANDLES = 120000;
/** @deprecated Совместимый alias старого REST-лимита. */
export const LAB_MAX_CANDLES = REST_MAX_CANDLES;

const SYMBOL_RE = /^[A-Z0-9]{2,25}$/;

/** number (epoch ms) | ISO-строка → epoch ms (целое). */
const timestampMs = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    let ms;
    if (typeof v === 'number') {
      ms = v;
    } else {
      const trimmed = v.trim();
      // Чисто числовая строка — это epoch ms; иначе пробуем ISO-дату.
      ms = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
    }
    if (!Number.isFinite(ms)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Некорректная дата/время' });
      return z.NEVER;
    }
    return Math.floor(ms);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Схема для Конструктора (Phase 2A Draft Definition)
// ─────────────────────────────────────────────────────────────────────────────

const periodIndicatorSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['EMA', 'ATR', 'RSI', 'FRACTALS']),
  name: z.string().max(64).optional(),
  period: z.number().int().min(1).max(1000),
  source: z.enum(['close', 'open', 'high', 'low']).optional(),
  visible: z.boolean().optional(),
});

const orderBlockIndicatorSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('ORDER_BLOCK'),
  name: z.string().max(64).optional(),
  lookback: z.number().int().min(1).max(20),
  displacementMultiplier: z.number().finite().min(0.1).max(10),
  atrIndicatorId: z.string().min(1).max(64),
  visible: z.boolean().optional(),
});

const marketStructureIndicatorSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MARKET_STRUCTURE'),
  name: z.string().max(64).optional(),
  leftBars: z.number().int().min(1).max(10),
  rightBars: z.number().int().min(1).max(10),
  visible: z.boolean().optional(),
});

/** Additive v2 indicator union: existing period indicators retain their shape. */
export const indicatorSchema = z.discriminatedUnion('type', [
  periodIndicatorSchema,
  orderBlockIndicatorSchema,
  marketStructureIndicatorSchema,
]);

export const logicRuleSchema = z.object({
  left: z.string().min(1).max(64),
  operator: z.enum(['crossesAbove', 'crossesBelow']),
  right: z.string().min(1).max(64),
});

export const stopSchema = z.object({
  type: z.literal('atrMultiple'),
  indicatorId: z.string().min(1).max(64),
  multiplier: z.number().min(0.01).max(100),
});

export const targetSchema = z.object({
  type: z.literal('rMultiple'),
  multiple: z.number().min(0.01).max(100),
});

export const executionSchema = z.object({
  feeBps: z.number().min(0).max(100),
  slippageBps: z.number().min(0).max(100),
});

export const strategyDefinitionSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    indicators: z.array(indicatorSchema).min(1).max(20),
    long: logicRuleSchema,
    short: logicRuleSchema,
    stop: stopSchema,
    target: targetSchema,
    execution: executionSchema.optional(),
  })
  .superRefine((def, ctx) => {
    const ids = new Set();
    const indicatorMap = new Map();
    for (const ind of def.indicators) {
      if (ids.has(ind.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['indicators'],
          message: `Дублирующийся ID индикатора: ${ind.id}`,
        });
      }
      ids.add(ind.id);
      indicatorMap.set(ind.id, ind);
    }

    // Проверка правила LONG
    const longLeft = indicatorMap.get(def.long.left);
    const longRight = indicatorMap.get(def.long.right);
    if (!longLeft) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['long', 'left'],
        message: `Неизвестный индикатор в правиле LONG: ${def.long.left}`,
      });
    } else if (longLeft.type !== 'EMA') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['long', 'left'],
        message: `Индикатор для правила LONG должен быть EMA (получен ${longLeft.type})`,
      });
    }
    if (!longRight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['long', 'right'],
        message: `Неизвестный индикатор в правиле LONG: ${def.long.right}`,
      });
    } else if (longRight.type !== 'EMA') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['long', 'right'],
        message: `Индикатор для правила LONG должен быть EMA (получен ${longRight.type})`,
      });
    }
    if (def.long.left === def.long.right) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['long'],
        message: 'Левый и правый индикатор в правиле LONG не могут совпадать',
      });
    }

    // Проверка правила SHORT
    const shortLeft = indicatorMap.get(def.short.left);
    const shortRight = indicatorMap.get(def.short.right);
    if (!shortLeft) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['short', 'left'],
        message: `Неизвестный индикатор в правиле SHORT: ${def.short.left}`,
      });
    } else if (shortLeft.type !== 'EMA') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['short', 'left'],
        message: `Индикатор для правила SHORT должен быть EMA (получен ${shortLeft.type})`,
      });
    }
    if (!shortRight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['short', 'right'],
        message: `Неизвестный индикатор в правиле SHORT: ${def.short.right}`,
      });
    } else if (shortRight.type !== 'EMA') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['short', 'right'],
        message: `Индикатор для правила SHORT должен быть EMA (получен ${shortRight.type})`,
      });
    }
    if (def.short.left === def.short.right) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['short'],
        message: 'Левый и правый индикатор в правиле SHORT не могут совпадать',
      });
    }

    // Проверка стопа
    const stopInd = indicatorMap.get(def.stop.indicatorId);
    if (!stopInd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stop', 'indicatorId'],
        message: `Неизвестный индикатор для стопа: ${def.stop.indicatorId}`,
      });
    } else if (stopInd.type !== 'ATR') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stop', 'indicatorId'],
        message: `Индикатор для стопа должен быть типа ATR (получен ${stopInd.type})`,
      });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Схема блок-схемы (BLOCKS-1): ТОЛЬКО форма данных
// ─────────────────────────────────────────────────────────────────────────────
/*
 * Здесь проверяется исключительно СХЕМА (типы, лимиты, стабильность ID).
 * Семантика графа (типы портов, циклы, обязательные входы, поддерживаемая
 * компилятором структура) проверяется ОБЩИМ валидатором из Lab-ядра —
 * `core.validateStrategyGraph` в labService.js. Второй реализации правил нет.
 */

export const GRAPH_MAX_NODES = 64;
export const GRAPH_MAX_EDGES = 128;

const GRAPH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const graphId = z.string().regex(GRAPH_ID_RE, { message: 'Некорректный идентификатор в блок-схеме' });

export const graphNodeSchema = z.object({
  id: graphId,
  type: z.string().min(1).max(64),
  position: z.object({
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
  }),
  params: z.record(z.string().max(64), z.number().finite()),
});

export const graphEndpointSchema = z.object({
  nodeId: graphId,
  port: z.string().min(1).max(64),
});

export const graphEdgeSchema = z.object({
  id: graphId,
  from: graphEndpointSchema,
  to: graphEndpointSchema,
});

export const strategyGraphSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(100),
  authoringMode: z.literal('blocks'),
  nodes: z.array(graphNodeSchema).min(1).max(GRAPH_MAX_NODES),
  edges: z.array(graphEdgeSchema).max(GRAPH_MAX_EDGES),
  execution: executionSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// CODE-FIRST черновик (индикаторы + код стратегии)
// ─────────────────────────────────────────────────────────────────────────────
/*
 * Здесь проверяется только ФОРМА запроса и жёсткие лимиты. Семантика кода
 * (разбор, ссылки на индикаторы, типы индикаторов, стоп/цель) проверяется ОБЩИМ
 * компилятором Lab-ядра — `core.compileResearchDraft` в labService.js. Второй
 * реализации правил языка нет.
 */

export const CODE_MAX_SOURCE_LENGTH = 32 * 1024;

export const strategyDraftSchema = z.object({
  name: z.string().min(1).max(100),
  indicators: z.array(indicatorSchema).min(1).max(20).superRefine((items, ctx) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    items.forEach((item, index) => {
      if (item.type === 'FRACTALS' && item.period !== 5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'period'], message: 'Фракталы используют фиксированный период 5.' });
      }
      if (item.type === 'ORDER_BLOCK') {
        const atr = byId.get(item.atrIndicatorId);
        if (!atr || atr.type !== 'ATR') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'atrIndicatorId'],
            message: 'ATR для Order Block должен ссылаться на настроенный индикатор ATR.',
          });
        }
      }
    });
  }),
  sourceCode: z.string().min(1).max(CODE_MAX_SOURCE_LENGTH),
  execution: executionSchema.optional(),
  apiVersion: z.literal(2),
});

// Legacy Phase 1A схема
export const researchConfigSchema = z
  .object({
    indicators: z.object({
      emaFast: z.number().int().min(1).max(500),
      emaSlow: z.number().int().min(2).max(1000),
      atrPeriod: z.number().int().min(1).max(500),
    }),
    strategy: z.object({
      stopAtrMult: z.number().min(0.1).max(20),
      targetR: z.number().min(0.1).max(20),
    }),
    execution: z.object({
      feeBps: z.number().min(0).max(100),
      slippageBps: z.number().min(0).max(100),
    }),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.indicators.emaSlow <= cfg.indicators.emaFast) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['indicators', 'emaSlow'],
        message: 'EMA Slow должен быть больше EMA Fast',
      });
    }
  });

export const replayRequestSchema = z
  .object({
    strategyId: z.string().min(1).max(64).optional(),
    strategyDefinition: strategyDefinitionSchema.optional(),
    strategyGraph: strategyGraphSchema.optional(),
    strategyDraft: strategyDraftSchema.optional(),
    market: z.enum(['spot', 'futures']),
    symbol: z
      .string()
      .transform((s) => s.trim().toUpperCase())
      .refine((s) => SYMBOL_RE.test(s), { message: 'Некорректный символ' }),
    timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']),
    from: timestampMs,
    to: timestampMs,
    researchConfig: researchConfigSchema.optional(),
  })
  .superRefine((req, ctx) => {
    if (!req.strategyDefinition && !req.researchConfig && !req.strategyGraph && !req.strategyDraft) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['strategyDraft'],
        message:
          'Необходимо передать `strategyDraft`, `strategyGraph`, `strategyDefinition` или `researchConfig`',
      });
    }
    if (req.strategyDraft && (req.strategyDefinition || req.strategyGraph)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['strategyDraft'],
        message: 'Нельзя одновременно передавать `strategyDraft` и другое определение стратегии',
      });
    }
    if (req.strategyGraph && req.strategyDefinition) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['strategyGraph'],
        message: 'Нельзя одновременно передавать `strategyGraph` и `strategyDefinition`',
      });
    }
    if (!(req.from < req.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: '`from` должен быть строго раньше `to`',
      });
      return;
    }
    // Лимит нельзя применять здесь: сначала Lab-сервис должен определить,
    // покрывает ли запрос локальный архив (120000) или нужен REST (5000).
  });

/** Разобрать и валидировать тело POST /api/strategy-lab/replay. Бросает ZodError. */
export function parseReplayRequest(body) {
  return replayRequestSchema.parse(body);
}
