# MARKET_DATA — Контракты и управление рыночными данными

> **Статус:** Спецификация контрактов, демонстрационного слоя и спотовых адаптеров (Этап 1 & 2)

---

## 1. Контракт провайдера данных (MarketDataProvider)

Архитектурный интерфейс `MarketDataProvider` определяет метод доступа ко всем рыночным структурам данных:

```typescript
export interface MarketDataProvider {
  readonly isDemo: boolean;

  // Обзор рынка
  getMarketOverview(): Promise<MarketOverviewData>;

  // Список активов для таблицы котировок
  getAssets(category?: AssetCategory): Promise<AssetSummary[]>;

  // Детализированные данные одного инструмента
  getAssetDetail(symbol: string): Promise<AssetDetail | null>;

  // Свечные данные для графиков
  getCandles(symbol: string, timeframe: Timeframe): Promise<OHLCV[]>;

  // Деривативный срез
  getFuturesList(): Promise<FuturesAsset[]>;

  // Сводка и поток ликвидаций
  getLiquidations(): Promise<LiquidationData>;

  // Поток аномальных событий радара
  getRadarEvents(): Promise<RadarEvent[]>;

  // Фильтрация скринера
  getScreenerResults(filters: ScreenerFilters): Promise<AssetSummary[]>;
}
```

---

## 2. Канонический реестр активов (Asset Registry — Этап 2)

