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

export const indicatorSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['EMA', 'ATR']),
  name: z.string().max(64).optional(),
  period: z.number().int().min(1).max(1000),
  source: z.enum(['close', 'open', 'high', 'low']).optional(),
  visible: z.boolean().optional(),
});

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
    if (!req.strategyDefinition && !req.researchConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['strategyDefinition'],
        message: 'Необходимо передать `strategyDefinition` или `researchConfig`',
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
