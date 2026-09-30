/**
 * CRYPTORA — Strategy Lab · валидация запросов (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Серверная валидация — ОБЯЗАТЕЛЬНА (§12): фронтенд не является источником
 * истины. Zod-схема отклоняет неизвестные таймфреймы, некорректный config и
 * запросы, которые превысили бы жёсткий потолок свечей/диапазона (§13, §14).
 *
 * ZodError глобально превращается в 400 (server/middleware/errorHandler.js).
 *
 * Константы (таймфреймы, потолок) осознанно продублированы здесь как
 * defense-in-depth и чтобы не собирать esbuild-бандл ради простой валидации.
 */

import { z } from 'zod';

/** Разрешённые таймфреймы Lab (зеркало src/services/strategyLab/types.ts). */
export const LAB_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

/** Длительность бара в мс — для проверки диапазона. */
export const LAB_TF_MS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** Жёсткий потолок закрытых свечей на один replay. */
export const LAB_MAX_CANDLES = 5000;

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

const researchConfigSchema = z.object({
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
}).superRefine((cfg, ctx) => {
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
    strategyId: z.string().min(1).max(64),
    market: z.enum(['spot', 'futures']),
    symbol: z
      .string()
      .transform((s) => s.trim().toUpperCase())
      .refine((s) => SYMBOL_RE.test(s), { message: 'Некорректный символ' }),
    timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
    from: timestampMs,
    to: timestampMs,
    researchConfig: researchConfigSchema,
  })
  .superRefine((req, ctx) => {
    if (!(req.from < req.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: '`from` должен быть строго раньше `to`',
      });
      return;
    }
    const spanMs = LAB_TF_MS[req.timeframe];
    const estimatedBars = Math.ceil((req.to - req.from) / spanMs);
    if (estimatedBars > LAB_MAX_CANDLES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: `Диапазон ~${estimatedBars} свечей превышает лимит ${LAB_MAX_CANDLES}. Сузьте период или увеличьте таймфрейм.`,
      });
    }
  });

/** Разобрать и валидировать тело POST /api/strategy-lab/replay. Бросает ZodError. */
export function parseReplayRequest(body) {
  return replayRequestSchema.parse(body);
}
