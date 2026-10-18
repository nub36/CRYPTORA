/**
 * signalUiModel — lifecycle-прогресс (Signals UI V1).
 *
 * Проверяется перенос серверной проекции `dto.progress` в модель:
 *
 *   • достигнутые TP1/TP2/стоп помечаются `reached` (TP3+ — никогда:
 *     frozen-ведение отслеживает ровно две цели);
 *   • действующий стоп после BE идёт отдельным набором `progressLevels` —
 *     только с доказанным значением, иначе строки нет вообще;
 *   • fill-стоп, переставший быть эффективным после BE, из `effectiveLevels`
 *     исключается (нельзя выдавать старый стоп за действующий);
 *   • публикационные уровни сохраняются как история во всех случаях;
 *   • отсутствие `progress` в DTO = «неизвестно»: рендер как раньше
 *     (обратная совместимость отображения);
 *   • факты НЕ перевыводятся: клиент доверяет серверной проекции целиком
 *     (V2.8 с BE-событием действующего стопа не получает — решает сервер).
 */

import { describe, it, expect } from 'vitest';
import type { SignalDto, SignalLifecycleProgressDto } from '@/services/strategyOps';
import {
  buildEffectiveLevelRows,
  buildLevelRows,
  buildProgressLevelRows,
  resolveSignalProgress,
  toSignalUiModel,
} from '@/services/signals/ui/signalUiModel';

const NO_PROGRESS: SignalLifecycleProgressDto = {
  tp1Hit: false,
  tp1HitAt: null,
  tp2Hit: false,
  tp2HitAt: null,
  breakevenArmed: false,
  breakevenArmedAt: null,
  stopHit: false,
  stopHitAt: null,
  currentStop: null,
  currentStopBasis: null,
};

function makeSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: 'sig-near',
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    strategyVersion: '3.4',
    engineSetupId: 'engine-1',
    symbol: 'NEAR/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-10-17T22:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: 'TP2 или стоп',
    entryMin: 4.84,
    entryMax: 4.87,
    stopLoss: 4.7,
    targets: [4.9835, 5.44],
    tp1: 4.9835,
    tp2: 5.44,
    status: 'FILLED',
    createdAt: '2026-10-17T22:05:00.000Z',
    updatedAt: '2026-10-18T03:00:00.000Z',
    fillPrice: 4.857,
    filledAt: '2026-10-18T00:59:00.000Z',
    fillStop: 4.7,
    fillTargets: [4.9835, 5.44],
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    metadata: null,
    hash: 'h',
    previousHash: 'p',
    outcomeHash: null,
    provenanceStatus: 'VERIFIED',
    testRunId: null,
    chainVersion: 2,
    ...overrides,
  };
}

function withProgress(overrides: Partial<SignalLifecycleProgressDto>): SignalDto {
  return makeSignal({ progress: { ...NO_PROGRESS, ...overrides } });
}

describe('resolveSignalProgress — нормализация серверной проекции', () => {
  it('отсутствие progress в DTO → все флаги ложны, стоп null', () => {
    expect(resolveSignalProgress(makeSignal())).toEqual(NO_PROGRESS);
    expect(resolveSignalProgress(makeSignal({ progress: undefined }))).toEqual(NO_PROGRESS);
  });

  it('переносит флаги, времена и стоп как есть', () => {
    const p = resolveSignalProgress(
      withProgress({
        tp1Hit: true,
        tp1HitAt: '2026-10-18T01:59:00.000Z',
        breakevenArmed: true,
        breakevenArmedAt: '2026-10-18T02:59:00.000Z',
        currentStop: 4.857,
        currentStopBasis: 'BE_AT_ENTRY',
      })
    );
    expect(p).toEqual({
      ...NO_PROGRESS,
      tp1Hit: true,
      tp1HitAt: '2026-10-18T01:59:00.000Z',
      breakevenArmed: true,
      breakevenArmedAt: '2026-10-18T02:59:00.000Z',
      currentStop: 4.857,
      currentStopBasis: 'BE_AT_ENTRY',
    });
  });

  it('мусор вместо флага/стопа → безопасные дефолты', () => {
    const p = resolveSignalProgress(
      makeSignal({ progress: { tp1Hit: 'yes', currentStop: Number.NaN } as never })
    );
    expect(p.tp1Hit).toBe(false);
    expect(p.currentStop).toBe(null);
  });
});

