// @vitest-environment node
/**
 * CRYPTORA — Strategy Lab · серверная валидация и компиляция блок-схемы
 * ---------------------------------------------------------------------------
 * Фронтенд НЕ источник истины (§10, §18): сервер обязан сам отклонить
 * некорректный граф и сам скомпилировать корректный в существующий
 * `StrategyDraftDefinition`, после чего выполнить ТОТ ЖЕ бэктест.
 *
 * Тест идёт настоящим серверным путём: `labService.runReplay` + реальное
 * исследовательское ядро из esbuild-бандла (`loadLabCore`). Сеть не нужна:
 * свечи подставляются через существующие тестовые швы localInspector/localReader.
 */

import { describe, it, expect, vi } from 'vitest';
import { runReplay, LabRequestError } from '../../server/services/strategyLab/labService.js';
import { loadLabCore } from '../../server/services/strategyLab/labCoreBundle.js';
import { parseReplayRequest } from '../../server/validators/strategyLab.js';
import { createEmaTrendTemplate, cloneStrategyGraph } from '@/services/strategyLab/graph/templates';
import { defaultDraftDefinition } from '@/services/strategyLab/registry';
import type { LabCandle } from '@/services/strategyLab/types';
import type { StrategyGraph } from '@/services/strategyLab/graph/types';

const HOUR_MS = 60 * 60_000;
const FROM_MS = Date.parse('2025-01-01T00:00:00.000Z');
const BARS = 360;

function candles(): LabCandle[] {
  const out: LabCandle[] = [];
  for (let i = 0; i < BARS; i += 1) {
    const wave = 100 + 12 * Math.sin(i / 11) + 5 * Math.sin(i / 3.5);
    const close = wave;
    const open = wave - 0.4 * Math.sin(i / 5);
    const time = Math.floor(FROM_MS / 1000) + i * 3600;
    out.push({
      time,
      closeTime: time + 3599,
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
      volume: 1000 + i,
    });
  }
  return out;
}

const localMeta = {
  datasetVersion: 'fixture-v1',
  manifestGeneratedAt: '2025-02-01T00:00:00.000Z',
  coverageFrom: new Date(FROM_MS).toISOString(),
  coverageTo: new Date(FROM_MS + BARS * HOUR_MS).toISOString(),
  seriesSha256: 'a'.repeat(64),
};

function serverOptions(reader = vi.fn(async () => ({ covered: true, candles: candles(), meta: localMeta }))) {
  return {
    reader,
    options: {
      localInspector: vi.fn(async () => ({ covered: true, datasetAvailable: true })),
      localReader: reader,
      nowMs: FROM_MS + (BARS + 5) * HOUR_MS,
    },
  };
}

function request(body: Record<string, unknown>) {
  return parseReplayRequest({
    market: 'spot',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    from: FROM_MS,
    to: FROM_MS + BARS * HOUR_MS,
    ...body,
  });
}

function brokenGraph(edgeId: string): StrategyGraph {
  const graph = cloneStrategyGraph(createEmaTrendTemplate());
  graph.edges = graph.edges.filter((e) => e.id !== edgeId);
  return graph;
}

describe('Strategy Lab · сервер принимает валидную блок-схему', () => {
  it('P. валидный граф компилируется на сервере и даёт полноценный результат', async () => {
    const core = await loadLabCore();
    const { options } = serverOptions();
    const result = await runReplay(request({ strategyGraph: createEmaTrendTemplate() }), {
      ...options,
      core,
    });

    expect(result.meta.strategyId).toBe('BLOCK_GRAPH');
    expect(result.meta.strategyName).toBe('EMA Trend');
    expect(result.meta.researchOnly).toBe(true);
    expect(result.meta.dataSource).toBe('local-dataset');
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.metrics.trades).toBe(result.trades.length);
  });

  it('L(server). результат графа совпадает с результатом текущего Draft', async () => {
    const core = await loadLabCore();
    const viaGraph = await runReplay(request({ strategyGraph: createEmaTrendTemplate() }), {
      ...serverOptions().options,
      core,
    });
    const viaDraft = await runReplay(
      request({ strategyDefinition: defaultDraftDefinition('EMA Trend') }),
      { ...serverOptions().options, core }
    );

    expect(viaGraph.trades).toEqual(viaDraft.trades);
    expect(viaGraph.events).toEqual(viaDraft.events);
    expect(viaGraph.rejections).toEqual(viaDraft.rejections);
    expect(viaGraph.metrics).toEqual(viaDraft.metrics);
    expect(viaGraph.indicators.emaFast).toEqual(viaDraft.indicators.emaFast);
    expect(viaGraph.indicators.atr).toEqual(viaDraft.indicators.atr);
  });
});

describe('Strategy Lab · сервер отклоняет некорректную блок-схему', () => {
  it('O. неподключённый риск стопа → 400 с русским объяснением и БЕЗ чтения свечей', async () => {
    const core = await loadLabCore();
    const { reader, options } = serverOptions();
    await expect(
      runReplay(request({ strategyGraph: brokenGraph('e-mul-stop') }), { ...options, core })
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STRATEGY_GRAPH',
      message: expect.stringContaining('Стоп: не подключён риск'),
    });
    expect(reader).not.toHaveBeenCalled();
  });

  it('O2. несовместимые порты и неизвестный блок отклоняются сервером', async () => {
    const core = await loadLabCore();
    const incompatible = cloneStrategyGraph(createEmaTrendTemplate());
    incompatible.edges.push({
      id: 'bad-1',
      from: { nodeId: 'long', port: 'signal' },
      to: { nodeId: 'cross-up', port: 'a' },
    });
    await expect(
      runReplay(request({ strategyGraph: incompatible }), { ...serverOptions().options, core })
    ).rejects.toBeInstanceOf(LabRequestError);

    const unknown = cloneStrategyGraph(createEmaTrendTemplate());
    (unknown.nodes as unknown[]).push({
      id: 'rsi-1',
      type: 'RSI',
      position: { x: 0, y: 0 },
      params: {},
    });
    await expect(
      runReplay(request({ strategyGraph: unknown }), { ...serverOptions().options, core })
    ).rejects.toMatchObject({ code: 'INVALID_STRATEGY_GRAPH' });
  });

  it('схема запроса: битая форма графа отклоняется до семантики', () => {
    expect(() =>
      request({
        strategyGraph: {
          schemaVersion: 1,
          name: 'X',
          authoringMode: 'blocks',
          nodes: [{ id: 'a', type: 'EMA', position: { x: 0, y: 0 }, params: { period: 'много' } }],
          edges: [],
        },
      })
    ).toThrow();

    expect(() =>
      request({
        strategyGraph: { ...createEmaTrendTemplate(), schemaVersion: 2 },
      })
    ).toThrow();

    expect(() =>
      request({
        strategyGraph: createEmaTrendTemplate(),
        strategyDefinition: defaultDraftDefinition('EMA Trend'),
      })
    ).toThrow();
  });

  it('запрос без стратегии по-прежнему отклоняется', () => {
    expect(() => request({})).toThrow();
  });
});
