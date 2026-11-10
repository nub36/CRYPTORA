/**
 * Обезличенные синтетические данные для parity-тестов.
 *
 * Требования к фикстуре:
 *   • никаких реальных тикеров, цен и дат биржи — символическое имя `ASSET-A`,
 *     стартовая цена 100, фиксированный «нулевой» timestamp;
 *   • детерминизм: один seed → одна и та же серия, одинаковые результаты у
 *     источника и у копии;
 *   • 4H-серия построена АГРЕГАЦИЕЙ 1H-серии (как это делает биржа), поэтому
 *     окна согласованы и не содержат выдуманных «идеальных» структур.
 *
 * Генератор не является частью стратегии: он не влияет на расчёты.
 */
import type { ArchiveCandle } from '../../src/strategy/types';

/** Детерминированный PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  /** Сколько 1H-баров сгенерировать (кратно 4). */
  bars1h?: number;
  seed?: number;
  startPrice?: number;
  /** Базовая волатильность 1H-бара (доля цены). */
  sigma?: number;
  /** Каждый N-й бар — импульс (для displacement/RVOL). */
  impulseEvery?: number;
  /** Сила импульса (доля цены). */
  impulseSigma?: number;
  /** Начало окна (мс, кратно 4H, фиксированное). */
  startTime?: number;
}

const FOUR_H = 14_400_000;

/** Свечи 1H и агрегированные из них 4H (все закрытые). */
export interface SyntheticSeries {
  h1: ArchiveCandle[];
  h4: ArchiveCandle[];
}

export function makeSyntheticSeries(opts: SyntheticOptions = {}): SyntheticSeries {
  const bars = opts.bars1h ?? 900;
  const seed = opts.seed ?? 20260930;
  const sigma = opts.sigma ?? 0.0045;
  const impulseEvery = opts.impulseEvery ?? 17;
  const impulseSigma = opts.impulseSigma ?? 0.028;
  // 2024-01-01T00:00:00Z — фиксированная, обезличенная точка отсчёта.
  const startTime = opts.startTime ?? Date.UTC(2024, 0, 1, 0, 0, 0);
  const rnd = mulberry32(seed);

  const h1: ArchiveCandle[] = [];
  let price = opts.startPrice ?? 100;
  let impulseDir = 1;

  for (let i = 0; i < bars; i++) {
    const isImpulse = impulseEvery > 0 && i > 0 && i % impulseEvery === 0;
    if (isImpulse && rnd() < 0.5) impulseDir = -impulseDir;
    const gauss = (rnd() + rnd() + rnd() + rnd() - 2) / 1.1;
    const step = price * gauss * (isImpulse ? impulseSigma : sigma) * (isImpulse ? impulseDir : 1);

    const open = price;
    const close = Math.max(0.5, open + step);
    const wick = Math.abs(step) * (0.35 + rnd() * 1.2) + open * sigma * 0.5;
    const high = Math.max(open, close) + wick * rnd();
    const low = Math.max(0.25, Math.min(open, close) - wick * rnd());
    const baseVol = 900 + rnd() * 400;
    const volume = isImpulse ? baseVol * (5 + rnd() * 5) : baseVol;

    const openTime = startTime + i * 3_600_000;
    h1.push({
      openTime,
      open: round6(open),
      high: round6(high),
      low: round6(low),
      close: round6(close),
      volume: round6(volume),
      closeTime: openTime + 3_600_000 - 1,
      isClosed: true,
    });
    price = close;
  }

  const h4: ArchiveCandle[] = [];
  for (let i = 0; i + 3 < h1.length; i += 4) {
    const group = h1.slice(i, i + 4);
    const openTime = group[0]!.openTime;
    if (openTime % FOUR_H !== 0) continue;
    h4.push({
      openTime,
      open: group[0]!.open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[3]!.close,
      volume: group.reduce((s, c) => s + c.volume, 0),
      closeTime: openTime + FOUR_H - 1,
      isClosed: true,
    });
  }

  return { h1, h4 };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
