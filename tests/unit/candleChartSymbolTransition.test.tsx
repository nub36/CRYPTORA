/**
 * CandleChart — смена инструмента не оставляет данных и шкалы прошлого символа.
 *
 * Прод-наблюдение (RUNE): заголовок показывал RUNE/USDT, а шкала цены и свечи
 * оставались от BTC (диапазон ~60k–110k). Причина — persistent-график сбрасывал
 * данные, но НЕ возвращал шкалу цены в авто-масштаб и не сбрасывал состояние
 * наполнения для нового символа.
 *
 * Здесь проверяется контракт перехода:
 *   1. данные прошлого инструмента снимаются немедленно (`setData([])`);
 *   2. линии и маркеры прошлого инструмента удаляются;
 *   3. шкала цены явно возвращается в `autoScale: true` (и у серий, и у правой
 *      шкалы графика) — иначе следующий инструмент рисуется в чужом диапазоне;
 *   4. новый инструмент получает единое читаемое стартовое окно;
 *   5. обычное обновление не сбрасывает пользовательский zoom/pan;
 *   6. график НЕ пересоздаётся (серии переиспользуются);
 *   7. после перехода на графике нет ни одной цены BTC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { OHLCV } from '@/types/market';
import { CandleChart } from '@/components/common/CandleChart';

interface SeriesStub {
  options: unknown;
  dataCalls: unknown[][];
  markerCalls: unknown[][];
  priceScaleOptions: unknown[];
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
  setMarkers: ReturnType<typeof vi.fn>;
  priceScale: ReturnType<typeof vi.fn>;
}

interface ChartStub {
  options: unknown;
  series: SeriesStub[];
  rightScaleOptions: unknown[];
  fitContent: ReturnType<typeof vi.fn>;
  timeScaleOptions: unknown[];
  visibleRanges: Array<{ from: number; to: number }>;
}

const capture = vi.hoisted(() => ({ charts: [] as unknown[] }));

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightweight-charts')>();
  const makeSeries = (options: unknown): SeriesStub => {
    const dataCalls: unknown[][] = [];
    const markerCalls: unknown[][] = [];
    const priceScaleOptions: unknown[] = [];
    const series: SeriesStub = {
      options,
      dataCalls,
      markerCalls,
      priceScaleOptions,
      setData: vi.fn((d: unknown) => {
        dataCalls.push([d]);
      }),
      update: vi.fn(),
      applyOptions: vi.fn(),
      createPriceLine: vi.fn(() => ({ id: 'price-line' })),
      removePriceLine: vi.fn(),
      setMarkers: vi.fn((m: unknown) => {
        markerCalls.push([m]);
      }),
      priceScale: vi.fn(() => ({
        applyOptions: vi.fn((o: unknown) => {
          priceScaleOptions.push(o);
        }),
      })),
    };
    return series;
  };

  return {
    ...actual,
    createChart: vi.fn(() => {
      const chart: ChartStub = {
        options: {},
        series: [],
        rightScaleOptions: [],
        fitContent: vi.fn(),
        timeScaleOptions: [],
        visibleRanges: [],
      };
      const timeScale = {
        fitContent: chart.fitContent,
        applyOptions: vi.fn((o: unknown) => {
          chart.timeScaleOptions.push(o);
        }),
        getVisibleLogicalRange: vi.fn(() => chart.visibleRanges.at(-1) ?? null),
        setVisibleLogicalRange: vi.fn((range: { from: number; to: number }) => {
          chart.visibleRanges.push(range);
        }),
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
      };
      Object.assign(chart, {
        applyOptions: vi.fn(),
        remove: vi.fn(),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        timeScale: () => timeScale,
        priceScale: () => ({
          applyOptions: vi.fn((o: unknown) => {
            chart.rightScaleOptions.push(o);
          }),
        }),
      });
      for (const kind of ['addCandlestickSeries', 'addBarSeries', 'addLineSeries', 'addHistogramSeries'] as const) {
        Object.assign(chart, {
          [kind]: vi.fn((seriesOptions: unknown) => {
            const series = makeSeries(seriesOptions);
            chart.series.push(series);
            return series;
          }),
        });
      }
      capture.charts.push(chart);
      return chart;
    }),
  };
});

function btcCandles(): OHLCV[] {
  return [
    { time: 1_780_000_000, open: 65_000, high: 66_000, low: 64_000, close: 65_500, volume: 12 },
    { time: 1_780_003_600, open: 65_500, high: 66_400, low: 65_100, close: 66_100, volume: 15 },
  ];
}

function runeCandles(): OHLCV[] {
  return [
    { time: 1_790_000_000, open: 0.63, high: 0.65, low: 0.62, close: 0.64, volume: 900 },
    { time: 1_790_003_600, open: 0.64, high: 0.66, low: 0.63, close: 0.655, volume: 950 },
  ];
}

/** Все цены, реально попавшие в серии цены (candlestick / bar / line). */
function pricesSeenInSeries(chart: ChartStub): number[] {
  const prices: number[] = [];
  for (const series of chart.series) {
    for (const [payload] of series.dataCalls) {
      if (!Array.isArray(payload)) continue;
      for (const row of payload as Array<Record<string, number>>) {
        for (const key of ['close', 'open', 'high', 'low', 'value']) {
          if (typeof row?.[key] === 'number') prices.push(row[key]);
        }
      }
    }
  }
  return prices;
}

