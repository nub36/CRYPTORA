/**
 * V3.4 REAL-ENTRY LIFECYCLE — ИССЛЕДОВАНИЕ. В ПРОДУКТОВОМ ГРАФЕ ЭТОГО МОДУЛЯ НЕТ.
 *
 * Здесь лежит экспериментальный участок ВХОДА V3.4 по закрытым минутным
 * свечам: бар-триггер не исполняет сам себя, наблюдение начинается не раньше
 * публикации, до касания зоны позиции нет. После исполнения сопровождение
 * отдаётся той же замороженной `manageTrade` V3.3 с теми же константами —
 * правила выхода не менялись и не дублировались.
 *
 * ПОЧЕМУ ЭТО ЗДЕСЬ, А НЕ В `lifecycle.ts`
 * ---------------------------------------
 * Раньше эта ветка жила в продуктовом `lifecycle.ts` и включалась опциональным
 * полем `opts.m1`. Ни один продуктовый вызов минутные свечи не передавал, так
 * что ветка была недостижима, — но модуль всё равно попадал в сборку
 * продуктового ядра. Теперь `lifecycle.ts` про неё не знает вовсе: эксперимент
 * физически отсутствует в графе модулей рантайма.
 *
 * Поведение V3.4 в проде при этом НЕ ИЗМЕНИЛОСЬ. Единственный достижимый в
 * рантайме путь — часовой `trackCorridor` с константами V3.3 — сохранён
 * дословно; именно так V3.4 велась и до этой правки.
 *
 * Канонические статусы (`WAITING_FOR_ENTRY`, `MISSED`), модель исполнения и
 * судьба исторической ретроспективы не решены —
 * см. docs/V34_REAL_ENTRY_LIFECYCLE_2026-09-30.md, раздел «known issue».
 */
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { manageTrade as manageTradeV33, V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import type { AnalyticalSetup, SetupFill } from '@/services/signals/SignalsAuditLedger';
import { managedExitPrice, managedStatus, round } from '../replays/shared';
import { isoOf, noTrade, pnlPct, type LifecycleResult } from '../lifecycle';
import { partialHourFromFill, resolveV34Entry } from './v34EntryLifecycle';

/**
 * Исследовательская точка входа: разбирает опубликованный сетап V3.4 по
 * минутным свечам. Продуктовый `trackPublishedSetup` её НЕ вызывает.
 *
 * @param m1 закрытые 1m-свечи по возрастанию openTime; пустая серия
 *           недопустима — без данных о рынке после публикации подтвердить
 *           вход нечем, и выдумывать его нельзя.
 */
export function trackPublishedSetupV34Research(
  entry: AnalyticalSetup, h1: readonly ArchiveCandle[], m1: readonly ArchiveCandle[],
): LifecycleResult {
  if (h1.length === 0) return { kind: 'SKIP', reason: 'нет закрытых свечей' };
  return trackCorridorV34(entry, h1, m1);
}

/**
 * V3.4: опубликовано → WAITING_FOR_ENTRY → FILLED → TP1/TP2/SL.
 *
 * Отличие от `trackCorridor` ровно одно — УЧАСТОК ВХОДА. После исполнения
 * сопровождение идёт той же замороженной `manageTradeV33` с теми же
 * константами, что и у V3.3: правила выхода не менялись и не дублировались.
 *
 * Пустая минутная серия отвергается: без данных о рынке после публикации
 * подтвердить вход нечем, и выдумывать его нельзя.
 */
function trackCorridorV34(
  entry: AnalyticalSetup, h1: readonly ArchiveCandle[], m1: readonly ArchiveCandle[],
): LifecycleResult {
  if (!m1 || m1.length === 0) {
    return { kind: 'SKIP', reason: 'V3.4: нет минутных свечей — вход по часовым не подтверждается' };
  }
  // Ниже — участок входа; всё, что после FILLED, отдаётся замороженной V3.3.
  const tp1 = entry.targets[0];
  const tp2 = entry.targets[1] ?? entry.targets[0];
  if (tp1 === undefined || tp2 === undefined) return { kind: 'SKIP', reason: 'у публикации нет целей' };
  const publishedAtMs = Date.parse(entry.createdAt);
  if (!Number.isFinite(publishedAtMs)) return { kind: 'SKIP', reason: 'у публикации нет времени создания' };

  const res = resolveV34Entry({
    direction: entry.direction,
    zoneLow: entry.entryZone[0],
    zoneHigh: entry.entryZone[1],
    stop: entry.invalidationLevel,
    tp1,
    setupOpenTime: entry.setupOpenTime,
    publishedAtMs,
    m1,
  });

  // До исполнения позиции нет: ни TP, ни SL не могут дать результат сделки.
  if (res.state === 'WAITING_FOR_ENTRY') return { kind: 'UNCHANGED' };
  if (res.state === 'INVALIDATED') {
    return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', res.decidedAt ?? entry.setupOpenTime, 'STOP_BEFORE_ENTRY') };
  }
  if (res.state === 'MISSED') {
    return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', res.decidedAt ?? entry.setupOpenTime, 'MISSED') };
  }
  if (res.state === 'EXPIRED') {
    return { kind: 'RESOLVED', fill: null, outcome: noTrade('EXPIRED', res.expiresAt, 'EXPIRED') };
  }

  const f = res.fill!;
  // Геометрия проверяется на фактической цене входа — та же проверка, что в
  // замороженном `corridorStep`, потому что цена исполнения могла оказаться
  // лучше опубликованной грани (гэп сквозь зону).
  const long = entry.direction === 'LONG';
  const stop = entry.invalidationLevel;
  const risk = Math.abs(f.price - stop);
  const geomOk = risk > 0
    && (long ? stop < f.price : stop > f.price)
    && (long ? tp1 > f.price && tp2 > tp1 : tp1 < f.price && tp2 < tp1);
  if (!geomOk) {
    return { kind: 'RESOLVED', fill: null, outcome: noTrade('CANCELLED', f.barOpenTime, 'REJECTED_GEOMETRY') };
  }

  const fill: SetupFill = { price: f.price, at: isoOf(f.barOpenTime), barOpenTime: f.barOpenTime, stop, targets: [tp1, tp2] };

  // Первый бар сопровождения — остаток часа от минуты входа; дальше обычные
  // часовые бары. Так `manageTrade` не видит движение, случившееся ДО входа.
  const partial = partialHourFromFill(m1, f.barOpenTime);
  if (!partial) return { kind: 'FILLED', fill };
  const rest = h1.filter((c) => c.openTime > partial.openTime).slice(0, V33_CONSTANTS.TIMEOUT_BARS + 1);
  const bars: ArchiveCandle[] = [partial, ...rest];

  const r = manageTradeV33(entry.direction, f.price, stop, tp1, tp2, bars);
  if (!r) return { kind: 'FILLED', fill };
  const lastBar = bars[Math.min(bars.length, r.barsHeld) - 1]!;
  const exitPrice = managedExitPrice(r.exit, f.price, stop, tp2, lastBar);
  const fee = r.feeR(V33_CONSTANTS.MAKER_BPS, V33_CONSTANTS.TAKER_BPS);
  return {
    kind: 'RESOLVED', fill,
    outcome: {
      status: managedStatus(r.exit),
      closedAt: isoOf(lastBar.closeTime),
      exitReason: r.exit,
      exitPrice,
      resultR: round(r.grossR, 4),
      netResultR: round(r.grossR - fee, 4),
      pnlResultPct: exitPrice !== null ? pnlPct(entry.direction, f.price, exitPrice) : null,
      barsHeld: r.barsHeld,
    },
  };
}
