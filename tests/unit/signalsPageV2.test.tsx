/**
 * SignalsPage (V2) — интеграция страницы с серверной лентой и графиком.
 *
 * Проверяет требования §14/§18/§5/§9/§16 на уровне компонента:
 *   • мобильная иерархия: селектор монеты → сводка → график → детали → история → аудит;
 *   • свечи запрашиваются ТОЛЬКО для выбранного символа и таймфрейма (нет веера
 *     N×candles по вселенной);
 *   • переключатель таймфрейма графика присутствует и не меняет таймфрейм сигнала;
 *   • пустая лента и ошибка источника — честные состояния без подстановок;
 *   • произвольное число целей (3) отображается всеми строками;
 *   • серверная лента — источник (нет клиентской генерации сигналов).
 *
 * Стратегийная математика не проверяется — только отображение серверных данных.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { OHLCV, Timeframe } from '@/types/market';
import type { SignalDto } from '@/services/strategyOps';
import { SignalsPage } from '@/pages/SignalsPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';

function makeSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: 'sig-btc-1',
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
    metadata: { riskRewardRatio: 1.94 },
    hash: 'a'.repeat(64),
    previousHash: 'GENESIS',
    outcomeHash: null,
    provenanceStatus: 'VERIFIED',
    chainVersion: 2,
    ...overrides,
  };
}

function signalsPageDto(signals: SignalDto[], total = signals.length) {
  return {
    signals,
    count: signals.length,
    total,
    limit: 20,
    offset: 0,
    maxLimit: 200,
    ordering: 'created_at_desc',
    appliedFilters: { strategyId: null, status: null, open: null, symbol: 'BTC/USDT', direction: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    source: 'server',
  };
}

function candle(symbol: string, i: number): OHLCV {
  const base = symbol === 'BTC' ? 115000 : 150;
  return {
    time: Math.floor(Date.UTC(2026, 8, 1, 0, 0, 0) / 1000) + i * 3600,
    open: base + i,
    high: base + i + 2,
    low: base + i - 1,
    close: base + i + 1,
    volume: 1000 + i,
  };
}

/**
 * Заглушка сервера для `/signals`. Кроме ленты сигналов закрывает три
 * эндпоинта, которые страница опрашивает отдельно: состояние стратегий
 * (`/api/strategies` — честный статус сканирования), телеметрию монитора
 * (`/api/signals/monitor`) и серверную статистику
 * (`/api/signals/statistics`). Без них тест проверял бы поведение на
 * сломанном контракте, а не на поведении продукта.
 */
function strategiesDto(enabled: boolean) {
  return {
    strategies: [
      {
        strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
        version: '3.0',
        name: 'HTF Liquidation Trap',
        nameRu: 'HTF Liquidation Trap',
        timeframes: ['4h', '1h'],
        execTimeframe: '1h',
        contextTimeframes: ['4h'],
        badge: 'V3.0',
        enabled,
        status: enabled ? 'ON' : 'OFF',
        scanIntervalSeconds: 60,
        symbols: null,
        lastScanAt: null,
        lastSignalAt: null,
        lastError: null,
        updatedAt: null,
        activeSignalCount: 0,
      },
    ],
    source: 'server',
  };
}

