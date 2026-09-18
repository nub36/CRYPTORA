import { OHLCV } from '@/types/market';

export interface HeatmapAxisTick {
  /** Позиция в процентах от начала оси (0…100). */
  offsetPct: number;
  label: string;
}

export interface LiquidationHeatmapRow {
  price: number;
  /** Интенсивность по колонкам времени (0…1), слева — прошлое, справа — настоящее. */
  values: number[];
}

export interface LiquidationHeatmapModel {
  rows: LiquidationHeatmapRow[];
  timeTicks: HeatmapAxisTick[];
  priceTicks: HeatmapAxisTick[];
  /** Цена, вокруг которой строилась модель (последняя доступная метка). */
  referencePrice: number;
  /** Уровень с максимальной накопленной плотностью — только как модельная подсказка. */
  peakPrice: number;
  peakIntensity: number;
  leverageTiers: number[];
  columns: number;
  /** Провенанс входных метрик: фактические свечи или демонстрационный набор. */
  inputSource: 'FACTUAL' | 'DEMO';
  /** Пояснение формулы — выводится в UI рядом с картой. */
  methodNote: string;
}

export interface BuildHeatmapInput {
  candles: OHLCV[];
  referencePrice: number;
  openInterestUsd: number;
  leverageTiers?: number[];
  maxColumns?: number;
  maxRows?: number;
}

/**
 * LiquidationHeatmapModel — расчетная карта плотности ликвидаций «цена × время».
 *
 * ⚠️ Это МОДЕЛЬ, а не факт. Карта показывает, где при заданных плечах (10x–100x)
 * теоретически накапливаются зоны принудительного закрытия вдоль исторической
 * траектории цены, взвешенные по объёму свечей и открытому интересу.
 *
 * Инварианты (RULES §1, §3):
 *  1. Никаких случайных значений: результат — чистая детерминированная функция входов.
 *  2. Карта всегда маркируется `MODEL / ESTIMATED` и никогда не смешивается с
 *     фактическими событиями ликвидаций из потока биржи.
 *  3. Нет входных данных (свечи, метка цены) — карта не строится вовсе.
 */
export class LiquidationHeatmapModelBuilder {
  public static readonly DEFAULT_TIERS = [10, 25, 50, 100];
  private static readonly PADDING_RATIO = 0.02;
  private static readonly KERNEL = [0.3, 1, 0.3];