describe('buildLevelRows — отметки достижения', () => {
  it('TP1 достигнут → target-1 reached, TP2 — обычная цель', () => {
    const rows = buildLevelRows(withProgress({ tp1Hit: true, tp1HitAt: '2026-10-18T01:59:00.000Z' }));
    const tp1 = rows.find((r) => r.id === 'target-1')!;
    const tp2 = rows.find((r) => r.id === 'target-2')!;
    expect(tp1.reached).toBe(true);
    expect(tp1.price).toBe(4.9835);
    expect(tp2.reached).toBe(undefined);
  });

  it('TP2 достигнут → обе цели reached (TP2 невозможен без TP1)', () => {
    const rows = buildLevelRows(
      makeSignal({
        status: 'TARGET_REACHED',
        closeReason: 'TP2',
        progress: { ...NO_PROGRESS, tp1Hit: true, tp2Hit: true, tp2HitAt: '2026-10-18T06:00:00.000Z' },
      })
    );
    expect(rows.find((r) => r.id === 'target-1')!.reached).toBe(true);
    expect(rows.find((r) => r.id === 'target-2')!.reached).toBe(true);
  });

  it('TP3+ отметок не получают (frozen-ведение их не отслеживает)', () => {
    const rows = buildLevelRows(
      makeSignal({
        targets: [4.9835, 5.44, 6.0],
        progress: { ...NO_PROGRESS, tp1Hit: true, tp2Hit: true },
      })
    );
    expect(rows.find((r) => r.id === 'target-3')!.reached).toBe(undefined);
  });

  it('стоп сработал → stop reached, цели — обычные', () => {
    const rows = buildLevelRows(
      makeSignal({
        status: 'INVALIDATED',
        closeReason: 'SL',
        progress: { ...NO_PROGRESS, stopHit: true, stopHitAt: '2026-10-18T04:00:00.000Z' },
      })
    );
    const stop = rows.find((r) => r.id === 'stop')!;
    expect(stop.reached).toBe(true);
    expect(stop.price).toBe(4.7);
    expect(rows.find((r) => r.id === 'target-1')!.reached).toBe(undefined);
  });

  it('без прогресса — ни одной отметки (рендер как раньше)', () => {
    const rows = buildLevelRows(makeSignal());
    expect(rows.some((r) => r.reached)).toBe(false);
  });

  it('публикационные уровни сохраняются как история при любом прогрессе', () => {
    const rows = buildLevelRows(
      withProgress({ tp1Hit: true, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' })
    );
    // Зона входа (2) + первоначальный стоп (1) + цели (2) — всё на месте.
    expect(rows.map((r) => r.id)).toEqual(['entry-low', 'entry-high', 'stop', 'target-1', 'target-2']);
    expect(rows.find((r) => r.id === 'stop')!.price).toBe(4.7);
  });
});

describe('buildProgressLevelRows — действующий стоп', () => {
  it('доказанный currentStop → строка «Стоп в безубытке (действующий)»', () => {
    const rows = buildProgressLevelRows(
      withProgress({ breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'current-stop',
      kind: 'stop',
      label: 'Стоп в безубытке (действующий)',
      price: 4.857,
      tone: 'red',
      comparator: '<',
      progressLevel: true,
    });
  });

  it('SHORT: компаратор стопа — «>»', () => {
    const rows = buildProgressLevelRows(
      makeSignal({
        direction: 'SHORT',
        progress: { ...NO_PROGRESS, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' },
      })
    );
    expect(rows[0]!.comparator).toBe('>');
  });

  it('currentStop null → строк нет (уровень не выдумывается)', () => {
    // V2.8 с взведённым BE: статус есть, значения нет — строки нет.
    expect(buildProgressLevelRows(makeSignal())).toEqual([]);
    expect(buildProgressLevelRows(withProgress({ breakevenArmed: true }))).toEqual([]);
  });
});

describe('buildEffectiveLevelRows — stale fill-стоп после BE', () => {
  it('без BE: fill-стоп на месте (поведение как раньше)', () => {
    const rows = buildEffectiveLevelRows(makeSignal());
    expect(rows.find((r) => r.id === 'fill-stop')).toMatchObject({ price: 4.7, label: 'Эффективный стоп' });
  });

  it('BE с доказанным стопом: fill-стоп исключён (не выдаётся за действующий)', () => {
    const rows = buildEffectiveLevelRows(
      withProgress({ breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' })
    );
    expect(rows.find((r) => r.id === 'fill-stop')).toBe(undefined);
    // Остальные эффективные уровни (факт входа, цели) — на месте.
    expect(rows.find((r) => r.id === 'fill-price')!.price).toBe(4.857);
    expect(rows.filter((r) => r.id.startsWith('fill-target-'))).toHaveLength(2);
  });

  it('BE-статус без значения (V2.8): fill-стоп остаётся (выдумывать нечего)', () => {
    const rows = buildEffectiveLevelRows(
      makeSignal({
        strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
        progress: { ...NO_PROGRESS, breakevenArmed: true },
      })
    );
    expect(rows.find((r) => r.id === 'fill-stop')!.price).toBe(4.7);
  });
});

describe('toSignalUiModel — прогресс в модели', () => {
  it('модель несёт progress и progressLevels', () => {
    const m = toSignalUiModel(
      withProgress({ tp1Hit: true, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' })
    );
    expect(m.progress.tp1Hit).toBe(true);
    expect(m.progress.breakevenArmed).toBe(true);
    expect(m.progress.currentStop).toBe(4.857);
    expect(m.progressLevels).toHaveLength(1);
    expect(m.levels.find((r) => r.id === 'target-1')!.reached).toBe(true);
  });

  it('без прогресса в DTO модель валидна: флаги ложны, наборы пусты', () => {
    const m = toSignalUiModel(makeSignal());
    expect(m.progress).toEqual(NO_PROGRESS);
    expect(m.progressLevels).toEqual([]);
  });
});
