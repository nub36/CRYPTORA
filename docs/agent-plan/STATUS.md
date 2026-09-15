# STATUS — Текущий статус проекта CRYPTORA

> **ЕДИНСТВЕННАЯ ТОЧКА ОСТАНОВКИ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА**  
> **Последнее обновление:** 2026-09-15  
> **Текущая версия:** v0.3.0  
> **Текущий этап:** Этап 3 — Realtime WebSockets & Anomaly Engine Завершен.  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Терминал спроектирован исключительно для сбора и анализа данных (Crypto Market Intelligence Terminal). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью и бесповоротно исключены из архитектуры и дорожной карты платформы.

---

## 1. Что сделано

### Этап 3: Realtime WebSockets & Anomaly Engine (Завершен)
- **Потоковый WebSocket-клиент (`src/services/realtime/BinanceWebSocketClient.ts`):**
  - Подключение к публичному WebSocket шлюзу `wss://stream.binance.com:9443/stream` без API-ключей.
  - Потоки: `<symbol>@ticker`, `<symbol>@trade`, `<symbol>@depth20@100ms`.
  - Автоматический реконнект с экспоненциальным backoff (1s -> 30s) и синхронизацией подписок.
  - Инъекция WebSocket-конструктора для детерминированного тестирования.
- **Внутренняя шина событий с троттлингом (`src/services/realtime/EventBus.ts`):**
  - Pub/Sub для тем `ticker:*`, `ticker:<symbol>`, `trade:<symbol>`, `depth:<symbol>`, `radar`, `connection`.
  - Очередь сглаживания 250 мс для предотвращения перегрузки React-рендеров тиками.
- **Математический движок детекции аномалий (`src/services/realtime/AnomalyEngine.ts`):**
  - Volume Spike Z-Score ($Z = \frac{V - \mu}{\sigma}$, пороги 2.0σ и 3.0σ).
  - Price Velocity Move ($|\Delta P\%| \ge 2.5\%$ и $\ge 4.0\%$).
  - Volatility Expansion (расширение размаха $\ge 1.8\times$ и $\ge 2.5\times$).
  - Cooldown-буфер для защиты от спама дубликатами.
- **Realtime Feed Manager (`src/services/realtime/RealtimeFeedManager.ts`):**
  - Синглтон-оркестратор жизненного цикла сокетов и кэша актуальных цен.
- **Интеграция с UI и слоем данных:**
  - `Header`: отображение статуса WebSocket (`LIVE SPOT (WS ●)`).
  - `RadarPage`: живой режим `LIVE ANOMALY ENGINE` с реактивным получением аномалий.
  - `CoinDetailPage`: тики в реальном времени с пульсирующим индикатором.
  - `MarketPage`: реактивное обновление котировок в таблице инструментов.

### Этап 2: Публичные спотовые данные (Завершен)
- Канонический Asset Registry на 25 активов (`src/services/data/registry/assetRegistry.ts`).
- Zod-схемы DTO и типизированные ошибки адаптеров (`src/services/data/adapters/`).
- `BinanceSpotAdapter` (основной) и `KuCoinSpotAdapter` (вторичный fallback).
- Data Provenance (`exchange, market, symbol, timestamp, isFallback`).
- `LiveMarketDataProvider` с прозрачным разделением DEMO и LIVE.

### Генеральная ревизия концепции (Завершена)
- Зафиксировано решение **ADR-006: CRYPTORA IS ANALYTICS-ONLY / NO TRADE EXECUTION** в `docs/DECISIONS.md`.
- Целевой конвейер строго заканчивается шагом «Решение пользователя»:
  `Рынок → Данные → Аналитика → Наблюдения → Решение пользователя`.
- Все модули реального исполнения ордеров навсегда удалены из архитектуры, документации и планов.

---

## 2. Что НЕ сделано (Намеренно отложено согласно дорожной карте)
- Собственное серверное хранилище временных рядов (TimescaleDB / ClickHouse — Этап 4).
- Вычислительный Indicator Engine для глубоких исторических индикаторов (Этап 4).
- Интеграция живых фьючерсных потоков и расчетных агрегаторов OI (Этап 5).
- Движок симуляции бэктестинга (Этап 5).
- WebSocket-потоки фактических биржевых ликвидаций (Этап 6).
- AI-слой аналитических объяснений (Этап 7).
- Биллинг и тарифная система (Этап 8).
- **И отдельно:** ТОРГОВОЕ ИСПОЛНЕНИЕ, ТОРГОВЫЕ БОТЫ, КАСТОДИ И ТОРГОВЫЕ API-КЛЮЧИ ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ И НИКОГДА НЕ БУДУТ РЕАЛИЗОВАНЫ.

---

## 3. Результаты тестов (Все гейты пройдены со 100% успехом)
- **Typecheck (`npm run typecheck`):** PASSED — 0 ошибок TypeScript (`tsc --noEmit`).
- **Unit Tests (`npm test`):** PASSED — 10 тестовых люксов, **74 теста успешно пройдено**:
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
  - `dist/assets/index-9hi4AeOl.css` (32.20 kB)
  - `dist/assets/index-C2__dGPZ.js` (604.14 kB)
- **Playwright E2E Tests (`npm run test:e2e`):** PASSED — **31 сквозной тест** (`@playwright/test`):
  - 14 тестов сетевых маршрутов (`e2e/routes.spec.ts`)
  - 11 тестов пользовательских сценариев (`e2e/flows.spec.tsx` включая проверку LIVE SPOT и WebSocket)
  - 6 адаптивных смоук-тестов (`e2e/responsive.spec.tsx` для 390, 768, 1024, 1440, 1920px)

---

## 4. Следующий конкретный подэтап
- **Этап 4 (04-HISTORICAL.md):** Разработка архитектуры и контрактов долговременного хранилища временных рядов (Time-Series Storage) и высокоточного вычислительного Indicator Engine (RSI, MACD, Bollinger Bands, ATR, EMA/SMA с математической верификацией формул).

---

## 5. Версия и Git состояние
- **Версия:** `0.3.0`
- **Ветка:** `arena/01a0a67d-cryptora`
- **Инвариант концепции:** `CRYPTORA DOES NOT EXECUTE TRADES`
