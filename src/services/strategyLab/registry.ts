/**
 * CRYPTORA — Strategy Lab · реестр исследовательских стратегий (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Метаданные стратегий Lab: id, описание правила и ОПИСАТЕЛИ ПАРАМЕТРОВ. Панель
 * настроек на /strategy-lab строится ИЗ этого описания (а не хардкодом «все поля
 * для всех стратегий»): каждая стратегия объявляет ровно те поля, которые реально
 * использует.
 *
 * Это НЕ production-каталог стратегий (server/services/strategyCatalog.js) — он
 * не трогается. Здесь только новые research-стратегии.
 */

import type { ResearchConfig } from './types';

export type LabParamGroup = 'indicators' | 'strategy' | 'execution';

export interface LabParamField {
  /** Путь вида "indicators.emaFast" внутри ResearchConfig. */
  path: string;
  key: string;
  label: string;
  group: LabParamGroup;
  min: number;
  max: number;
  step: number;
  default: number;
  /** true — целое число (периоды), false — дробное допустимо. */
  integer: boolean;
  description: string;
}

export interface LabStrategyMeta {
  id: string;
  name: string;
  summary: string;
  /** Точное детерминированное правило (для UI и обучения). */
  rule: string[];
  fields: LabParamField[];
}

export const EMA_ATR_ID = 'EMA_ATR';

const EMA_ATR: LabStrategyMeta = {
  id: EMA_ATR_ID,
  name: 'EMA + ATR',
  summary:
    'Исследовательская стратегия CRYPTORA: сигнал по пересечению EMA с ATR-стопом и целью в единицах R. Работает только внутри Strategy Lab и не публикует production-сигналы.',
  rule: [
    'Сигнал по пересечению EMA на ЗАКРЫТОМ баре i.',
    'LONG: EMA Fast пересекает EMA Slow снизу вверх (fast[i-1] ≤ slow[i-1] и fast[i] > slow[i]).',
    'SHORT: EMA Fast пересекает EMA Slow сверху вниз (fast[i-1] ≥ slow[i-1] и fast[i] < slow[i]).',
    'knownAt = closeTime бара i (сигнал известен только после закрытия бара).',
    'Вход: по OPEN следующего бара i+1 (market next open), с проскальзыванием.',
    'Стоп = вход ∓ ATR(i) × Stop ATR. Цель = вход ± (Target R × дистанция до стопа).',
    'Одна свеча задела и стоп, и цель → консервативно засчитывается СТОП (worst-case).',
    'Отказы (реальные причины движка): NO_ATR (нет ATR), ZERO_ATR (ATR ≤ 0), NO_ENTRY_BAR (нет следующего бара для входа).',
  ],
  fields: [
    {
      path: 'indicators.emaFast',
      key: 'emaFast',
      label: 'EMA Fast',
      group: 'indicators',
      min: 1,
      max: 500,
      step: 1,
      default: 20,
      integer: true,
      description: 'Период быстрой EMA (по цене закрытия).',
    },
    {
      path: 'indicators.emaSlow',
      key: 'emaSlow',
      label: 'EMA Slow',
      group: 'indicators',
      min: 2,
      max: 1000,
      step: 1,
      default: 50,
      integer: true,
      description: 'Период медленной EMA. Должен быть больше EMA Fast.',
    },
    {
      path: 'indicators.atrPeriod',
      key: 'atrPeriod',
      label: 'ATR Period',
      group: 'indicators',
      min: 1,
      max: 500,
      step: 1,
      default: 14,
      integer: true,
      description: 'Период ATR (Wilder) для расчёта дистанции стопа.',
    },
    {
      path: 'strategy.stopAtrMult',
      key: 'stopAtrMult',
      label: 'Stop ATR ×',
      group: 'strategy',
      min: 0.1,
      max: 20,
      step: 0.1,
      default: 1.5,
      integer: false,
      description: 'Множитель ATR для дистанции стопа от цены входа.',
    },
    {
      path: 'strategy.targetR',
      key: 'targetR',
      label: 'Target R',
      group: 'strategy',
      min: 0.1,
      max: 20,
      step: 0.1,
      default: 2.0,
      integer: false,
      description: 'Цель в единицах риска R (дистанция цели = Target R × дистанция стопа).',
    },
    {
      path: 'execution.feeBps',
      key: 'feeBps',
      label: 'Fee (bps)',
      group: 'execution',
      min: 0,
      max: 100,
      step: 0.1,
      default: 5,
      integer: false,
      description: 'Комиссия в базисных пунктах на сторону (вход и выход).',
    },
    {
      path: 'execution.slippageBps',
      key: 'slippageBps',
      label: 'Slippage (bps)',
      group: 'execution',
      min: 0,
      max: 100,
      step: 0.1,
      default: 2,
      integer: false,
      description: 'Проскальзывание в bps, применяется к цене входа и выхода.',
    },
  ],
};

export const LAB_STRATEGIES: readonly LabStrategyMeta[] = Object.freeze([EMA_ATR]);

export function getLabStrategy(id: string): LabStrategyMeta | undefined {
  return LAB_STRATEGIES.find((s) => s.id === id);
}

export function isKnownLabStrategy(id: string): boolean {
  return LAB_STRATEGIES.some((s) => s.id === id);
}

/** Дефолтная researchConfig стратегии из описателей полей. */
export function defaultResearchConfig(id: string): ResearchConfig {
  const meta = getLabStrategy(id) ?? EMA_ATR;
  const cfg: ResearchConfig = {
    indicators: { emaFast: 20, emaSlow: 50, atrPeriod: 14 },
    strategy: { stopAtrMult: 1.5, targetR: 2.0 },
    execution: { feeBps: 5, slippageBps: 2 },
  };
  for (const f of meta.fields) {
    const [group, key] = f.path.split('.') as [keyof ResearchConfig, string];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cfg[group] as any)[key] = f.default;
  }
  return cfg;
}
