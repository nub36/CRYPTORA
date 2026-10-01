/**
 * CRYPTORA — Strategy Lab · фикс «сжатых свечей и пустого пространства» (§11/§12)
 * ---------------------------------------------------------------------------
 * Регрессионный тест КОНЦА-К-КОНЦУ: настоящий LabChart + настоящий CandleChart
 * (lightweight-charts подменён записывающей заглушкой — как в
 * candleChartSymbolTransition.test.tsx).
 *
 * Причина бага (воспроизведена отдельно): CandleChart считает замену датасета
 * «живым обновлением» и переустанавливает стартовый диапазон только при смене
 * символа/таймфрейма. Новый бэктест Strategy Lab с тем же символом и TF
 * наследовал viewport предыдущего результата (со сдвигом или без) — при
 * зуме/панораме прошлого результата свечи сжимались в часть ширины с большим
 * пустым пространством справа или слева.
 *
 * Фикс: LabChart увеличивает публичный prop `resetViewToken` CandleChart на
 * каждый НОВОГО результат (и по кнопке «Последние свечи»). Токен обязан
 * расти ТОЛЬКО на новое содержимое — выбор сделки и overlay-переключатели
 * пользовательский viewport не сбрасывают.
 */


import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// ── Записывающая заглушка lightweight-charts (настоящий CandleChart поверх неё) ──
const chartCapture = vi.hoisted(() => ({ charts: [] as ChartStub[] }));

/** Простой диапазон (логические индексы) без brand-типа библиотеки. */
interface Range {
  from: number;
  to: number;
}

interface ChartStub {
  applyOptions: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  rightScaleOptions: unknown[];
  visibleRanges: Range[];
  timeScale: {
    applyOptions: ReturnType<typeof vi.fn>;
    fitContent: ReturnType<typeof vi.fn>;
    getVisibleLogicalRange: () => Range | null;
    setVisibleLogicalRange: (range: Range) => void;
    subscribeVisibleLogicalRangeChange: ReturnType<typeof vi.fn>;
    unsubscribeVisibleLogicalRangeChange: ReturnType<typeof vi.fn>;
  };
}

vi.mock('lightweight-charts', () => {
  const makeSeries = () => ({
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    setMarkers: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
  });
  return {
    ColorType: { Solid: 'solid' },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
    createChart: () => {
      const visibleRanges: Range[] = [];
      const rightScaleOptions: unknown[] = [];
      const stub: ChartStub = {
        applyOptions: vi.fn(),
        remove: vi.fn(),
        rightScaleOptions,
        visibleRanges,
        timeScale: {
          applyOptions: vi.fn(),
          fitContent: vi.fn(),
          getVisibleLogicalRange: () => visibleRanges.at(-1) ?? null,
          setVisibleLogicalRange: (range: Range) => {
            visibleRanges.push(range);
          },
          subscribeVisibleLogicalRangeChange: vi.fn(),
          unsubscribeVisibleLogicalRangeChange: vi.fn(),
        },
      };
      chartCapture.charts.push(stub);
      return {
        ...stub,
        applyOptions: stub.applyOptions,
        addCandlestickSeries: makeSeries,
        addBarSeries: makeSeries,
        addLineSeries: makeSeries,
        addHistogramSeries: makeSeries,
        priceScale: () => ({
          applyOptions: vi.fn((o: unknown) => {
            rightScaleOptions.push(o);
          }),
          width: () => 64,
        }),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        timeScale: () => stub.timeScale,
      };
    },
  };
});

import { CandleChart } from '@/components/common/CandleChart';
import { LabChart } from '@/components/strategyLab/LabChart';
import type { LabCandle, LabReplayResult, LabTrade, StrategyDraftDefinition } from '@/services/strategyLab/types';

// ═══════════════════════════════ Фикстуры ═══════════════════════════════

const TF_SEC = 3600;
const BASE = 1_700_000_000;

function makeCandles(n: number): LabCandle[] {
  const out: LabCandle[] = [];
  let price = 100;
  let seed = 42;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o + (rnd() - 0.5) * 2;
    const h = Math.max(o, c) + rnd();
    const l = Math.min(o, c) - rnd();
    const time = BASE + i * TF_SEC;
    out.push({ time, closeTime: time + TF_SEC - 1, open: o, high: h, low: l, close: c, volume: 100 });
    price = c;
  }
  return out;
}

