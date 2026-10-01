/**
 * CRYPTORA — Strategy Lab · блок-схема: схема, валидация, компиляция, паритет
 * ---------------------------------------------------------------------------
 * Покрывает изолированный графовый контур BLOCKS-1
 * (`src/services/strategyLab/graph/**`):
 *   • шаблон «EMA Trend» валиден и компилируется в ожидаемый Draft;
 *   • отклоняются неизвестный блок/порт, несовместимые порты, дубликаты ID и
 *     связей, несколько связей в одиночный вход, пропущенные входы, циклы и
 *     превышение лимитов;
 *   • ТОЧНЫЙ паритет «граф → Draft» по сделкам, ценам, R, метрикам и событиям;
 *   • отсутствие look-ahead на графовом пути;
 *   • сохранение точности цен (PEPE-масштаб);
 *   • результат блок-режима работает с существующей проекцией графика (PR #45).
 */

import { describe, it, expect } from 'vitest';
import { runLabReplay } from '@/services/strategyLab/engine';
import { codeToGraph } from '@/services/strategyLab/code/toGraph';
import { EMA_TREND_CODE } from '@/services/strategyLab/code/templates';
import { defaultDraftDefinition, BLOCK_GRAPH_ID } from '@/services/strategyLab/registry';
import { mapLabEventMarkers, mapTradeLevels } from '@/services/strategyLab/labChartProjection';
import {
  createEmaTrendTemplate,
  cloneStrategyGraph,
  EMA_TREND_TEMPLATE_NAME,
  LAB_GRAPH_TEMPLATES,
} from '@/services/strategyLab/graph/templates';
import {
  validateStrategyGraph,
  canConnect,
  listCompatibleInputs,
  hasGraphCycle,
} from '@/services/strategyLab/graph/validate';
import {
  compileGraphToDraftDefinition,
  GraphCompileError,
} from '@/services/strategyLab/graph/compile';
import {
  BLOCK_REGISTRY,
  listBlocksByCategory,
  arePortTypesCompatible,
} from '@/services/strategyLab/graph/registry';
import { GRAPH_LIMITS, type StrategyGraph } from '@/services/strategyLab/graph/types';
import type { LabCandle, LabReplayInput } from '@/services/strategyLab/types';

const TF_SEC = 3600;
const BASE = 1_700_000_000;

/** Детерминированный «рынок» без Math.random: синус + пила, с разворотами. */
function makeCandles(count: number, scale = 1): LabCandle[] {
  const out: LabCandle[] = [];
  for (let i = 0; i < count; i += 1) {
    const wave =
      100 + 12 * Math.sin(i / 11) + 5 * Math.sin(i / 3.5) + 0.03 * ((i * 37) % 23) - 0.3;
    const close = wave * scale;
    const open = (wave - 0.4 * Math.sin(i / 5)) * scale;
    const high = Math.max(open, close) + 0.8 * scale;
    const low = Math.min(open, close) - 0.8 * scale;
    const time = BASE + i * TF_SEC;
    out.push({ time, closeTime: time + TF_SEC - 1, open, high, low, close, volume: 1000 + i });
  }
  return out;
}

function graphInput(graph: StrategyGraph, candles: LabCandle[]): LabReplayInput {
  return {
    strategyGraph: graph,
    market: 'spot',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    from: candles[0].time,
    to: candles[candles.length - 1].closeTime,
    candles,
  };
}

function withoutEdge(graph: StrategyGraph, edgeId: string): StrategyGraph {
  const next = cloneStrategyGraph(graph);
  next.edges = next.edges.filter((e) => e.id !== edgeId);
  return next;
}