beforeEach(() => {
  capture.charts = [];
  localStorage.clear();
});
afterEach(() => cleanup());

function lastChart(): ChartStub {
  return capture.charts[capture.charts.length - 1] as unknown as ChartStub;
}

function candleSeries(chart: ChartStub): SeriesStub {
  return chart.series[0];
}

describe('CandleChart: переход BTC → RUNE', () => {
  it('снимает данные BTC немедленно и возвращает шкалу цены в авто-масштаб', () => {
    const { rerender } = render(<CandleChart data={btcCandles()} symbol="BTC/USDT" timeframe="1h" />);
    const chart = lastChart();
    const series = candleSeries(chart);
    expect(chart.series.length).toBeGreaterThan(0);

    series.dataCalls.length = 0;
    series.priceScaleOptions.length = 0;
    chart.rightScaleOptions.length = 0;
    chart.fitContent.mockClear();

    // Переход со ПУСТЫМИ данными нового символа: на экране не должно остаться
    // ни свечей BTC, ни его шкалы.
    rerender(<CandleChart data={[]} symbol="RUNE/USDT" timeframe="1h" />);

    // 1. Данные прошлого инструмента сняты по ВСЕМ сериям цены.
    const priceSeries = chart.series.slice(0, 3); // candles / bars / line
    for (const s of priceSeries) {
      const last = s.dataCalls.at(-1)?.[0];
      expect(last).toEqual([]);
    }

    // 2. Шкала цены — явный авто-масштаб (у серий и у правой шкалы графика).
    expect(series.priceScaleOptions).toContainEqual({ autoScale: true });
    expect(chart.rightScaleOptions).toContainEqual({ autoScale: true });

    // 3. Маркеры прошлого инструмента сняты.
    expect(series.markerCalls.at(-1)?.[0]).toEqual([]);

    // 4. График не пересоздан — серии переиспользованы.
    expect(capture.charts.length).toBe(1);
  });

  it('на данных RUNE показывает только цены RUNE, подгоняя время и цену', () => {
    const { rerender } = render(<CandleChart data={btcCandles()} symbol="BTC/USDT" timeframe="1h" />);
    const chart = lastChart();
    const series = candleSeries(chart);

    rerender(<CandleChart data={[]} symbol="RUNE/USDT" timeframe="1h" />);
    chart.fitContent.mockClear();
    chart.visibleRanges.length = 0;
    // Смотрим только на то, что применено ПОСЛЕ перехода: история вызовов
    // первого рендера (BTC) не должна попадать в проверку «нет цен BTC».
    for (const s of chart.series) s.dataCalls.length = 0;

    rerender(<CandleChart data={runeCandles()} symbol="RUNE/USDT" timeframe="1h" />);

    // Новый инструмент получает единый стартовый диапазон один раз; все две
    // доступные свечи видимы и справа остаётся общий offset 6.
    expect(chart.visibleRanges).toContainEqual({ from: 0, to: 7 });
    expect(chart.fitContent).not.toHaveBeenCalled();

    // Последние данные серии — RUNE (0.63–0.66), ни одной цены BTC.
    const lastPayload = series.dataCalls.at(-1)?.[0] as Array<{ close: number }>;
    expect(lastPayload.map((c) => c.close)).toEqual([0.64, 0.655]);

    const prices = pricesSeenInSeries(chart);
    expect(prices.some((p) => p >= 60_000)).toBe(false);
  });

  it('ставит читаемое стартовое окно и не сбрасывает пользовательский zoom при обновлении', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      time: 1_780_000_000 + i * 3600,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 10 + i,
    }));
    const { rerender } = render(<CandleChart data={many} symbol="BTC/USDT" timeframe="1h" />);
    const chart = lastChart();
    expect(chart.visibleRanges.at(-1)).toEqual({ from: 28, to: 105 });

    // Simulate a user zoom/pan away from the default, then append one REST bar.
    chart.visibleRanges.push({ from: 70, to: 90 });
    rerender(
      <CandleChart
        data={[...many, { time: 1_780_360_000, open: 200, high: 202, low: 199, close: 201, volume: 20 }]}
        symbol="BTC/USDT"
        timeframe="1h"
      />
    );
    expect(chart.visibleRanges.at(-1)).toEqual({ from: 70, to: 90 });
    expect(chart.visibleRanges.at(-1)).not.toEqual({ from: 29, to: 106 });
  });

  it('переключение внутри одного символа не сбрасывает шкалу и не теряет данные', () => {
    const { rerender } = render(<CandleChart data={btcCandles()} symbol="BTC/USDT" timeframe="1h" />);
    const chart = lastChart();
    const series = candleSeries(chart);
    series.dataCalls.length = 0;

    const more = [...btcCandles(), { time: 1_780_007_200, open: 66_100, high: 67_000, low: 65_900, close: 66_800, volume: 20 }];
    rerender(<CandleChart data={more} symbol="BTC/USDT" timeframe="1h" />);

    // Данные не очищались: сразу пришёл новый массив свечей того же инструмента.
    expect(series.dataCalls).toHaveLength(1);
    expect((series.dataCalls[0]![0] as unknown[]).length).toBe(3);
  });

  it('после BTC → RUNE → SOL остаются только цены SOL', () => {
    const { rerender } = render(<CandleChart data={btcCandles()} symbol="BTC/USDT" timeframe="1h" />);
    const chart = lastChart();
    const series = candleSeries(chart);

    rerender(<CandleChart data={[]} symbol="RUNE/USDT" timeframe="1h" />);
    rerender(<CandleChart data={runeCandles()} symbol="RUNE/USDT" timeframe="1h" />);
    rerender(<CandleChart data={[]} symbol="SOL/USDT" timeframe="1h" />);
    rerender(
      <CandleChart
        data={[{ time: 1_790_500_000, open: 140, high: 145, low: 138, close: 143, volume: 500 }]}
        symbol="SOL/USDT"
        timeframe="1h"
      />
    );

    const lastPayload = series.dataCalls.at(-1)?.[0] as Array<{ close: number }>;
    expect(lastPayload.map((c) => c.close)).toEqual([143]);
  });

  it('пустые данные не оставляют включённым масштаб из прошлого символа', () => {
    const { rerender } = render(<CandleChart data={btcCandles()} symbol="BTC/USDT" timeframe="1h" />);
    const chart = lastChart();
    const series = candleSeries(chart);
    series.priceScaleOptions.length = 0;

    // Данные BTC обнулились без смены символа (источник вернул пусто).
    rerender(<CandleChart data={[]} symbol="BTC/USDT" timeframe="1h" />);
    expect(series.priceScaleOptions).toContainEqual({ autoScale: true });
  });
});
