/**
 * CRYPTORA — Strategy Lab · стабильные идентификаторы индикаторов (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Код ссылается на индикаторы по идентификаторам, которые ДЕТЕРМИНИРОВАННО
 * выводятся из стабильных ID индикаторов:
 *
 *   'ema-fast' → EMA_FAST   'ema-slow' → EMA_SLOW   'atr-main' → ATR_MAIN
 *
 * ВАЖНО: идентификатор выводится ТОЛЬКО из стабильного внутреннего id и НИКОГДА
 * из отображаемого названия. Переименование подписи индикатора в UI не ломает
 * уже написанный код.
 *
 * Правила генерации безопасные: только [A-Z0-9_], не начинается с цифры,
 * ограничение длины, детерминированное разрешение коллизий (_2, _3 …).
 * Никакого eval: это чистое преобразование строк.
 */

import type { IndicatorDefinition } from '../types';

const MAX_IDENTIFIER_LENGTH = 48;

/** Безопасный идентификатор кода из стабильного ID индикатора. */
export function indicatorIdentifier(id: string): string {
  const upper = id
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = upper.length === 0 ? 'IND' : upper;
  const withPrefix = /^[0-9]/.test(safe) ? `IND_${safe}` : safe;
  return withPrefix.slice(0, MAX_IDENTIFIER_LENGTH);
}

export interface IndicatorBinding {
  identifier: string;
  indicator: IndicatorDefinition;
}

/**
 * Карта «идентификатор кода → индикатор» в порядке объявления индикаторов.
 * Коллизии разрешаются суффиксом `_2`, `_3`… детерминированно.
 */
export function buildIndicatorBindings(indicators: IndicatorDefinition[]): IndicatorBinding[] {
  const used = new Set<string>();
  const bindings: IndicatorBinding[] = [];
  for (const indicator of indicators) {
    const base = indicatorIdentifier(indicator.id);
    let identifier = base;
    let n = 2;
    while (used.has(identifier)) identifier = `${base}_${n++}`;
    used.add(identifier);
    bindings.push({ identifier, indicator });
  }
  return bindings;
}

/** Быстрый доступ по идентификатору. */
export function indicatorBindingMap(
  indicators: IndicatorDefinition[]
): Map<string, IndicatorDefinition> {
  return new Map(buildIndicatorBindings(indicators).map((b) => [b.identifier, b.indicator]));
}