В Этапе 2 подключается начальный контролируемый universe из **25 криптоактивов**:
`BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `ADA`, `DOGE`, `AVAX`, `LINK`, `DOT`,
`SUI`, `NEAR`, `APT`, `RENDER`, `TAO`, `INJ`, `UNI`, `AAVE`, `OP`, `ARB`,
`TIA`, `FET`, `KAS`, `RUNE`, `SEI`.

Каждый инструмент описан в централизованном реестре:
- Канонический тикер (`symbol`: e.g. `BTC`)
- Наименование (`name`: e.g. `Bitcoin`)
- Сектор (`category`: e.g. `Layer 1`, `DeFi`, `AI`, `Layer 2`)
- Символ биржи Binance (`binanceSymbol`: e.g. `BTCUSDT`)
- Символ биржи KuCoin (`kucoinSymbol`: e.g. `BTC-USDT`)
- Порядковый номер в каноническом рейтинге (`rank`: 1..25)

---

## 3. Происхождение данных (Data Provenance)

Каждая запись, поступающая из внешнего биржевого источника, маркируется метаданными происхождения:

```typescript
export interface DataProvenance {
  exchange: 'binance' | 'kucoin' | 'synthetic-demo';
  market: 'spot' | 'futures';
  symbol: string;
  timestamp: number;
  isFallback?: boolean;
}
```

---

## 4. Архитектура адаптеров и Fallback

1. **Primary Source (Binance):**
   - Browser adapters call the same-origin `/api/market/binance/spot/*` and `/api/market/binance/futures/*` routes; the backend maps a fixed endpoint allowlist to `api.binance.com` / `fapi.binance.com`.
   - The response passes runtime Zod validation in the frontend adapter. The browser never calls Binance REST directly.
2. **Secondary Source / Fallback (KuCoin):**
   - `/api/market/kucoin/spot/*` maps only the approved stats, all-tickers, and candles routes to `api.kucoin.com`; arbitrary hosts and paths are rejected.
   - In case of a Binance/network failure or unavailable pair, KuCoin is tried as a fallback. Successful data gets `isFallback: true` and `exchange: 'kucoin'`.
3. **Transport separation:**
   - Public exchange REST goes through the same-origin HTTP gateway; realtime Binance WebSocket streams remain direct WSS connections. REST CORS changes do not alter WebSocket routing.
4. **Разделение DEMO и LIVE:**
   - Если и первичный, и вторичный источники живых данных недоступны, Live-провайдер возвращает явную ошибку / статус недоступности (`unavailable`).
   - **Строго запрещено** скрывать сетевые сбои подмешиванием демонстрационных цифр под вывеской LIVE.

---

## 5. Source Health (circuit breaker недоступных endpoints, v0.8.45)

Биржевой gateway устраняет browser-to-exchange CORS; при этом upstream-запросы всё ещё могут
отказывать систематически (сеть, WAF/гео-блокировка, rate limit, делистинг инструмента).
Чтобы не повторять запросы к заведомо недоступным endpoints каждым циклом опроса, используется
`SourceHealthTracker`
(`src/services/data/adapters/sourceHealth.ts`):

- Ключ = ресурс + инструмент (`klines?symbol=KASUSDT`), без изменчивых параметров (interval/limit).
- Политики: `network`/`http` — блокировка после 3 подряд неудач на 10 мин (повторный эпизод —
  backoff ×2, кап 1 ч); `invalid_symbol` (HTTP 400/404) — сразу на 6 ч; `rate_limit` (429/418) —
  30 с. Таймауты (AbortError) не учитываются.
- Успешный ответ полностью восстанавливает ключ (half-open). Диагностика — один `console.warn`
  на эпизод (`[CRYPTORA][source] key: причина + срок паузы`).
- Подключение: опциональный параметр `health` адаптеров Binance/KuCoin и `CandleHistoryService`;
  выключен по умолчанию (детерминированность тестов), включён в боевых composition-точках
  (`MarketDataContext`, `CandleHistoryService.getInstance()`).
- **Честность данных (RULES §1) не затрагивается:** трекер ничего не подменяет и не кэширует
  рыночные данные; актив с недоступными источниками честно отсутствует/помечен «нет данных».
  Ошибка запроса — `AdapterSourceBlockedError extends AdapterNetworkError` (для catch-веток это
  обычный сетевой отказ).

### Диагностика запросов KAS со страницы `/coin/BTC`

`KASUSDT` candle-запросы не являются подпиской CoinPage на предыдущую монету: `CandleHistoryService`
обогащает спарклайны для всего канонического каталога, а `LiveSignalEngine` по умолчанию сканирует
общую scan-universe (включая KAS) циклом. KuCoin candle fallback возникает, когда Binance candle-запрос
для этого символа неуспешен. Запрос `market/stats?symbol=KAS-USDT` может исходить из общего
`getAssets()` fallback (если Binance bulk-ответ не получен/не содержит канонический инструмент) либо
из явного запроса деталей KAS; по одному URL без DevTools Initiator нельзя выбрать между этими двумя
инициаторами. Эти общие запросы не привязаны к выбранному BTC и не свидетельствуют о повторном
рендере CoinPage. Маршрутные WS-подписки CoinPage (`ticker`, `trade`, `depth`, `kline`) освобождаются
при смене символа/размонтировании; в частности, ticker/trade теперь используют scoped lease.

---

## 6. LIVE Market Radar — server-owned detector (2026-09-26, branch only)

LIVE Radar market-data collection is **server-owned**. `server/services/radar/binanceRadarTickerStream.js`
holds one dynamic Binance Spot `@ticker` WebSocket for the effective Admin Scan Universe; no browser
exchange connection is required for Radar detection and additional tabs do not multiply that upstream
subscription set.

The source remains factual Binance Spot ticker fields. `shared/radar/anomalyCalculationCore.js` derives
Radar observations deterministically from those fields. The shared core is imported by the backend monitor
and by the retained browser test/debug adapter, so moving runtime ownership did not duplicate or change
anomaly calculations.

### Universe and feed safety

- effective universe = PostgreSQL `scan_universe` `saved ∩ active Binance Spot exchangeInfo`;
- no canonical fallback and no hardcoded instrument count;
- Admin mutation notification plus 30-second server reread safely converges subscriptions;
- removed symbols are unsubscribed and cleared from rolling state; added symbols warm from zero;
- incomplete exchange ticks are discarded rather than filled with local/demo values;
- reconnect uses capped exponential backoff; 30 seconds without ticker data is reported as `stale` and
  triggers recovery.

### Consumer behavior

`GET /api/radar/events` returns persisted server history and `GET /api/radar/status` exposes monitor/feed
state. `LiveMarketDataProvider.getRadarEvents()` uses the server history API in LIVE mode, so Overview
and Radar use the same source. `/radar` polls server facts and labels its telemetry `SERVER`; it neither
acquires Radar WebSocket leases nor resets warm-up on reload.

The browser's ordinary `RealtimeFeedManager` remains for unrelated ticker/trade/depth UI, but it no longer
constructs an authoritative Radar detector. No demo record is substituted on server/feed error.

### Persistence and retention

Migration `012_radar_events.sql` stores server-derived event facts and a unique replay-dedup key.
`RADAR_EVENT_RETENTION_DAYS=30` is an explicit, configurable branch proposal; the monitor performs
bounded expiry cleanup. This storage decision awaits owner review before deployment and does not alter
market-data or anomaly math. See `docs/RADAR.md` for lifecycle, API, warm-up, and acceptance details.
