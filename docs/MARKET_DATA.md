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

## 6. LIVE Market Radar — браузерный детектор и честный прогрев (2026-09-26)

`/radar` остаётся **browser/live** функцией: события создаёт `AnomalyEngine` в памяти браузера из
Binance Spot ticker WS, а `LiveMarketDataProvider.getRadarEvents()` только читает текущий буфер
этого движка. Серверной таблицы Radar и 24/7 фонового процесса пока нет.

### Источник universe

При монтировании LIVE-маршрута Radar читает общий серверный Scan Universe через уже существующий
клиент `src/services/signals/scanUniverse.ts` (`GET /api/strategies/scan-universe`). Это тот же
bounded список `saved ∩ active`, которым пользуется браузерный слой стратегий; Admin Scan Universe
при этом **не изменяется**. Отдельный hardcoded coin-list для Radar запрещён.

### Подписки

Radar теперь владеет собственными маршрутными WS-lease для этой вселенной:

```ts
const release = RealtimeFeedManager.getInstance().subscribeSymbolScoped(symbol);
```

Изменение universe применяется delta-логикой: удалённые символы освобождаются, общие символы
сохраняют lease, новые символы приобретаются. На размонтировании `/radar`, смене режима LIVE → QA
или потере universe освобождаются только Radar-owned leases. Refcount в `RealtimeFeedManager`
сохраняет независимые подписки Coin page, watchlist и alerts; Radar unmount не должен отписывать
чужой BTC/ETH stream. Новый WebSocket-клиент не создаётся — используется существующий Binance
combined-stream transport.

### Warm-up и lifetime

`AnomalyEngine` хранит `volumes[]`, `prices[]`, `ranges[]` по символам в памяти вкладки; размер окна
по умолчанию — 20 наблюдений. После reload/закрытия вкладки истории и буфер событий сбрасываются,
поэтому Radar снова проходит warm-up. UI различает четыре состояния:

- `WARMING` — «Радар набирает окно наблюдений…»;
- `READY`, событий нет — «В текущем LIVE-окне аномалий не обнаружено.»;
- `FILTERED` — события есть, но фильтры их скрыли;
- `SOURCE ERROR` — realtime/source или Scan Universe недоступны.

Телеметрия UI показывает subscribed symbol count, warmed symbols / total, максимум наблюдений / window
и состояние WS. Это read-only статус существующих историй; thresholds, Z-score/velocity/volatility
расчёты, cooldown и severity math не менялись.

### Roadmap

Если нужен Radar, работающий 24/7 независимо от открытой вкладки и переживающий reload, требуется
отдельный future track: server-side Radar process + persistence/read API. В этом минимальном исправлении
persistence намеренно не добавлялась.
