/**
 * signalUiModel — отображение серверного `SignalDto` в модель UI.
 *
 * Покрывает требования §22: произвольная длина `targets[]`, статусы (включая
 * неизвестный серверу), таймфрейм исполнения (V2.8 = '1h', не «15m»), пустое
 * состояние, выбор активного сигнала, эффективные уровни после исполнения.
 *
 * Стратегийная математика НЕ пересчитывается: тесты проверяют только то, что
 * значения переносятся из DTO как есть (никаких округлений и досчётов).
 */

import { describe, it, expect } from 'vitest';
import type { SignalDto } from '@/services/strategyOps';
import {
  buildLevelRows,
  buildEffectiveLevelRows,
  latestSignal,
  resolveActiveSignal,
  resolveTargetPrices,
  toSignalUiModel,
  toSignalUiModels,
} from '@/services/signals/ui/signalUiModel';
import { serverStatusLabel, timeframeText } from '@/utils/serverSignalText';

function makeSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: 'sig-1',
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    engineSetupId: 'engine-1',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-01T04:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: 'TP2 или стоп',
    entryMin: 115200.5,
    entryMax: 115480.25,
    stopLoss: 114310.75,
    targets: [116900.5, 118400.25, 121050],
    tp1: 116900.5,
    tp2: 118400.25,
    status: 'ACTIVE',
    createdAt: '2026-09-01T04:05:00.000Z',
    updatedAt: '2026-09-01T04:05:00.000Z',
    fillPrice: null,
    filledAt: null,
    fillStop: null,
    fillTargets: null,
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    metadata: {
      engineVersion: 'v2',
      riskRewardRatio: 1.94,
      confirmingFactors: ['фактор 1'],
      invalidationFactors: ['риск 1'],
      latencyBars: 1,
      publishedAt: '2026-09-01T04:05:00.000Z',
    },
    hash: 'a'.repeat(64),
    previousHash: 'GENESIS',
    outcomeHash: null,
    provenanceStatus: 'VERIFIED',
    chainVersion: 2,
    ...overrides,
  };
}

describe('signalUiModel: перенос значений без пересчёта', () => {
  it('переносит уровни как они сохранены сервером', () => {
    const m = toSignalUiModel(makeSignal());
    expect(m.pair).toBe('BTC/USDT');
    expect(m.baseSymbol).toBe('BTC');
    expect(m.direction).toBe('LONG');
    expect(m.entry.min).toBe(115200.5);
    expect(m.entry.max).toBe(115480.25);
    expect(m.stop.price).toBe(114310.75);
    expect(m.targets.map((t) => t.price)).toEqual([116900.5, 118400.25, 121050]);
    expect(m.integrity.chainVersion).toBe(2);
  });

  it('произвольная длина targets: 0, 1, 3, 5', () => {
    expect(resolveTargetPrices(makeSignal({ targets: [] }))).toEqual([]);
    expect(toSignalUiModel(makeSignal({ targets: [] })).hasTargets).toBe(false);

    expect(resolveTargetPrices(makeSignal({ targets: [100] }))).toEqual([100]);

    const three = resolveTargetPrices(makeSignal({ targets: [100, 110, 120] }));
    expect(three).toEqual([100, 110, 120]);

    const five = resolveTargetPrices(makeSignal({ targets: [1, 2, 3, 4, 5] }));
    expect(five).toEqual([1, 2, 3, 4, 5]);
    const fiveModel = toSignalUiModel(makeSignal({ targets: [1, 2, 3, 4, 5] }));
    expect(fiveModel.targets.map((t) => t.label)).toEqual([
      'Цель 1', 'Цель 2', 'Цель 3', 'Цель 4', 'Цель 5',
    ]);
  });

  it('цели рисуются всеми строками, включая третью и далее', () => {
    const rows = buildLevelRows(makeSignal({ targets: [100, 110, 120] }));
    const targetRows = rows.filter((r) => r.kind === 'target');
    expect(targetRows.map((r) => r.price)).toEqual([100, 110, 120]);
    expect(targetRows.map((r) => r.label)).toEqual(['Цель 1', 'Цель 2', 'Цель 3']);
  });

  it('legacy tp1/tp2 используются только когда сервер не отдал массив', () => {
    // Строка формы миграции 007: targets === null, есть только tp1/tp2.
    const legacy = makeSignal({ targets: null, tp1: 200, tp2: 210 });
    expect(resolveTargetPrices(legacy)).toEqual([200, 210]);
    // Массив всегда в приоритете над наследием.
    const withArray = makeSignal({ targets: [300], tp1: 200, tp2: 210 });
    expect(resolveTargetPrices(withArray)).toEqual([300]);
  });

  it('эффективные уровни существуют только если сервер их отдал', () => {
    expect(buildEffectiveLevelRows(makeSignal())).toEqual([]);
    const filled = makeSignal({
      status: 'FILLED',
      fillPrice: 115260.25,
      filledAt: '2026-09-01T05:00:00.000Z',
      fillStop: 114350,
      fillTargets: [116950, 118450],
    });
    const eff = buildEffectiveLevelRows(filled);
    expect(eff.map((r) => r.price)).toEqual([115260.25, 114350, 116950, 118450]);
    expect(eff.every((r) => r.effective)).toBe(true);
  });
});

