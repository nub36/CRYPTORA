/**
 * V3.4 — РЕАЛЬНЫЙ ЖИЗНЕННЫЙ ЦИКЛ ВХОДА (только для V3.4).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ГРАНИЦА ОТВЕТСТВЕННОСТИ                                                  ║
 * ║  • Модуль относится ТОЛЬКО к V3.4. V3.0 и V3.3 его не импортируют и      ║
 * ║    не вызывают: их семантика входа (`corridorStep` по закрытым 1H-барам) ║
 * ║    остаётся байт-в-байт прежней.                                         ║
 * ║  • Модуль ЧИСТЫЙ: ни сети, ни БД, ни времени (`Date.now`). Всё, что       ║
 * ║    нужно для решения, приходит аргументами.                              ║
 * ║  • Модуль отвечает ТОЛЬКО за участок «опубликовано → исполнено/не         ║
 * ║    состоялось». Сопровождение позиции после входа не меняется: им        ║
 * ║    по-прежнему занимается замороженная `manageTrade` V3.3.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ── ЗАЧЕМ ─────────────────────────────────────────────────────────────────
 * Аудит `docs/V34_LIVE_ENTRY_SEMANTICS_2026-09-30.md` показал: коридор V3.3
 * центрирован на close бара-триггера, а `open` следующего 1H-бара равен этому
 * close, поэтому «касание» выполняется автоматически и вход происходит в
 * 100 % случаев на баре N+1 по его открытию. Ожидания входа фактически нет:
 * EXPIRED без фила — 0 из 26 767 сетапов за четыре года.
 *
 * Здесь вход становится настоящим событием рынка:
 *   • бар-триггер НЕ может исполнить сам себя;
 *   • наблюдение начинается не раньше публикации;
 *   • касание проверяется по ЗАКРЫТЫМ минутным свечам;
 *   • до исполнения нет ни позиции, ни TP, ни SL.
 *
 * ── СОСТОЯНИЯ ─────────────────────────────────────────────────────────────
 *   WAITING_FOR_ENTRY  окно ещё не закрыто, касания не было
 *   FILLED             зона задета — позиция открыта
 *   INVALIDATED        стоп задет ДО входа (сделки не было)
 *   MISSED             TP1 достигнут ДО входа (сделки не было, цена ушла)
 *   EXPIRED            окно коридора полностью наблюдено, касания не было
 *
 * ── ПОЧЕМУ НЕТ ЗАГЛЯДЫВАНИЯ В БУДУЩЕЕ ─────────────────────────────────────
 * Свечи просматриваются строго по возрастанию openTime, решение принимается на
 * первой же свече, которая удовлетворяет условию, и цикл обрывается. Ни одна
 * свеча с openTime, большим момента решения, на результат не влияет — это
 * проверяется тестом «no-lookahead» (префикс данных даёт тот же исход).
 */
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { V33_CONSTANTS } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';

/** Длительность бара исполнения V3.3/V3.4 — 1H. */
export const V34_EXEC_TF_MS = 3_600_000;

/**
 * Сколько баров исполнения живёт коридор. Значение берётся у V3.3, а не
 * дублируется числом: срок жизни публикации менять не входит в задачу.
 */
export const V34_ENTRY_EXPIRY_BARS = V33_CONSTANTS.CORRIDOR_EXPIRY_BARS;

export type V34EntryState =
  | 'WAITING_FOR_ENTRY'
  | 'FILLED'
  | 'INVALIDATED'
  | 'MISSED'
  | 'EXPIRED';

/** Причина терминального состояния — попадает в `exitReason` публикации. */
export type V34EntryReason =
  | 'STOP_BEFORE_ENTRY'
  | 'TARGET_BEFORE_ENTRY'
  | 'ENTRY_WINDOW_EXPIRED';

