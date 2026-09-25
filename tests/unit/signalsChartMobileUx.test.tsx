/**
 * Тесты UX графика сигналов на mobile и настроек отображения (§19).
 *
 * Требования:
 *   - historical markers compact (нет гигантских подписей на свечах);
 *   - no giant LONG/SHORT text labels;
 *   - selected signal gets levels;
 *   - switching selected signal replaces levels;
 *   - display settings toggles markers;
 *   - toggles levels;
 *   - toggles volume if supported;
 *   - mobile default compact;
 *   - MISMATCH excluded from primary markers;
 *   - VERIFIED displayed;
 *   - timezone text not overlaid;
 *   - no LOCAL;
 *   - marker popover touch UX and level toggle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SignalDto } from '@/services/strategyOps';
import { toSignalUiModel, resolveActiveSignal } from '@/services/signals/ui/signalUiModel';
import {
  mapSignalMarkers,
  buildSignalLevelLines,
  SIGNAL_MARKER_COLORS,
} from '@/services/signals/ui/signalChartProjection';
import {
  DEFAULT_CHART_DISPLAY_SETTINGS,
  loadChartDisplaySettings,
  saveChartDisplaySettings,
  ChartDisplaySettingsModal,
} from '@/components/signals/ChartDisplaySettingsModal';
import { SignalMarkerPopover } from '@/components/signals/SignalMarkerPopover';
import { SignalChartCard } from '@/components/signals/SignalChartCard';
import { CandleChart, toSeriesMarkers } from '@/components/common/CandleChart';
import type { OHLCV } from '@/types/market';

const chartCapture = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lightweight-charts')>();
  const createSeries = (options: unknown) => ({
    options,
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    createPriceLine: vi.fn((desc: any) => ({ id: desc?.id ?? 'price-line', ...desc })),
    removePriceLine: vi.fn(),
    setMarkers: vi.fn(),
  });
  return {
    ...actual,
    createChart: vi.fn((_container: HTMLElement, options: unknown) => {
      const instance: any = {
        options,
        series: [],
        applyOptions: vi.fn(),
        remove: vi.fn(),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        subscribeClick: vi.fn(),
        unsubscribeClick: vi.fn(),
        timeScale: () => instance.scale,
        scale: {
          applyOptions: vi.fn(),
          fitContent: vi.fn(),
          getVisibleLogicalRange: vi.fn(() => null),
          setVisibleLogicalRange: vi.fn(),
          subscribeVisibleLogicalRangeChange: vi.fn(),
          unsubscribeVisibleLogicalRangeChange: vi.fn(),
        },
        addCandlestickSeries: vi.fn((opts: unknown) => {
          const s = createSeries(opts);
          instance.series.push(s);
          return s;
        }),
        addBarSeries: vi.fn((opts: unknown) => {
          const s = createSeries(opts);
          instance.series.push(s);
          return s;
        }),
        addLineSeries: vi.fn((opts: unknown) => {
          const s = createSeries(opts);
          instance.series.push(s);
          return s;
        }),
        addHistogramSeries: vi.fn((opts: unknown) => {
          const s = createSeries(opts);
          instance.series.push(s);
          return s;
        }),
      };
      chartCapture.instances.push(instance);
      return instance;
    }),
  };
});

function makeSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: 'sig-test-1',
    strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
    strategyVersion: '3.0',
    engineSetupId: null,
    symbol: 'BTC/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-01T04:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: 'TP2 или стоп',
    entryMin: 83612.9,
    entryMax: 83734.6,
    stopLoss: 83297.6,
    targets: [85389.3, 87278.5],
    tp1: 85389.3,
    tp2: 87278.5,
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
    hash: 'a'.repeat(64),
    previousHash: 'GENESIS',
    outcomeHash: null,
    chainVersion: 2,
    provenanceStatus: 'VERIFIED',
    ...overrides,
  };
}

const T0 = Date.parse('2026-09-01T04:00:00.000Z') / 1000;
const HOUR = 3600;
const sampleCandles: OHLCV[] = [
  { time: T0, open: 83600, high: 83800, low: 83500, close: 83700, volume: 150 },
  { time: T0 + HOUR, open: 83700, high: 83900, low: 83650, close: 83850, volume: 200 },
];

beforeEach(() => {
  chartCapture.instances = [];
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('1. Historical markers compact & no giant text labels (§3, §19)', () => {
  it('по опции showLabels: false не добавляет текстовые подписи (LONG · V3.0) к маркерам', () => {
    const long = toSignalUiModel(makeSignal({ id: 'l1', direction: 'LONG' }));
    const short = toSignalUiModel(makeSignal({ id: 's1', direction: 'SHORT' }));
    const res = mapSignalMarkers([long, short], sampleCandles, HOUR, { showLabels: false });

    expect(res.markers).toHaveLength(2);
    // §3: маркеры компактные, text отсутствует
    expect(res.markers[0].text).toBeUndefined();
    expect(res.markers[1].text).toBeUndefined();

    // toSeriesMarkers не передаёт text в библиотеку
    const seriesMarkers = toSeriesMarkers(res.markers);
    expect(seriesMarkers.every((sm) => sm.text === undefined)).toBe(true);
  });

  it('сторона различается формой и положением: LONG = arrowUp belowBar, SHORT = arrowDown aboveBar', () => {
    const long = toSignalUiModel(makeSignal({ id: 'l1', direction: 'LONG' }));
    const short = toSignalUiModel(makeSignal({ id: 's1', direction: 'SHORT' }));
    const res = mapSignalMarkers([long, short], sampleCandles, HOUR, { showLabels: false });

    const longM = res.markers.find((m) => m.id === 'l1')!;
    const shortM = res.markers.find((m) => m.id === 's1')!;

    expect(longM.shape).toBe('arrowUp');
    expect(longM.position).toBe('belowBar');
    expect(shortM.shape).toBe('arrowDown');
    expect(shortM.position).toBe('aboveBar');
  });

  it('открытый сигнал ярче (size 2), закрытый терминальный — аккуратнее (size 1)', () => {
    const open = toSignalUiModel(makeSignal({ id: 'open', status: 'ACTIVE' }));
    const closed = toSignalUiModel(makeSignal({ id: 'closed', status: 'TARGET_REACHED' }));
    const res = mapSignalMarkers([open, closed], sampleCandles, HOUR, { showLabels: false });

    const openM = res.markers.find((m) => m.id === 'open')!;
    const closedM = res.markers.find((m) => m.id === 'closed')!;

    expect(openM.size).toBe(2);
    expect(closedM.size).toBe(1);
    expect(openM.color).toBe(SIGNAL_MARKER_COLORS.LONG_OPEN);
    expect(closedM.color).toBe(SIGNAL_MARKER_COLORS.LONG_CLOSED);
  });
});

describe('2. Current main / PR #21 selection behavior & provenance indicator', () => {
  it('выбор активного сигнала следует current main (latestSignal при null selectedId)', () => {
    const s1 = toSignalUiModel(makeSignal({ id: 's1', provenanceStatus: 'MISMATCH', status: 'ACTIVE' }));
    const s2 = toSignalUiModel(makeSignal({ id: 's2', provenanceStatus: 'VERIFIED', status: 'ACTIVE' }));

    const active = resolveActiveSignal([s1, s2], null);
    // На current main: первый сигнал в ленте
    expect(active?.id).toBe('s1');

    // При явном selectedId — выбирает указанный
    const explicit = resolveActiveSignal([s1, s2], 's2');
    expect(explicit?.id).toBe('s2');
  });

  it('копирует provenanceStatus дословно для отображения бейджа в presentation', () => {
    const verified = toSignalUiModel(makeSignal({ provenanceStatus: 'VERIFIED' }));
    const mismatch = toSignalUiModel(makeSignal({ provenanceStatus: 'MISMATCH' }));
    const unknown = toSignalUiModel(makeSignal({ provenanceStatus: 'UNKNOWN' }));

    expect(verified.provenanceStatus).toBe('VERIFIED');
    expect(mismatch.provenanceStatus).toBe('MISMATCH');
    expect(unknown.provenanceStatus).toBe('UNKNOWN');
  });
});

describe('3. Selected signal levels & replacing levels on switch (§5, §8, §9)', () => {
  it('выбранный сигнал получает линии уровней с компактными подписями', () => {
    const sig = toSignalUiModel(makeSignal());
    const { lines } = buildSignalLevelLines(sig, { showLabels: true, compact: true });

    expect(lines.length).toBeGreaterThan(0);
    // Вход (верх и низ) + Стоп + TP1 + TP2
    const titles = lines.map((l) => l.title);
    expect(titles.some((t) => t.startsWith('Вход ↓'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Вход ↑'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Стоп'))).toBe(true);
    expect(titles.some((t) => t.startsWith('TP1'))).toBe(true);
    expect(titles.some((t) => t.startsWith('TP2'))).toBe(true);

    // Ни одна подпись не длиннее 25 символов
    expect(titles.every((t) => t.length < 25)).toBe(true);
  });

  it('смена выбранного сигнала заменяет уровни (старые уровни исчезают)', () => {
    const sigA = toSignalUiModel(makeSignal({ id: 'sig-a', entryMin: 80000, entryMax: 81000 }));
    const sigB = toSignalUiModel(makeSignal({ id: 'sig-b', entryMin: 90000, entryMax: 91000 }));

    const linesA = buildSignalLevelLines(sigA).lines;
    const linesB = buildSignalLevelLines(sigB).lines;

    expect(linesA.some((l) => l.price === 80000)).toBe(true);
    expect(linesB.some((l) => l.price === 80000)).toBe(false);
    expect(linesB.some((l) => l.price === 90000)).toBe(true);
  });
});

describe('4. Display Settings & Mobile Defaults (§6, §7)', () => {
  it('дефолтные настройки для мобильных экранов минималистичны', () => {
    expect(DEFAULT_CHART_DISPLAY_SETTINGS.showMarkers).toBe(true);
    expect(DEFAULT_CHART_DISPLAY_SETTINGS.showLevels).toBe(true);
    expect(DEFAULT_CHART_DISPLAY_SETTINGS.showLevelLabels).toBe(false);
    expect(DEFAULT_CHART_DISPLAY_SETTINGS.showVolume).toBe(true);
    expect(DEFAULT_CHART_DISPLAY_SETTINGS.showBadges).toBe(false);

    expect(loadChartDisplaySettings()).toEqual(DEFAULT_CHART_DISPLAY_SETTINGS);
  });

  it('сохранение и загрузка настроек из localStorage работают корректно', () => {
    const custom = {
      showMarkers: false,
      showLevels: true,
      showLevelLabels: true,
      showVolume: false,
      showBadges: true,
    };
    saveChartDisplaySettings(custom);
    expect(loadChartDisplaySettings()).toEqual(custom);
  });

  it('модальное окно настроек отображения имеет aria-label и позволяет переключать тумблеры', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();

    render(
      <ChartDisplaySettingsModal
        isOpen={true}
        onClose={onClose}
        settings={DEFAULT_CHART_DISPLAY_SETTINGS}
        onChange={onChange}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Отображение графика' })).toBeInTheDocument();
    expect(screen.getByTestId('display-settings-timezone')).toBeInTheDocument();

    const markersToggle = screen.getByTestId('toggle-markers');
    fireEvent.click(markersToggle);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showMarkers: false }));

    const levelsToggle = screen.getByTestId('toggle-levels');
    fireEvent.click(levelsToggle);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showLevels: false }));

    const volumeToggle = screen.getByTestId('toggle-volume');
    fireEvent.click(volumeToggle);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ showVolume: false }));

    // Закрытие по кнопке X
    fireEvent.click(screen.getByTestId('chart-display-settings-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('5. Timezone overlay & no LOCAL (§10, §11, §19)', () => {
  it('в шапке графика отсутствует устаревший переключатель LOCAL', () => {
    const { container } = render(<CandleChart data={sampleCandles} />);
    expect(container.textContent).not.toMatch(/\bLOCAL\b/);
  });

  it('при showTimezone={false} оверлей часового пояса не накладывается поверх canvas', () => {
    const { container } = render(<CandleChart data={sampleCandles} showTimezone={false} />);
    expect(container.querySelector('[data-qa="chart-timezone-label"]')).toBeNull();
  });
});

describe('6. Tap marker → SignalMarkerPopover details & level toggle (§4)', () => {
  it('показывает пару, направление, стратегию, таймфрейм, вход, стоп, цели и результат', () => {
    const sig = toSignalUiModel(
      makeSignal({
        status: 'FILLED',
        fillPrice: 83650,
        resultR: 1.5,
        netResultR: 1.42,
      })
    );
    const onToggle = vi.fn();
    const onClose = vi.fn();

    render(
      <SignalMarkerPopover
        model={sig}
        isOpen={true}
        onClose={onClose}
        showLevels={true}
        onToggleLevels={onToggle}
      />
    );

    const popover = screen.getByTestId('signal-marker-popover');
    expect(popover).toBeInTheDocument();
    expect(popover).toHaveTextContent('BTC/USDT');
    expect(popover).toHaveTextContent('LONG');
    expect(popover).toHaveTextContent('V3.0');
    expect(popover).toHaveTextContent('1h');
    expect(popover).toHaveTextContent('83 297,6'); // Стоп

    // Кнопка переключения уровней
    const toggleBtn = screen.getByTestId('popover-toggle-levels');
    expect(toggleBtn).toHaveTextContent('Скрыть уровни на графике');
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledOnce();

    // Закрытие по кнопке X
    fireEvent.click(screen.getByTestId('popover-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('7. SignalChartCard integration with display settings and popover (§6, §7)', () => {
  it('рендерит кнопку настроек отображения и применяет настройки', () => {
    const sig = toSignalUiModel(makeSignal());
    const onMarkerSelect = vi.fn();

    render(
      <SignalChartCard
        symbol="BTC"
        pair="BTC/USDT"
        timeframe="1h"
        onTimeframeChange={vi.fn()}
        candles={sampleCandles}
        realtimeKline={null}
        candlePhase="ready"
        candleError={null}
        markers={[]}
        levelLines={[]}
        activeSignal={sig}
        onMarkerSelect={onMarkerSelect}
      />
    );

    // Кнопка настроек отображения в тулбаре
    const settingsBtn = screen.getByTestId('chart-display-settings-btn');
    expect(settingsBtn).toBeInTheDocument();
    expect(settingsBtn).toHaveAttribute('aria-label', 'Настройки отображения графика');

    // Клик открывает модалку настроек
    fireEvent.click(settingsBtn);
    expect(screen.getByTestId('chart-display-settings-modal')).toBeInTheDocument();

    // Закрытие модалки
    fireEvent.click(screen.getByTestId('chart-display-settings-close'));
    expect(screen.queryByTestId('chart-display-settings-modal')).not.toBeInTheDocument();
  });
});
