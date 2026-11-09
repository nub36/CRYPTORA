/**
 * Фабрики тестовых данных. Значения нарочно «неудобные» (не круглые), чтобы
 * тесты ловили подстановку/округление на клиенте.
 */
import type { ApiClient, ListParams } from '../../src/api/client';
import { ApiError } from '../../src/api/client';
import type { MetaResponse, SignalView, SignalsListResponse } from '../../src/api/types';

export function makeSignal(overrides: Partial<SignalView> = {}): SignalView {
  const base: SignalView = {
    id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY-BTCUSDT-1760000000000',
    strategy: {
      id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      version: '3.4',
      name: 'HTF zone mitigation + quality gates',
    },
    symbol: 'BTC/USDT',
    exchangeSymbol: 'BTCUSDT',
    direction: 'LONG',
    timeframe: '1h',
    setupAt: '2026-10-05T09:00:00.000Z',
    publishedAt: '2026-10-05T10:00:07.000Z',
    entryZone: { low: 61300.17, high: 61988.43 },
    entry: { price: 61300.17, at: '2026-10-05T11:02:00.000Z' },
    initialStopLoss: 60901.53,
    targets: [
      { level: 1, price: 62450.21 },
      { level: 2, price: 63980.09 },
    ],
    status: 'FILLED',
    statusAt: '2026-10-05T11:02:00.000Z',
    closedAt: null,
    outcome: null,
    progress: {
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
    },
    events: [
      { type: 'NEW_SIGNAL', occurredAt: '2026-10-05T10:00:07.000Z' },
      { type: 'FILL', occurredAt: '2026-10-05T11:02:00.000Z' },
    ],
    dataSource: { exchange: 'Binance', isFallback: false },
    stale: false,
    staleReason: null,
    asOf: '2026-10-05T12:00:00.000Z',
  };
  return {
    ...base,
    ...overrides,
    progress: { ...base.progress, ...(overrides.progress ?? {}) },
  };
}

export function makeList(items: SignalView[], overrides: Partial<SignalsListResponse> = {}): SignalsListResponse {
  return {
    items,
    count: items.length,
    total: items.length,
    limit: 50,
    nextCursor: null,
    asOf: '2026-10-05T12:00:00.000Z',
    stale: false,
    staleReason: null,
    ...overrides,
  };
}

