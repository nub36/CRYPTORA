/**
 * CRYPTORA — Strategy Lab · шаблон кода стратегии (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Грамматика v2 (CODE-FIRST): индикаторы объявляются в разделе «ИНДИКАТОРЫ»,
 * код ТОЛЬКО ссылается на них по стабильным идентификаторам. Периоды в коде
 * больше не дублируются.
 *
 * Идентификаторы в шаблоне обязаны совпадать С ТОЧНОСТЬЮ ДО СИМВОЛА с теми,
 * что показаны на карточках индикаторов (см. draft/identifiers.ts и
 * регрессионный тест «стартовый шаблон ссылается ровно на показанные ID»).
 */

/** Версия языка кода стратегии. v1 — EMA(CLOSE, 20); v2 — ссылки на индикаторы. */
export const CODE_API_VERSION = 2 as const;

/** Сборка стартового кода под конкретное название стратегии. */
export function buildStarterCode(strategyName: string): string {
  const safeName = String(strategyName ?? '').replace(/["\\\n\r]/g, ' ').trim() || 'Новая стратегия';
  return `strategy(${JSON.stringify(safeName)}, () => {
  LONG(crossesAbove(EMA_FAST, EMA_SLOW));
  SHORT(crossesBelow(EMA_FAST, EMA_SLOW));

  STOP(multiply(ATR_MAIN, 1.5));
  TAKE_PROFIT(R(2));
});`;
}

/** Код стартовой стратегии (EMA Fast/Slow + ATR Main из настроек индикаторов). */
export const DEFAULT_STRATEGY_CODE = buildStarterCode('EMA Trend');
