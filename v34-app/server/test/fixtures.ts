/**
 * Тестовые рыночные данные backend'а.
 *
 * Детерминированный синтетический ряд, обезличенный (`ASSET-A` → `ASSETAUSDT`),
 * в двух формах:
 *   • `rows` — как отвечает Binance /api/v3/klines (массив массивов);
 *   • `h1`/`h4` — как ArchiveCandle (для проверок ядра).
 *
 * Генератор не входит в продукт: он существует только в тестах.
 */
export interface BinanceRowOptions {
  bars1h?: number;
  seed?: number;
  /** Время закрытия последнего 1H-бара (мс). */
  endMs?: number;
  startPrice?: number;
  impulseEvery?: number;
}

export interface FixtureSet {
  symbol: string;
  rows1h: unknown[][];
  rows4h: unknown[][];
  /** openTime последнего 1H-бара. */
  lastOpenTime: number;
  /** closeTime последнего 1H-бара. */
  lastCloseTime: number;
  /** «Сейчас» = сразу после закрытия последнего бара. */
  nowMs: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Полный набор klines: 1H и агрегированные 4H, выровненные по времени. */
export function makeFixtures(opts: BinanceRowOptions = {}): FixtureSet {
  const bars = opts.bars1h ?? 300;
  const seed = opts.seed ?? 1234;
  const endMs = opts.endMs ?? Date.UTC(2024, 5, 1, 0, 0, 0) + 3_600_000;
  const impulseEvery = opts.impulseEvery ?? 13;
  const rnd = mulberry32(seed);

  const HOUR = 3_600_000;
  const FOUR_HOURS = 14_400_000;
  // Старт выравнивается по 4H-границе эпохи: иначе 4H-агрегация не даёт ни
  // одной свечи (группы по 4 бара не совпадают с биржевыми границами).
  const startTime = Math.floor((endMs - bars * HOUR) / FOUR_HOURS) * FOUR_HOURS;

  interface Bar { openTime: number; open: number; high: number; low: number; close: number; volume: number }
  const h1: Bar[] = [];
  let price = opts.startPrice ?? 100;
  let dir = 1;

  for (let i = 0; i < bars; i++) {
    const impulse = impulseEvery > 0 && i > 0 && i % impulseEvery === 0;
    if (impulse && rnd() < 0.5) dir = -dir;
    const gauss = (rnd() + rnd() + rnd() + rnd() - 2) / 1.1;
    const step = price * gauss * (impulse ? 0.03 : 0.005) * (impulse ? dir : 1);
    const open = price;
    const close = Math.max(0.5, open + step);
    const wick = Math.abs(step) * (0.35 + rnd() * 1.2) + open * 0.002;
    const high = Math.max(open, close) + wick * rnd();
    const low = Math.max(0.25, Math.min(open, close) - wick * rnd());
    const volume = impulse ? 5000 + rnd() * 4000 : 900 + rnd() * 400;
    h1.push({
      openTime: startTime + i * HOUR,
      open: r6(open), high: r6(high), low: r6(low), close: r6(close), volume: r6(volume),
    });
    price = close;
  }

  const rows1h = h1.map((b) => row(b, HOUR));
  const rows4h: unknown[][] = [];
  for (let i = 0; i + 3 < h1.length; i += 4) {
    const g = h1.slice(i, i + 4);
    if (g[0]!.openTime % FOUR_HOURS !== 0) continue;
    rows4h.push([
      g[0]!.openTime,
      String(g[0]!.open),
      String(Math.max(...g.map((c) => c.high))),
      String(Math.min(...g.map((c) => c.low))),
      String(g[3]!.close),
      String(g.reduce((s, c) => s + c.volume, 0)),
      g[0]!.openTime + FOUR_HOURS - 1, '0', 1, '0', '0', '0',
    ]);
  }

  const last = h1[h1.length - 1]!;
  return {
    symbol: 'ASSETAUSDT',
    rows1h,
    rows4h,
    lastOpenTime: last.openTime,
    lastCloseTime: last.openTime + HOUR - 1,
    nowMs: last.openTime + HOUR,
  };
}

function row(b: { openTime: number; open: number; high: number; low: number; close: number; volume: number }, span: number): unknown[] {
  return [
    b.openTime, String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume),
    b.openTime + span - 1, '0', 10, '0', '0', '0',
  ];
}

function r6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Подменить последние N баров на «хвост» — для проверок устаревания. */
export function rowsUpTo(rows: readonly unknown[][], index: number): unknown[][] {
  return rows.slice(0, index + 1);
}