function statisticsDto(signals: SignalDto[]) {
  const withOutcome = signals.filter((s) => ['TARGET_REACHED', 'INVALIDATED', 'CLOSED'].includes(s.status));
  return {
    period: 'all',
    filters: { strategyId: null, symbol: 'BTC/USDT' },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    tradeClosedStatuses: ['TARGET_REACHED', 'INVALIDATED', 'CLOSED'],
    noTradeStatuses: ['EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    closedStatuses: ['TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    totals: {
      published: signals.length,
      waitingEntry: signals.filter((s) => s.status === 'ACTIVE').length,
      filled: signals.filter((s) => s.status === 'FILLED').length,
      completed: withOutcome.length,
      cancelled: 0,
      expired: 0,
      unresolved: 0,
      targetReached: withOutcome.filter((s) => s.status === 'TARGET_REACHED').length,
      invalidated: withOutcome.filter((s) => s.status === 'INVALIDATED').length,
      closed: withOutcome.filter((s) => s.status === 'CLOSED').length,
      wins: withOutcome.filter((s) => (s.resultR ?? 0) > 0).length,
      losses: withOutcome.filter((s) => (s.resultR ?? 0) <= 0).length,
      winRatePct: withOutcome.length > 0
        ? Math.round((withOutcome.filter((s) => (s.resultR ?? 0) > 0).length / withOutcome.length) * 1000) / 10
        : null,
      avgGrossR: null,
      avgNetR: null,
      grossRSum: null,
      netRSum: null,
      fillRatePct: null,
      completionRatePct: null,
    },
    byStrategy: [],
    bySymbol: [],
    definitions: { winRatePct: 'x', avgGrossR: 'x', avgNetR: 'x' },
    source: 'server',
  };
}

function stubSignalsFetch(
  signals: SignalDto[],
  opts: { fail?: boolean; strategiesEnabled?: boolean; strategiesFail?: boolean } = {}
) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/signals/statistics')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(statisticsDto(signals)) };
    }
    if (u.includes('/api/signals/monitor')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            running: true,
            cycles: 3,
            inFlight: false,
            lastTickStartedAt: null,
            lastTickFinishedAt: null,
            lastTickDurationMs: 120,
            lastError: null,
            consecutiveFailures: 0,
            stale: false,
            lastSummary: null,
          }),
      };
    }
    if (u.includes('/api/strategies')) {
      if (opts.strategiesFail) {
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'DB_UNAVAILABLE' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(strategiesDto(opts.strategiesEnabled ?? true)) };
    }
    if (u.includes('/api/signals')) {
      if (opts.fail) {
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'DB_UNAVAILABLE' }) };
      }
      const requestUrl = new URL(u, 'http://localhost');
      const open = requestUrl.searchParams.get('open');
      const requestedSymbol = requestUrl.searchParams.get('symbol')?.split('/')[0]?.toUpperCase() ?? null;
      const bySymbol = requestedSymbol
        ? signals.filter((signal) => signal.symbol.split('/')[0]!.toUpperCase() === requestedSymbol)
        : signals;
      const filtered = open === 'true'
        ? bySymbol.filter((signal) => signal.status === 'ACTIVE' || signal.status === 'FILLED')
        : open === 'false'
          ? bySymbol.filter((signal) => signal.status !== 'ACTIVE' && signal.status !== 'FILLED')
          : bySymbol;
      return { ok: true, status: 200, text: async () => JSON.stringify(signalsPageDto(filtered)) };
    }
    if (u.includes('/api/market/universe/spot')) {
      const symbols = ['BTC', 'DOT', 'AEVO', 'ETH', 'SOL'].map((symbol) => ({
        symbol,
        exchangeSymbol: `${symbol}USDT`,
        quoteAsset: 'USDT',
      }));
      const body = { count: symbols.length, symbols, fetchedAt: '2026-09-26T00:00:00.000Z', stale: false };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    }
    if (u.includes('/api/market/metadata/assets')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ assets: {} }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  });
}

function mockProvider(): MarketDataProvider & { getCandles: ReturnType<typeof vi.fn> } {
  const getCandles = vi.fn(async (symbol: string, _timeframe: Timeframe) =>
    Array.from({ length: 40 }, (_, i) => candle(symbol, i))
  );
  return { getCandles } as unknown as MarketDataProvider & { getCandles: ReturnType<typeof vi.fn> };
}

