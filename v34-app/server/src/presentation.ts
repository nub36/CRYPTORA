/**
 * Представление данных для Android-приложения.
 *
 * Правила, которые здесь соблюдаются буквально:
 *   • уровни отдаются только те, что сохранены сервером; отсутствующий стоп —
 *     это `null`, и НИКОГДА не цена входа;
 *   • TP1 ✓ / TP2 ✓ / безубыток / действующий стоп выводятся только из
 *     подтверждённых событий журнала и подтверждённого прогресса ядра;
 *   • время события — только сохранённое (`occurred_at`), а не «сейчас»;
 *   • устаревшие данные помечаются флагом `stale` и причиной, а не выдаются за
 *     свежие.
 */
import type { SignalRow, EventRow } from './repository';
import { projectSignalProgress, type LifecycleProjection } from './events';
import type { SignalEventType } from './db';

export interface SignalPresentationContext {
  /** Данные источника устарели на момент ответа. */
  stale: boolean;
  /** Причина устаревания (например, «последний скан 12 мин назад»). */
  staleReason: string | null;
  now: string;
}

export interface SignalView {
  id: string;
  strategy: { id: string; version: string; name: string };
  symbol: string;
  exchangeSymbol: string;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  /** Время события формирования сетапа (бар сетапа, UTC ISO). */
  setupAt: string;
  /** Время публикации на сервере. */
  publishedAt: string;
  /** План входа: коридор. null — если стратегия его не задала. */
  entryZone: { low: number; high: number } | null;
  /** Факт исполнения. null — входа ещё не было. */
  entry: { price: number; at: string } | null;
  /** Первоначальный стоп. null — серверного значения нет (НЕ цена входа). */
  initialStopLoss: number | null;
  /** Лестница целей, только сохранённые уровни. */
  targets: { level: number; price: number }[];
  status: string;
  /** Время последнего подтверждённого изменения статуса. */
  statusAt: string | null;
  closedAt: string | null;
  outcome: {
    status: string;
    exitReason: string | null;
    exitPrice: number | null;
    resultR: number | null;
    netResultR: number | null;
    pnlResultPct: number | null;
    barsHeld: number | null;
  } | null;
  /** Прогресс сделки — ровно проекция событий (без вычислений по рынку). */
  progress: LifecycleProjection;
  events: { type: SignalEventType; occurredAt: string | null }[];
  dataSource: { exchange: string; isFallback: boolean } | null;
  /** Данные устарели — UI обязан показать предупреждение, а не «свежий сигнал». */
  stale: boolean;
  staleReason: string | null;
  asOf: string;
}

function numOrNull(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function toSignalView(
  row: SignalRow,
  events: readonly EventRow[],
  ctx: SignalPresentationContext,
  strategy: { id: string; version: string; name: string },
): SignalView {
  const entryLow = numOrNull(row.entry_min);
  const entryHigh = numOrNull(row.entry_max);
  const stop = numOrNull(row.stop_loss);
  const targets: { level: number; price: number }[] = [];
  const tp1 = numOrNull(row.tp1);
  const tp2 = numOrNull(row.tp2);
  if (tp1 !== null) targets.push({ level: 1, price: tp1 });
  if (tp2 !== null) targets.push({ level: 2, price: tp2 });

  const fillPrice = numOrNull(row.fill_price);
  const progress = projectSignalProgress(
    {
      status: row.status,
      fillPrice,
      closeReason: row.close_reason,
      closedAt: row.closed_at,
      createdAt: row.created_at,
      filledAt: row.filled_at,
    },
    events.map((e) => ({ eventType: e.event_type, occurredAt: e.occurred_at })),
  );

  const tradeClosed = row.closed_at !== null;

  return {
    id: row.id,
    strategy,
    symbol: row.symbol,
    exchangeSymbol: row.exchange_symbol,
    direction: row.direction,
    timeframe: row.timeframe,
    setupAt: iso(row.setup_open_time),
    publishedAt: row.created_at,
    entryZone: entryLow !== null && entryHigh !== null ? { low: entryLow, high: entryHigh } : null,
    entry: fillPrice !== null && row.filled_at !== null ? { price: fillPrice, at: row.filled_at } : null,
    initialStopLoss: stop,
    targets,
    status: row.status,
    statusAt: row.closed_at ?? row.filled_at ?? row.created_at,
    closedAt: row.closed_at,
    outcome: tradeClosed
      ? {
        status: row.status,
        exitReason: row.close_reason,
        exitPrice: numOrNull(row.close_price),
        resultR: numOrNull(row.result_r),
        netResultR: numOrNull(row.net_result_r),
        pnlResultPct: numOrNull(row.pnl_result_pct),
        barsHeld: row.bars_held,
      }
      : null,
    progress,
    events: events.map((e) => ({ type: e.event_type, occurredAt: e.occurred_at })),
    dataSource: row.data_source ? (JSON.parse(row.data_source) as { exchange: string; isFallback: boolean }) : null,
    stale: ctx.stale,
    staleReason: ctx.stale ? ctx.staleReason : null,
    asOf: ctx.now,
  };
}

export interface DataStatus {
  status: 'fresh' | 'stale' | 'error' | 'unknown';
  reason: string | null;
  lastScanAt: string | null;
  lastSuccessfulScanAt: string | null;
  ageMs: number | null;
}

/**
 * Свежесть данных источника.
 *
 * `stale` — успешный скан был, но давно; `error` — сканы идут, но все символы
 * с ошибкой данных; `unknown` — сканов ещё не было. Приложение обязано
 * показывать эти состояния, а не пустой список без объяснения.
 */
export function computeDataStatus(args: {
  nowMs: number;
  scanStaleAfterMs: number;
  lastScan: { finished_at: string | null; started_at: string } | null;
  lastSuccessfulScanAt: string | null;
  symbols: readonly { data_error: string | null }[];
}): DataStatus {
  const lastScanAt = args.lastScan?.finished_at ?? args.lastScan?.started_at ?? null;
  if (!lastScanAt) {
    return {
      status: 'unknown', reason: 'сканов ещё не было', lastScanAt: null,
      lastSuccessfulScanAt: null, ageMs: null,
    };
  }
  const successfulMs = args.lastSuccessfulScanAt ? Date.parse(args.lastSuccessfulScanAt) : null;
  const ageMs = successfulMs !== null ? args.nowMs - successfulMs : null;

  if (args.symbols.length > 0 && args.symbols.every((s) => s.data_error !== null)) {
    return {
      status: 'error',
      reason: 'все символы вернули ошибку данных',
      lastScanAt,
      lastSuccessfulScanAt: args.lastSuccessfulScanAt,
      ageMs,
    };
  }
  if (successfulMs === null) {
    return {
      status: 'stale', reason: 'успешных сканов ещё не было', lastScanAt,
      lastSuccessfulScanAt: args.lastSuccessfulScanAt, ageMs,
    };
  }
  if (ageMs !== null && ageMs > args.scanStaleAfterMs) {
    return {
      status: 'stale',
      reason: `последний успешный скан ${Math.round(ageMs / 60_000)} мин назад`,
      lastScanAt,
      lastSuccessfulScanAt: args.lastSuccessfulScanAt,
      ageMs,
    };
  }
  return {
    status: 'fresh', reason: null, lastScanAt,
    lastSuccessfulScanAt: args.lastSuccessfulScanAt, ageMs,
  };
}
