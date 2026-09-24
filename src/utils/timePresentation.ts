/**
 * CRYPTORA — ЕДИНЫЙ форматтер времени для интерфейса.
 *
 * ЗАЧЕМ ОДИН ФАЙЛ. До этого в продукте было несколько несовместимых
 * реализаций: `timePresentation`, `chartTime`, локальные `toLocaleString` в
 * компонентах и хардкод смещений в паре мест. Они расходились ровно там, где
 * сходиться обязаны: подпись оси графика, перекрестие, время сигнала, время
 * исполнения и время исхода должны показывать ОДНО И ТО ЖЕ время.
 *
 * ПОЛИТИКА (docs/SIGNALS.md, docs/MARKET_DATA.md):
 *   1. В БД и в API время — UTC/ISO. Ничего не пересчитывается на сервере.
 *   2. На экране — часовой пояс БРАУЗЕРА/ОС пользователя:
 *      `Intl.DateTimeFormat().resolvedOptions().timeZone`. Никаких
 *      захардкоженных UTC+3 / Europe/Moscow / Moscow — иначе пользователь в
 *      другом поясе видит чужие часы.
 *   3. DST учитывается автоматически: `Intl.DateTimeFormat` сам знает правила
 *      зоны, поэтому летнее и зимнее время не требуют отдельной ветки.
 *   4. Единственная точка переключения зоны — `TIME_ZONE_MODE`. В продукте
 *      используется `BROWSER`; `UTC` оставлен для отладки и печати, а не как
 *      переключатель в UI (см. BUG D: подписи «LOCAL» на графиках убраны).
 */

export type TimeDisplayMode = 'LOCAL' | 'UTC';

/** Зона, в которой показывается время. В продукте — всегда браузерная. */
export type ChartTimeZone = 'BROWSER' | 'UTC';

/**
 * Зона пользователя. Читается из окружения браузера при каждом вызове, чтобы
 * смена зоны в ОС подхватывалась без перезагрузки страницы.
 */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    // Старые движки без Intl резолвера — падаем в локальное время хоста.
  }
  return 'UTC';
}

/** IANA-зона для показа: браузерная либо UTC (отладка/печать). */
export function displayTimeZone(mode: ChartTimeZone = 'BROWSER'): string {
  return mode === 'UTC' ? 'UTC' : browserTimeZone();
}

/** Язык интерфейса по умолчанию. */
const DEFAULT_LOCALE = 'ru-RU';

export interface TimeFormatOptions {
  /** UTC — только для отладки/печати; по умолчанию пояс браузера. */
  mode?: ChartTimeZone;
  locale?: string;
  includeDate?: boolean;
  includeSeconds?: boolean;
  /** 'time' — часы:минуты, 'date' — дата, 'datetime' — дата и время, 'year' — год. */
  granularity?: 'time' | 'date' | 'datetime' | 'year' | 'month';
}

/**
 * Форматирует эпоху (мс) в часовом поясе браузера.
 *
 * ЕДИНСТВЕННАЯ реализация в продукте: оси графиков, перекрестие, бейджи
 * свежести, время сигнала и время исхода обязаны звать её, иначе одинаковые
 * миллисекунды будут показаны по-разному на разных экранах.
 */
export function formatEpochTime(epochMs: number, options: TimeFormatOptions = {}): string {
  if (!Number.isFinite(epochMs)) return '—';
  const {
    mode = 'BROWSER',
    locale = DEFAULT_LOCALE,
    includeDate = false,
    includeSeconds = false,
    granularity,
  } = options;
  const resolved = granularity ?? (includeDate ? 'datetime' : 'time');
  const timeZone = displayTimeZone(mode);

  const fmt: Intl.DateTimeFormatOptions = { timeZone, hourCycle: 'h23' };
  switch (resolved) {
    case 'year':
      fmt.year = 'numeric';
      break;
    case 'month':
      fmt.month = 'short';
      break;
    case 'date':
      fmt.year = 'numeric';
      fmt.month = '2-digit';
      fmt.day = '2-digit';
      break;
    case 'datetime':
      fmt.year = 'numeric';
      fmt.month = '2-digit';
      fmt.day = '2-digit';
      fmt.hour = '2-digit';
      fmt.minute = '2-digit';
      if (includeSeconds) fmt.second = '2-digit';
      break;
    default:
      fmt.hour = '2-digit';
      fmt.minute = '2-digit';
      if (includeSeconds) fmt.second = '2-digit';
  }
  return new Intl.DateTimeFormat(locale, fmt).format(new Date(epochMs));
}

