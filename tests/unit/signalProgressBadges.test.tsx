/**
 * SignalProgressBadges + SignalDetailsPanel — прогресс на экране (Signals UI V1).
 *
 * Проверяется отображение подтверждённых фактов:
 *
 *   • TP1 → «🎯 TP1 достигнут»; TP2 → «🏆 TP2 достигнут»;
 *   • BE со значением → «🛡️ Стоп в безубытке · <цена>»;
 *     BE без значения (V2.8) → только статус, без выдуманной цены;
 *   • стоп → «🔴 Закрыт по стопу»;
 *   • без флагов бейджей нет (null, а не «нет событий»);
 *   • панель деталей показывает блок действующего стопа и бейджи в обоих
 *     режимах (полном и levelsOnly — это состояние уровней, не исход).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import type { SignalDto, SignalLifecycleProgressDto } from '@/services/strategyOps';
import { toSignalUiModel, type SignalProgressModel } from '@/services/signals/ui/signalUiModel';
import { SignalProgressBadges } from '@/components/signals/SignalProgressBadges';
import { SignalDetailsPanel } from '@/components/signals/SignalDetailsPanel';

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

function progress(overrides: Partial<SignalProgressModel> = {}): SignalProgressModel {
  return { ...NO_PROGRESS, ...overrides };
}

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

const qa = (container: HTMLElement, id: string) => container.querySelector(`[data-qa="${id}"]`);
const text = (container: HTMLElement, id: string) => qa(container, id)?.textContent ?? '';

describe('SignalProgressBadges', () => {
  it('TP1+BE с ценой → оба бейджа, цена действующего стопа видна', () => {
    const { container } = render(
      <SignalProgressBadges
        progress={progress({ tp1Hit: true, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' })}
      />
    );
    expect(text(container, 'signals-progress-tp1')).toContain('🎯 TP1 достигнут');
    expect(text(container, 'signals-progress-be')).toContain('🛡️ Стоп в безубытке');
    expect(text(container, 'signals-progress-be')).toContain('4,857');
    expect(qa(container, 'signals-progress-tp2')).toBe(null);
    expect(qa(container, 'signals-progress-stop')).toBe(null);
  });

  it('BE без значения (V2.8) → только статус, цены нет', () => {
    const { container } = render(<SignalProgressBadges progress={progress({ breakevenArmed: true })} />);
    expect(text(container, 'signals-progress-be')).toBe('🛡️ Стоп в безубытке');
  });

  it('TP2 → «🏆 TP2 достигнут»', () => {
    const { container } = render(
      <SignalProgressBadges progress={progress({ tp1Hit: true, tp2Hit: true })} />
    );
    expect(text(container, 'signals-progress-tp2')).toContain('🏆 TP2 достигнут');
  });

  it('стоп → «🔴 Закрыт по стопу»', () => {
    const { container } = render(<SignalProgressBadges progress={progress({ stopHit: true })} />);
    expect(text(container, 'signals-progress-stop')).toContain('🔴 Закрыт по стопу');
  });

  it('без флагов и без прогресса → ничего (null)', () => {
    const { container: c1 } = render(<SignalProgressBadges progress={progress()} />);
    expect(c1.querySelector('[data-qa="signals-progress-badges"]')).toBe(null);
    const { container: c2 } = render(<SignalProgressBadges progress={null} />);
    expect(c2.querySelector('[data-qa="signals-progress-badges"]')).toBe(null);
    const { container: c3 } = render(<SignalProgressBadges progress={undefined} />);
    expect(c3.querySelector('[data-qa="signals-progress-badges"]')).toBe(null);
  });
});

describe('SignalDetailsPanel — прогресс в деталях', () => {
  it('полный режим: бейджи + блок действующего стопа + история', () => {
    const model = toSignalUiModel(
      makeSignal({
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
    const { container } = render(<SignalDetailsPanel model={model} />);
    expect(text(container, 'signals-progress-tp1')).toContain('TP1 достигнут');
    expect(text(container, 'signals-progress-be')).toContain('Стоп в безубытке');
    // Действующий стоп — отдельным блоком со своей ценой.
    const block = qa(container, 'signals-progress-level-list');
    expect(block?.textContent).toContain('Стоп в безубытке (действующий)');
    expect(block?.textContent).toContain('4,857');
    // Первоначальный стоп — исторической строкой на своей цене.
    expect(text(container, 'signals-level-stop')).toContain('4,7000');
  });

  it('levelsOnly: бейджи и действующий стоп тоже видны (это уровни, не исход)', () => {
    const model = toSignalUiModel(
      makeSignal({
        progress: { ...NO_PROGRESS, tp1Hit: true, breakevenArmed: true, currentStop: 4.857, currentStopBasis: 'BE_AT_ENTRY' },
      })
    );
    const { container } = render(<SignalDetailsPanel model={model} levelsOnly />);
    expect(qa(container, 'signals-progress-badges')).not.toBe(null);
    expect(qa(container, 'signals-progress-level-list')).not.toBe(null);
    // А вот дублирования исхода нет.
    expect(container.querySelector('[data-testid="signals-outcome"]')).toBe(null);
  });

  it('терминальный TP2: бейдж TP2 + статусная метка цели', () => {
    const model = toSignalUiModel(
      makeSignal({
        status: 'TARGET_REACHED',
        closeReason: 'TP2',
        closedAt: '2026-10-18T06:00:00.000Z',
        closePrice: 5.44,
        resultR: 1.5,
        netResultR: 1.42,
        progress: { ...NO_PROGRESS, tp1Hit: true, tp2Hit: true, tp2HitAt: '2026-10-18T06:00:00.000Z' },
      })
    );
    const { container } = render(<SignalDetailsPanel model={model} />);
    expect(text(container, 'signals-progress-tp2')).toContain('🏆 TP2 достигнут');
    // Действующего стопа у закрытой сделки нет.
    expect(qa(container, 'signals-progress-level-list')).toBe(null);
  });

  it('CANCELLED: ни бейджей, ни действующего стопа — неактивный сигнал', () => {
    const model = toSignalUiModel(
      makeSignal({ status: 'CANCELLED', closeReason: 'CANCELLED', fillPrice: null, filledAt: null })
    );
    const { container } = render(<SignalDetailsPanel model={model} />);
    expect(container.querySelector('[data-qa="signals-progress-badges"]')).toBe(null);
    expect(qa(container, 'signals-progress-level-list')).toBe(null);
  });
});
