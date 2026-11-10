/**
 * Серверный проход V3.4 по одному символу.
 *
 * ПОРТ ПРАВИЛ ПУБЛИКАЦИИ из `src/services/signals/live/LiveSignalEngine.ts`
 * (`scanSymbol`): в журнал попадают только сетапы ПОСЛЕДНЕГО закрытого 1H-бара
 * (`rec.setupOpenTime === lastClosed.openTime`) и только прошедшие геометрию
 * (`rec.publishable === true`). Остальные записи окна — ретроспектива, не
 * сигналы: они возвращаются отдельно и в базу не пишутся.
 *
 * Никакой математики здесь нет — только подготовка серий, вызов неизменённого
 * реплея и отбор публикуемых записей.
 */
import type { ArchiveCandle } from './strategy/types';
import { V34_CANDLE_LIMITS, V34_SYMBOLS, DATA_FRESHNESS } from './config';
import { countGaps, toClosedArchive, type OHLCV } from './signals/ohlcv';
import { runV34LiveReplay } from './signals/v34LiveReplay';
import type { ReplayOutput, ReplayRecord } from './signals/replayTypes';

export interface V34ScanInput {
  symbol: string;
  /** Сырые 1H-свечи от биржи (незакрытый последний бар допустим — он отбрасывается). */
  h1Raw: readonly OHLCV[];
  /** Сырые 4H-свечи от биржи. */
  h4Raw: readonly OHLCV[];
  /** Время оценки (мс). Незакрытые бары отбрасываются по нему. */
  nowMs: number;
}

export interface V34ScanOutput {
  symbol: string;
  /** Полный результат реплея окна (сетапы + исходы по закрытым свечам). */
  replay: ReplayOutput;
  /** Сетапы, которые разрешено публиковать (последний закрытый бар + геометрия). */
  publishable: ReplayRecord[];
  lastClosedBarOpenTime: number | null;
  lastClosedBarCloseTime: number | null;
  closedBars: { '1h': number; '4h': number };
  gaps1h: number;
  /** Явная ошибка данных: окно непригодно. null — окно пригодно. */
  dataError: string | null;
  /** Закрытая 1H-серия, по которой считался реплей (нужна ведению сигналов). */
  closedH1: ArchiveCandle[];
  /** Закрытая 4H-серия (контекст). */
  closedH4: ArchiveCandle[];
  /** Провенанс серии (заполняет провайдер; здесь только пробрасывается). */
  source: { exchange: string; isFallback: boolean } | null;
  /** Заметки реплея (усечение истории, прогрев) — для статуса, не для UI-сигналов. */
  notes: string[];
  /** «Свежесть» закрытого бара на момент nowMs (мс). */
  lastBarAgeMs: number | null;
}

function sourceOf(raw: readonly OHLCV[] | null | undefined): { exchange: string; isFallback: boolean } | null {
  if (!Array.isArray(raw)) return null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const p = raw[i]?.provenance;
    if (p?.exchange) return { exchange: p.exchange, isFallback: Boolean(p.isFallback) };
  }
  return null;
}

/**
 * Один проход по символу. Ошибки данных формулируются явно (`dataError`), а не
 * превращаются в «сетапов нет».
 */
export function runV34Scan(input: V34ScanInput): V34ScanOutput {
  const { symbol, nowMs } = input;
  const h1: ArchiveCandle[] = toClosedArchive(input.h1Raw, '1h', nowMs);
  const h4: ArchiveCandle[] = toClosedArchive(input.h4Raw, '4h', nowMs);

  const lastClosed = h1[h1.length - 1] ?? null;
  const notes: string[] = [];
  let dataError: string | null = null;

  if (!lastClosed) {
    dataError = 'нет закрытых 1H-свечей в ответе биржи';
  } else if (h1.length < DATA_FRESHNESS.minClosedBars1h) {
    dataError = `недостаточно закрытых 1H-баров: ${h1.length} < ${DATA_FRESHNESS.minClosedBars1h}`;
  } else if (h4.length === 0) {
    dataError = 'нет закрытых 4H-свечей в ответе биржи';
  }

  const replay: ReplayOutput = dataError
    ? { records: [], evaluatedBars: 0, firstEvaluatedOpenTime: null, lastEvaluatedOpenTime: null, notes: [dataError] }
    : runV34LiveReplay({ symbol, h1, h4 });

  if (dataError) notes.push(dataError);
  else notes.push(...replay.notes);

  const lastBarAgeMs = lastClosed ? nowMs - lastClosed.closeTime : null;
  if (lastClosed && lastBarAgeMs !== null && lastBarAgeMs > DATA_FRESHNESS.maxBarAgeMs) {
    notes.push(
      `Последний закрытый 1H-бар старше ${Math.round(DATA_FRESHNESS.maxBarAgeMs / 60000)} мин — данные биржи устарели.`,
    );
  }

  return {
    symbol,
    replay,
    publishable: dataError ? [] : selectPublishableSetups(replay, lastClosed!.openTime),
    lastClosedBarOpenTime: lastClosed ? lastClosed.openTime : null,
    lastClosedBarCloseTime: lastClosed ? lastClosed.closeTime : null,
    closedBars: { '1h': h1.length, '4h': h4.length },
    gaps1h: countGaps(h1, 3_600_000),
    closedH1: h1,
    closedH4: h4,
    dataError,
    source: sourceOf(input.h1Raw),
    notes,
    lastBarAgeMs,
  };
}

/**
 * Отбор публикуемых сетапов: только бар сетапа = последний закрытый 1H-бар и
 * только прошедшая геометрия. Правило взято из `LiveSignalEngine.scanSymbol`.
 */
export function selectPublishableSetups(out: ReplayOutput, lastClosedOpenTime: number): ReplayRecord[] {
  return out.records.filter(
    (rec) => rec.setupOpenTime === lastClosedOpenTime && rec.publishable === true,
  );
}

/** Вселенная по умолчанию (проверяется на совпадение с каталогом в тестах). */
export function defaultSymbols(): readonly string[] {
  return V34_SYMBOLS;
}

/** Лимиты свечей, которые нужно запросить, чтобы повторить окно продукта. */
export function candleLimits(): { '1h': number; '4h': number } {
  return { '1h': V34_CANDLE_LIMITS['1h'], '4h': V34_CANDLE_LIMITS['4h'] };
}
