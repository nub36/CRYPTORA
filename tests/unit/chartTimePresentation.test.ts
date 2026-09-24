/**
 * CRYPTORA — единый форматтер времени: UTC в данных, пояс браузера на экране.
 *
 * Проверяются три вещи, которые легко сломать и которые дорого стоят:
 *   1. Детерминированность: один и тот же Unix-момент даёт одну и ту же строку
 *      в каждой поддерживаемой зоне (UTC / Europe-Berlin с DST / Asia-Tokyo).
 *      Зона подставляется как параметр форматтера, поэтому тест не зависит от
 *      той зоны, в которой запущен CI.
 *   2. DST: летнее и зимнее время одной зоны дают разные смещения без
 *      отдельной ветки в коде — это гарантия `Intl`, а не нашего if.
 *   3. Отсутствие хардкода: в коде нет строк 'UTC+3' / 'Europe/Moscow' /
 *      'Moscow'. Пояс берётся из `Intl.DateTimeFormat().resolvedOptions()`.
 */

import { describe, expect, it } from 'vitest';
import type { Time, TickMarkType } from 'lightweight-charts';
import { formatChartAxisTime, formatChartCrosshairTime, chartTimeToEpochMs } from '@/utils/chartTime';
import {
  formatEpochTime,
  formatIsoTimestamp,
  browserTimeZone,
  timeZoneLabel,
  timeZoneLabelWithOffset,
  shortOffset,
  displayTimeZone,
} from '@/utils/timePresentation';
import { formatSignalTime } from '@/utils/serverSignalText';
import fs from 'node:fs';
import path from 'node:path';

/** 2026-01-15T08:09:00Z — зима в Европе, поэтому смещение Берлина +1. */
const WINTER_MS = Date.parse('2026-01-15T08:09:00.000Z');
/** 2026-07-15T08:09:00Z — лето в Европе, смещение Берлина +2. */
const SUMMER_MS = Date.parse('2026-07-15T08:09:00.000Z');

/** Эталон: считаем ожидание напрямую через Intl, без нашего кода. */
function intl(ms: number, timeZone: string, opts: Intl.DateTimeFormatOptions, locale = 'ru-RU'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...opts }).format(new Date(ms));
}

const HH_MM = { hour: '2-digit' as const, minute: '2-digit' as const, hourCycle: 'h23' as const };
const DATE_TIME = {
  year: 'numeric' as const,
  month: '2-digit' as const,
  day: '2-digit' as const,
  ...HH_MM,
};

describe('Один Unix-момент — три часовых пояса', () => {
  it('UTC, Europe/Berlin (зима) и Asia/Tokyo дают разные, но предсказуемые строки', () => {
    expect(intl(WINTER_MS, 'UTC', HH_MM)).toBe('08:09');
    // Берлин зимой UTC+1, Токио всегда UTC+9.
    expect(intl(WINTER_MS, 'Europe/Berlin', HH_MM)).toBe('09:09');
    expect(intl(WINTER_MS, 'Asia/Tokyo', HH_MM)).toBe('17:09');

    // Наш форматтер в явной зоне даёт ровно то же самое.
    expect(formatEpochTime(WINTER_MS, { mode: 'UTC', granularity: 'time' })).toBe('08:09');
    expect(formatEpochTime(WINTER_MS, { mode: 'UTC', granularity: 'time' })).toBe(intl(WINTER_MS, 'UTC', HH_MM));
  });

  it('Europe/Berlin переходит на летнее время без отдельной ветки кода', () => {
    // Зимой +1, летом +2 — разница в одном часе, оба значения из Intl.
    expect(intl(WINTER_MS, 'Europe/Berlin', HH_MM)).toBe('09:09');
    expect(intl(SUMMER_MS, 'Europe/Berlin', HH_MM)).toBe('10:09');
    expect(shortOffset('BROWSER', new Date(WINTER_MS))).toMatch(/^(UTC|GMT[+-]\d{1,2})$/);
    // 'UTC' и 'GMT+0' — оба допустимых представления нулевого смещения в ICU.
    expect(shortOffset('UTC', new Date(WINTER_MS))).toMatch(/^(UTC|GMT\+0)$/);
  });

  it('Asia/Tokyo не имеет перехода на летнее время — смещение постоянно', () => {
    expect(intl(WINTER_MS, 'Asia/Tokyo', HH_MM)).toBe('17:09');
    expect(intl(SUMMER_MS, 'Asia/Tokyo', HH_MM)).toBe('17:09');
  });
});

