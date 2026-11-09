/**
 * OHLCV биржи → ArchiveCandle (типы стратегии) и подготовка закрытых серий.
 *
 * ПОРТ ИЗ CRYPTORA:
 *   • `ohlcvToArchive` — `src/services/signals/live/ohlcvAdapter.ts` (isClosed
 *     считается по времени закрытия свечи, а не хардкодится: незакрытый бар
 *     стратегию не видит);
 *   • `toClosedArchive` / `countGaps` — `src/services/signals/live/LiveSignalEngine.ts`
 *     (сортировка по времени, дедупликация по openTime, подсчёт пропусков).
 *
 * Единственное отличие от источника — локальный тип `OHLCV` (в CRYPTORA он из
 * `src/types/market.ts`) и обязательный `provenance` на уровне провайдера.
 * Поведение проверяется `test/parity.ohlcv.test.ts`.
 */
import type { ArchiveCandle, ArchiveTimeframe } from '../strategy/types';
import { ARCHIVE_TF_MS } from '../strategy/types';

/** Свеча от публичного REST-эндпоинта биржи (time — секунды, как у Binance). */
export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  provenance?: { exchange: string; isFallback: boolean };
}

export function ohlcvToArchive(c: OHLCV, tf: ArchiveTimeframe, nowMs?: number): ArchiveCandle {
  const openTime = c.time * 1000; // seconds → ms
  const span = ARCHIVE_TF_MS[tf];
  const closeTime = openTime + span - 1;
  return {
    openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    closeTime,
    // nowMs не задан (архив/бэктест) → считаем бар закрытым; задан → только если
    // время закрытия уже прошло. Незакрытый бар в стратегию не попадает.
    isClosed: nowMs === undefined ? true : closeTime < nowMs,
  };
}

/** Закрытые свечи по возрастанию времени, без дублей. */
export function toClosedArchive(
  raw: readonly OHLCV[] | null | undefined, tf: ArchiveTimeframe, nowMs: number,
): ArchiveCandle[] {
  const conv = (Array.isArray(raw) ? raw : []).map((c) => ohlcvToArchive(c, tf, nowMs)).filter((c) => c.isClosed);
  conv.sort((a, b) => a.openTime - b.openTime);
  const out: ArchiveCandle[] = [];
  for (const c of conv) {
    const last = out[out.length - 1];
    if (last && last.openTime === c.openTime) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

/** Сколько разрывов в серии (для честного статуса «данные с пропусками»). */
export function countGaps(candles: readonly ArchiveCandle[], spanMs: number): number {
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.openTime - candles[i - 1]!.openTime !== spanMs) gaps++;
  }
  return gaps;
}
