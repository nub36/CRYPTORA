# STATUS — Текущий статус проекта CRYPTORA

> **ЕДИНСТВЕННАЯ ТОЧКА ОСТАНОВКИ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА**  
> **Последнее обновление:** 2026-09-15  
> **Текущая версия:** v0.5.0  
> **Текущий этап:** Этап 5 — Derivatives & Aggregated Futures Завершен.  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Терминал спроектирован исключительно для сбора и анализа данных (Crypto Market Intelligence Terminal). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью и бесповоротно исключены из архитектуры и дорожной карты платформы.

---

## 1. Что сделано

### Этап 5: Деривативный конвейер (Завершен)
- **Адаптер публичных фьючерсных данных (`src/services/data/adapters/BinanceFuturesAdapter.ts`):**
  - Подключение к публичному REST API Binance USD-M Futures (`fapi.binance.com`) без API-ключей.
  - Zod-схемы DTO: `BinanceFuturesPremiumIndexSchema`, `BinanceFuturesOpenInterestSchema`, `BinanceFuturesTicker24hrSchema`.
  - Типизированная обработка ошибок сети, лимитов (429/418) и таймаутов (`AdapterError`).
- **Расчетный движок деривативов (`src/services/derivatives/DerivativesEngine.ts`):**
  - Расчет годовой ставки фандинга (Annualized Funding Rate / APR = $\text{FR}_{8h} \times 1095$).
  - Расчет базиса и классификация рыночного режима (Contango vs Backwardation).
  - Расчет открытого интереса в долларовом выражении (OI USD).
  - Нормализация в `FuturesAsset` с `isDemo: false` и фиксацией происхождения данных.
  - Агрегация макро-показателей рынка деривативов (`calculateAggregatedOverview`).
- **Интеграция с `LiveMarketDataProvider` и UI:**
  - Реализация `getFuturesList()` с кэшированием и автоматическим fallback.
  - `FuturesPage.tsx`: переключение в режим `LIVE DERIVATIVES (BINANCE FUTURES)`, агрегированные карточки макро-метрик, фильтрация шорт-сквизов.

### Этап 4: Углубленные карточки активов, Time-Series и Indicator Engine (Завершен)
- Индикаторный движок `IndicatorEngine`: SMA, EMA, Wilder's RSI, MACD, Bollinger Bands, ATR, VWAP, Volume Profile, CVD.
- Хранилище временных рядов `MemoryTimeSeriesRepository` с дедупликацией свечей и детекцией пробелов (`detectGaps`).
- Биржевой стакан Level 2 `OrderBookL2` со шкалой глубины и расчетом спреда в USD и bps.

### Этап 3: Realtime WebSockets & Anomaly Engine (Завершен)
- Потоковый WebSocket-клиент `BinanceWebSocketClient`.
- Внутренняя шина событий `EventBus` с регулируемым троттлингом (250 мс batch).
- Математический движок `AnomalyEngine` (Z-Score всплесков объема, ценовой импульс, расширение волатильности).

### Этап 2: Публичные спотовые данные (Завершен)
- Канонический Asset Registry на 25 активов (`src/services/data/registry/assetRegistry.ts`).
- Zod-схемы DTO и адаптеры `BinanceSpotAdapter` и `KuCoinSpotAdapter`.
- `LiveMarketDataProvider` с Data Provenance (`exchange, market, symbol, timestamp, isFallback`).

### Генеральная ревизия концепции (Завершена)
- Зафиксировано решение **ADR-006: CRYPTORA IS ANALYTICS-ONLY / NO TRADE EXECUTION** в `docs/DECISIONS.md`.
- Целевой конвейер строго заканчивается шагом «Решение пользователя»:
  `Рынок → Данные → Аналитика → Наблюдения → Решение пользователя`.
- Торговое исполнение исключено навсегда.

---

## 2. Что НЕ сделано (Намеренно отложено согласно дорожной карте)
- WebSocket-потоки фактических биржевых ликвидаций и тепловые карты плотности ликвидаций (Этап 6).
- Движок симуляции бэктестинга (Этап 6/7).
- AI-слой аналитических объяснений (Этап 7).
- Биллинг и тарифная система (Этап 8).
- **И отдельно:** ТОРГОВОЕ ИСПОЛНЕНИЕ, ТОРГОВЫЕ БОТЫ, КАСТОДИ И ТОРГОВЫЕ API-КЛЮЧИ ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ И НИКОГДА НЕ БУДУТ РЕАЛИЗОВАНЫ.

---

## 3. Результаты тестов (Все гейты пройдены со 100% успехом)
- **Typecheck (`npm run typecheck`):** PASSED — 0 ошибок TypeScript (`tsc --noEmit`).
- **Unit Tests (`npm test`):** PASSED — 13 тестовых люксов, **96 тестов успешно пройдено**:
  - `tests/unit/derivatives.test.ts` (9 тестов: DTO валидация, расчет APR, базис Contango/Backwardation, OI USD, агрегаты)
  - `tests/unit/indicators.test.ts` (9 тестов)
  - `tests/unit/timeSeries.test.ts` (4 теста)
  - `tests/unit/adapters.test.ts` (15 тестов)
  - `tests/unit/liveDataProvider.test.ts` (9 тестов)
  - `tests/unit/realtimeWs.test.ts` (5 тестов)
  - `tests/unit/eventBus.test.ts` (5 тестов)
  - `tests/unit/anomalyEngine.test.ts` (5 тестов)
  - `tests/unit/calculators.test.ts` (6 тестов)
  - `tests/unit/dataProvider.test.ts` (9 тестов)
  - `tests/unit/assetRegistry.test.ts` (7 тестов)
  - `tests/unit/formatters.test.ts` (10 тестов)
  - `tests/unit/sorting.test.ts` (3 теста)
- **Build (`npm run build`):** PASSED — чистая production-сборка (`tsc -b && vite build`):
  - `dist/index.html` (1.48 kB)
  - `dist/assets/index-ChejmA-6.css` (32.88 kB)
  - `dist/assets/index-CGsQDi2g.js` (620.85 kB)
- **Playwright E2E Tests (`npm run test:e2e`):** PASSED — **31 сквозной тест** (`@playwright/test`):
  - 14 тестов сетевых маршрутов (`e2e/routes.spec.ts`)
  - 11 тестов пользовательских сценариев (`e2e/flows.spec.tsx` включая Order Book L2, индикаторы и фьючерсы)
  - 6 адаптивных смоук-тестов (`e2e/responsive.spec.tsx` для 390, 768, 1024, 1440, 1920px)

---

## 4. Следующий конкретный подэтап
- **Этап 6 (06-LIQUIDATIONS.md):** Поток принудительных ликвидаций (WebSocket public stream), тепловая карта плотности ликвидаций и аналитический таймлайн с методологическим дисклеймером (`Actual != Estimated`).

---

## 5. Версия и Git состояние
- **Версия:** `0.5.0`
- **Ветка:** `arena/01a0a67d-cryptora`
- **Инвариант концепции:** `CRYPTORA DOES NOT EXECUTE TRADES`