export interface V34EntryInput {
  direction: 'LONG' | 'SHORT';
  /** Границы ОПУБЛИКОВАННОЙ зоны (у V3.4 — уже расширенной). */
  zoneLow: number;
  zoneHigh: number;
  /** Уровень инвалидации публикации. */
  stop: number;
  /** Первая цель — нужна только чтобы отличить MISSED от EXPIRED. */
  tp1: number;
  /** openTime бара-триггера (1H). */
  setupOpenTime: number;
  /** Момент публикации сигнала, мс. */
  publishedAtMs: number;
  /** ЗАКРЫТЫЕ минутные свечи по возрастанию openTime. */
  m1: readonly ArchiveCandle[];
  /** Переопределения для тестов; по умолчанию — значения V3.3. */
  execTfMs?: number;
  expiryBars?: number;
}

export interface V34EntryFill {
  price: number;
  /** openTime МИНУТНОЙ свечи, на которой произошло касание. */
  barOpenTime: number;
}

export interface V34EntryResult {
  state: V34EntryState;
  /** Раньше этого момента ни одна свеча не рассматривается. */
  eligibleFrom: number;
  /** Момент, после которого коридор мёртв (граница исключающая). */
  expiresAt: number;
  fill: V34EntryFill | null;
  reason: V34EntryReason | null;
  /**
   * Момент принятия решения: openTime решающей минутной свечи, а для EXPIRED —
   * граница окна. `null`, пока состояние WAITING_FOR_ENTRY.
   */
  decidedAt: number | null;
  /** Сколько закрытых минутных свечей реально просмотрено до решения. */
  observedBars: number;
}

/**
 * Момент, начиная с которого свеча имеет право исполнить вход.
 *
 * Два условия, оба обязательны:
 *  1. бар-триггер не может активировать сам себя — значит не раньше момента
 *     его ЗАКРЫТИЯ (`setupOpenTime + execTfMs`);
 *  2. сигнал не может быть исполнен до того, как он опубликован.
 *
 * Свеча учитывается по `openTime`: минута, начавшаяся раньше публикации, уже
 * содержит движение, которого подписчик не мог использовать, поэтому она
 * отбрасывается целиком, а не «частично».
 */
export function entryEligibleFrom(input: Pick<V34EntryInput, 'setupOpenTime' | 'publishedAtMs' | 'execTfMs'>): number {
  const tf = input.execTfMs ?? V34_EXEC_TF_MS;
  return Math.max(input.setupOpenTime + tf, input.publishedAtMs);
}

/** Момент смерти коридора: те же `expiryBars` баров исполнения, что и у V3.3. */
export function entryExpiresAt(input: Pick<V34EntryInput, 'setupOpenTime' | 'execTfMs' | 'expiryBars'>): number {
  const tf = input.execTfMs ?? V34_EXEC_TF_MS;
  const bars = input.expiryBars ?? V34_ENTRY_EXPIRY_BARS;
  return input.setupOpenTime + (bars + 1) * tf;
}

