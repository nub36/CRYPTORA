/**
 * serverSignalText — словарь человеческих формулировок для СИГНАЛОВ СЕРВЕРА.
 *
 * Почему отдельный файл, а не дополнение к `signalText.ts`: там живут подписи
 * БРАУЗЕРНОГО журнала (`SignalsAuditLedger`, `AnalyticalSetup`), а здесь —
 * подписи серверного источника (`GET /api/signals`, `SignalDto`). Это два
 * разных журнала, и RULES §1 запрещает показывать их числа без пометки
 * источника; разделение начинается со словаря.
 *
 * Никакой математики стратегий здесь нет: только отображение фактов, которые
 * сервер уже сохранил. Три правила файла:
 *   1. статус, которого сервер не знает, НЕ выдумывается — показывается как есть
 *      с явной пометкой «неизвестное состояние»;
 *   2. уровни (вход/стоп/цели) берутся из DTO как есть, ничего не усредняется
 *      и не досчитывается;
 *   3. R приходит готовым из ядра (gross/net) и показывается только там, где
 *      сделка действительно была: null → «сделки не было», никогда не «0 R».
 */

import type { SignalDto, SignalStatus } from '@/services/strategyOps';
import { TRADE_CLOSED_SIGNAL_STATUSES } from '@/services/strategyOps';
import { exitReasonLabelRu, formatSignedR, strategyShortLabel } from './signalText';
import { pairLabel, sideLabel, stopComparator } from './labels';
import { formatEventTimestamp, type TimeDisplayMode } from './timePresentation';

/** Тон бейджа — тот же набор, что у `Badge`, чтобы не изобретать палитру. */
export type ServerStatusTone = 'green' | 'red' | 'cyan' | 'amber' | 'neutral';

/**
 * Подписи восьми состояний серверного домена (миграция 009 = `SetupStatus` ядра).
 *
 * Формулировки намеренно «человеческие»: пользователь не обязан знать, что
 * такое ACTIVE/FILLED. Raw-enum остаётся в `data-status` и в деталях сигнала —
 * для сверки с API, но не как основной текст (§11 задачи Signals V2).
 */
export const SERVER_STATUS_LABELS: Readonly<Record<SignalStatus, string>> = Object.freeze({
  ACTIVE: 'ОЖИДАЕТ ВХОДА',
  FILLED: 'В ПОЗИЦИИ',
  TARGET_REACHED: 'ЦЕЛЬ ДОСТИГНУТА',
  INVALIDATED: 'СТОП СРАБОТАЛ',
  CLOSED: 'ЗАКРЫТ ПО ПРАВИЛУ СТРАТЕГИИ',
  EXPIRED: 'СРОК ВХОДА ИСТЁК',
  CANCELLED: 'ОТМЕНЁН ДО ВХОДА',
  UNRESOLVED: 'ИСХОД НЕ ОТСЛЕЖЕН',
});

/** Короткая подпись для компактных строк (лента истории, маркеры). */
export const SERVER_STATUS_SHORT_LABELS: Readonly<Record<SignalStatus, string>> = Object.freeze({
  ACTIVE: 'Ждёт входа',
  FILLED: 'В позиции',
  TARGET_REACHED: 'Цель достигнута',
  INVALIDATED: 'Стоп',
  CLOSED: 'Закрыт по правилу',
  EXPIRED: 'Срок истёк',
  CANCELLED: 'Отменён',
  UNRESOLVED: 'Не отслежен',
});

export const SERVER_STATUS_TONES: Readonly<Record<SignalStatus, ServerStatusTone>> = Object.freeze({
  ACTIVE: 'cyan',
  FILLED: 'cyan',
  TARGET_REACHED: 'green',
  INVALIDATED: 'red',
  CLOSED: 'amber',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  UNRESOLVED: 'neutral',
});

/**
 * Что состояние означает и откуда оно взялось.
 *
 * Обязательная оговорка (§10): realtime-мониторинга позиции на сервере нет —
 * исход определяется реплеем по ЗАКРЫТЫМ свечам окна, поэтому статус всегда
 * «последнее зафиксированное сервером состояние», а не «прямо сейчас».
 */
export const SERVER_STATUS_HINTS: Readonly<Record<SignalStatus, string>> = Object.freeze({
  ACTIVE:
    'Сервер зафиксировал сетап; вход ещё не исполнен. Статус отражает последнее состояние, зафиксированное сервером по закрытым свечам.',
  FILLED:
    'Коридор входа исполнен по закрытым свечам; позиция открыта. Исход ещё не определён сервером.',
  TARGET_REACHED:
    'Цель достигнута по правилам стратегии (исход зафиксирован сервером по закрытым свечам).',
  INVALIDATED:
    'Уровень отмены (стоп) достигнут — сетап больше не действителен. Исход зафиксирован сервером.',
  CLOSED:
    'Позиция закрыта по правилу стратегии (трейлинг, безубыток, таймаут). Причина — в деталях сигнала.',
  EXPIRED:
    'Срок действия входа истёк: сделка не была заключена. R у такого сигнала нет (null, не 0).',
  CANCELLED:
    'Сетап отменён до входа: сделка не была заключена. R у такого сигнала нет (null, не 0).',
  UNRESOLVED:
    'Сервер не смог определить исход: бар сетапа вышел за окно данных. Это честное «неизвестно», а не «без убытка».',
});

