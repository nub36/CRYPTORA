// @vitest-environment node
/**
 * CRYPTORA — Strategy Lab · серверная валидация code-first черновика
 * ---------------------------------------------------------------------------
 * Фронтенд НЕ источник истины (§14): сервер сам разбирает код стратегии, сам
 * проверяет ссылки на индикаторы/типы/стоп/цель и сам компилирует черновик в
 * существующий `StrategyDraftDefinition`, после чего выполняет ТОТ ЖЕ бэктест.
 *
 * Тест идёт настоящим серверным путём: `labService.runReplay` + реальное ядро
 * из esbuild-бандла. Сеть не нужна (свечи через тестовые швы).
 */

import { describe, it, expect, vi } from 'vitest';
import { runReplay } from '../../server/services/strategyLab/labService.js';
import { loadLabCore } from '../../server/services/strategyLab/labCoreBundle.js';
import { parseReplayRequest } from '../../server/validators/strategyLab.js';
import { defaultResearchDraft } from '@/services/strategyLab/draft';
import { defaultDraftDefinition } from '@/services/strategyLab/registry';
import type { LabCandle } from '@/services/strategyLab/types';

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

function serverOptions(
  reader = vi.fn(async () => ({ covered: true, candles: candles(), meta: localMeta }))
) {
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

function draftWithCode(replacer: (code: string) => string) {
  const draft = defaultResearchDraft();
  return { ...draft, sourceCode: replacer(draft.sourceCode) };
}

describe('Strategy Lab · сервер принимает code-first черновик', () => {
  it('валидный черновик компилируется на сервере и даёт полноценный результат', async () => {
    const core = await loadLabCore();
    const result = await runReplay(request({ strategyDraft: defaultResearchDraft() }), {
      ...serverOptions().options,
      core,
    });

    expect(result.meta.strategyId).toBe('CODE_DRAFT');
    expect(result.meta.strategyName).toBe('EMA Trend');
    expect(result.meta.researchOnly).toBe(true);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.metrics.trades).toBe(result.trades.length);
  });

  it('I/J. результат code-first черновика совпадает с прежней EMA-стратегией', async () => {
    const core = await loadLabCore();
    const viaDraft = await runReplay(request({ strategyDraft: defaultResearchDraft() }), {
      ...serverOptions().options,
      core,
    });
    const viaLegacy = await runReplay(
      request({ strategyDefinition: defaultDraftDefinition('EMA Trend') }),
      { ...serverOptions().options, core }
    );

    expect(viaDraft.trades).toEqual(viaLegacy.trades);
    expect(viaDraft.events).toEqual(viaLegacy.events);
    expect(viaDraft.rejections).toEqual(viaLegacy.rejections);
    expect(viaDraft.metrics).toEqual(viaLegacy.metrics);
    expect(viaDraft.indicators.emaFast).toEqual(viaLegacy.indicators.emaFast);
    expect(viaDraft.indicators.atr).toEqual(viaLegacy.indicators.atr);
  });
});

describe('Strategy Lab · сервер отклоняет некорректный код/индикаторы', () => {
  it('ссылка на отсутствующий индикатор → 400 по-русски и БЕЗ чтения свечей', async () => {
    const core = await loadLabCore();
    const { reader, options } = serverOptions();
    await expect(
      runReplay(
        request({ strategyDraft: draftWithCode((c) => c.replace('EMA_SLOW', 'EMA_NOPE')) }),
        { ...options, core }
      )
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STRATEGY_CODE',
      message: expect.stringContaining('EMA_NOPE'),
    });
    expect(reader).not.toHaveBeenCalled();
  });

  it('неверный тип индикатора, битый код и плохая цель отклоняются', async () => {
    const core = await loadLabCore();
    const options = serverOptions().options;

    await expect(
      runReplay(
        request({
          strategyDraft: draftWithCode((c) => c.replace('multiply(ATR_MAIN, 1.5)', 'multiply(EMA_FAST, 1.5)')),
        }),
        { ...options, core }
      )
    ).rejects.toMatchObject({ code: 'INVALID_STRATEGY_CODE' });

    await expect(
      runReplay(
        request({ strategyDraft: draftWithCode(() => 'strategy("x", () => { eval("1"); });') }),
        { ...options, core }
      )
    ).rejects.toMatchObject({ code: 'INVALID_STRATEGY_CODE' });

    await expect(
      runReplay(request({ strategyDraft: draftWithCode((c) => c.replace('R(2)', 'R(0)')) }), {
        ...options,
        core,
      })
    ).rejects.toMatchObject({ code: 'INVALID_STRATEGY_CODE' });
  });

  it('схема запроса: форма черновика и конфликты отклоняются до семантики', () => {
    expect(() => request({ strategyDraft: { ...defaultResearchDraft(), apiVersion: 1 } })).toThrow();
    expect(() => request({ strategyDraft: { ...defaultResearchDraft(), indicators: [] } })).toThrow();
    expect(() => request({ strategyDraft: { ...defaultResearchDraft(), sourceCode: '' } })).toThrow();
    expect(() =>
      request({
        strategyDraft: defaultResearchDraft(),
        strategyDefinition: defaultDraftDefinition('EMA Trend'),
      })
    ).toThrow();
    expect(() => request({})).toThrow();
  });
});
