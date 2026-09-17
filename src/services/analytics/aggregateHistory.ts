/**
 * История агрегатов Обзора (суммарный объём 24ч) для честной 24h-дельты.
 * Источник не отдаёт «объём за предыдущие 24ч», поэтому дельта возможна только
 * относительно собственного снимка ≥ 24ч давности. Пока такого снимка нет — дельта не подставляется (null).
 * Чистая логика; хранилище — localStorage браузера (ключ ниже), ≤ 48ч точек с шагом ≥ 10 мин.
 */
export const AGGREGATE_HISTORY_KEY = 'cryptora_overview_history_v1';
const MIN_STEP_MS = 10 * 60 * 1000;
const KEEP_MS = 48 * 60 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** Допуск на поиск точки «≈24ч назад»: от 24ч до 30ч. */
const TOLERANCE_MS = 6 * 60 * 60 * 1000;

export interface AggregatePoint {
  t: number;
  volume24h: number;
}

export function parseHistory(raw: string | null | undefined): AggregatePoint[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((p): p is AggregatePoint => !!p && typeof (p as AggregatePoint).t === 'number' && typeof (p as AggregatePoint).volume24h === 'number');
  } catch {
    return [];
  }
}

/** Добавляет точку (не чаще раза в 10 мин) и обрезает хвост старше 48ч. Не мутирует вход. */
export function appendPoint(history: readonly AggregatePoint[], point: AggregatePoint): AggregatePoint[] {
  const pruned = history.filter((p) => point.t - p.t <= KEEP_MS && p.t <= point.t);
  const last = pruned[pruned.length - 1];
  if (last && point.t - last.t < MIN_STEP_MS) return pruned;
  return [...pruned, point];
}

/**
 * Дельта объёма 24ч, %: текущий объём против точки, ближайшей к (now − 24ч) в окне [24ч; 30ч] назад.
 * null — базы нет (ещё не накоплено 24ч наблюдений).
 */
export function volumeChange24h(history: readonly AggregatePoint[], current: number, now: number): number | null {
  const target = now - WINDOW_MS;
  let best: AggregatePoint | null = null;
  for (const p of history) {
    if (p.t > target || target - p.t > TOLERANCE_MS) continue;
    if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
  }
  if (!best || best.volume24h <= 0) return null;
  return Number((((current - best.volume24h) / best.volume24h) * 100).toFixed(2));
}

/**
 * Дельта капитализации 24ч, % — точная производная из данных источника: капитализация = цена × оборотное предложение,
 * а 24h-изменение цены каждого актива источник отдаёт. prevCap = cap / (1 + change/100).
 */
export function marketCapChange24hFromAssets(assets: ReadonlyArray<{ marketCap: number; change24h: number }>): number | null {
  let cur = 0;
  let prev = 0;
  for (const a of assets) {
    if (!(a.marketCap > 0) || !Number.isFinite(a.change24h) || a.change24h <= -100) continue;
    cur += a.marketCap;
    prev += a.marketCap / (1 + a.change24h / 100);
  }
  if (prev <= 0) return null;
  return Number((((cur - prev) / prev) * 100).toFixed(2));
}