/** Общий текст подсказки рядом со статусом (§10). */
export const STATUS_SOURCE_NOTE =
  'Статус отражает последнее состояние, зафиксированное сервером по закрытым свечам, а не цену в данную секунду.';

/** Статус из известного серверу домена? Всё остальное показывается как есть. */
export function isKnownServerStatus(status: string): status is SignalStatus {
  return Object.prototype.hasOwnProperty.call(SERVER_STATUS_LABELS, status);
}

/**
 * Подпись статуса. Неизвестное серверное состояние НЕ подменяется «нейтральным»
 * словом: пользователь видит код и пометку — иначе UI соврал бы о данных.
 */
export function serverStatusLabel(status: string): string {
  return isKnownServerStatus(status) ? SERVER_STATUS_LABELS[status] : `${status} (неизвестное состояние)`;
}

export function serverStatusShortLabel(status: string): string {
  return isKnownServerStatus(status) ? SERVER_STATUS_SHORT_LABELS[status] : status;
}

export function serverStatusTone(status: string): ServerStatusTone {
  return isKnownServerStatus(status) ? SERVER_STATUS_TONES[status] : 'neutral';
}

export function serverStatusHint(status: string): string {
  return isKnownServerStatus(status) ? SERVER_STATUS_HINTS[status] : STATUS_SOURCE_NOTE;
}

/** Сделка по этому статусу была (есть R)? Тот же домен, что у сервера. */
export function statusHasTrade(status: string): boolean {
  return (TRADE_CLOSED_SIGNAL_STATUSES as readonly string[]).includes(status);
}

/** LONG / SHORT — industry English (русское «Лонг/Шорт» запрещено гвард-тестом). */
export function directionText(direction: 'LONG' | 'SHORT'): string {
  return sideLabel(direction).toUpperCase();
}

/** Пояснение направления простым языком (§11) — рядом с LONG/SHORT, не вместо. */
export function directionHint(direction: 'LONG' | 'SHORT'): string {
  return direction === 'LONG'
    ? 'Расчёт на рост цены от зоны входа'
    : 'Расчёт на снижение цены от зоны входа';
}

/** Знак сравнения для стопа: LONG — стоп ниже входа, SHORT — выше. */
export function stopSign(direction: 'LONG' | 'SHORT'): '<' | '>' {
  return stopComparator(direction);
}

/**
 * Цена в том же формате, что и на остальных экранах терминала.
 * `null`/`undefined`/NaN → «—»: отсутствие данных не показывается нулём.
 */
