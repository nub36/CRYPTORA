/**
 * signalChartProjection — маркеры истории и линии уровней выбранного сигнала.
 *
 * Проверяет §7/§8: маркер встаёт только на бар, реально присутствующий в
 * свечах; вне окна — честно уходит в `skipped`. Линии — только для выбранного
 * сигнала. Сторона читается без цвета (форма + позиция + текст).
 */

import { describe, it, expect } from 'vitest';
import type { SignalDto } from '@/services/strategyOps';
import { toSignalUiModel, type SignalUiModel } from '@/services/signals/ui/signalUiModel';
import {
  buildSignalLevelLines,
  mapSignalMarkers,
  pickMarkerAtTime,
  signalTimeSeconds,
  timeframeToSeconds,
  SIGNAL_MARKERS_MAX,
} from '@/services/signals/ui/signalChartProjection';

const HOUR = 3600;

function makeSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: 'sig-1',
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    engineSetupId: 'e',
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-01T04:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: null,
    entryMin: 100,
    entryMax: 102,
    stopLoss: 98,
    targets: [104, 106, 108],
    tp1: 104,
    tp2: 106,
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
    metadata: null,
    hash: 'h',
    previousHash: 'p',
    outcomeHash: null,
    provenanceStatus: 'VERIFIED',
    chainVersion: 2,
    ...overrides,
  };
}

const T0 = Date.parse('2026-09-01T04:00:00.000Z') / 1000;

function candles(times: number[]): Array<{ time: number }> {
  return times.map((time) => ({ time }));
}

describe('timeframeToSeconds', () => {
  it('знает таймфреймы проекта и серверные значения', () => {
    expect(timeframeToSeconds('15m')).toBe(900);
    expect(timeframeToSeconds('1h')).toBe(3600);
    expect(timeframeToSeconds('4h')).toBe(14400);
    expect(timeframeToSeconds('1D')).toBe(86400);
    expect(timeframeToSeconds('1d')).toBe(86400);
    expect(timeframeToSeconds('unknown')).toBe(0);
    expect(timeframeToSeconds(null)).toBe(0);
  });
});

describe('signalTimeSeconds', () => {
  it('ISO → unix-секунды; невалидное время → null', () => {
    expect(signalTimeSeconds('2026-09-01T04:00:00.000Z')).toBe(T0);
    expect(signalTimeSeconds('not-a-date')).toBeNull();
    expect(signalTimeSeconds(null)).toBeNull();
  });
});

describe('mapSignalMarkers', () => {
  it('маркер прикрепляется только к реальному бару', () => {
    const model = toSignalUiModel(makeSignal());
    const onBar = mapSignalMarkers([model], candles([T0, T0 + HOUR]), HOUR);
    expect(onBar.markers).toHaveLength(1);
    expect(onBar.skipped).toBe(0);

    const offBar = mapSignalMarkers([model], candles([T0 + HOUR, T0 + 2 * HOUR]), HOUR);
    expect(offBar.markers).toHaveLength(0);
    expect(offBar.skipped).toBe(1);
  });

  it('сторона различается без цвета: форма, позиция и текст', () => {
    const long = toSignalUiModel(makeSignal({ id: 'l', direction: 'LONG' }));
    const short = toSignalUiModel(makeSignal({ id: 's', direction: 'SHORT', stopLoss: 104 }));
    const res = mapSignalMarkers([long, short], candles([T0]), HOUR);
    const longMarker = res.markers.find((m) => m.id === 'l')!;
    const shortMarker = res.markers.find((m) => m.id === 's')!;
    expect(longMarker.shape).toBe('arrowUp');
    expect(longMarker.position).toBe('belowBar');
    expect(longMarker.text).toContain('LONG');
    expect(shortMarker.shape).toBe('arrowDown');
    expect(shortMarker.position).toBe('aboveBar');
    expect(shortMarker.text).toContain('SHORT');
  });

  it('пустые свечи / нулевой интервал → маркеров нет', () => {
    const model = toSignalUiModel(makeSignal());
    expect(mapSignalMarkers([model], [], HOUR).markers).toHaveLength(0);
    expect(mapSignalMarkers([model], candles([T0]), 0).markers).toHaveLength(0);
  });

  it('выбранный сигнал помечается крупнее и с точкой', () => {
    const a = toSignalUiModel(makeSignal({ id: 'a' }));
    const b = toSignalUiModel(makeSignal({ id: 'b', signalCandleTs: '2026-09-01T05:00:00.000Z' }));
    const res = mapSignalMarkers([a, b], candles([T0, T0 + HOUR]), HOUR, 'b');
    const bMarker = res.markers.find((m) => m.id === 'b')!;
    expect(bMarker.size).toBe(3);
    expect(bMarker.text).toContain('•');
  });

  it('число маркеров ограничено', () => {
    const many: SignalUiModel[] = Array.from({ length: SIGNAL_MARKERS_MAX + 20 }, (_, i) =>
      toSignalUiModel(makeSignal({ id: `s${i}`, signalCandleTs: new Date((T0 + i * HOUR) * 1000).toISOString() }))
    );
    const times = many.map((_, i) => T0 + i * HOUR);
    const res = mapSignalMarkers(many, candles(times), HOUR);
    expect(res.markers.length).toBe(SIGNAL_MARKERS_MAX);
    expect(res.skipped).toBe(20);
  });
});

describe('buildSignalLevelLines', () => {
  it('нет сигнала → нет линий', () => {
    expect(buildSignalLevelLines(null).lines).toHaveLength(0);
  });

  it('линии — только выбранного сигнала, вся лестница целей', () => {
    const model = toSignalUiModel(makeSignal());
    const { lines, skippedLevels } = buildSignalLevelLines(model);
    expect(skippedLevels).toBe(0);
    const kinds = lines.map((l) => l.title);
    // вход (2 границы зоны) + стоп + 3 цели
    expect(lines).toHaveLength(6);
    expect(kinds.some((t) => t.includes('Стоп'))).toBe(true);
    expect(lines.filter((l) => l.title.includes('Цель'))).toHaveLength(3);
  });

  it('эффективные уровни добавляются отдельным набором только по флагу', () => {
    const model = toSignalUiModel(
      makeSignal({ status: 'FILLED', fillPrice: 101, fillStop: 98.5, fillTargets: [104.5] })
    );
    const without = buildSignalLevelLines(model, { showEffective: false });
    const withEff = buildSignalLevelLines(model, { showEffective: true });
    expect(withEff.lines.length).toBeGreaterThan(without.lines.length);
    expect(withEff.lines.some((l) => l.title.includes('Факт входа'))).toBe(true);
  });
});

describe('pickMarkerAtTime', () => {
  it('возвращает маркер на баре; приоритет выбранному и открытому', () => {
    const open = toSignalUiModel(makeSignal({ id: 'open', status: 'FILLED' }));
    const closed = toSignalUiModel(
      makeSignal({ id: 'closed', status: 'TARGET_REACHED', signalCandleTs: '2026-09-01T04:00:00.000Z' })
    );
    const res = mapSignalMarkers([closed, open], candles([T0]), HOUR);
    // оба на одном баре; открытый должен быть выбран раньше закрытого
    const picked = pickMarkerAtTime(res.markers, T0, [closed, open]);
    expect(picked?.payload?.['signalId']).toBe('open');
    expect(pickMarkerAtTime(res.markers, T0 + 9999, [closed, open])).toBeNull();
  });
});