/**
 * ISO-время из БД/API → строка в поясе браузера.
 * Некорректная метка не «чинится»: возвращается как есть, чтобы сломанное
 * значение было видно, а не молча показано как сегодня.
 */
export function formatIsoTimestamp(iso: string | null | undefined, options: TimeFormatOptions = {}): string {
  if (!iso) return '—';
  const epochMs = Date.parse(iso);
  if (!Number.isFinite(epochMs)) return String(iso);
  return formatEpochTime(epochMs, { includeDate: true, ...options });
}

/** Обратная совместимость: раньше называлось `formatEventTimestamp`. */
export function formatEventTimestamp(iso: string, mode: ChartTimeZone = 'BROWSER'): string {
  return formatIsoTimestamp(iso, { mode, includeDate: true });
}

/**
 * Короткая человекочитаемая метка зоны пользователя: «Московское время»,
 * «Центральноевропейское время», «Среднее время по Гринвичу».
 *
 * Берётся из `Intl` по IANA-имени зоны браузера, поэтому:
 *   • зона не захардкожена — показывается та, что настроена у пользователя;
 *   • при смене зоны в ОС метка меняется сама;
 *   • это не технический жаргон вроде «LOCAL»/«UTC+3», а имя зоны.
 */
export function timeZoneLabel(mode: ChartTimeZone = 'BROWSER', locale = DEFAULT_LOCALE): string {
  const zone = displayTimeZone(mode);
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'long' }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name) return name;
  } catch {
    // Неизвестная зона — падаем в IANA-имя.
  }
  return zone;
}

/** Метка зоны + смещение, например «Московское время · GMT+3». */
export function timeZoneLabelWithOffset(mode: ChartTimeZone = 'BROWSER', locale = DEFAULT_LOCALE): string {
  return `${timeZoneLabel(mode, locale)} · ${shortOffset(mode)}`;
}

/** Смещение зоны в виде «GMT+3» / «GMT-5» / «UTC». DST учитывается. */
export function shortOffset(mode: ChartTimeZone = 'BROWSER', at: Date = new Date()): string {
  const zone = displayTimeZone(mode);
  for (const style of ['shortOffset', 'longOffset'] as const) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(at);
      const zoneName = parts.find((p) => p.type === 'timeZoneName')?.value;
      if (zoneName) return zoneName;
    } catch {
      // Движок не знает эту форму имени зоны — пробуем следующую.
    }
  }
  return zone;
}

/** Обратная совместимость: прежнее имя `localTimeZoneLabel`. */
export function localTimeZoneLabel(): string {
  return shortOffset('BROWSER');
}

/**
 * Unix-время (секунды) из `lightweight-charts` → эпоха в мс.
 * `null` — значение, которое нельзя интерпретировать: показывать «—» честнее,
 * чем подставить текущее время.
 */
export function chartTimeToEpochMs(time: unknown): number | null {
  if (typeof time === 'number') return Number.isFinite(time) ? time * 1000 : null;
  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (time && typeof time === 'object') {
    const day = time as { year?: number; month?: number; day?: number };
    if (typeof day.year === 'number' && typeof day.month === 'number' && typeof day.day === 'number') {
      return Date.UTC(day.year, day.month - 1, day.day);
    }
  }
  return null;
}