  public static build(input: BuildHeatmapInput): LiquidationHeatmapModel | null {
    const tiers = input.leverageTiers ?? this.DEFAULT_TIERS;
    const maxColumns = input.maxColumns ?? 64;
    const maxRows = input.maxRows ?? 28;

    const candles = input.candles.filter(
      (c) => Number.isFinite(c.close) && c.close > 0 && Number.isFinite(c.high) && Number.isFinite(c.low)
    );
    if (candles.length < 8 || !Number.isFinite(input.referencePrice) || input.referencePrice <= 0) {
      return null;
    }

    const step = Math.max(1, Math.ceil(candles.length / maxColumns));
    const sampled = candles.filter((_, index) => index % step === 0).slice(-maxColumns);

    const referencePrice = input.referencePrice;

    // Диапазон обязан перекрывать ВСЕ уровни модели (включая дальние зоны 10x),
    // иначе их вклад «слипался» бы в крайние строки и создавал ложные пики на краях.
    const levelPrices: number[] = [];
    const candleCloses: Array<{ close: number; volume: number }> = [];
    for (const candle of sampled) {
      candleCloses.push({ close: candle.close, volume: Number.isFinite(candle.volume) ? candle.volume : 0 });
      for (const leverage of tiers) {
        levelPrices.push(candle.close * (1 - 1 / leverage), candle.close * (1 + 1 / leverage));
      }
    }

    const candidates = [
      ...sampled.map((c) => c.low),
      ...sampled.map((c) => c.high),
      ...levelPrices,
      referencePrice,
    ];
    let low = Math.min(...candidates);
    let high = Math.max(...candidates);
    const padding = (high - low) * this.PADDING_RATIO;
    low -= padding;
    high += padding;
    const span = high - low || 1;

    const rows: LiquidationHeatmapRow[] = Array.from({ length: maxRows }, (_, row) => ({
      price: Number((high - ((row + 0.5) / maxRows) * span).toFixed(6)),
      values: new Array(sampled.length).fill(0),
    }));

    const avgVolume =
      sampled.reduce((acc, c) => acc + (Number.isFinite(c.volume) ? c.volume : 0), 0) / sampled.length || 1;

    const rowIndexFor = (price: number): number => {
      const ratio = (high - price) / span;
      return Math.min(maxRows - 1, Math.max(0, Math.floor(ratio * maxRows)));
    };

    candleCloses.forEach(({ close, volume }, column) => {
      const volumeWeight = Math.min(1.5, volume / avgVolume);

      for (const leverage of tiers) {
        // Распределение открытого интереса по плечевым тирам принимается равномерным:
        // более высокие плечи стоят ближе к цене и естественно образуют более узкие
        // и плотные полосы без искусственного усиления веса.
        const tierWeight = 1 / tiers.length;
        const weighted = volumeWeight * tierWeight;

        for (const price of [close * (1 - 1 / leverage), close * (1 + 1 / leverage)]) {
          const center = rowIndexFor(price);
          this.KERNEL.forEach((kernelWeight, offset) => {
            const index = center + offset - 1;
            if (index < 0 || index >= rows.length) return;
            rows[index].values[column] += weighted * kernelWeight;
          });
        }
      }
    });

    // Нормировка к 0…1 по глобальному максимуму — карта остаётся сопоставимой.
    const maxValue = Math.max(...rows.map((row) => Math.max(...row.values)), 0);
    if (maxValue <= 0) return null;

    for (const row of rows) {
      row.values = row.values.map((value) =>
        Number(Math.min(1, (value / maxValue) * (1 + (input.openInterestUsd > 0 ? 0.15 : 0))).toFixed(4))
      );
    }

    const peakRow = rows.reduce((best, row) => {
      const total = row.values.reduce((a, b) => a + b, 0);
      return total > best.total ? { total, row } : best;
    }, { total: 0, row: rows[0] });

    // Тики времени: не более 6 подписей, последняя — строго на правом краю.
    // Соседние подписи не должны наезжать друг на друга (иначе метки обрезаются).
    const timeTickIndices: number[] = [];
    const tickStep = Math.max(1, Math.round((sampled.length - 1) / 5));
    for (let index = 0; index <= sampled.length - 1; index += tickStep) timeTickIndices.push(index);
    const lastIndex = sampled.length - 1;
    if (timeTickIndices[timeTickIndices.length - 1] !== lastIndex) {
      if (lastIndex - timeTickIndices[timeTickIndices.length - 1] < tickStep * 0.6) timeTickIndices.pop();
      timeTickIndices.push(lastIndex);
    }

    const timeTicks: HeatmapAxisTick[] = timeTickIndices.map((index) => {
      const date = new Date(sampled[index].time * 1000);
      return {
        offsetPct: Number(((index / Math.max(1, sampled.length - 1)) * 100).toFixed(2)),
        label: `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')} ${String(
          date.getUTCHours()
        ).padStart(2, '0')}:00`,
      };
    });

    const priceTickEvery = Math.max(1, Math.floor(maxRows / 5));
    const priceTicks: HeatmapAxisTick[] = [];
    rows.forEach((row, index) => {
      if (index % priceTickEvery !== 0 && index !== rows.length - 1) return;
      priceTicks.push({
        offsetPct: Number((((index + 0.5) / rows.length) * 100).toFixed(2)),
        label: row.price.toLocaleString('en-US', { maximumFractionDigits: row.price > 100 ? 0 : 2 }),
      });
    });

    return {
      rows,
      timeTicks,
      priceTicks,
      referencePrice,
      peakPrice: peakRow.row.price,
      peakIntensity: Number(Math.min(1, peakRow.total / sampled.length).toFixed(4)),
      leverageTiers: tiers,
      columns: sampled.length,
      inputSource: sampled[0]?.provenance?.exchange === 'synthetic-demo' || !sampled[0]?.provenance
        ? 'DEMO'
        : 'FACTUAL',
      methodNote:
        'Модель: уровни 1/плечо от цены закрытия каждой свечи (10x–100x) при равномерном распределении открытого интереса по тирам, ' +
        'взвешенные по объёму свечей. ' +
        'Светлые зоны — расчетная плотность зон принудительного закрытия. Это не фактические ордера и не индивидуальные уровни клиентов бирж.',
    };
  }
}