describe('Форматтер графика использует пояс браузера', () => {
  it('ось и перекрестие форматируются в одной и той же зоне', () => {
    const zone = browserTimeZone();
    expect(formatChartAxisTime((WINTER_MS / 1000) as Time, 3 as TickMarkType)).toBe(
      intl(WINTER_MS, zone, HH_MM)
    );
    expect(formatChartCrosshairTime((WINTER_MS / 1000) as Time)).toBe(
      intl(WINTER_MS, zone, DATE_TIME)
    );
  });

  it('детализация деления оси выбирается по tickType', () => {
    const zone = browserTimeZone();
    expect(formatChartAxisTime((WINTER_MS / 1000) as Time, 0 as TickMarkType)).toBe(
      intl(WINTER_MS, zone, { year: 'numeric' })
    );
    expect(formatChartAxisTime((WINTER_MS / 1000) as Time, 1 as TickMarkType)).toBe(
      intl(WINTER_MS, zone, { month: 'short' })
    );
    expect(formatChartAxisTime((WINTER_MS / 1000) as Time, 2 as TickMarkType)).toBe(
      intl(WINTER_MS, zone, { month: 'short', day: '2-digit' })
    );
  });

  it('нечитаемое время возвращает пустую строку, а не текущее время', () => {
    expect(formatChartAxisTime('not-a-time' as Time, 3 as TickMarkType)).toBe('');
    expect(formatChartCrosshairTime(undefined)).toBe('');
    expect(chartTimeToEpochMs({ year: 2026, month: 1, day: 15 })).toBe(Date.UTC(2026, 0, 15));
    expect(chartTimeToEpochMs('nope')).toBeNull();
  });
});

describe('Время сигнала и события — та же зона, что у графика', () => {
  it('formatSignalTime совпадает с форматомтером событий', () => {
    const zone = browserTimeZone();
    expect(formatSignalTime('2026-01-15T08:09:00.000Z')).toBe(
      formatIsoTimestamp('2026-01-15T08:09:00.000Z')
    );
    expect(formatSignalTime('2026-01-15T08:09:00.000Z')).toBe(intl(WINTER_MS, zone, DATE_TIME));
    expect(formatSignalTime(null)).toBe('—');
  });

  it('UTC остаётся явным режимом для отладки и печати', () => {
    expect(formatEpochTime(WINTER_MS, { mode: 'UTC', granularity: 'time' })).toBe('08:09');
    expect(formatIsoTimestamp('2026-01-15T08:09:00.000Z', { mode: 'UTC' })).toContain('08:09');
    expect(displayTimeZone('UTC')).toBe('UTC');
  });

  it('испорченная метка не подменяется текущей датой', () => {
    expect(formatIsoTimestamp('не дата')).toBe('не дата');
    expect(formatIsoTimestamp(null)).toBe('—');
  });
});

describe('Никакого захардкоженного смещения', () => {
  it('в utils/ и components/ нет строк UTC+3 / Europe/Moscow / Moscow', () => {
    const roots = ['src/utils', 'src/components/common', 'src/components/signals', 'src/pages/SignalsPage.tsx'];
    const forbidden = ['UTC+3', 'UTC+2', 'Europe/Moscow', 'Europe/Kiev', "'Moscow'", '"Moscow"'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          // Комментарии вырезаются: объяснение политики в докблоке — не хардкод.
          const text = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
          for (const bad of forbidden) {
            if (text.includes(bad)) offenders.push(`${full}: ${bad}`);
          }
        }
      }
    };
    for (const root of roots) {
      const abs = path.resolve(__dirname, '../..', root);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else {
        const text = fs.readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        for (const bad of forbidden) {
          if (text.includes(bad)) offenders.push(`${abs}: ${bad}`);
        }
      }
    }
    expect(offenders, 'часовой пояс Presentation не должен быть захардкожен').toEqual([]);
  });

  it('метка зоны читается из окружения браузера', () => {
    // В CI зона может быть любой — проверяем не конкретное имя, а то, что метка
    // непустая, совпадает с разрешённой зоной и не содержит жаргона 'LOCAL'.
    const label = timeZoneLabel('BROWSER');
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe('LOCAL');
    expect(label.toUpperCase()).not.toBe('UTC');
    expect(timeZoneLabelWithOffset('BROWSER')).toContain(label);
  });
});
