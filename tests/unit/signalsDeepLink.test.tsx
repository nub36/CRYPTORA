/**
 * SignalsPage: deep-link из продакшн-уведомления.
 *
 * Требование: нажатие на серверное уведомление (`/signals?symbol=RUNE&signal=<server-id>`)
 * открывает ИМЕННО тот сигнал, который отдал сервер, — на том же инструменте и с
 * тем же id. Никакой подстановки «похожего» сигнала, никакой догадки по локальному
 * журналу браузера.
 *
 * Ссылка здесь НЕ собирается руками: её строит тот же код, что и у колокольчика
 * (`buildServerNotification`), из того же `SignalDto`, который отдаёт сервер. Так
 * тест ловит расхождение между «ссылкой уведомления» и «разбором ссылки страницей».
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { OHLCV, Timeframe } from '@/types/market';
import type { SignalDto } from '@/services/strategyOps';
import { SignalsPage } from '@/pages/SignalsPage';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { resetExchangeUniverseForTests } from '@/services/data/registry/exchangeUniverse';
import { resetCoinLogoCacheForTests } from '@/services/data/registry/coinLogoRegistry';
import { buildServerNotification } from '@/services/signals/serverSignalNotifications';

/** Серверный сигнал RUNE — единственный источник и для ленты, и для уведомления. */
function runeSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: '3a7c58d2-9c4e-4f61-8d5a-2b0e7c1f9a44',
    strategyId: 'V3_3_HTF_ZONE_MITIGATION',
    strategyVersion: '3.3',
    engineSetupId: null,
    symbol: 'RUNE/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-24T15:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: 'TP2 или стоп',
    entryMin: 0.6312,
    entryMax: 0.6418,
    stopLoss: 0.6104,
    targets: [0.6552, 0.671],
    tp1: 0.6552,
    tp2: 0.671,
    status: 'ACTIVE',
    createdAt: '2026-09-24T15:01:10.361Z',
    updatedAt: '2026-09-24T15:01:10.361Z',
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

function pageDto(signals: SignalDto[]) {
  return {
    signals,
    count: signals.length,
    total: signals.length,
    limit: 20,
    offset: 0,
    maxLimit: 200,
    ordering: 'created_at_desc',
    appliedFilters: { strategyId: null, status: null, open: null, symbol: 'RUNE/USDT', direction: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    source: 'server',
  };
}

function strategiesDto() {
  return {
    strategies: [],
    source: 'server',
  };
}

function statisticsDto() {
  return {
    period: 'all',
    filters: { strategyId: null, symbol: 'RUNE/USDT' },
    statuses: [],
    openStatuses: [],
    tradeClosedStatuses: [],
    noTradeStatuses: [],
    closedStatuses: [],
    totals: {
      published: 0, waitingEntry: 0, filled: 0, completed: 0, cancelled: 0, expired: 0,
      unresolved: 0, targetReached: 0, invalidated: 0, closed: 0, wins: 0, losses: 0,
      winRatePct: null, avgGrossR: null, avgNetR: null, grossRSum: null, netRSum: null,
      fillRatePct: null, completionRatePct: null,
    },
    byStrategy: [],
    bySymbol: [],
    definitions: { winRatePct: 'x', avgGrossR: 'x', avgNetR: 'x' },
    source: 'server',
  };
}

/**
 * Заглушка сервера. Точечный `GET /api/signals/:id` проверяется ДО списка —
 * иначе он матчился бы общим `/api/signals` и тест не отличил бы догрузку по
 * id от первой страницы ленты.
 */
function stubFetch(page: SignalDto[], byId: { value: SignalDto | null; status?: number }) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (/\/api\/signals\/[^/?]+$/.test(u) && !u.includes('/statistics') && !u.includes('/monitor')) {
      if (byId.value === null) {
        return { ok: false, status: byId.status ?? 404, text: async () => JSON.stringify({ error: 'SIGNAL_NOT_FOUND' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ signal: byId.value, source: 'server' }) };
    }
    if (u.includes('/api/signals/statistics')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(statisticsDto()) };
    }
    if (u.includes('/api/signals/monitor')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            running: true, cycles: 1, inFlight: false, lastTickStartedAt: null,
            lastTickFinishedAt: null, lastTickDurationMs: 50, lastError: null,
            consecutiveFailures: 0, stale: false, lastSummary: null,
          }),
      };
    }
    if (u.includes('/api/strategies')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(strategiesDto()) };
    }
    if (u.includes('/api/signals')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(pageDto(page)) };
    }
    if (u.includes('/api/market/metadata/assets')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ assets: {} }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  });
}

function mockProvider() {
  const getCandles = vi.fn(async (_symbol: string, _timeframe: Timeframe) =>
    Array.from({ length: 30 }, (_, i): OHLCV => ({
      time: Math.floor(Date.UTC(2026, 8, 24, 0, 0, 0) / 1000) + i * 3600,
      open: 0.63 + i / 1000,
      high: 0.64 + i / 1000,
      low: 0.62 + i / 1000,
      close: 0.635 + i / 1000,
      volume: 100,
    }))
  );
  return { getCandles } as unknown as MarketDataProvider & { getCandles: ReturnType<typeof vi.fn> };
}

function renderAt(path: string, provider: MarketDataProvider, fetchImpl: unknown) {
  localStorage.setItem('cryptora_qa_fixture', '1');
  resetExchangeUniverseForTests();
  resetCoinLogoCacheForTests();
  vi.stubGlobal('fetch', fetchImpl);
  return render(
    <MemoryRouter initialEntries={[path]}>
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
  localStorage.clear();
});