function errorCodes(graph: unknown): string[] {
  return validateStrategyGraph(graph).errors.map((e) => e.code);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Валидность шаблона
// ─────────────────────────────────────────────────────────────────────────────

describe('Strategy Lab · блок-схема «EMA Trend»', () => {
  it('A. шаблон проходит валидацию', () => {
    const result = validateStrategyGraph(createEmaTrendTemplate());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('шаблон не использует запрещённые служебные названия и зарегистрирован', () => {
    expect(EMA_TREND_TEMPLATE_NAME).toBe('EMA Trend');
    expect(LAB_GRAPH_TEMPLATES.map((t) => t.id)).toContain('ema-trend');
    const serialized = JSON.stringify(createEmaTrendTemplate());
    for (const banned of ['DEMO', 'TEST', 'TEMP', 'EXAMPLE']) {
      expect(serialized.toUpperCase()).not.toContain(banned);
    }
  });

  it('реестр отдаёт русские названия всех категорий и блоков V1', () => {
    const groups = listBlocksByCategory();
    expect(groups.map((g) => g.label)).toEqual([
      'ДАННЫЕ',
      'ИНДИКАТОРЫ',
      'УСЛОВИЯ',
      'ЗНАЧЕНИЯ',
      'ДЕЙСТВИЯ',
      'СДЕЛКА',
    ]);
    expect(groups.flatMap((g) => g.blocks.map((b) => b.label))).toEqual([
      'Цена закрытия',
      'EMA',
      'ATR',
      'Пересечение вверх',
      'Пересечение вниз',
      'Число',
      'Умножить',
      'R',
      'LONG',
      'SHORT',
      'Стоп',
      'Тейк-профит',
    ]);
  });

  it('у каждого блока СВОЯ форма портов (нет универсального блока)', () => {
    expect(BLOCK_REGISTRY.EMA.inputs.map((p) => p.id)).toEqual(['price']);
    expect(BLOCK_REGISTRY.EMA.params.map((p) => p.id)).toEqual(['period']);
    expect(BLOCK_REGISTRY.ATR.inputs).toHaveLength(0);
    expect(BLOCK_REGISTRY.CROSSES_ABOVE.inputs.map((p) => p.id)).toEqual(['a', 'b']);
    expect(BLOCK_REGISTRY.LONG.inputs.map((p) => p.id)).toEqual(['condition']);
    expect(BLOCK_REGISTRY.LONG.outputs.map((p) => p.id)).toEqual(['signal']);
    expect(BLOCK_REGISTRY.STOP.inputs.map((p) => p.id)).toEqual(['signal', 'risk']);
    expect(BLOCK_REGISTRY.TAKE_PROFIT.inputs.map((p) => p.id)).toEqual(['signal', 'target']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B–J. Отказы валидации
// ─────────────────────────────────────────────────────────────────────────────

describe('Strategy Lab · блок-схема отвергает некорректные графы', () => {
  it('B. неизвестный тип блока', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    (graph.nodes as unknown[]).push({
      id: 'rsi-1',
      type: 'RSI',
      position: { x: 0, y: 0 },
      params: { period: 14 },
    });
    const result = validateStrategyGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('UNKNOWN_BLOCK_TYPE');
    expect(result.errors.find((e) => e.code === 'UNKNOWN_BLOCK_TYPE')?.message).toContain('RSI');
  });

  it('C. неизвестный порт', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.edges[0] = { ...graph.edges[0], to: { nodeId: 'ema-fast', port: 'volume' } };
    const result = validateStrategyGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('UNKNOWN_PORT');
  });

  it('D. несовместимые типы портов (SIGNAL → NUMBER_SERIES)', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.edges.push({
      id: 'bad-1',
      from: { nodeId: 'long', port: 'signal' },
      to: { nodeId: 'cross-up', port: 'a' },
    });
    const result = validateStrategyGraph(graph);
    expect(result.ok).toBe(false);
    const incompatible = result.errors.find((e) => e.code === 'INCOMPATIBLE_PORTS');
    expect(incompatible?.message).toContain('Нельзя соединить SIGNAL с NUMBER_SERIES');
  });

  it('D2. NUMBER (SCALAR) нельзя подключить к EMA.price (NUMBER_SERIES)', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    const problem = canConnect(
      graph,
      { nodeId: 'stop-multiplier', port: 'value' },
      { nodeId: 'ema-fast', port: 'price' }
    );
    expect(problem?.code).toBe('INCOMPATIBLE_PORTS');
    expect(arePortTypesCompatible('SCALAR', 'NUMBER_SERIES')).toBe(false);
  });

  it('E. дублирующиеся ID блоков', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.nodes.push({ ...graph.nodes[1], position: { x: 10, y: 10 } });
    expect(errorCodes(graph)).toContain('DUPLICATE_NODE_ID');
  });

  it('F. дублирующаяся связь (те же порты) и дублирующийся ID связи', () => {
    const duplicatePorts = cloneStrategyGraph(createEmaTrendTemplate());
    duplicatePorts.edges.push({ ...duplicatePorts.edges[0], id: 'copy-1' });
    expect(errorCodes(duplicatePorts)).toContain('DUPLICATE_EDGE');

    const duplicateIds = cloneStrategyGraph(createEmaTrendTemplate());
    duplicateIds.edges.push({ ...duplicateIds.edges[1], id: duplicateIds.edges[0].id });
    expect(errorCodes(duplicateIds)).toContain('DUPLICATE_EDGE_ID');
  });

  it('G. несколько связей в одиночный вход', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.edges.push({
      id: 'second-price',
      from: { nodeId: 'ema-slow', port: 'value' },
      to: { nodeId: 'cross-up', port: 'a' },
    });
    expect(errorCodes(graph)).toContain('SINGLE_INPUT_PORT');
    expect(
      canConnect(
        createEmaTrendTemplate(),
        { nodeId: 'ema-slow', port: 'value' },
        { nodeId: 'cross-up', port: 'a' }
      )?.code
    ).toBe('SINGLE_INPUT_PORT');
  });

  it('G2. STOP.signal и TAKE_PROFIT.signal принимают и LONG, и SHORT', () => {
    const result = validateStrategyGraph(createEmaTrendTemplate());
    expect(result.ok).toBe(true);
    expect(BLOCK_REGISTRY.STOP.inputs[0].multi).toBe(true);
    expect(BLOCK_REGISTRY.TAKE_PROFIT.inputs[0].multi).toBe(true);
  });

  it('H. пропущенные обязательные входы дают русские сообщения', () => {
    const noPrice = withoutEdge(createEmaTrendTemplate(), 'e-close-fast');
    expect(validateStrategyGraph(noPrice).errors.map((e) => e.message)).toContain(
      'EMA: не подключён вход цены'
    );

    const noCondition = withoutEdge(createEmaTrendTemplate(), 'e-up-long');
    expect(validateStrategyGraph(noCondition).errors.map((e) => e.message)).toContain(
      'LONG: не подключено условие'
    );

    const noRisk = withoutEdge(createEmaTrendTemplate(), 'e-mul-stop');
    expect(validateStrategyGraph(noRisk).errors.map((e) => e.message)).toContain(
      'Стоп: не подключён риск'
    );
  });

  it('I. цикл в блок-схеме', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    // EMA Fast → EMA Slow.price создаёт цикл вместе с существующей связью.
    graph.edges = graph.edges.filter((e) => e.id !== 'e-close-slow' && e.id !== 'e-close-fast');
    graph.edges.push(
      { id: 'cyc-1', from: { nodeId: 'ema-fast', port: 'value' }, to: { nodeId: 'ema-slow', port: 'price' } },
      { id: 'cyc-2', from: { nodeId: 'ema-slow', port: 'value' }, to: { nodeId: 'ema-fast', port: 'price' } }
    );
    expect(hasGraphCycle(graph)).toBe(true);
    const result = validateStrategyGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toBe('Обнаружен цикл в блок-схеме');
  });

  it('I2. соединение, создающее цикл, не допускается заранее', () => {
    const graph = withoutEdge(createEmaTrendTemplate(), 'e-close-slow');
    expect(
      canConnect(graph, { nodeId: 'ema-slow', port: 'value' }, { nodeId: 'ema-slow', port: 'price' })
        ?.code
    ).toBe('SELF_CONNECTION');
  });

  it('J. лимиты узлов и связей', () => {
    const tooManyNodes = cloneStrategyGraph(createEmaTrendTemplate());
    for (let i = 0; i < GRAPH_LIMITS.maxNodes; i += 1) {
      tooManyNodes.nodes.push({
        id: `filler-${i}`,
        type: 'NUMBER',
        position: { x: i, y: 0 },
        params: { value: 1 },
      });
    }
    expect(errorCodes(tooManyNodes)).toContain('MAX_NODES');

    const tooManyEdges = cloneStrategyGraph(createEmaTrendTemplate());
    for (let i = 0; i < GRAPH_LIMITS.maxEdges; i += 1) {
      tooManyEdges.edges.push({
        id: `filler-edge-${i}`,
        from: { nodeId: 'close', port: 'value' },
        to: { nodeId: 'ema-fast', port: 'price' },
      });
    }
    expect(errorCodes(tooManyEdges)).toContain('MAX_EDGES');
  });

  it('J2. неизвестный и некорректный параметр блока', () => {
    const unknownParam = cloneStrategyGraph(createEmaTrendTemplate());
    unknownParam.nodes[1].params = { period: 20, lookahead: 3 };
    expect(errorCodes(unknownParam)).toContain('UNKNOWN_PARAM');

    const badValue = cloneStrategyGraph(createEmaTrendTemplate());
    badValue.nodes[1].params = { period: 0.5 };
    expect(errorCodes(badValue)).toContain('INVALID_PARAM_VALUE');
  });

  it('J3. нестабильные/битые ID отклоняются', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.nodes[0] = { ...graph.nodes[0], id: 'не валидный id' };
    expect(errorCodes(graph)).toContain('INVALID_NODE_ID');
  });

  it('J4. требуются обе стороны: LONG и SHORT', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.nodes = graph.nodes.filter((n) => n.id !== 'short');
    graph.edges = graph.edges.filter((e) => e.from.nodeId !== 'short' && e.to.nodeId !== 'short');
    const result = validateStrategyGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('MISSING_BLOCK');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Компиляция
// ─────────────────────────────────────────────────────────────────────────────

describe('Strategy Lab · компиляция блок-схемы в Draft', () => {
  it('K. «EMA Trend» компилируется в ожидаемое определение', () => {
    const definition = compileGraphToDraftDefinition(createEmaTrendTemplate());
    expect(definition).toEqual({
      ...defaultDraftDefinition(EMA_TREND_TEMPLATE_NAME),
      name: EMA_TREND_TEMPLATE_NAME,
    });
    expect(definition.stop).toEqual({ type: 'atrMultiple', indicatorId: 'atr', multiplier: 1.5 });
    expect(definition.target).toEqual({ type: 'rMultiple', multiple: 2 });
  });

  it('параметры блоков переносятся в определение', () => {
    const graph = cloneStrategyGraph(createEmaTrendTemplate());
    graph.nodes.find((n) => n.id === 'ema-fast')!.params.period = 9;
    graph.nodes.find((n) => n.id === 'atr')!.params.period = 21;
    graph.nodes.find((n) => n.id === 'stop-multiplier')!.params.value = 2.5;
    graph.nodes.find((n) => n.id === 'target-value')!.params.value = 3;
    const definition = compileGraphToDraftDefinition(graph);
    expect(definition.indicators.find((i) => i.id === 'ema-fast')?.period).toBe(9);
    expect(definition.indicators.find((i) => i.id === 'atr')?.period).toBe(21);
    expect(definition.stop.multiplier).toBe(2.5);
    expect(definition.target.multiple).toBe(3);
  });

  it('координаты блоков не влияют на компиляцию (position — только UI)', () => {
    const moved = cloneStrategyGraph(createEmaTrendTemplate());
    moved.nodes = moved.nodes
      .map((n, i) => ({ ...n, position: { x: -5 * i, y: 999 - i } }))
      .reverse();
    expect(compileGraphToDraftDefinition(moved)).toEqual(
      compileGraphToDraftDefinition(createEmaTrendTemplate())
    );
  });

  it('невалидный граф не компилируется', () => {
    const broken = withoutEdge(createEmaTrendTemplate(), 'e-mul-stop');
    expect(() => compileGraphToDraftDefinition(broken)).toThrow(GraphCompileError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L, M, N. Паритет, отсутствие look-ahead, точность
// ─────────────────────────────────────────────────────────────────────────────

describe('Strategy Lab · паритет «граф ↔ Draft»', () => {
  const candles = makeCandles(400);
  const graphResult = runLabReplay(graphInput(createEmaTrendTemplate(), candles), 1);
  const draftResult = runLabReplay(
    {
      strategyDefinition: defaultDraftDefinition(EMA_TREND_TEMPLATE_NAME),
      market: 'spot',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      from: candles[0].time,
      to: candles[candles.length - 1].closeTime,
      candles,
    },
    1
  );

  it('CODE-1: Simple Constructor, Block Graph and Code Graph produce identical official results', () => {
    const parsed = codeToGraph(EMA_TREND_CODE);
    expect(parsed.graph).toBeTruthy();
    const codeResult = runLabReplay(graphInput(parsed.graph!, candles), 1);
    expect(graphResult.trades).toEqual(codeResult.trades);
    expect(graphResult.rejections).toEqual(codeResult.rejections);
    expect(graphResult.events).toEqual(codeResult.events);
    expect(graphResult.metrics).toEqual(codeResult.metrics);
    expect(graphResult.trades.map(t => ({entry:t.entryPrice, stop:t.stop, target:t.target, outcome:t.outcome, grossR:t.grossR, netR:t.netR, barsHeld:t.barsHeld})))
      .toEqual(draftResult.trades.map(t => ({entry:t.entryPrice, stop:t.stop, target:t.target, outcome:t.outcome, grossR:t.grossR, netR:t.netR, barsHeld:t.barsHeld})));
  });

  it('набор данных даёт реальные сделки (тест не пустой)', () => {
    expect(graphResult.trades.length).toBeGreaterThan(3);
  });

  it('L. кандидаты, сделки, цены входа/стопа/цели, исходы и R совпадают', () => {
    expect(graphResult.trades).toEqual(draftResult.trades);
    expect(graphResult.metrics).toEqual(draftResult.metrics);
    expect(graphResult.events).toEqual(draftResult.events);
    expect(graphResult.rejections).toEqual(draftResult.rejections);
    expect(graphResult.indicators.emaFast).toEqual(draftResult.indicators.emaFast);
    expect(graphResult.indicators.emaSlow).toEqual(draftResult.indicators.emaSlow);
    expect(graphResult.indicators.atr).toEqual(draftResult.indicators.atr);
    expect(graphResult.meta.evaluatedBars).toBe(draftResult.meta.evaluatedBars);
    expect(graphResult.meta.warmupBars).toBe(draftResult.meta.warmupBars);
    expect(graphResult.meta.strategyId).toBe(BLOCK_GRAPH_ID);
  });

  it('M. нет look-ahead: knownAt ≥ candleTime и решения не зависят от будущих баров', () => {
    for (const ev of graphResult.events) {
      expect(ev.knownAt).toBeGreaterThanOrEqual(ev.candleTime);
    }
    for (const trade of graphResult.trades) {
      expect(trade.entryTime).toBeGreaterThan(trade.signalTime);
    }

    const cut = 240;
    const truncated = runLabReplay(graphInput(createEmaTrendTemplate(), candles.slice(0, cut)), 1);
    const horizon = candles[cut - 1].closeTime;
    const fullCandidates = graphResult.events
      .filter((e) => e.kind === 'CANDIDATE' && e.knownAt <= horizon)
      .map((e) => `${e.candleTime}:${e.side}:${e.price}`);
    const truncatedCandidates = truncated.events
      .filter((e) => e.kind === 'CANDIDATE' && e.knownAt <= horizon)
      .map((e) => `${e.candleTime}:${e.side}:${e.price}`);
    expect(truncatedCandidates).toEqual(fullCandidates);

    const resolvedBefore = graphResult.trades.filter((t) => t.exitTime < candles[cut - 2].time);
    const truncatedById = new Map(truncated.trades.map((t) => [t.id, t]));
    for (const trade of resolvedBefore) {
      expect(truncatedById.get(trade.id)).toEqual(trade);
    }
  });

  it('CODE-1: no look-ahead and knownAt invariants hold on Code Mode graph path', () => {
    const parsed = codeToGraph(EMA_TREND_CODE);
    const full = runLabReplay(graphInput(parsed.graph!, candles), 1);
    const cut = 240;
    const partial = runLabReplay(graphInput(parsed.graph!, candles.slice(0, cut)), 1);
    const horizon = candles[cut - 1].closeTime;
    expect(partial.events.filter(e => e.kind === 'CANDIDATE' && e.knownAt <= horizon).map(e => `${e.candleTime}:${e.side}:${e.price}`))
      .toEqual(full.events.filter(e => e.kind === 'CANDIDATE' && e.knownAt <= horizon).map(e => `${e.candleTime}:${e.side}:${e.price}`));
    for (const event of full.events) expect(event.knownAt).toBeGreaterThanOrEqual(event.candleTime);
  });

  it('N. точность цен PEPE-масштаба сохраняется без округления', () => {
    const micro = makeCandles(400, 0.00000012);
    const viaGraph = runLabReplay(graphInput(createEmaTrendTemplate(), micro), 1);
    const parsedCode = codeToGraph(EMA_TREND_CODE);
    const viaCode = runLabReplay(graphInput(parsedCode.graph!, micro), 1);
    const viaDraft = runLabReplay(
      {
        strategyDefinition: defaultDraftDefinition(EMA_TREND_TEMPLATE_NAME),
        market: 'spot',
        symbol: 'PEPEUSDT',
        timeframe: '1h',
        from: micro[0].time,
        to: micro[micro.length - 1].closeTime,
        candles: micro,
      },
      1
    );
    expect(viaGraph.trades).toEqual(viaDraft.trades);
    expect(viaCode.trades).toEqual(viaDraft.trades);
    expect(viaGraph.trades.length).toBeGreaterThan(0);
    const sample = viaGraph.trades[0];
    expect(sample.entryPrice).toBeLessThan(0.001);
    expect(sample.entryPrice).not.toBe(0);
    expect(sample.stop).not.toBe(sample.entryPrice);
    // Цены сохраняют десятичные знаки далеко за пределами 8 знаков.
    expect(String(sample.entryPrice)).toMatch(/e-|\.\d{8,}/);
  });

  it('X. результат блок-режима работает с существующей проекцией графика (PR #45)', () => {
    const projection = mapLabEventMarkers(graphResult.events, graphResult.candles);
    expect(projection.markers.length).toBeGreaterThan(0);
    for (let i = 1; i < projection.markers.length; i += 1) {
      expect(projection.markers[i].time).toBeGreaterThanOrEqual(projection.markers[i - 1].time);
    }
    const trade = graphResult.trades[0];
    const levels = mapTradeLevels(trade);
    expect(levels.map((l) => l.price)).toEqual([trade.entryPrice, trade.stop, trade.target]);
    const tradeIds = new Set(graphResult.trades.map((t) => t.id));
    const linked = graphResult.events.filter((e) => e.payload?.tradeId);
    expect(linked.length).toBeGreaterThan(0);
    for (const ev of linked) {
      expect(tradeIds.has(String(ev.payload?.tradeId))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Подсказки UX для tap-to-connect
// ─────────────────────────────────────────────────────────────────────────────

describe('Strategy Lab · совместимые входы для tap-to-connect', () => {
  it('подсвечиваются только совместимые и свободные входы', () => {
    const graph = withoutEdge(createEmaTrendTemplate(), 'e-close-fast');
    const targets = listCompatibleInputs(graph, { nodeId: 'close', port: 'value' });
    expect(targets).toContainEqual({ nodeId: 'ema-fast', port: 'price' });
    // Занятый одиночный вход EMA Slow в список не попадает.
    expect(targets).not.toContainEqual({ nodeId: 'ema-slow', port: 'price' });
    // Входы другого типа недоступны.
    expect(targets.some((t) => t.nodeId === 'long')).toBe(false);
    expect(targets.some((t) => t.nodeId === 'target-r')).toBe(false);
  });

  it('из SIGNAL доступны только сигнальные входы сделки', () => {
    const graph = withoutEdge(createEmaTrendTemplate(), 'e-long-stop');
    const targets = listCompatibleInputs(graph, { nodeId: 'long', port: 'signal' });
    expect(targets).toEqual([{ nodeId: 'stop', port: 'signal' }]);
  });
});