async function pickAsset(symbol: string): Promise<void> {
  fireEvent.click(document.querySelector('[data-qa="signals-coin-picker-open"]')!);
  const option = await waitFor(() => {
    const element = document.querySelector(`[data-qa="symbol-picker-option-${symbol}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
  fireEvent.click(option);
}

function renderSignals(provider: MarketDataProvider, fetchImpl: unknown) {
  localStorage.setItem('cryptora_qa_fixture', '1');
  resetExchangeUniverseForTests();
  resetCoinLogoCacheForTests();
  vi.stubGlobal('fetch', fetchImpl);
  return render(
    <MemoryRouter initialEntries={['/signals']}>
      <ThemeProvider>
        <MarketDataProviderComponent customProvider={provider}>
          <Routes>
            <Route path="/signals" element={<SignalsPage />} />
          </Routes>
        </MarketDataProviderComponent>
      </ThemeProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SignalsPage V2: иерархия и источник данных', () => {
  it('рендерит селектор монеты, сводку, график, детали, историю и аудит', async () => {
    const provider = mockProvider();
    renderSignals(provider, stubSignalsFetch([makeSignal()]));

    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="signals-coin-selector"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-chart-card"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-disclosures"]')).not.toBeNull();
    expect(document.querySelector('[data-qa="signals-compact-inspector"]')).toBeNull();
    expect(document.querySelector('[data-qa="signals-audit-section"]')).not.toBeNull();

    // Сводка показывает серверные данные человеческим языком.
    const summary = document.querySelector('[data-qa="signals-summary"]')!;
    expect(summary.textContent).toContain('BTC/USDT');
    expect(summary.textContent).toContain('LONG');
    expect(summary.textContent).toContain('V3.0');
  });

  it('свечи запрашиваются только для выбранного символа — нет веера по вселенной', async () => {
    const provider = mockProvider();
    renderSignals(provider, stubSignalsFetch([makeSignal()]));

    await waitFor(() => expect(provider.getCandles).toHaveBeenCalled());
    // Ровно один запрос свечей — для выбранного BTC, никакого map(universe).
    await waitFor(() => expect(provider.getCandles).toHaveBeenCalledTimes(1));
    expect(provider.getCandles).toHaveBeenCalledWith('BTC', '1h', 500);
    const calledSymbols = provider.getCandles.mock.calls.map((c) => c[0]);
    expect(new Set(calledSymbols)).toEqual(new Set(['BTC']));
  });

  it('переключение таймфрейма графика перезапрашивает свечи того же символа', async () => {
    const provider = mockProvider();
    renderSignals(provider, stubSignalsFetch([makeSignal()]));
    await waitFor(() => expect(provider.getCandles).toHaveBeenCalledTimes(1));

    const btn4h = document.querySelector('[data-qa="signals-chart-tf-4h"]') as HTMLButtonElement;
    expect(btn4h).not.toBeNull();
    await act(async () => {
      fireEvent.click(btn4h);
    });
    await waitFor(() => expect(provider.getCandles).toHaveBeenCalledTimes(2));
    expect(provider.getCandles).toHaveBeenLastCalledWith('BTC', '4h', 500);
    // По-прежнему только один символ — веера нет.
    expect(new Set(provider.getCandles.mock.calls.map((c) => c[0]))).toEqual(new Set(['BTC']));
  });

  it('три цели отображаются всеми строками (Цель 1/2/3)', async () => {
    const provider = mockProvider();
    renderSignals(provider, stubSignalsFetch([makeSignal()]));
    await waitFor(() => expect(document.querySelector('[data-qa="signals-disclosure-levels"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-qa="signals-disclosure-levels"]')!);
    await waitFor(() => expect(document.querySelector('[data-qa="signals-level-list"]')).not.toBeNull());
    const list = document.querySelector('[data-qa="signals-level-list"]')!;
    const targetRows = list.querySelectorAll('[data-kind="target"]');
    expect(targetRows.length).toBe(3);
    expect(within(list as HTMLElement).getByText('Цель 1')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Цель 3')).toBeInTheDocument();
  });

  it('V2.8 показывает таймфрейм 1h, а не 15m', async () => {
    const provider = mockProvider();
    const v28 = makeSignal({
      id: 'sig-v28',
      strategyId: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
      strategyVersion: '2.8',
      timeframe: '1h',
    });
    renderSignals(provider, stubSignalsFetch([v28]));
    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')).not.toBeNull());
    const summary = document.querySelector('[data-qa="signals-summary"]')!;
    expect(summary.textContent).toContain('V2.8');
    expect(summary.textContent).toContain('1h');
    expect(summary.textContent).not.toContain('15m');
  });

  it('лента актуальных сигналов показывает только ACTIVE/FILLED, а терминальные записи остаются в истории', async () => {
    const provider = mockProvider();
    const fixtures: SignalDto[] = [
      makeSignal({ id: 'active-id', status: 'ACTIVE' }),
      makeSignal({ id: 'filled-id', symbol: 'ETH/USDT', status: 'FILLED', fillPrice: 3200 }),
      makeSignal({ id: 'target-id', status: 'TARGET_REACHED' }),
      makeSignal({ id: 'invalid-id', status: 'INVALIDATED' }),
      makeSignal({ id: 'closed-id', status: 'CLOSED' }),
      makeSignal({ id: 'expired-id', status: 'EXPIRED' }),
      makeSignal({ id: 'cancelled-id', status: 'CANCELLED' }),
      makeSignal({ id: 'unresolved-id', status: 'UNRESOLVED' }),
    ];
    renderSignals(provider, stubSignalsFetch(fixtures));

    const tape = await waitFor(() => document.querySelector('[data-qa="signals-global-feed"]')!);
    const tapeCards = [...tape.querySelectorAll('[data-qa="signal-card"]')];
    expect(tapeCards.map((card) => card.getAttribute('data-status'))).toEqual(['ACTIVE', 'FILLED']);
    for (const status of ['TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED']) {
      expect(tape.querySelector(`[data-status="${status}"]`)).toBeNull();
    }

    fireEvent.click(tape.querySelector('[data-signal-id="filled-id"]')!);
    await waitFor(() => expect(document.querySelector('[data-qa="signals-chart-card"]')?.getAttribute('aria-label')).toBe('График ETH/USDT'));
    expect(document.querySelector('[data-qa="signals-summary"]')?.getAttribute('data-signal-id')).toBe('filled-id');

    // Return workspace to BTC before checking its terminal history fixture.
    fireEvent.click(tape.querySelector('[data-signal-id="active-id"]')!);
    await waitFor(() => expect(document.querySelector('[data-qa="signals-chart-card"]')?.getAttribute('aria-label')).toBe('График BTC/USDT'));
    fireEvent.click(document.querySelector('[data-qa="signals-disclosure-history"]')!);
    const history = await waitFor(() => {
      const element = document.querySelector('[data-qa="signals-asset-history"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(history.querySelector('[data-status="TARGET_REACHED"]')).not.toBeNull();
    expect(history.querySelector('[data-status="INVALIDATED"]')).not.toBeNull();
  });

  it('DOT → AEVO без сигналов очищает summary и уровни, не используя первый глобальный DOT', async () => {
    const provider = mockProvider();
    const dot = makeSignal({ id: 'dot-open', symbol: 'DOT/USDT', entryMin: 1.01, entryMax: 1.02, stopLoss: 0.95, targets: [1.1] });
    renderSignals(provider, stubSignalsFetch([dot]));

    const dotRow = await waitFor(() => {
      const element = document.querySelector('[data-signal-id="dot-open"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    fireEvent.click(dotRow);
    await waitFor(() => expect(document.querySelector('[data-qa="signals-chart-card"]')?.getAttribute('aria-label')).toBe('График DOT/USDT'));
    expect(document.querySelector('[data-qa="signals-summary"]')?.getAttribute('data-signal-id')).toBe('dot-open');

    await pickAsset('AEVO');
    await waitFor(() => expect(document.querySelector('[data-qa="signals-chart-card"]')?.getAttribute('aria-label')).toBe('График AEVO/USDT'));
    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')).toBeNull());
    const chart = document.querySelector('[data-qa="signals-chart-card"]')!;
    expect(chart.getAttribute('data-active-signal-id')).toBe('');
    expect(chart.getAttribute('data-active-signal-symbol')).toBe('');
    expect(chart.getAttribute('data-level-count')).toBe('0');
    expect(provider.getCandles).toHaveBeenLastCalledWith('AEVO', '1h', 500);
    // The global tape remains global and still contains DOT, but it is not the workspace selection.
    expect(document.querySelector('[data-qa="signals-global-feed"] [data-signal-id="dot-open"]')).not.toBeNull();
  });

  it('DOT → ETH selects the first ETH server signal and projects no DOT levels', async () => {
    const provider = mockProvider();
    const dot = makeSignal({ id: 'dot-open', symbol: 'DOT/USDT', entryMin: 1, entryMax: 1.1, stopLoss: 0.9, targets: [1.2] });
    const eth = makeSignal({ id: 'eth-open', symbol: 'ETH/USDT', entryMin: 3200, entryMax: 3210, stopLoss: 3100, targets: [3400] });
    renderSignals(provider, stubSignalsFetch([dot, eth]));

    fireEvent.click(await waitFor(() => {
      const element = document.querySelector('[data-signal-id="dot-open"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    }));
    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')?.getAttribute('data-signal-id')).toBe('dot-open'));
    await pickAsset('ETH');

    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')?.getAttribute('data-signal-id')).toBe('eth-open'));
    const chart = document.querySelector('[data-qa="signals-chart-card"]')!;
    expect(chart.getAttribute('aria-label')).toBe('График ETH/USDT');
    expect(chart.getAttribute('data-active-signal-symbol')).toBe('ETH');
    expect(Number(chart.getAttribute('data-level-count'))).toBeGreaterThan(0);
    expect(document.querySelector('[data-qa="signals-summary"]')?.textContent).not.toContain('DOT/USDT');
  });

  it('быстрая гонка DOT → AEVO → SOL → AEVO заканчивается только AEVO selection', async () => {
    const provider = mockProvider();
    const fixtures = [
      makeSignal({ id: 'dot-race', symbol: 'DOT/USDT' }),
      makeSignal({ id: 'aevo-race', symbol: 'AEVO/USDT', entryMin: 0.026, entryMax: 0.027, stopLoss: 0.024, targets: [0.03] }),
      makeSignal({ id: 'sol-race', symbol: 'SOL/USDT' }),
    ];
    const baseFetch = stubSignalsFetch(fixtures);
    const delayedFetch = vi.fn(async (url: string) => {
      const parsed = new URL(String(url), 'http://localhost');
      const symbol = parsed.searchParams.get('symbol')?.split('/')[0];
      if (parsed.pathname === '/api/signals' && parsed.searchParams.get('open') === 'true' && symbol) {
        const delay = symbol === 'AEVO' ? 60 : symbol === 'SOL' ? 30 : 5;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return baseFetch(url);
    });
    renderSignals(provider, delayedFetch);

    await pickAsset('DOT');
    await pickAsset('AEVO');
    await pickAsset('SOL');
    await pickAsset('AEVO');

    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')?.getAttribute('data-signal-id')).toBe('aevo-race'));
    const chart = document.querySelector('[data-qa="signals-chart-card"]')!;
    expect(chart.getAttribute('aria-label')).toBe('График AEVO/USDT');
    expect(chart.getAttribute('data-active-signal-symbol')).toBe('AEVO');
    expect(provider.getCandles).toHaveBeenLastCalledWith('AEVO', '1h', 500);
  });

  it('УРОВНИ / ИСТОРИЯ / СТАТИСТИКА открываются и повторным кликом закрываются', async () => {
    renderSignals(mockProvider(), stubSignalsFetch([makeSignal()]));
    await waitFor(() => expect(document.querySelector('[data-qa="signals-disclosure-levels"]')).not.toBeNull());

    for (const id of ['levels', 'history', 'statistics'] as const) {
      const button = document.querySelector(`[data-qa="signals-disclosure-${id}"]`)!;
      fireEvent.click(button);
      await waitFor(() => expect(document.querySelector('[data-qa="signals-compact-inspector"]')?.getAttribute('data-panel')).toBe(id));
      expect(button.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(button);
      await waitFor(() => expect(document.querySelector('[data-qa="signals-compact-inspector"]')).toBeNull());
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });
});

describe('SignalsPage V2: пустые и ошибочные состояния (§16)', () => {
  it('пустая лента — честное «сигналов нет», график остаётся', async () => {
    const provider = mockProvider();
    renderSignals(provider, stubSignalsFetch([]));
    await waitFor(() => {
      const empty = document.querySelector('[data-qa="signals-empty"]');
      expect(empty).not.toBeNull();
      expect(empty!.getAttribute('data-state')).toBe('empty');
    });
    expect(document.querySelectorAll('[data-qa="signal-card"]').length).toBe(0);
    // График всё равно показывается для выбранной монеты.
    expect(document.querySelector('[data-qa="signals-chart-card"]')).not.toBeNull();
    // BUG B: пустое состояние ОДНО. Дубль внутри сводки удалён — проверяем,
    // что второго блока про «нет сигналов» на экране нет.
    expect(document.querySelectorAll('[data-qa="signals-summary-empty"]').length).toBe(0);
    expect(document.querySelectorAll('[data-qa="signals-empty"]').length).toBe(1);
  });

  it('ошибка источника сигналов — состояние ошибки без подстановок', async () => {
    const provider = mockProvider();
    renderSignals(provider, stubSignalsFetch([], { fail: true }));
    await waitFor(() => {
      const empty = document.querySelector('[data-qa="signals-empty"]');
      expect(empty).not.toBeNull();
      expect(empty!.getAttribute('data-state')).toBe('error');
    });
    expect(document.querySelectorAll('[data-qa="signal-card"]').length).toBe(0);
    expect(document.body.textContent).toContain('Источник сигналов недоступен');
  });
});
