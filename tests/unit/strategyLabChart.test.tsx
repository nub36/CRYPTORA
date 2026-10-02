/**
 * CRYPTORA — Strategy Lab · Chart Strategy Visualization tests (§18)
 * ---------------------------------------------------------------------------
 * Покрывают ТОЛЬКО Lab-контур (src/components/strategyLab, src/services/strategyLab):
 * проекцию событий в маркеры, уровни выбранной сделки, инспектор, overlay-переключатели,
 * выбор сделки из таблицы и по маркеру, пустой результат, источник данных,
 * PEPE-точность и no-look-ahead таймстемпы. CandleChart подменён заглушкой —
 * его собственный контракт покрыт отдельными candleChart*-тестами (в т.ч.
 * strategyLabChartViewport.test.tsx для фикса сжатия графика).
 *
 * A. LONG marker → correct trade/time        B. SHORT marker → correct trade/time
 * C. Entry uses actual fill timestamp/price  D. TP marker at actual TP hit
 * E. SL marker at actual stop hit            F. Selected trade levels exact
 * G. Selecting another trade replaces levels H. visible=false: not rendered, engine same
 * I. Overlay toggles don't recalculate       J. Trade table row selects trade
 * K. Marker selects trade                    L. Empty backtest UX
 * M. API error ≠ successful zero result      N. PEPE-like precision
 * O. No-look-ahead timestamps                P. Large backtest → bounded markers/lines
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── CandleChart mock с захватом props (контракт LabChart, а не общий график) ──
const capture = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
  all: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/components/common/CandleChart', () => ({
  CandleChart: (props: Record<string, unknown>) => {
    capture.last = props;
    capture.all.push(props);
    return <div data-testid="mock-candle-chart" />;
  },
}));

// ── Auth mock (страница — admin) ──
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@cryptora.test', role: 'admin' },
    isAdmin: true,
    isLoading: false,
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── labClient mock для страничного теста API-ошибки ──
const labClientMock = vi.hoisted(() => ({
  runLabBacktest: vi.fn(),
  fetchLabDataCoverage: vi.fn(),
}));
vi.mock('@/services/strategyLab/labClient', () => {
  class LabApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.name = 'LabApiError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    LabApiError,
    runLabBacktest: labClientMock.runLabBacktest,
    fetchLabDataCoverage: labClientMock.fetchLabDataCoverage,
  };
});

import { LabChart } from '@/components/strategyLab/LabChart';
import { LabTester } from '@/components/strategyLab/LabTester';
import { LabTradeInspector } from '@/components/strategyLab/LabTradeInspector';
import { StrategyLabPage } from '@/pages/StrategyLabPage';
import {
  LAB_MARKERS_MAX,
  mapLabEventMarkers,
  mapTradeLevels,
  type LabMarkerOverlays,
} from '@/services/strategyLab/labChartProjection';
import { evaluateDraftStrategy } from '@/services/strategyLab/strategies/draftStrategy';
import { defaultDraftDefinition } from '@/services/strategyLab/registry';
import { getLabSignalDiagnostics } from '@/components/strategyLab/labSignalDiagnostics';
import type {
  LabCandle,
  LabEvent,
  LabReplayResult,
  LabTrade,
  StrategyDraftDefinition,
} from '@/services/strategyLab/types';
import type { ChartMarker } from '@/types/chart';
import { LabApiError } from '@/services/strategyLab/labClient';

// ═══════════════════════════════ Хелперы ═══════════════════════════════

const TF_SEC = 3600;
const BASE = 1_700_000_000;
const t = (i: number) => BASE + i * TF_SEC;
const closeTime = (i: number) => t(i) + TF_SEC - 1;

function candle(i: number, o: number, h: number, l: number, c: number): LabCandle {
  return { time: t(i), closeTime: closeTime(i), open: o, high: h, low: l, close: c, volume: 1000 };
}

function flatCandles(closes: number[], spread = 0.5): LabCandle[] {
  return closes.map((c, i) => candle(i, c, c + spread, c - spread, c));
}

/** Стохастический (детерминированный) ряд закрытий с трендами и сменами направления. */
function waveCloses(count: number): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += Math.sin(i / 5) * 3 + Math.cos(i / 10) * 1.5;
    closes.push(price);
  }
  return closes;
}

function getByDataQa(qa: string): HTMLElement {
  const el = document.querySelector(`[data-qa="${qa}"]`);
  if (!el) throw new Error(`[data-qa="${qa}"] not found`);
  return el as HTMLElement;
}
function queryByDataQa(qa: string): HTMLElement | null {
  return document.querySelector(`[data-qa="${qa}"]`) as HTMLElement | null;
}
function getAllByDataQa(qa: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(`[data-qa="${qa}"]`));
}
function findMarker(markers: ChartMarker[], kind: string, tradeId: string) {
  return markers.find((m) => m.payload?.kind === kind && m.payload?.tradeId === tradeId);
}

// ═══════════════════════════════ Фикстуры ═══════════════════════════════