/**
 * Цена исполнения — детерминированная функция ОДНОЙ свечи и границ зоны.
 *
 * Модель: в зоне стоит лимитный ордер по ХУДШЕЙ для нас границе
 * (LONG — `zoneHigh`, SHORT — `zoneLow`). Формула повторяет ту, что уже
 * заморожена в `corridorStep` (v30Core.ts:220), поэтому конвенция «цена входа
 * = открытие, ограниченное худшей гранью» в системе остаётся одна.
 *
 * Разбор всех случаев для LONG (SHORT — зеркально):
 *
 *  A. открытие ВНУТРИ зоны (в т.ч. гэп внутрь)
 *     `zoneLow <= open <= zoneHigh` ⇒ лимит исполняется по открытию: `open`.
 *  B. открытие ВЫШЕ зоны, свеча опускается в неё
 *     `open > zoneHigh`, `low <= zoneHigh` ⇒ первая достигнутая цена зоны —
 *     её верхняя граница: `zoneHigh`. Лучше границы получить нельзя,
 *     поэтому берётся ровно граница, а не `low` (это было бы заглядыванием
 *     в самую выгодную точку свечи).
 *  C. гэп НИЖЕ зоны с возвратом в неё
 *     `open < zoneLow`, `high >= zoneLow` ⇒ на открытии рынок уже лучше
 *     лимита, стоящий ордер исполняется по открытию: `open`. Занижать до
 *     `zoneLow` нельзя — это выдумало бы цену хуже фактически доступной.
 *  D. свеча пересекла зону насквозь снизу вверх
 *     `open < zoneLow`, `high > zoneHigh` ⇒ это случай C: вход по `open`.
 *  E. свеча накрыла зону целиком сверху вниз
 *     `open > zoneHigh`, `low < zoneLow` ⇒ это случай B: вход по `zoneHigh`.
 *
 * Все пять случаев сворачиваются в `min(open, zoneHigh)` для LONG и
 * `max(open, zoneLow)` для SHORT. Будущее не используется: берутся только
 * `open` той же свечи и опубликованные границы.
 *
 * ── ГРАНИЧНЫЙ СЛУЧАЙ, О КОТОРОМ НУЖНО ЗНАТЬ ───────────────────────────────
 * Свеча, целиком лежащая ЗА зоной с выгодной стороны (LONG: `high < zoneLow`),
 * по заданному условию касания зоной НЕ считается — пересечения диапазонов
 * нет. Экономически стоящий лимитный ордер в такой момент исполнился бы.
 * Расхождение оставлено осознанно: условие касания
 * `high >= zoneLow && low <= zoneHigh` задано в постановке, а «додумать»
 * исполнение там, где диапазоны не пересекаются, значит придумать сделку,
 * которой нет в данных. На практике случай почти всегда поглощается стопом:
 * уйти за зону с выгодной стороны, не задев её, — это движение к стопу
 * (LONG: зона выше стопа), и правило стопа срабатывает раньше.
 */
export function v34FillPrice(direction: 'LONG' | 'SHORT', open: number, zoneLow: number, zoneHigh: number): number {
  return direction === 'LONG' ? Math.min(open, zoneHigh) : Math.max(open, zoneLow);
}

/**
 * Касание зоны — ровно то условие, которое задано в требовании:
 * `candle.high >= zoneLow && candle.low <= zoneHigh`.
 * Оно симметрично и покрывает и «свеча внутри зоны», и «зона внутри свечи».
 */
export function touchesZone(c: Pick<ArchiveCandle, 'high' | 'low'>, zoneLow: number, zoneHigh: number): boolean {
  return c.high >= zoneLow && c.low <= zoneHigh;
}

/**
 * Разрешение входа V3.4 по закрытым минутным свечам.
 *
 * Порядок проверок внутри ОДНОЙ свечи (внутриминутная последовательность
 * неизвестна, поэтому выбран консервативный порядок — сомнение трактуется
 * против сделки):
 *
 *   1. стоп задет     → INVALIDATED, даже если та же свеча задела зону;
 *   2. зона задета    → FILLED;
 *   3. TP1 достигнут  → MISSED (цена ушла к цели мимо входа).
 *
 * Почему стоп раньше зоны: если минута накрыла и зону, и стоп, утверждать, что
 * вход состоялся раньше инвалидации, нечем. Это та же конвенция, что в
 * замороженном `corridorStep` (`touches && hitStop → CANCELLED`).
 *
 * Почему зона раньше TP1: касание зоны — это факт входа, и объявить «цель без
 * сделки» после того, как цена побывала в зоне, было бы приписыванием стратегии
 * несуществующего пропуска.
 */
