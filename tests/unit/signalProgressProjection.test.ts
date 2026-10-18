/**
 * signalChartProjection — линии lifecycle-прогресса (Signals UI V1).
 *
 * Проверяется визуальное различие подтверждённого и ожидающего:
 *
 *   • достигнутая цель — сплошная линия с «✓» в подписи («TP1 ✓»);
 *     ожидающая — пунктирная без отметки (как раньше);
 *   • сработавший стоп — «Стоп ✓» сплошной; ожидающий — dashed «Стоп»;
 *   • действующий стоп после BE — сплошная красная «SL (BE)», включается
 *     всегда, когда сервер доказал значение (независимо от showEffective);
 *   • исторические линии (первоначальный стоп, достигнутые цели) остаются
 *     на графике — достигнутое не убирается, а перемаркируется;
 *   • обновление: новый DTO с прогрессом (очередной тик polling) даёт новые
 *     линии без ручной перезагрузки — проекция чиста от входного DTO.
 */

import { describe, it, expect } from 'vitest';
import type { SignalDto, SignalLifecycleProgressDto } from '@/services/strategyOps';
import { toSignalUiModel } from '@/services/signals/ui/signalUiModel';
import {
  buildSignalLevelLines,
  compactLevelLabel,
} from '@/services/signals/ui/signalChartProjection';

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
    exitRule: null,
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

function linesOf(signal: SignalDto, showEffective = true) {
  return buildSignalLevelLines(toSignalUiModel(signal), {
    showEffective,
    showLabels: true,
    compact: true,
  }).lines;
}

