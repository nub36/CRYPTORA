/**
 * CRYPTORA — форматирование времени для графиков `lightweight-charts`.
 *
 * Тонкая обёртка над ЕДИНЫМ форматтером (`utils/timePresentation`): здесь
 * остаётся только перевод типов библиотеки (`Time`, `TickMarkType`) в эпоху и
 * выбор детализации. Вся логика зоны — в одном месте, поэтому ось графика,
 * перекрестие и подпись бара не могут разойтись.
 *
 * ЗАПРЕЩЕНО (BUG D): показывать на графике техническую метку зоны («LOCAL»).
 * Время всегда — пояс браузера/ОС пользователя, DST учитывается `Intl`.
 */

import type { Time, TickMarkType } from 'lightweight-charts';
import {
  chartTimeToEpochMs,
  formatEpochTime,
  type ChartTimeZone,
} from './timePresentation';

export { chartTimeToEpochMs };

/**
 * Подпись деления оси времени.
 *
 * @param time значение от библиотеки
 * @param tickType 0 — год, 1 — месяц, 2 — месяц+день, 3 — время внутри дня
 */
export function formatChartAxisTime(time: Time, tickType: TickMarkType, zone: ChartTimeZone = 'BROWSER'): string {
  const epochMs = chartTimeToEpochMs(time);
  if (epochMs === null) return '';
  switch (tickType) {
    case 0:
      return formatEpochTime(epochMs, { mode: zone, granularity: 'year', locale: 'ru-RU' });
    case 1:
      return formatEpochTime(epochMs, { mode: zone, granularity: 'month', locale: 'ru-RU' });
    case 2:
      // День и месяц: год не нужен, его показывает деление уровня 0.
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: zone === 'UTC' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone,
        month: 'short',
        day: '2-digit',
      }).format(new Date(epochMs));
    default:
      return formatEpochTime(epochMs, { mode: zone, granularity: 'time', locale: 'ru-RU' });
  }
}

/** Подпись бара под перекрестием: дата и время в поясе пользователя. */
export function formatChartCrosshairTime(time: Time | undefined, zone: ChartTimeZone = 'BROWSER'): string {
  if (time === undefined) return '';
  const epochMs = chartTimeToEpochMs(time);
  if (epochMs === null) return '';
  return formatEpochTime(epochMs, { mode: zone, granularity: 'datetime', locale: 'ru-RU' });
}