export function formatSignalPrice(price: number | null | undefined): string {
  if (typeof price !== 'number' || !Number.isFinite(price)) return '—';
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return price.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Зона входа словами. Одна цена — если сервер отдал одну (минимум = максимум). */
export function entryZoneText(
  entryMin: number | null,
  entryMax: number | null,
  entryType: SignalDto['entryType']
): string {
  if (entryMin === null && entryMax === null) return '—';
  const low = entryMin ?? entryMax;
  const high = entryMax ?? entryMin;
  const price =
    low !== null && high !== null && low !== high
      ? `${formatSignalPrice(low)} – ${formatSignalPrice(high)}`
      : formatSignalPrice(low ?? high);
  if (entryType === 'MARKET_NEXT_OPEN') return `${price} (вход по открытию следующего бара)`;
  if (entryType === 'LIMIT_CORRIDOR') return `${price} (лимитный вход в коридоре)`;
  return price;
}

/** «Цель 1», «Цель 2», … — нумерация с 1, без «TP» в мобильном виде (§5). */
export function targetLabel(index: number): string {
  return `Цель ${index + 1}`;
}

/** Короткая подпись цели для маркеров/оси графика. */
export function targetShortLabel(index: number): string {
  return `Ц${index + 1}`;
}

/** Способ входа словами (из DTO, без домысливания). */
export function entryTypeText(entryType: SignalDto['entryType'], validForBars: number | null): string {
  if (entryType === 'LIMIT_CORRIDOR') {
    return validForBars !== null && validForBars > 0
      ? `Лимитный вход в коридоре · действителен ${validForBars} бар.`
      : 'Лимитный вход в коридоре';
  }
  if (entryType === 'MARKET_NEXT_OPEN') return 'Вход по открытию следующего бара';
  return 'Способ входа не указан сервером';
}

/** Таймфрейм сигнала как его отдал сервер (V2.8 = '1h', никакой «15m»). */
export function timeframeText(timeframe: string | null | undefined): string {
  return typeof timeframe === 'string' && timeframe.length > 0 ? timeframe : '—';
}

/**
 * Предупреждение о рассогласовании таймфреймов (§5).
 *
 * График может показывать 15m, а сигнал выпущен на 1h — это разные вещи, и UI
 * обязан не создавать впечатления, будто стратегия сработала на таймфрейме
 * графика. Сравнение регистронезависимое: сервер отдаёт '1h', а продуктовый
 * тип графика хранит дневной таймфрейм как '1D'.
 */
export function timeframeMismatchNote(
  signalTimeframe: string | null | undefined,
  chartTimeframe: string | null | undefined
): string | null {
  if (!signalTimeframe || !chartTimeframe) return null;
  if (signalTimeframe.toLowerCase() === chartTimeframe.toLowerCase()) return null;
  return `График открыт в ${timeframeText(chartTimeframe)}, а сигнал выпущен на ${timeframeText(signalTimeframe)}`;
}

/** Время сигнала (время ЗАКРЫТОГО бара сетапа) в выбранном режиме LOCAL/UTC. */
export function formatSignalTime(iso: string | null | undefined, mode: TimeDisplayMode = 'LOCAL'): string {
  if (!iso) return '—';
  return formatEventTimestamp(iso, mode);
}

/**
 * Одна строка итога человеческим языком — для карточки сигнала.
 *
 * Только факты из DTO: причина выхода берётся из `closeReason` (словарь ядра),
 * R — из `resultR`/`netResultR`. Ничего не пересчитывается.
 */
export function describeServerSignalOutcome(signal: SignalDto): string {
  const status = signal.status;
  const reason = signal.closeReason ? exitReasonLabelRu(signal.closeReason) : null;

  if (!statusHasTrade(status)) {
    // Сделки не было: R отсутствует, и это не «0 R».
    return `${serverStatusLabel(status)} · сделки не было`;
  }

  const net = typeof signal.netResultR === 'number' ? formatSignedR(signal.netResultR) : null;
  const gross = typeof signal.resultR === 'number' ? formatSignedR(signal.resultR) : null;
  const parts = [serverStatusLabel(status)];
  if (reason) parts.push(reason);
  if (net) parts.push(`${net} net`);
  else if (gross) parts.push(`${gross} gross`);
  if (typeof signal.barsHeld === 'number' && signal.barsHeld > 0) {
    parts.push(`в позиции ${signal.barsHeld} бар.`);
  }
  return parts.join(' · ');
}

/**
 * Подпись результата для advanced-блока (§12).
 *
 * Процент показывается, только если сервер его отдал (`pnlResultPct`);
 * досчитывать PnL на клиенте запрещено.
 */
export function resultSummary(signal: SignalDto): {
  gross: string;
  net: string;
  pnlPct: string;
  hasTrade: boolean;
} {
  const hasTrade = statusHasTrade(signal.status);
  return {
    gross: hasTrade ? formatSignedR(signal.resultR) : 'сделки не было',
    net: hasTrade ? formatSignedR(signal.netResultR) : 'сделки не было',
    pnlPct:
      typeof signal.pnlResultPct === 'number' && Number.isFinite(signal.pnlResultPct)
        ? `${signal.pnlResultPct > 0 ? '+' : ''}${signal.pnlResultPct.toFixed(2)} %`
        : '—',
    hasTrade,
  };
}

/**
 * Объяснение R простым языком (§12). Формулы сверены с замороженным кодом:
 * `risk = |entry − stop|` и `netR = grossR − feeR(makerBps, takerBps)`
 * (v30Core.ts:129,146; lifecycle.ts:110-119; v28Live.ts:128-132 — 2 bps maker
 * на вход, 5 bps taker на выход). На клиенте R НЕ пересчитывается.
 */
export const R_HELP_TEXT =
  '1R — первоначальный риск сделки: расстояние между ценой входа и стопом (|вход − стоп|). ' +
  '«+1.9R» означает результат в 1.9 раза больше этого риска, «−1R» — сработавший стоп. ' +
  'Gross R — результат без комиссий, Net R — за вычетом комиссии в тех же единицах ' +
  '(модель 2 bps maker на вход / 5 bps taker на выход). Значения приходят с сервера из ядра стратегий ' +
  'и на клиенте не пересчитываются. Если сделки не было (срок истёк, отмена, исход не отслежен), ' +
  'R отсутствует — это «—», а не ноль.';

/** Оговорка про V2.8 (gross-only): net у неё отрицательный по построению модели. */
export const V28_GROSS_ONLY_NOTE =
  'V2.8 валидирована только по gross (без комиссий): live-путь считает net по той же модели 2/5 bps, ' +
  'поэтому отрицательный net у этой стратегии — её свойство, а не ошибка расчёта.';

/** Короткое имя стратегии (V3.0 / V3.3 / V2.8) + версия из DTO, если она есть. */
export function strategyText(strategyId: string, strategyVersion: string | null): string {
  const short = strategyShortLabel(strategyId);
  return strategyVersion ? `${short} · v${strategyVersion}` : short;
}

/** Пара в форме «BTC/USDT» из любого серверного представления символа. */
export function signalPairText(symbol: string): string {
  return pairLabel(symbol).toUpperCase();
}

/** BASE-тикер («BTC») — нужен селектору монет и свечам. */
export function signalBaseSymbol(symbol: string): string {
  return pairLabel(symbol).toUpperCase().split('/')[0] ?? symbol.toUpperCase();
}