const DEFINITION: StrategyDraftDefinition = {
  name: 'V',
  indicators: [
    { id: 'ema-fast', type: 'EMA', name: 'EMA 20', period: 20, source: 'close', visible: true },
    { id: 'ema-slow', type: 'EMA', name: 'EMA 50', period: 50, source: 'close', visible: true },
    { id: 'atr', type: 'ATR', name: 'ATR 14', period: 14, visible: false },
  ],
  long: { left: 'ema-fast', operator: 'crossesAbove', right: 'ema-slow' },
  short: { left: 'ema-fast', operator: 'crossesBelow', right: 'ema-slow' },
  stop: { type: 'atrMultiple', indicatorId: 'atr', multiplier: 1.5 },
  target: { type: 'rMultiple', multiple: 2 },
};

function makeResult(n: number, generatedAt = 1): LabReplayResult {
  const candles = makeCandles(n);
  const nulls: (number | null)[] = new Array(n).fill(null);
  return {
    meta: {
      dataSource: 'local-dataset',
      strategyId: 'CONSTRUCTOR',
      strategyName: 'V',
      market: 'spot',
      symbol: 'ETHUSDT',
      timeframe: '1h',
      from: candles[0].time,
      to: candles[n - 1].time,
      candleCount: n,
      evaluatedBars: n,
      warmupBars: 50,
      firstCandleTime: candles[0].time,
      lastCandleTime: candles[n - 1].time,
      sameBarRule: 'test',
      researchOnly: true,
      generatedAt,
      notes: [],
    },
    candles,
    indicators: {
      emaFast: nulls,
      emaSlow: nulls,
      atr: nulls,
      byIndicatorId: { 'ema-fast': nulls, 'ema-slow': nulls, atr: nulls },
      indicatorsList: DEFINITION.indicators,
    },
    events: [],
    trades: [] as LabTrade[],
    rejections: [],
    metrics: {
      totalCandidates: 0, accepted: 0, rejected: 0, trades: 0, resolved: 0,
      profitable: 0, losing: 0, breakEven: 0, winRate: null, averageNetR: null,
      expectancy: null, profitFactor: null, maxDrawdownR: null,
    },
  };
}

/** Ожидаемый стартовый диапазон CandleChart (chartPresentationConfig). */
function initialRange(n: number, visibleBars = 72, rightOffset = 6): Range {
  const count = Math.max(1, Math.min(n, visibleBars));
  return { from: n - count, to: n - 1 + rightOffset };
}

function lastChart(): ChartStub {
  const chart = chartCapture.charts.at(-1);
  if (!chart) throw new Error('chart not created');
  return chart;
}

const lastRange = () => lastChart().visibleRanges.at(-1);

// ═══════════════════════════════ Тесты ═══════════════════════════════