/** Синтетические сделки с ПОЛНЫМ контролем таймстемпов/цен. */
const tradeLong: LabTrade = {
  id: 'trade-long',
  side: 'LONG',
  signalTime: t(10),
  entryTime: t(11),
  entryPrice: 100.5,
  stop: 90,
  target: 121,
  exitTime: t(15),
  exitPrice: 121,
  outcome: 'TARGET',
  exitReason: 'TARGET',
  grossR: 2.05,
  netR: 1.95,
  barsHeld: 4,
};
const tradeShort: LabTrade = {
  id: 'trade-short',
  side: 'SHORT',
  signalTime: t(30),
  entryTime: t(31),
  entryPrice: 200.25,
  stop: 210,
  target: 180.5,
  exitTime: t(35),
  exitPrice: 210,
  outcome: 'STOP',
  exitReason: 'STOP',
  grossR: -0.97,
  netR: -1.02,
  barsHeld: 4,
};
const tradeEod: LabTrade = {
  id: 'trade-eod',
  side: 'LONG',
  signalTime: t(50),
  entryTime: t(51),
  entryPrice: 150,
  stop: 140,
  target: 170,
  exitTime: t(60),
  exitPrice: 155,
  outcome: 'EXIT',
  exitReason: 'END_OF_DATA',
  grossR: 0.5,
  netR: 0.45,
  barsHeld: 9,
};

/** События движка для синтетических сделок (в порядке испускания движком). */
function synthEvents(): LabEvent[] {
  return [
    { id: 'ev-cand-long', kind: 'CANDIDATE', candleTime: t(10), knownAt: closeTime(10), side: 'LONG', price: 100, payload: { tradeId: 'trade-long', atr: 7 } },
    { id: 'ev-entry-long', kind: 'ENTRY', candleTime: t(11), knownAt: t(11), side: 'LONG', price: 100, payload: { tradeId: 'trade-long' } },
    { id: 'ev-fill-long', kind: 'FILL', candleTime: t(11), knownAt: t(11), side: 'LONG', price: 100.5, payload: { tradeId: 'trade-long' } },
    { id: 'ev-tp-long', kind: 'TP1', candleTime: t(15), knownAt: closeTime(15), side: 'LONG', price: 121, payload: { tradeId: 'trade-long' } },
    { id: 'ev-exit-long', kind: 'EXIT', candleTime: t(15), knownAt: closeTime(15), side: 'LONG', price: 121, reason: 'TARGET', payload: { tradeId: 'trade-long' } },

    { id: 'ev-cand-short', kind: 'CANDIDATE', candleTime: t(30), knownAt: closeTime(30), side: 'SHORT', price: 200, payload: { tradeId: 'trade-short', atr: 6.5 } },
    { id: 'ev-entry-short', kind: 'ENTRY', candleTime: t(31), knownAt: t(31), side: 'SHORT', price: 200, payload: { tradeId: 'trade-short' } },
    { id: 'ev-fill-short', kind: 'FILL', candleTime: t(31), knownAt: t(31), side: 'SHORT', price: 200.25, payload: { tradeId: 'trade-short' } },
    { id: 'ev-stop-short', kind: 'STOP', candleTime: t(35), knownAt: closeTime(35), side: 'SHORT', price: 210, reason: 'STOP', payload: { tradeId: 'trade-short' } },
    { id: 'ev-exit-short', kind: 'EXIT', candleTime: t(35), knownAt: closeTime(35), side: 'SHORT', price: 210, reason: 'STOP', payload: { tradeId: 'trade-short' } },

    { id: 'ev-cand-eod', kind: 'CANDIDATE', candleTime: t(50), knownAt: closeTime(50), side: 'LONG', price: 149, payload: { tradeId: 'trade-eod', atr: 6 } },
    { id: 'ev-fill-eod', kind: 'FILL', candleTime: t(51), knownAt: t(51), side: 'LONG', price: 150, payload: { tradeId: 'trade-eod' } },
    { id: 'ev-exit-eod', kind: 'EXIT', candleTime: t(60), knownAt: closeTime(60), side: 'LONG', price: 155, reason: 'END_OF_DATA', payload: { tradeId: 'trade-eod' } },
  ];
}

const CANDLES: LabCandle[] = flatCandles(
  Array.from({ length: 61 }, (_, i) => 100 + Math.sin(i / 7) * 20),
  1.5
);