describe('compactLevelLabel — подписи прогресса', () => {
  it('TP1 достигнут → «TP1 ✓», TP2 ждёт → «TP2»', () => {
    const m = toSignalUiModel(makeSignal({ progress: { ...NO_PROGRESS, tp1Hit: true } }));
    const tp1 = m.levels.find((r) => r.id === 'target-1')!;
    const tp2 = m.levels.find((r) => r.id === 'target-2')!;
    expect(compactLevelLabel(tp1)).toBe('TP1 ✓');
    expect(compactLevelLabel(tp2)).toBe('TP2');
  });

  it('действующий стоп → «SL (BE)»', () => {
    const m = toSignalUiModel(
      makeSignal({
        progress: { ...NO_PROGRESS, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' },
      })
    );
    expect(compactLevelLabel(m.progressLevels[0]!)).toBe('SL (BE)');
  });

  it('сработавший стоп → «Стоп ✓»', () => {
    const m = toSignalUiModel(makeSignal({ progress: { ...NO_PROGRESS, stopHit: true } }));
    expect(compactLevelLabel(m.levels.find((r) => r.id === 'stop')!)).toBe('Стоп ✓');
  });
});

describe('buildSignalLevelLines — достигнутое vs ожидающее', () => {
  it('TP1 ✓ — сплошная на цене TP1; TP2 — пунктирная без отметки', () => {
    const lines = linesOf(makeSignal({ progress: { ...NO_PROGRESS, tp1Hit: true } }));
    const tp1 = lines.find((l) => l.id === 'target-1')!;
    const tp2 = lines.find((l) => l.id === 'target-2')!;
    expect(tp1.price).toBe(4.9835);
    expect(tp1.style).toBe('solid');
    expect(tp1.title).toContain('TP1 ✓');
    expect(tp1.color).toBe('#10b981');
    expect(tp2.style).toBe('dotted');
    expect(tp2.title).toContain('TP2');
    expect(tp2.title).not.toContain('✓');
  });

  it('полные подписи тоже несут ✓ (некомпактный режим)', () => {
    const { lines } = buildSignalLevelLines(
      toSignalUiModel(makeSignal({ progress: { ...NO_PROGRESS, tp1Hit: true } })),
      { showEffective: false, showLabels: true, compact: false }
    );
    const tp1 = lines.find((l) => l.id === 'target-1')!;
    expect(tp1.title).toContain('✓');
    expect(tp1.title).toContain('4,9835');
  });

  it('BE: линия «SL (BE)» на fillPrice + исторический стоп остаётся', () => {
    const lines = linesOf(
      makeSignal({
        progress: { ...NO_PROGRESS, tp1Hit: true, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' },
      })
    );
    const current = lines.find((l) => l.id === 'current-stop')!;
    expect(current.price).toBe(4.857);
    expect(current.style).toBe('solid');
    expect(current.color).toBe('#f43f5e');
    expect(current.lineWidth).toBe(2);
    expect(current.title).toContain('SL (BE)');
    // Первоначальный стоп — исторической dashed-линией на своей цене.
    const initial = lines.find((l) => l.id === 'stop')!;
    expect(initial.price).toBe(4.7);
    expect(initial.style).toBe('dashed');
    expect(initial.title).not.toContain('(BE)');
    // Stale «SL эфф» на первоначальной цене после BE не рисуется.
    expect(lines.find((l) => l.id === 'eff-fill-stop')).toBe(undefined);
  });

  it('BE-статус без значения (V2.8): линии действующего стопа нет', () => {
    const lines = linesOf(
      makeSignal({
        strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
        progress: { ...NO_PROGRESS, breakevenArmed: true },
      })
    );
    expect(lines.find((l) => l.id === 'current-stop')).toBe(undefined);
    // Fill-стоп трейлинга остаётся (выдумывать замену нечем).
    expect(lines.find((l) => l.id === 'eff-fill-stop')!.price).toBe(4.7);
  });

  it('уровни прогресса рисуются независимо от showEffective', () => {
    const signal = makeSignal({
      progress: { ...NO_PROGRESS, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' },
    });
    const withoutEffective = linesOf(signal, false);
    expect(withoutEffective.find((l) => l.id === 'current-stop')!.price).toBe(4.857);
    expect(withoutEffective.find((l) => l.id === 'eff-fill-stop')).toBe(undefined);
  });

  it('INVALIDATED: стоп «Стоп ✓» сплошной; цели без отметок', () => {
    const lines = linesOf(
      makeSignal({
        status: 'INVALIDATED',
        closeReason: 'SL',
        progress: { ...NO_PROGRESS, stopHit: true },
      })
    );
    const stop = lines.find((l) => l.id === 'stop')!;
    expect(stop.style).toBe('solid');
    expect(stop.title).toContain('Стоп ✓');
    expect(lines.find((l) => l.id === 'target-1')!.style).toBe('dotted');
  });

  it('TARGET_REACHED: обе цели ✓ сплошными', () => {
    const lines = linesOf(
      makeSignal({
        status: 'TARGET_REACHED',
        closeReason: 'TP2',
        progress: { ...NO_PROGRESS, tp1Hit: true, tp2Hit: true },
      })
    );
    expect(lines.find((l) => l.id === 'target-1')!.title).toContain('TP1 ✓');
    expect(lines.find((l) => l.id === 'target-2')!.title).toContain('TP2 ✓');
    expect(lines.find((l) => l.id === 'target-2')!.style).toBe('solid');
  });

  it('без прогресса линии как раньше: dotted-цели, dashed-стоп, без ✓', () => {
    const lines = linesOf(makeSignal());
    expect(lines.find((l) => l.id === 'target-1')!.style).toBe('dotted');
    expect(lines.find((l) => l.id === 'target-2')!.style).toBe('dotted');
    expect(lines.find((l) => l.id === 'stop')!.style).toBe('dashed');
    expect(lines.some((l) => l.title.includes('✓'))).toBe(false);
    expect(lines.find((l) => l.id === 'current-stop')).toBe(undefined);
  });
});

describe('обновление overlays при polling — новый DTO → новые линии', () => {
  it('тик 1: целей нет в прогрессе → тик 2: TP1+BE → линии перемаркируются', () => {
    // Тот же сигнал двумя последовательными ответами API (poll 60 c):
    // проекция чиста от входа, поэтому свежий DTO даёт свежие линии
    // без ручной перезагрузки и без React-стейта между тиками.
    const before = linesOf(makeSignal({ progress: { ...NO_PROGRESS } }));
    expect(before.find((l) => l.id === 'target-1')!.title).not.toContain('✓');
    expect(before.find((l) => l.id === 'current-stop')).toBe(undefined);

    const after = linesOf(
      makeSignal({
        updatedAt: '2026-10-18T03:01:00.000Z',
        progress: {
          ...NO_PROGRESS,
          tp1Hit: true,
          tp1HitAt: '2026-10-18T01:59:00.000Z',
          breakevenArmed: true,
          breakevenArmedAt: '2026-10-18T02:59:00.000Z',
          currentStop: 4.857,
          currentStopBasis: 'BE_AT_ENTRY',
        },
      })
    );
    expect(after.find((l) => l.id === 'target-1')!.title).toContain('TP1 ✓');
    expect(after.find((l) => l.id === 'current-stop')!.price).toBe(4.857);
    // История не потеряна обновлением: первоначальный стоп на месте.
    expect(after.find((l) => l.id === 'stop')!.price).toBe(4.7);
  });

  it('закрытие между тиками: FILLED → CLOSED (TP1→BE) → терминальные линии', () => {
    const after = linesOf(
      makeSignal({
        status: 'CLOSED',
        closeReason: 'TP1_THEN_BE',
        closedAt: '2026-10-18T05:00:00.000Z',
        closePrice: 4.857,
        resultR: 0.5,
        netResultR: 0.42,
        progress: { ...NO_PROGRESS, tp1Hit: true, tp1HitAt: '2026-10-18T01:59:00.000Z' },
      })
    );
    // TP1 остаётся отмеченной; действующего стопа у закрытой сделки нет.
    expect(after.find((l) => l.id === 'target-1')!.title).toContain('TP1 ✓');
    expect(after.find((l) => l.id === 'current-stop')).toBe(undefined);
    // TP2 не достигнута — без отметки.
    expect(after.find((l) => l.id === 'target-2')!.title).not.toContain('✓');
  });
});