export function makeMeta(overrides: Partial<MetaResponse> = {}): MetaResponse {
  return {
    apiVersion: 'v1',
    serverVersion: '0.1.0',
    minAppVersion: '0.1.0',
    serverTime: '2026-10-05T12:00:00.000Z',
    strategy: {
      id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      version: '3.4',
      name: 'HTF zone mitigation + quality gates',
      nameRu: 'Митигация старшей зоны с гейтами качества',
      liveVariant: 'V34_LIVE',
      badge: 'DERIVED_NO_BACKTEST',
      badgeLabel: 'исследование без бэктеста',
      researchNote: 'Производная логика без подтверждённого бэктеста.',
      exitRule: 'TP1 → безубыток; TP2 закрывает остаток.',
      qualityGates: { entryZoneAtrPad: 0.25, tp1MinR: 0.5, tp2MinR: 1 },
      entryZoneHalfWidthAtr: 0.35,
      timeframes: { exec: '1h', context: '4h' },
      warmupBars: 60,
      candleLimits: { '1h': 400, '4h': 400 },
      defaultScanIntervalSeconds: 60,
      description: {
        short: 'Серверный детектор сетапов.',
        entry: 'Лимитный коридор вокруг close.',
        stop: 'Структурный стоп.',
        targets: 'TP1 = середина ноги.',
        riskNote: 'Не инвестиционная рекомендация.',
        limitations: ['Производная без бэктеста.'],
      },
    },
    universe: { symbols: ['BTCUSDT'], defaultSymbols: ['BTCUSDT'], quote: 'USDT' },
    marketData: {
      id: 'binance-spot-public-klines',
      exchange: 'Binance',
      venue: 'spot',
      baseUrl: 'https://api.binance.com',
      readOnly: true,
      apiKeysRequired: false,
      orderPlacement: false,
      feeVenueAssumed: 'BINANCE_USDT_FUTURES',
      requestTimeoutMs: 10000,
    },
    engine: {
      scanIntervalMs: 60000,
      scanStaleAfterMs: 180000,
      maxBarAgeMs: 5400000,
      dataStatus: 'fresh',
      staleReason: null,
      lastScanAt: '2026-10-05T11:59:00.000Z',
      lastSuccessfulScanAt: '2026-10-05T11:59:00.000Z',
      lastScan: {
        startedAt: '2026-10-05T11:59:00.000Z',
        finishedAt: '2026-10-05T11:59:03.000Z',
        status: 'SUCCESS',
        symbolsTotal: 1,
        symbolsOk: 1,
        signalsNew: 0,
        error: null,
      },
      perSymbol: [
        {
          symbol: 'BTCUSDT',
          lastScanAt: '2026-10-05T11:59:00.000Z',
          lastSuccessAt: '2026-10-05T11:59:00.000Z',
          lastBarOpenTime: '2026-10-05T10:00:00.000Z',
          closedBars: { '1h': 400, '4h': 400 },
          gaps1h: 0,
          dataError: null,
          source: { exchange: 'Binance', isFallback: false },
          notes: [],
        },
      ],
    },
    push: { enabled: false, configured: false, missing: ['V34_FCM_SERVICE_ACCOUNT_FILE'], reason: 'push отключён', devices: { enabled: 0, total: 0 } },
    statuses: { all: ['ACTIVE', 'FILLED'], open: ['ACTIVE', 'FILLED'], closed: ['CLOSED'] },
    disclaimer: 'Аналитические сигналы, не инвестиционная рекомендация.',
    ...overrides,
  };
}

export interface FakeApiOptions {
  signals?: SignalView[] | SignalsListResponse | (() => Promise<SignalsListResponse>);
  detail?: SignalView | (() => Promise<SignalView>);
  meta?: MetaResponse;
  registerDevice?: ApiClient['registerDevice'];
}

/** Клиент с записываемыми вызовами — чтобы проверять, что UI просит именно то, что нужно. */
export function makeFakeApi(options: FakeApiOptions = {}) {
  const calls = { list: [] as ListParams[], detail: [] as string[], meta: 0 };
  const api: ApiClient = {
    baseUrl: 'https://signals.test.local',
    async getSignals(params: ListParams = {}) {
      calls.list.push(params);
      const s = options.signals;
      if (typeof s === 'function') return s();
      if (Array.isArray(s)) return makeList(s);
      return s ?? makeList([]);
    },
    async getSignal(id: string) {
      calls.detail.push(id);
      const d = options.detail;
      if (typeof d === 'function') return d();
      if (d) return d;
      throw new ApiError('http', 'сигнал не найден', 404);
    },
    async getMeta() {
      calls.meta += 1;
      return options.meta ?? makeMeta();
    },
    registerDevice: options.registerDevice ?? (async () => ({
      ok: true,
      registered: true,
      pushConfigured: false,
      note: 'push на сервере не настроен',
    })),
  };
  return { api, calls };
}

/** Управляемая ошибка сети для проверки состояний. */
export function failingApi(kind: 'network' | 'timeout' | 'http' = 'network') {
  const message = kind === 'timeout' ? 'сервер не ответил вовремя' : kind === 'http' ? 'сервер вернул HTTP 503' : 'нет связи с сервером сигналов';
  const api: ApiClient = {
    baseUrl: 'https://signals.test.local',
    async getSignals() { throw new ApiError(kind, message, kind === 'http' ? 503 : null); },
    async getSignal() { throw new ApiError(kind, message, kind === 'http' ? 503 : null); },
    async getMeta() { throw new ApiError(kind, message, kind === 'http' ? 503 : null); },
    async registerDevice() { throw new ApiError(kind, message, kind === 'http' ? 503 : null); },
  };
  return { api, message };
}
