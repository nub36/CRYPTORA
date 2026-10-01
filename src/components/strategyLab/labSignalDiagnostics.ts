/**
 * CRYPTORA — Strategy Lab · диагностика условий на сигнальном баре (frontend)
 * ---------------------------------------------------------------------------
 * Чистая функция для инспектора сделки (§7): показывает индикаторы стратегии
 * на баре сигнала. Значения НЕ пересчитываются и НЕ выдумываются — читаются
 * готовые series движка (indicators.byIndicatorId), выровненные по индексу
 * свечей, на индексе бара signalTime. Пересечение печатается только по
 * фактическим значениям серии на i−1 и i.
 *
 * Если движок не вернул серий/определение неизвестно — возвращается пустой
 * результат, и инспектор честно скрывает блок условий (limitation, §7).
 */

import type {
  LabIndicatorSeries,
  LabReplayResult,
  LabTrade,
  StrategyDraftDefinition,
} from '@/services/strategyLab/types';

export interface LabIndicatorValueRow {
  /** Имя индикатора («EMA 20»). */
  label: string;
  /** Значение на сигнальном баре (null — прогрев). */
  value: number | null;
}

export interface LabSignalDiagnostics {
  /** Индикаторы правила на сигнальном баре (left/right правила стороны сделки). */
  ruleRows: LabIndicatorValueRow[];
  /** Индикатор стопа (ATR) на сигнальном баре. */
  stopRow: LabIndicatorValueRow | null;
  /** Фактическое пересечение по значениям серии, например «EMA 20 пересекла EMA 50 вверх». */
  crossText: string | null;
}

function indicatorLabel(
  definition: StrategyDraftDefinition | null | undefined,
  indicatorId: string,
  series: LabIndicatorSeries
): string {
  // Приоритет — определению ИЗ РЕЗУЛЬТАТА (то, что реально исполнялось):
  // определение в конструкторе пользователь мог отредактировать после бэктеста.
  const fromResult = series.indicatorsList?.find((ind) => ind.id === indicatorId);
  if (fromResult?.name) return fromResult.name;
  if (fromResult) return `${fromResult.type} ${fromResult.period}`;
  const def = definition?.indicators.find((ind) => ind.id === indicatorId);
  if (def?.name) return def.name;
  if (def) return `${def.type} ${def.period}`;
  return indicatorId;
}

function crossDirection(
  prevLeft: number | null,
  curLeft: number | null,
  prevRight: number | null,
  curRight: number | null
): 'up' | 'down' | null {
  if (
    prevLeft === null || curLeft === null || prevRight === null || curRight === null
  ) {
    return null;
  }
  if (prevLeft <= prevRight && curLeft > curRight) return 'up';
  if (prevLeft >= prevRight && curLeft < curRight) return 'down';
  return null;
}

/**
 * Диагностика условий сделки на её сигнальном баре.
 * Возвращает null-подобный результат (пустые rows), если данных нет.
 */
export function getLabSignalDiagnostics(
  result: LabReplayResult,
  trade: LabTrade,
  definition: StrategyDraftDefinition | null | undefined
): LabSignalDiagnostics {
  const series = result.indicators;
  const byId = series.byIndicatorId;
  const empty: LabSignalDiagnostics = { ruleRows: [], stopRow: null, crossText: null };
  if (!byId) return empty;

  // Индекс бара сигнала в массиве свечей (series выровнены по этому индексу).
  const signalIndex = result.candles.findIndex((c) => c.time === trade.signalTime);
  if (signalIndex < 0) return empty;

  const rule = trade.side === 'LONG' ? definition?.long : definition?.short;
  if (!rule) return empty;

  const leftSeries = byId[rule.left];
  const rightSeries = byId[rule.right];
  if (!leftSeries || !rightSeries) return empty;

  const ruleRows: LabIndicatorValueRow[] = [
    {
      label: indicatorLabel(definition, rule.left, series),
      value: leftSeries[signalIndex] ?? null,
    },
    {
      label: indicatorLabel(definition, rule.right, series),
      value: rightSeries[signalIndex] ?? null,
    },
  ];

  const direction = crossDirection(
    leftSeries[signalIndex - 1] ?? null,
    leftSeries[signalIndex] ?? null,
    rightSeries[signalIndex - 1] ?? null,
    rightSeries[signalIndex] ?? null
  );

  // Пересечение печатается только если фактическое направление серии
  // соответствует оператору правила (защита от редактирования конструктора
  // ПОСЛЕ бэктеста: данные всегда из результата, а не из живой формы).
  const directionMatchesRule =
    direction !== null &&
    ((rule.operator === 'crossesAbove' && direction === 'up') ||
      (rule.operator === 'crossesBelow' && direction === 'down'));

  const crossText =
    directionMatchesRule && direction !== null
      ? `${ruleRows[0].label} пересекла ${ruleRows[1].label} ${direction === 'up' ? 'вверх' : 'вниз'}`
      : null;

  let stopRow: LabIndicatorValueRow | null = null;
  const stopId = definition?.stop.indicatorId;
  if (stopId && byId[stopId]) {
    stopRow = {
      label: indicatorLabel(definition, stopId, series),
      value: byId[stopId][signalIndex] ?? null,
    };
  }

  return { ruleRows, stopRow, crossText };
}