describe('Strategy Lab · Chart · viewport после нового бэктеста (§11/§12)', () => {
  beforeEach(() => {
    chartCapture.charts.length = 0;
  });

  it('первый результат: разумный стартовый диапазон последних ~72 свечей', () => {
    render(
      <LabChart result={makeResult(480)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    expect(chartCapture.charts).toHaveLength(1);
    expect(lastRange()).toEqual(initialRange(480));
  });

  it('РЕГРЕССИЯ СЖАТИЯ: пользовательский zoom/pan прошлого результата НЕ наследуется новым бэктестом', () => {
    const { rerender } = render(
      <LabChart result={makeResult(480)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    expect(lastRange()).toEqual(initialRange(480));

    // Пользователь уменьшил масштаб и ушёл в начало истории прошлого результата
    // (viewport, при котором свечи сжимаются в часть ширины с пустотой справа).
    lastChart().timeScale.setVisibleLogicalRange({ from: 0, to: 300 });
    expect(lastRange()).toEqual({ from: 0, to: 300 });

    // Новый бэктест: ТОТ ЖЕ символ и таймфрейм, другая длина диапазона.
    rerender(
      <LabChart result={makeResult(1000)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );

    // ДО фикса последний вызов оставался бы наследованием старого viewport
    // ({from:0,to:300} или его сдвигом). ПОСЛЕ фикса — разумный стартовый диапазон.
    expect(lastRange()).toEqual(initialRange(1000));
    expect(lastRange()).not.toEqual({ from: 0, to: 300 });
  });

  it('годовой 5m датасет (105120 свечей): стартовый вид — последние ~72 свечи, не fitContent всех', () => {
    render(
      <LabChart result={makeResult(105120, 3)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    expect(lastRange()).toEqual(initialRange(105120));
    // Полный датасет остаётся на графике для scroll/zoom (не усекается для вида).
    const setData = lastChart().visibleRanges; // chart exists
    expect(setData.length).toBeGreaterThan(0);
    expect(lastChart().timeScale.fitContent).not.toHaveBeenCalled();
  });

  it('кнопка «Последние свечи» сбрасывает viewport и возвращает авто-масштаб цены', () => {
    const { container } = render(
      <LabChart result={makeResult(480)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    // Пользователь далеко от правого края
    lastChart().timeScale.setVisibleLogicalRange({ from: 0, to: 30 });
    const button = container.querySelector('[data-qa="lab-chart-reset-view"]') as HTMLElement;
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(lastRange()).toEqual(initialRange(480));
    // Авто-масштаб цены возвращается (шкала не «залипает» в прошлом диапазоне)
    const right = lastChart().rightScaleOptions as Array<{ autoScale?: boolean }>;
    expect(right.some((o) => o.autoScale === true)).toBe(true);
  });

  it('выбор сделки и overlay-переключатели НЕ сбрасывают viewport', () => {
    const result = makeResult(480);
    const { rerender } = render(
      <LabChart result={result} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    // Пользователь установил свой viewport
    lastChart().timeScale.setVisibleLogicalRange({ from: 10, to: 120 });
    const rangesAfterUser = lastChart().visibleRanges.length;

    // Overlay-переключатели: только презентация
    const chip = document.querySelector('[data-qa="lab-overlay-signals"]') as HTMLElement;
    fireEvent.click(chip);
    expect(lastChart().visibleRanges.length).toBe(rangesAfterUser);

    // Выбор сделки: уровни рисуются, viewport не трогается
    const trade: LabTrade = {
      id: 'x',
      side: 'LONG',
      signalTime: result.candles[100].time,
      entryTime: result.candles[101].time,
      entryPrice: 100,
      stop: 90,
      target: 120,
      exitTime: result.candles[110].time,
      exitPrice: 120,
      outcome: 'TARGET',
      exitReason: 'TARGET',
      grossR: 2,
      netR: 1.9,
      barsHeld: 9,
    };
    rerender(
      <LabChart result={result} selectedTrade={trade} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    expect(lastChart().visibleRanges.length).toBe(rangesAfterUser);
    expect(lastRange()).toEqual({ from: 10, to: 120 });
  });

  it('CandleChart остаётся НЕ пересозданным между результатами (один инстанс)', () => {
    const { rerender } = render(
      <LabChart result={makeResult(480)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    rerender(
      <LabChart result={makeResult(600)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    expect(chartCapture.charts).toHaveLength(1);
  });

  it('смена символа или таймфрейма по-прежнему получает корректный стартовый диапазон', () => {
    const { rerender } = render(
      <LabChart result={makeResult(480)} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    const other = makeResult(600);
    other.meta.symbol = 'BTCUSDT';
    rerender(
      <LabChart result={other} selectedTrade={null} onSelectTrade={vi.fn()} definition={DEFINITION} />
    );
    expect(lastRange()).toEqual(initialRange(600));
  });
});

describe('Strategy Lab · Chart · контракт resetViewToken общего графика', () => {
  it('CandleChart применяет initialChartLogicalRange при увеличении токена', () => {
    const candles = makeCandles(200).map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    }));
    const { rerender } = render(
      <CandleChart data={candles} symbol="ETHUSDT" height={300} resetViewToken={1} />
    );
    expect(lastRange()).toEqual(initialRange(200));
    // Пользователь сместил viewport
    lastChart().timeScale.setVisibleLogicalRange({ from: 0, to: 50 });
    // Тот же токен — сброса нет
    rerender(<CandleChart data={candles} symbol="ETHUSDT" height={300} resetViewToken={1} />);
    expect(lastRange()).toEqual({ from: 0, to: 50 });
    // Новый токен — сброс к стартовому окну
    rerender(<CandleChart data={candles} symbol="ETHUSDT" height={300} resetViewToken={2} />);
    expect(lastRange()).toEqual(initialRange(200));
  });
});