const TEST_DEFINITION: StrategyDraftDefinition = {
  name: 'Test EMA Cross',
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

/** Полный LabReplayResult с синтетическими сделками (контроль значений). */
function makeResult(overrides: Partial<LabReplayResult> = {}): LabReplayResult {
  const { orderBlocks = [], marketStructureEvents = [], ...rest } = overrides;
  const n = CANDLES.length;
  const emaFast: (number | null)[] = new Array(n).fill(null);
  const emaSlow: (number | null)[] = new Array(n).fill(null);
  const atr: (number | null)[] = new Array(n).fill(null);
  // Значения на барах сигналов: LONG — пересечение вверх, SHORT — вниз.
  emaFast[9] = 99.5; emaSlow[9] = 100;
  emaFast[10] = 100.5; emaSlow[10] = 100;
  emaFast[29] = 200.5; emaSlow[29] = 200;
  emaFast[30] = 199.5; emaSlow[30] = 200;
  emaFast[49] = 149.5; emaSlow[49] = 150;
  emaFast[50] = 150.5; emaSlow[50] = 150;
  atr[10] = 7; atr[30] = 6.5; atr[50] = 6;
  return {
    meta: {
      dataSource: 'local-dataset',
      strategyId: 'CONSTRUCTOR',
      strategyName: 'Test EMA Cross',
      market: 'spot',
      symbol: 'ETHUSDT',
      timeframe: '1h',
      from: CANDLES[0].time,
      to: CANDLES[n - 1].time,
      candleCount: n,
      evaluatedBars: n,
      warmupBars: 50,
      firstCandleTime: CANDLES[0].time,
      lastCandleTime: CANDLES[n - 1].time,
      sameBarRule: 'test',
      researchOnly: true,
      generatedAt: 1,
      notes: [],
    },
    candles: CANDLES,
    indicators: {
      emaFast,
      emaSlow,
      atr,
      byIndicatorId: { 'ema-fast': emaFast, 'ema-slow': emaSlow, atr },
      indicatorsList: TEST_DEFINITION.indicators,
    },
    orderBlocks,
    fairValueGaps: [],
    marketStructureEvents,
    events: synthEvents(),
    trades: [tradeLong, tradeShort, tradeEod],
    rejections: [],
    metrics: {
      totalCandidates: 3,
      accepted: 3,
      rejected: 0,
      trades: 3,
      resolved: 3,
      profitable: 2,
      losing: 1,
      breakEven: 0,
      winRate: 2 / 3,
      averageNetR: 0.46,
      expectancy: 0.46,
      profitFactor: 3,
      maxDrawdownR: 1.02,
    },
    ...rest,
  };
}

function renderLabChart(props: Partial<React.ComponentProps<typeof LabChart>> = {}) {
  const result = props.result ?? makeResult();
  const onSelectTrade = props.onSelectTrade ?? vi.fn();
  const utils = render(
    <LabChart
      result={result}
      selectedTrade={props.selectedTrade ?? null}
      onSelectTrade={onSelectTrade}
      definition={props.definition ?? TEST_DEFINITION}
      {...props}
    />
  );
  return { ...utils, result, onSelectTrade };
}

// ═══════════════════ A–E: маркеры событий (§4/§5) ═══════════════════

describe('Strategy Lab · Chart · маркеры событий (§4/§5)', () => {
  it('A. LONG marker: зелёная стрелка вверх на баре СИГНАЛА, связь по tradeId', () => {
    const { markers } = mapLabEventMarkers(synthEvents(), CANDLES);
    const m = findMarker(markers, 'CANDIDATE', 'trade-long');
    expect(m).toBeDefined();
    expect(m!.time).toBe(t(10)); // strategy timestamp бара решения
    expect(m!.shape).toBe('arrowUp');
    expect(m!.position).toBe('belowBar');
    expect(m!.text).toBe('LONG');
    expect(m!.color).toMatch(/16, 185, 129/); // зелёный
  });

  it('B. SHORT marker: красная стрелка вниз на баре сигнала, связь по tradeId', () => {
    const { markers } = mapLabEventMarkers(synthEvents(), CANDLES);
    const m = findMarker(markers, 'CANDIDATE', 'trade-short');
    expect(m).toBeDefined();
    expect(m!.time).toBe(t(30));
    expect(m!.shape).toBe('arrowDown');
    expect(m!.position).toBe('aboveBar');
    expect(m!.text).toBe('SHORT');
    expect(m!.color).toMatch(/244, 63, 94/); // красный
  });

  it('C. Вход: маркер FILL на фактическом баре исполнения и с фактической ценой (≠ бар сигнала)', () => {
    const { markers } = mapLabEventMarkers(synthEvents(), CANDLES);
    const fill = findMarker(markers, 'FILL', 'trade-long');
    expect(fill).toBeDefined();
    expect(fill!.time).toBe(tradeLong.entryTime); // бар входа (i+1), не бар сигнала
    expect(fill!.time).not.toBe(tradeLong.signalTime);
    expect(fill!.payload?.price).toBe(tradeLong.entryPrice); // реальный execution output
    // ENTRY-событие (open без проскальзывания) на график не проецируется
    expect(markers.find((m) => m.id === 'ev-entry-long')).toBeUndefined();
  });

  it('D. TP marker стоит на фактическом баре достижения цели, НЕ на входе', () => {
    const { markers } = mapLabEventMarkers(synthEvents(), CANDLES);
    const tp = findMarker(markers, 'TP1', 'trade-long');
    expect(tp).toBeDefined();
    expect(tp!.time).toBe(tradeLong.exitTime); // бар фактического hit
    expect(tp!.time).not.toBe(tradeLong.entryTime); // не момент входа
  });

  it('E. SL marker стоит на фактическом баре стопа; EXIT не дублирует SL/TP', () => {
    const { markers } = mapLabEventMarkers(synthEvents(), CANDLES);
    const sl = findMarker(markers, 'STOP', 'trade-short');
    expect(sl).toBeDefined();
    expect(sl!.time).toBe(tradeShort.exitTime);
    expect(sl!.text).toBe('SL');
    // У сделки со STOP-исходом не должно быть отдельного маркера «Выход»
    expect(findMarker(markers, 'EXIT', 'trade-short')).toBeUndefined();
  });

  it('E2. END_OF_DATA: маркер «Выход» на последнем баре, без выдуманных типов', () => {
    const { markers } = mapLabEventMarkers(synthEvents(), CANDLES);
    const exit = findMarker(markers, 'EXIT', 'trade-eod');
    expect(exit).toBeDefined();
    expect(exit!.time).toBe(tradeEod.exitTime);
    expect(exit!.payload?.reason).toBe('END_OF_DATA'); // существующая причина движка
  });

  it('маркеры отсортированы по времени (требование lightweight-charts при перекрытии сделок)', () => {
    // События движка идут по сделкам, а не хронологически (сделки перекрываются).
    const events: LabEvent[] = [
      { id: 'c-a', kind: 'CANDIDATE', candleTime: t(10), knownAt: closeTime(10), side: 'LONG', payload: { tradeId: 'a' } },
      { id: 'x-a', kind: 'EXIT', candleTime: t(60), knownAt: closeTime(60), side: 'LONG', reason: 'END_OF_DATA', payload: { tradeId: 'a' } },
      { id: 'c-b', kind: 'CANDIDATE', candleTime: t(30), knownAt: closeTime(30), side: 'SHORT', payload: { tradeId: 'b' } },
    ];
    const { markers } = mapLabEventMarkers(events, CANDLES);
    const times = markers.map((m) => m.time);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('события вне загруженных свечей пропускаются и считаются в skipped', () => {
    const events: LabEvent[] = [
      { id: 'x', kind: 'CANDIDATE', candleTime: t(1000), knownAt: t(1000), side: 'LONG', payload: { tradeId: 'zz' } },
    ];
    const { markers, skipped } = mapLabEventMarkers(events, CANDLES);
    expect(markers).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

// ═══════════════════ F/G: уровни выбранной сделки (§6) ═══════════════════

describe('Strategy Lab · Chart · уровни выбранной сделки (§6)', () => {
  it('F. Entry/SL/TP линии точно соответствуют сделке', () => {
    const lines = mapTradeLevels(tradeLong);
    expect(lines).toHaveLength(3);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(byId[`lvl-entry-${tradeLong.id}`].price).toBe(tradeLong.entryPrice);
    expect(byId[`lvl-stop-${tradeLong.id}`].price).toBe(tradeLong.stop);
    expect(byId[`lvl-target-${tradeLong.id}`].price).toBe(tradeLong.target);
  });

  it('G. Выбор другой сделки даёт ДРУГИЕ id линий (замена, не накопление)', () => {
    const a = mapTradeLevels(tradeLong);
    const b = mapTradeLevels(tradeShort);
    expect(a.map((l) => l.id)).not.toEqual(b.map((l) => l.id));
    expect(b.map((l) => l.id)).toContain(`lvl-entry-${tradeShort.id}`);
    expect(mapTradeLevels(null)).toEqual([]);
  });

  it('G2. Компонент передаёт CandleChart уровни ТОЛЬКО выбранной сделки', () => {
    const { rerender } = renderLabChart({ selectedTrade: tradeLong });
    expect((capture.last?.levelLines as { id: string }[]).map((l) => l.id)).toEqual([
      `lvl-entry-${tradeLong.id}`,
      `lvl-stop-${tradeLong.id}`,
      `lvl-target-${tradeLong.id}`,
    ]);

    rerender(
      <LabChart
        result={makeResult()}
        selectedTrade={tradeShort}
        onSelectTrade={vi.fn()}
        definition={TEST_DEFINITION}
      />
    );
    expect((capture.last?.levelLines as { id: string }[]).map((l) => l.id)).toEqual([
      `lvl-entry-${tradeShort.id}`,
      `lvl-stop-${tradeShort.id}`,
      `lvl-target-${tradeShort.id}`,
    ]);
  });
});

// ═══════════════════ H: visible=false индикатор (§4B) ═══════════════════

describe('Strategy Lab · Chart · visible=false индикатор (§4B)', () => {
  const candles = flatCandles(waveCloses(240), 1.5);

  it('движок: visible не влияет на расчёты — сделки и события идентичны', () => {
    const visible: StrategyDraftDefinition = {
      ...defaultDraftDefinition('V'),
      indicators: [
        { id: 'ema-fast', type: 'EMA', name: 'EMA 20', period: 20, source: 'close', visible: true },
        { id: 'ema-slow', type: 'EMA', name: 'EMA 50', period: 50, source: 'close', visible: true },
        { id: 'atr', type: 'ATR', name: 'ATR 14', period: 14, visible: true },
      ],
    };
    const hidden: StrategyDraftDefinition = {
      ...visible,
      indicators: visible.indicators.map((ind) =>
        ind.id === 'ema-slow' || ind.type === 'ATR' ? { ...ind, visible: false } : ind
      ),
    };
    const a = evaluateDraftStrategy(candles, visible);
    const b = evaluateDraftStrategy(candles, hidden);
    expect(b.trades).toEqual(a.trades);
    expect(b.events).toEqual(a.events);
    expect(b.candidateCount).toBe(a.candidateCount);
  });

  it('график: невидимые EMA не передаются в CandleChart, ATR не рисуется поверх цены', () => {
    const def: StrategyDraftDefinition = {
      ...TEST_DEFINITION,
      indicators: [
        { id: 'ema-fast', type: 'EMA', name: 'EMA 20', period: 20, source: 'close', visible: true },
        { id: 'ema-slow', type: 'EMA', name: 'EMA 50', period: 50, source: 'close', visible: false },
        { id: 'atr', type: 'ATR', name: 'ATR 14', period: 14, visible: false },
      ],
    };
    const evaluation = evaluateDraftStrategy(candles, def);
    expect(evaluation.trades.length).toBeGreaterThan(0);
    const result: LabReplayResult = {
      ...makeResult(),
      candles,
      indicators: evaluation.indicators,
      events: evaluation.events,
      trades: evaluation.trades,
    };
    render(<LabChart result={result} selectedTrade={null} onSelectTrade={vi.fn()} />);
    const indicators = capture.last?.indicators as Record<string, number[] | undefined>;
    expect(indicators.sma20).toBeDefined(); // только ema-fast видима
    expect(indicators.sma50).toBeUndefined(); // ema-slow скрыта, но участвовала в расчёте
    expect(indicators.sma200).toBeUndefined(); // ATR никогда не рисуется поверх цены
  });
});

// ═══════════════════ I: overlay-переключатели (§10) ═══════════════════

describe('Strategy Lab · Chart · overlay-переключатели (§10)', () => {
  it('I. Переключение меняет только отображение: результат не пересчитывается', () => {
    renderLabChart();
    const dataBefore = capture.last?.data as unknown[];
    const markersBefore = capture.last?.markers as ChartMarker[];

    fireEvent.click(getByDataQa('lab-overlay-signals'));
    fireEvent.click(getByDataQa('lab-overlay-entries'));
    fireEvent.click(getByDataQa('lab-overlay-stopTarget'));
    fireEvent.click(getByDataQa('lab-overlay-exits'));

    const dataAfter = capture.last?.data as unknown[];
    expect(capture.last?.markers).toHaveLength(0); // группы скрыты — presentation only
    expect(dataAfter).toBe(dataBefore); // тот же результат бэктеста, без пересчёта
    expect(dataAfter.length).toBe(dataBefore.length);

    // Индикаторы выключаются отдельно, не трогая маркеры
    fireEvent.click(getByDataQa('lab-overlay-indicators'));
    expect(capture.last?.indicators).toBeUndefined();
    expect(capture.last?.showMA).toBe(false);

    // Возврат SL/TP: снова ровно TP1/STOP-маркеры исходной проекции
    fireEvent.click(getByDataQa('lab-overlay-stopTarget'));
    const restored = capture.last?.markers as ChartMarker[];
    const expected = markersBefore.filter(
      (m) => m.payload?.kind === 'TP1' || m.payload?.kind === 'STOP'
    );
    expect(restored.map((m) => m.id).sort()).toEqual(expected.map((m) => m.id).sort());
  });

  it('чистая проекция: overlay-флаги фильтруют группы независимо', () => {
    const all = mapLabEventMarkers(synthEvents(), CANDLES);
    expect(new Set(all.markers.map((m) => m.payload?.kind))).toEqual(
      new Set(['CANDIDATE', 'FILL', 'TP1', 'STOP', 'EXIT'])
    );
    const kinds = (o: Partial<LabMarkerOverlays>) =>
      mapLabEventMarkers(synthEvents(), CANDLES, { overlays: o }).markers.map((m) => m.payload?.kind);
    expect(kinds({ signals: false })).not.toContain('CANDIDATE');
    expect(kinds({ entries: false })).not.toContain('FILL');
    expect(kinds({ stopTarget: false })).not.toContain('TP1');
    expect(kinds({ stopTarget: false })).not.toContain('STOP');
    expect(kinds({ exits: false })).not.toContain('EXIT');
  });
});

// ═══════════════════ J: выбор из таблицы сделок (§8) ═══════════════════

describe('Strategy Lab · Chart · таблица сделок выбирает сделку (§8)', () => {
  it('J. Клик по строке выбирает правильную сделку и выделяет её; повторный снимает', () => {
    const result = makeResult();
    const onSelectTrade = vi.fn();
    const { rerender } = render(
      <LabTester
        result={result}
        tab="trades"
        onTabChange={vi.fn()}
        selectedTradeId={null}
        onSelectTrade={onSelectTrade}
      />
    );
    const row = getAllByDataQa('lab-trade-row').find(
      (r) => r.getAttribute('data-trade-id') === 'trade-long'
    )!;
    fireEvent.click(row);
    expect(onSelectTrade).toHaveBeenCalledWith('trade-long');

    rerender(
      <LabTester
        result={result}
        tab="trades"
        onTabChange={vi.fn()}
        selectedTradeId="trade-long"
        onSelectTrade={onSelectTrade}
      />
    );
    const selectedRow = getAllByDataQa('lab-trade-row').find(
      (r) => r.getAttribute('data-trade-id') === 'trade-long'
    )!;
    expect(selectedRow.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(selectedRow);
    expect(onSelectTrade).toHaveBeenLastCalledWith(null);
  });
});

// ═══════════════════ K: выбор по маркеру графика (§9) ═══════════════════

describe('Strategy Lab · Chart · клик по маркеру выбирает сделку (§9)', () => {
  it('K. onMarkerClick связывает маркер и сделку по стабильному tradeId', () => {
    const onSelectTrade = vi.fn();
    renderLabChart({ onSelectTrade });
    const onMarkerClick = capture.last?.onMarkerClick as (
      marker: ChartMarker,
      markersAtTime: ChartMarker[]
    ) => void;

    const longMarker = findMarker(capture.last?.markers as ChartMarker[], 'CANDIDATE', 'trade-long')!;
    onMarkerClick(longMarker, [longMarker]);
    expect(onSelectTrade).toHaveBeenCalledWith('trade-long');

    const tpMarker = findMarker(capture.last?.markers as ChartMarker[], 'TP1', 'trade-long')!;
    onMarkerClick(tpMarker, [tpMarker]);
    expect(onSelectTrade).toHaveBeenLastCalledWith('trade-long');
  });
});

// ═══════════════════ L: пустой успешный бэктест (§14) ═══════════════════

describe('Strategy Lab · Chart · пустой успешный бэктест (§14)', () => {
  it('L. 0 сделок: свечи и индикаторы показываются + сообщение, это не ошибка', () => {
    // Плоские закрытия → пересечений EMA нет → 0 сделок (честный движок)
    const flat = flatCandles(new Array(120).fill(100));
    const evaluation = evaluateDraftStrategy(flat, defaultDraftDefinition('F'));
    expect(evaluation.trades).toHaveLength(0);
    const result: LabReplayResult = {
      ...makeResult(),
      candles: flat,
      indicators: evaluation.indicators,
      events: evaluation.events,
      trades: evaluation.trades,
      metrics: {
        totalCandidates: 0,
        accepted: 0,
        rejected: 0,
        trades: 0,
        resolved: 0,
        profitable: 0,
        losing: 0,
        breakEven: 0,
        winRate: null,
        averageNetR: null,
        expectancy: null,
        profitFactor: null,
        maxDrawdownR: null,
      },
    };
    renderLabChart({ result });
    expect(screen.getByTestId('mock-candle-chart')).toBeInTheDocument();
    expect((capture.last?.data as unknown[]).length).toBeGreaterThan(0);
    expect(capture.last?.indicators).toBeDefined();
    expect(getByDataQa('lab-chart-zero-trades')).toHaveTextContent(
      'За выбранный период стратегия не сформировала условий входа.'
    );
  });

  it('L2. 0 закрытых свечей: отдельное честное сообщение, не «запустите бэктест»', () => {
    renderLabChart({
      result: makeResult({ candles: [], meta: { ...makeResult().meta, candleCount: 0 } }),
    });
    expect(getByDataQa('lab-chart-empty-candles')).toHaveTextContent(
      'В выбранном диапазоне нет закрытых свечей'
    );
    expect(screen.queryByTestId('mock-candle-chart')).not.toBeInTheDocument();
  });
});

// ═══════════════════ M: API-ошибка ≠ нулевой результат (§14) ═══════════════════

describe('Strategy Lab · Chart · API-ошибка не выдаётся за успешный ноль (§14)', () => {
  beforeEach(() => {
    labClientMock.runLabBacktest.mockReset();
    labClientMock.fetchLabDataCoverage.mockReset();
    labClientMock.fetchLabDataCoverage.mockResolvedValue({ datasetAvailable: false });
  });

  it('M. Ошибка бэктеста: баннер ошибки, результат не подставлен', async () => {
    labClientMock.runLabBacktest.mockRejectedValue(
      new LabApiError(502, 'Binance ответил 502', 'UPSTREAM_ERROR')
    );
    render(
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Запустить бэктест'));
    await vi.waitFor(() => {
      expect(screen.getByText(/Binance ответил 502/)).toBeInTheDocument();
    });
    // Нулевой результат НЕ показывается как успешный: ни метрик, ни сообщения
    // «не сформировала условий», ни источника данных.
    expect(screen.queryByText('Всего кандидатов')).not.toBeInTheDocument();
    expect(screen.queryByText(/не сформировала условий входа/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Источник данных/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Запустите бэктест, чтобы построить график/i)).toBeInTheDocument();
  });

  it('M2. Успешный ответ: результат и источник данных показываются', async () => {
    labClientMock.runLabBacktest.mockResolvedValue(makeResult());
    render(
      <MemoryRouter>
        <StrategyLabPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Запустить бэктест'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('mock-candle-chart')).toBeInTheDocument();
    });
    expect(getByDataQa('lab-data-source').textContent).toContain('Источник данных');
    expect(getByDataQa('lab-data-source').textContent).toContain('Локальный архив');
  });
});

// ═══════════════════ N: PEPE-подобная точность (§18N) ═══════════════════

describe('Strategy Lab · Chart · PEPE-подобная точность (§18N)', () => {
  const pepeTrade: LabTrade = {
    ...tradeLong,
    id: 'trade-pepe',
    entryPrice: 0.00001234,
    stop: 0.00001111,
    target: 0.00001475,
    exitPrice: 0.00001475,
  };

  it('N. Уровни выбранной сделки несут ТОЧНЫЕ цены без округления', () => {
    const lines = mapTradeLevels(pepeTrade);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(byId['lvl-entry-trade-pepe'].price).toBe(0.00001234);
    expect(byId['lvl-stop-trade-pepe'].price).toBe(0.00001111);
    expect(byId['lvl-target-trade-pepe'].price).toBe(0.00001475);
  });

  it('N2. Инспектор показывает точные значения цен', () => {
    render(
      <LabTradeInspector
        result={makeResult()}
        trade={pepeTrade}
        definition={TEST_DEFINITION}
        onClose={vi.fn()}
      />
    );
    const card = getByDataQa('lab-trade-inspector');
    expect(card.textContent).toContain('0.00001234');
    expect(card.textContent).toContain('0.00001111');
    expect(card.textContent).toContain('0.00001475');
  });
});

// ═══════════════════ O: no-look-ahead таймстемпы (§5/§18O) ═══════════════════

describe('Strategy Lab · Chart · no-look-ahead таймстемпы (§5/§18O)', () => {
  it('O. Маркер стоит на candleTime события (openTime), а не на knownAt (closeTime)', () => {
    const events = synthEvents();
    const { markers } = mapLabEventMarkers(events, CANDLES);
    const candEvent = events.find((e) => e.kind === 'CANDIDATE')!;
    const candMarker = markers.find((m) => m.id === 'ev-cand-long')!;
    // knownAt = closeTime > candleTime: сигнал известен только после закрытия бара
    expect(candEvent.knownAt).toBeGreaterThan(candEvent.candleTime);
    expect(candMarker.time).toBe(candEvent.candleTime);
  });

  it('O2. Движок: вход строго после сигнала, маркеры только на реальных барах', () => {
    const candles = flatCandles(waveCloses(240), 1.5);
    const evaluation = evaluateDraftStrategy(candles, defaultDraftDefinition('O'));
    expect(evaluation.trades.length).toBeGreaterThan(0);
    const candleTimes = new Set(candles.map((c) => c.time));
    for (const trade of evaluation.trades) {
      expect(trade.entryTime).toBeGreaterThan(trade.signalTime); // вход на следующем баре
      expect(trade.exitTime).toBeGreaterThanOrEqual(trade.entryTime);
      expect(candleTimes.has(trade.signalTime)).toBe(true);
    }
    const { markers } = mapLabEventMarkers(evaluation.events, candles);
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(candleTimes.has(m.time)).toBe(true); // маркер только на реальном баре
    }
    // Все события движка сохраняют no-look-ahead инвариант
    for (const ev of evaluation.events) {
      expect(ev.knownAt).toBeGreaterThanOrEqual(ev.candleTime);
    }
  });
});

// ═══════════════════ P: большой бэктест (§13/§18P) ═══════════════════

describe('Strategy Lab · Chart · большой бэктест (§13/§18P)', () => {
  it('P. Presentation-лимит маркеров соблюдён, выбранная сделка сохраняется', () => {
    // 400 перекрывающихся сделок по 4 события.
    const bigCandles: LabCandle[] = flatCandles(
      Array.from({ length: 3000 }, (_, i) => 100 + Math.sin(i / 40) * 30),
      1.5
    );
    const bigEvents: LabEvent[] = [];
    for (let i = 0; i < 400; i++) {
      const signalIdx = 60 + i * 5;
      const entryIdx = signalIdx + 1;
      const exitIdx = signalIdx + 2;
      const id = `bulk-${i}`;
      bigEvents.push(
        { id: `c-${id}`, kind: 'CANDIDATE', candleTime: bigCandles[signalIdx].time, knownAt: bigCandles[signalIdx].closeTime, side: 'LONG', payload: { tradeId: id } },
        { id: `f-${id}`, kind: 'FILL', candleTime: bigCandles[entryIdx].time, knownAt: bigCandles[entryIdx].time, side: 'LONG', price: 100, payload: { tradeId: id } },
        { id: `t-${id}`, kind: 'TP1', candleTime: bigCandles[exitIdx].time, knownAt: bigCandles[exitIdx].closeTime, side: 'LONG', price: 120, payload: { tradeId: id } },
        { id: `x-${id}`, kind: 'EXIT', candleTime: bigCandles[exitIdx].time, knownAt: bigCandles[exitIdx].closeTime, side: 'LONG', price: 120, reason: 'TARGET', payload: { tradeId: id } }
      );
    }

    const { markers, skipped } = mapLabEventMarkers(bigEvents, bigCandles, {
      selectedTradeId: 'bulk-399',
    });
    expect(markers.length).toBeLessThanOrEqual(LAB_MARKERS_MAX + 5);
    expect(skipped).toBeGreaterThan(0);
    // Маркеры выбранной сделки пережили лимит
    expect(markers.some((m) => m.payload?.tradeId === 'bulk-399')).toBe(true);
    // Уровни — только для выбранной сделки (никогда не для всех)
    expect(mapTradeLevels(tradeLong)).toHaveLength(3);
    expect(mapTradeLevels(null)).toHaveLength(0);
  });
});

// ═══════════════════ Инспектор сделки (§7) ═══════════════════

describe('Strategy Lab · Chart · инспектор сделки (§7)', () => {
  it('показывает фактические данные сделки и условия на сигнальном баре', () => {
    render(
      <LabTradeInspector
        result={makeResult()}
        trade={tradeLong}
        definition={TEST_DEFINITION}
        onClose={vi.fn()}
      />
    );
    const card = getByDataQa('lab-trade-inspector');
    // Заголовок: сторона/монета/рынок/таймфрейм
    expect(card.textContent).toContain('LONG');
    expect(card.textContent).toContain('ETHUSDT');
    expect(card.textContent).toContain('Спот');
    expect(card.textContent).toContain('1h');
    // Результат
    expect(card.textContent).toContain('+2.05R');
    expect(card.textContent).toContain('+1.95R');
    expect(card.textContent).toContain('Баров в сделке');
    // Условия: значения индикаторов движка на сигнальном баре
    const indicators = getAllByDataQa('lab-inspector-indicator');
    expect(indicators.some((el) => el.textContent?.startsWith('EMA 20:'))).toBe(true);
    expect(indicators.some((el) => el.textContent?.startsWith('EMA 50:'))).toBe(true);
    expect(getByDataQa('lab-inspector-cross').textContent).toContain(
      'EMA 20 пересекла EMA 50 вверх'
    );
  });

  it('закрывается крестиком (сброс выбора)', () => {
    const onClose = vi.fn();
    render(
      <LabTradeInspector
        result={makeResult()}
        trade={tradeLong}
        definition={TEST_DEFINITION}
        onClose={onClose}
      />
    );
    fireEvent.click(getByDataQa('lab-trade-inspector-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('getLabSignalDiagnostics: нет серии → пустая диагностика (не выдумываем)', () => {
    const broken: LabReplayResult = {
      ...makeResult(),
      indicators: { emaFast: [], emaSlow: [], atr: [] }, // нет byIndicatorId
    };
    const d = getLabSignalDiagnostics(broken, tradeLong, TEST_DEFINITION);
    expect(d.ruleRows).toHaveLength(0);
    expect(d.crossText).toBeNull();
  });

  it('инспектор появляется под графиком при выборе сделки в LabChart', () => {
    const { rerender } = renderLabChart();
    expect(queryByDataQa('lab-trade-inspector')).toBeNull();

    rerender(
      <LabChart
        result={makeResult()}
        selectedTrade={tradeShort}
        onSelectTrade={vi.fn()}
        definition={TEST_DEFINITION}
      />
    );
    const card = getByDataQa('lab-trade-inspector');
    expect(card.textContent).toContain('SHORT');
  });
});

// ═══════════════════ Viewport после нового результата (§11/§12) ═══════════════════

describe('Strategy Lab · Chart · viewport и источник данных (§11/§12/§15)', () => {
  it('новый результат увеличивает resetViewToken, выбор сделки — нет', () => {
    const { result, rerender } = renderLabChart();
    const token1 = capture.last?.resetViewToken as number;

    // Выбор сделки (ТОТ ЖЕ результат) не сбрасывает viewport
    rerender(
      <LabChart
        result={result}
        selectedTrade={tradeLong}
        onSelectTrade={vi.fn()}
        definition={TEST_DEFINITION}
      />
    );
    const token2 = capture.last?.resetViewToken as number;
    expect(token2).toBe(token1);

    // НОВОЕ содержимое результата → новый viewport
    const resultB = makeResult();
    resultB.meta.generatedAt = 2;
    rerender(
      <LabChart
        result={resultB}
        selectedTrade={null}
        onSelectTrade={vi.fn()}
        definition={TEST_DEFINITION}
      />
    );
    const token3 = capture.last?.resetViewToken as number;
    expect(token3).toBeGreaterThan(token2);

    // Ручной сброс «Последние свечи» тоже увеличивает токен
    fireEvent.click(getByDataQa('lab-chart-reset-view'));
    const token4 = capture.last?.resetViewToken as number;
    expect(token4).toBeGreaterThan(token3);
  });

  it('подпись источника данных отражает фактический meta.dataSource (§15)', () => {
    const { rerender } = renderLabChart();
    expect(getByDataQa('lab-data-source').textContent).toContain('Локальный архив');

    const rest = makeResult();
    rest.meta.dataSource = 'binance-rest';
    rerender(
      <LabChart result={rest} selectedTrade={null} onSelectTrade={vi.fn()} definition={TEST_DEFINITION} />
    );
    expect(getByDataQa('lab-data-source').textContent).toContain('Binance REST');

    const none = makeResult();
    delete (none.meta as { dataSource?: string }).dataSource;
    rerender(
      <LabChart result={none} selectedTrade={null} onSelectTrade={vi.fn()} definition={TEST_DEFINITION} />
    );
    expect(queryByDataQa('lab-data-source')).toBeNull();
  });

  it('таймфрейм 30m и 1m передаётся в общий график (не схлопывается в дефолт)', () => {
    const r30 = makeResult();
    (r30.meta as { timeframe: string }).timeframe = '30m';
    const { rerender } = renderLabChart({ result: r30 });
    expect(capture.last?.timeframe).toBe('30m');

    const r1 = makeResult();
    (r1.meta as { timeframe: string }).timeframe = '1m';
    rerender(
      <LabChart result={r1} selectedTrade={null} onSelectTrade={vi.fn()} definition={TEST_DEFINITION} />
    );
    expect(capture.last?.timeframe).toBe('1m');
  });
});

// ═══════════════════ Служебное ═══════════════════

beforeEach(() => {
  capture.all = [];
  capture.last = null;
});