describe('signalUiModel: статусы', () => {
  it('известные статусы отображаются человеческим языком', () => {
    expect(serverStatusLabel('ACTIVE')).toBe('ОЖИДАЕТ ВХОДА');
    expect(serverStatusLabel('FILLED')).toBe('В ПОЗИЦИИ');
    expect(serverStatusLabel('TARGET_REACHED')).toBe('ЦЕЛЬ ДОСТИГНУТА');
    expect(serverStatusLabel('INVALIDATED')).toBe('СТОП СРАБОТАЛ');
    expect(serverStatusLabel('CLOSED')).toBe('ЗАКРЫТ ПО ПРАВИЛУ СТРАТЕГИИ');
    expect(serverStatusLabel('EXPIRED')).toBe('СРОК ВХОДА ИСТЁК');
    expect(serverStatusLabel('CANCELLED')).toBe('ОТМЕНЁН ДО ВХОДА');
    expect(serverStatusLabel('UNRESOLVED')).toBe('ИСХОД НЕ ОТСЛЕЖЕН');
  });

  it('неизвестный серверу статус не подменяется нейтральным словом', () => {
    expect(serverStatusLabel('MYSTERY')).toBe('MYSTERY (неизвестное состояние)');
    const m = toSignalUiModel(makeSignal({ status: 'MYSTERY' as SignalDto['status'] }));
    expect(m.statusKnown).toBe(false);
    expect(m.statusLabel).toContain('неизвестное состояние');
  });

  it('R показывается только у состояний со сделкой, иначе «сделки не было»', () => {
    const noTrade = toSignalUiModel(makeSignal({ status: 'EXPIRED', resultR: null, netResultR: null }));
    expect(noTrade.hasTrade).toBe(false);
    expect(noTrade.outcome.gross).toBe('сделки не было');
    expect(noTrade.outcome.net).toBe('сделки не было');

    const closed = toSignalUiModel(
      makeSignal({ status: 'TARGET_REACHED', resultR: 1.94, netResultR: 1.9 })
    );
    expect(closed.hasTrade).toBe(true);
    expect(closed.outcome.gross).toBe('+1.94 R');
    expect(closed.outcome.net).toBe('+1.90 R');
  });
});

describe('signalUiModel: таймфрейм исполнения', () => {
  it('V2.8 отображает 1h, а не ложную 15m', () => {
    const m = toSignalUiModel(
      makeSignal({ strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING', strategyVersion: '2.8', timeframe: '1h' })
    );
    expect(m.timeframe).toBe('1h');
    expect(m.timeframe).not.toBe('15m');
    expect(m.strategyShort).toBe('V2.8');
    expect(m.strategyText).toContain('V2.8');
  });

  it('timeframeText возвращает фактическое значение сервера', () => {
    expect(timeframeText('1h')).toBe('1h');
    expect(timeframeText('4h')).toBe('4h');
    expect(timeframeText(null)).toBe('—');
  });
});

describe('signalUiModel: выбор сигнала', () => {
  it('пустая лента → последнего сигнала нет', () => {
    expect(latestSignal([])).toBeNull();
    expect(resolveActiveSignal([], null)).toBeNull();
  });

  it('без явного выбора активен последний (порядок сервера не пересортировывается)', () => {
    const models = toSignalUiModels([makeSignal({ id: 'new' }), makeSignal({ id: 'old' })]);
    expect(latestSignal(models)?.id).toBe('new');
    expect(resolveActiveSignal(models, null)?.id).toBe('new');
  });

  it('явный выбор из истории переключает активный сигнал', () => {
    const models = toSignalUiModels([makeSignal({ id: 'new' }), makeSignal({ id: 'old' })]);
    expect(resolveActiveSignal(models, 'old')?.id).toBe('old');
  });

  it('выбранный id, которого нет в ленте, откатывается к последнему', () => {
    const models = toSignalUiModels([makeSignal({ id: 'new' })]);
    expect(resolveActiveSignal(models, 'gone')?.id).toBe('new');
  });
});