describe('SignalsPage: deep-link уведомления колокольчика', () => {
  it('ссылка уведомления открывает ровно свой серверный сигнал (догрузка по id)', async () => {
    const dto = runeSignal();
    // Ссылку строит продакшн-код колокольчика из серверного DTO.
    const notification = buildServerNotification(dto, 'NEW_SIGNAL');
    expect(notification.href).toBe(`/signals?symbol=RUNE&signal=${dto.id}`);

    const provider = mockProvider();
    // Первая страница ленты сигнал НЕ содержит — уведомление старше/глубже.
    const fetchImpl = stubFetch([], { value: dto });
    renderAt(notification.href, provider, fetchImpl);

    await waitFor(() => {
      const card = document.querySelector(`[data-qa="signal-card"][data-signal-id="${dto.id}"]`);
      expect(card).not.toBeNull();
      expect(card!.getAttribute('aria-pressed')).toBe('true');
    });

    // Догрузка шла точечным запросом по id, а не перебором страниц.
    const urls = (fetchImpl.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`/api/signals/${dto.id}`))).toBe(true);

    // Сводка показывает серверные поля того же сигнала.
    const summary = document.querySelector('[data-qa="signals-summary"]')!;
    expect(summary.textContent).toContain('RUNE/USDT');
    expect(summary.textContent).toContain('LONG');
    expect(summary.textContent).toContain('V3.3');

    // Свечи запрошены только для RUNE — BTC в этом сценарии не существует.
    await waitFor(() => expect(provider.getCandles).toHaveBeenCalled());
    expect(new Set(provider.getCandles.mock.calls.map((c) => c[0]))).toEqual(new Set(['RUNE']));
  });

  it('сигнал уже есть на первой странице — лишнего запроса по id нет, выбор сохранён', async () => {
    const dto = runeSignal();
    const notification = buildServerNotification(dto, 'NEW_SIGNAL');
    const provider = mockProvider();
    const fetchImpl = stubFetch([dto], { value: runeSignal({ id: 'should-not-be-fetched' }) });
    renderAt(notification.href, provider, fetchImpl);

    await waitFor(() =>
      expect(document.querySelector(`[data-qa="signal-card"][data-signal-id="${dto.id}"]`)).not.toBeNull()
    );
    await waitFor(() => expect(provider.getCandles).toHaveBeenCalled());

    const urls = (fetchImpl.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`/api/signals/${dto.id}`))).toBe(false);

    const card = document.querySelector(`[data-qa="signal-card"][data-signal-id="${dto.id}"]`)!;
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });

  it('без `?signal=` страница не делает точечных запросов по id', async () => {
    const dto = runeSignal();
    const provider = mockProvider();
    const fetchImpl = stubFetch([dto], { value: dto });
    renderAt('/signals?symbol=RUNE', provider, fetchImpl);

    await waitFor(() => expect(document.querySelector('[data-qa="signals-summary"]')).not.toBeNull());
    await waitFor(() => expect(document.querySelectorAll('[data-qa="signal-card"]').length).toBe(1));

    const urls = (fetchImpl.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`/api/signals/${dto.id}`))).toBe(false);

    // Показывается лента выбранного инструмента: карточка — серверная строка,
    // подставленных «сигналов» нет.
    const cards = document.querySelectorAll('[data-qa="signal-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0]!.getAttribute('data-signal-id')).toBe(dto.id);
  });

  it('mismatch deep-link AEVO + RUNE id никогда не проецирует RUNE на AEVO chart', async () => {
    const dto = runeSignal();
    const provider = mockProvider();
    const fetchImpl = stubFetch([], { value: dto });
    renderAt(`/signals?symbol=AEVO&signal=${dto.id}`, provider, fetchImpl);

    await waitFor(() => expect(document.querySelector('[data-qa="signals-deeplink-symbol-mismatch"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="signals-summary"]')).toBeNull();
    const chart = document.querySelector('[data-qa="signals-chart-card"]')!;
    expect(chart.getAttribute('aria-label')).toBe('График AEVO/USDT');
    expect(chart.getAttribute('data-active-signal-symbol')).toBe('');
    expect(chart.getAttribute('data-level-count')).toBe('0');
    await waitFor(() => expect(provider.getCandles).toHaveBeenCalled());
    expect(new Set(provider.getCandles.mock.calls.map((call) => call[0]))).toEqual(new Set(['AEVO']));
  });

  it('ссылка с неизвестным серверу id — честная ошибка, а не чужой сигнал', async () => {
    const dto = runeSignal();
    const provider = mockProvider();
    const fetchImpl = stubFetch([], { value: null, status: 404 });
    renderAt(`/signals?symbol=RUNE&signal=${dto.id}`, provider, fetchImpl);

    await waitFor(() => expect(document.querySelector('[data-qa="signals-deeplink-error"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="signals-deeplink-error"]')!.textContent).toContain(
      'локальному событию браузера'
    );
    // Ни один сигнал не выбран и не «придуман».
    expect(document.querySelectorAll('[data-qa="signal-card"][aria-pressed="true"]').length).toBe(0);
  });

  it('карантинный сигнал из ссылки показывается как факт БД с пометкой происхождения', async () => {
    const dto = runeSignal({ provenanceStatus: 'MISMATCH' });
    const provider = mockProvider();
    const fetchImpl = stubFetch([], { value: dto });
    renderAt(`/signals?symbol=RUNE&signal=${dto.id}`, provider, fetchImpl);

    await waitFor(() => expect(document.querySelector('[data-qa="signals-provenance-note"]')).not.toBeNull());
    expect(document.querySelector('[data-qa="signals-provenance-note"]')!.textContent).toContain('MISMATCH');
    const card = document.querySelector(`[data-qa="signal-card"][data-signal-id="${dto.id}"]`);
    expect(card!.getAttribute('aria-pressed')).toBe('true');
  });
});