export function resolveV34Entry(input: V34EntryInput): V34EntryResult {
  const { direction, zoneLow, zoneHigh, stop, tp1, m1 } = input;
  const long = direction === 'LONG';
  const eligibleFrom = entryEligibleFrom(input);
  const expiresAt = entryExpiresAt(input);

  let observedBars = 0;
  let windowFullyObserved = false;

  for (const c of m1) {
    if (!c.isClosed) continue;
    if (c.openTime < eligibleFrom) continue;
    if (c.openTime >= expiresAt) { windowFullyObserved = true; break; }
    observedBars++;

    const hitStop = long ? c.low <= stop : c.high >= stop;
    if (hitStop) {
      return { state: 'INVALIDATED', eligibleFrom, expiresAt, fill: null, reason: 'STOP_BEFORE_ENTRY', decidedAt: c.openTime, observedBars };
    }
    if (touchesZone(c, zoneLow, zoneHigh)) {
      return {
        state: 'FILLED', eligibleFrom, expiresAt,
        fill: { price: v34FillPrice(direction, c.open, zoneLow, zoneHigh), barOpenTime: c.openTime },
        reason: null, decidedAt: c.openTime, observedBars,
      };
    }
    const hitTp1 = long ? c.high >= tp1 : c.low <= tp1;
    if (hitTp1) {
      return { state: 'MISSED', eligibleFrom, expiresAt, fill: null, reason: 'TARGET_BEFORE_ENTRY', decidedAt: c.openTime, observedBars };
    }
  }

  /**
   * EXPIRED объявляется только когда окно ДЕЙСТВИТЕЛЬНО наблюдено целиком:
   * либо в серии есть свеча за границей окна, либо последняя закрытая свеча
   * доходит до самой границы. Иначе честный ответ — «ещё ждём»: сказать
   * «истёк» по недостающим данным значит выдумать исход.
   */
  if (!windowFullyObserved) {
    const lastClosed = [...m1].reverse().find((c) => c.isClosed);
    if (lastClosed && lastClosed.closeTime + 1 >= expiresAt) windowFullyObserved = true;
  }
  if (windowFullyObserved) {
    return { state: 'EXPIRED', eligibleFrom, expiresAt, fill: null, reason: 'ENTRY_WINDOW_EXPIRED', decidedAt: expiresAt, observedBars };
  }
  return { state: 'WAITING_FOR_ENTRY', eligibleFrom, expiresAt, fill: null, reason: null, decidedAt: null, observedBars };
}

/**
 * Первый бар сопровождения позиции после внутриминутного входа.
 *
 * Задача: не менять `manageTrade`, но и не отдавать ей час, часть которого
 * прошла ДО входа. Решение — синтетический неполный бар: остаток часового бара,
 * собранный из минутных свечей начиная с минуты исполнения включительно.
 *
 *  • включительно — потому что V3.3 тоже включает бар исполнения в
 *    сопровождение (`bars = h1.slice(i, …)`), и стоп, задетый в ту же минуту,
 *    обязан считаться;
 *  • только остаток часа — потому что минуты до входа к позиции отношения не
 *    имеют, и их high/low дали бы ложный SL/TP;
 *  • будущее не используется: берутся только минуты того же часового бара.
 *
 * Возвращает `null`, если минут после входа в серии нет (данных не хватает —
 * сопровождение в этот момент считать нельзя).
 */
export function partialHourFromFill(
  m1: readonly ArchiveCandle[], fillBarOpenTime: number, execTfMs: number = V34_EXEC_TF_MS,
): ArchiveCandle | null {
  const hourStart = Math.floor(fillBarOpenTime / execTfMs) * execTfMs;
  const hourEnd = hourStart + execTfMs;
  let open: number | null = null;
  let high = -Infinity, low = Infinity, close = 0, volume = 0;
  for (const c of m1) {
    if (!c.isClosed) continue;
    if (c.openTime < fillBarOpenTime) continue;
    if (c.openTime >= hourEnd) break;
    if (open === null) open = c.open;
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    close = c.close;
    volume += c.volume;
  }
  if (open === null) return null;
  return { openTime: hourStart, open, high, low, close, volume, closeTime: hourEnd - 1, isClosed: true };
}
