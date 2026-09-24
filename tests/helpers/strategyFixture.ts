/**
 * CRYPTORA — Детерминированные фикстурные свечи для проверки provenance сигналов.
 *
 * Зачем отдельный генератор, а не общий синус из других тестов:
 * контракт provenance проверяется только там, где замороженные стратегии
 * РЕАЛЬНО публикуют сетап. Синусоидальные ряды из
 * tests/integration/strategyEngineScan.test.ts условий стратегий не
 * удовлетворяют (в нём же про это честно написано), поэтому «все три стратегии
 * молчат» и подмена одной стратегии другой неотличима от «сетапов нет».
 *
 * Здесь ряд строится так, чтобы на ПОСЛЕДНЕМ закрытом 1h-баре выполнились
 * условия V3.0 и V3.3, а уровни у них при этом РАЗНЫЕ (цели считаются по
 * разным формулам): это даёт воспроизводимый тест на «чей payload ушёл в БД».
 *
 * Детерминизм: ни Math.random, ни Date.now() внутри генератора (RULES §2) —
 * `nowMs` передаётся снаружи.
 */

export const HOUR_MS = 3_600_000;
const H4_MS = 4 * HOUR_MS;
const D1_MS = 24 * HOUR_MS;

/** Пол (в долях) и амплитуда синтетического 4h-ряда: LOW = 900, HIGH = 1100. */
export const FIXTURE_LOW = 900;
export const FIXTURE_HIGH = 1100;

export interface FixtureOptions {
  /** Момент «сейчас»: последний 1h-бар считается формирующимся и отбрасывается. */
  nowMs?: number;
  limit1h?: number;
  limit4h?: number;
  limit1d?: number;
}

export interface CandleFixture {
  nowMs: number;
  /** openTime последнего ЗАКРЫТОГО 1h-бара. */
  lastClosed1hOpenTime: number;
  h1: number[][];
  h4: number[][];
  h1d: number[][];
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Детерминированный «шум» вместо Math.random: строгие пивоты без случайности. */
const noise = (i: number, mul: number, mod: number): number => ((i * mul) % mod) / mod;

/** Треугольная волна: 0 в минимуме, 1 в максимуме. */
const tri = (x: number): number => {
  const f = x - Math.floor(x);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

/**
 * Сырые klines Binance: [openTime, o, h, l, c, v, closeTime, …].
 * Последний бар серии — формирующийся (closeTime > nowMs), как у реального
 * эндпоинта: ядро обязано отсечь его само, иначе look-ahead.
 */
export function buildProvenanceFixture(opts: FixtureOptions = {}): CandleFixture {
  const nowMs = opts.nowMs ?? Date.parse('2026-09-24T15:30:00.000Z');
  const limit1h = opts.limit1h ?? 1000;
  const limit4h = opts.limit4h ?? 1000;
  const limit1d = opts.limit1d ?? 400;

  const lastOpen1h = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const first1h = lastOpen1h - (limit1h - 1) * HOUR_MS;
  const lastOpen4h = Math.floor(nowMs / H4_MS) * H4_MS;
  const first4h = lastOpen4h - (limit4h - 1) * H4_MS;
  const lastOpen1d = Math.floor(nowMs / D1_MS) * D1_MS;
  const first1d = lastOpen1d - (limit1d - 1) * D1_MS;

  // 4h-ряд: пила с периодом 40 баров. Тело бара ≈ 10 ⇒ body/ATR(4h) > 0.6,
  // то есть displacement для зон V3.3 детектируется.
  const level4h = (t: number): number => FIXTURE_LOW + (FIXTURE_HIGH - FIXTURE_LOW) * tri(t / 40);
  // 1h-ряд: та же полоса, но медленнее (период 640 баров) + мелкая рябь.
  const level1h = (t: number): number =>
    FIXTURE_LOW + (FIXTURE_HIGH - FIXTURE_LOW) * tri(t / 640) + 6 * Math.sin(t / 11);
  const level1d = (t: number): number =>
    FIXTURE_LOW + (FIXTURE_HIGH - FIXTURE_LOW) * tri(t / 30);

  const series = (
    first: number, step: number, count: number, level: (t: number) => number,
    baseVolume: number,
  ): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < count; i++) {
      const openTime = first + i * step;
      const o = level(i);
      const c = level(i + 1);
      const high = Math.max(o, c) * (1 + 0.0004 + 0.0006 * noise(i, 37, 11));
      const low = Math.min(o, c) * (1 - 0.0004 - 0.0006 * noise(i, 53, 13));
      const volume = baseVolume * (1 + 0.3 * Math.abs(Math.sin(i / 5)));
      out.push([
        openTime, r2(o), r2(high), r2(low), r2(c), r2(volume),
        openTime + step - 1, r2(volume * c), 500, r2(volume * 0.4), r2(volume * 0.4 * c), 0,
      ]);
    }
    return out;
  };

  const h4 = series(first4h, H4_MS, limit4h, level4h, 100);
  const h1d = series(first1d, D1_MS, limit1d, level1d, 100);
  const h1 = series(first1h, HOUR_MS, limit1h, level1h, 100);

  // Последний ЗАКРЫТЫЙ 1h-бар (индекс limit1h - 2): прокол минимума 4h-диапазона
  // с закрытием обратно выше — ровно то, что ищут V3.0 (ловушка) и V3.3
  // (абсорбция на mitigated-зоне у минимума).
  const t = limit1h - 2;
  const low = FIXTURE_LOW - 12;    // прокол ниже подтверждённого swing low (≈ LOW)
  const open = FIXTURE_LOW - 8;
  const close = FIXTURE_LOW + 2;   // закрытие выше swing low, но НИЖЕ середины 4h-диапазона
  const high = FIXTURE_LOW + 7;
  const openTime = first1h + t * HOUR_MS;
  const volume = 5000;             // RVOL ≫ 1.25
  h1[t] = [
    openTime, r2(open), r2(high), r2(low), r2(close), volume,
    openTime + HOUR_MS - 1, r2(volume * close), 500, r2(volume * 0.4), r2(volume * 0.4 * close), 0,
  ];
  // Плавный спуск к климаксу, чтобы engineered-бар не выглядел телепортом.
  for (let k = 1; k <= 6; k++) {
    const idx = t - k;
    const row = h1[idx]!;
    const drift = level1h(idx) - (7 - k) * 1.5;
    row[1] = r2(drift);
    row[4] = r2(drift - 1.5);
    row[2] = r2(Math.max(drift, drift - 1.5) * 1.002);
    row[3] = r2(Math.min(drift, drift - 1.5) * 0.998);
  }

  return { nowMs, lastClosed1hOpenTime: openTime, h1, h4, h1d };
}
