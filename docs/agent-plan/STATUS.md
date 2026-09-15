# STATUS — Текущий статус проекта CRYPTORA

> **ЕДИНСТВЕННАЯ ТОЧКА ОСТАНОВКИ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА**  
> **Последнее обновление:** 2026-09-15  
> **Текущая версия:** v0.4.0  
> **Текущий этап:** Этап 4 — Coin Pages, Time-Series Storage & Indicator Engine Завершен.  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Терминал спроектирован исключительно для сбора и анализа данных (Crypto Market Intelligence Terminal). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью и бесповоротно исключены из архитектуры и дорожной карты платформы.

---

## 1. Что сделано

### Этап 4: Углубленные карточки активов, Time-Series и Indicator Engine (Завершен)
- **Высокопроизводительный индикаторный движок (`src/services/indicators/IndicatorEngine.ts`):**
  - Математически верифицированные формулы:
    - SMA (20, 50, 200);
    - EMA (с коэффициентом $k = \frac{2}{N+1}$);
    - Wilder's Smoothed RSI (14 периодов, строгие границы 0–100, зоны перекупленности/перепроданности);
    - MACD (12, 26, 9: линия MACD, сигнальная линия, гистограмма);
    - Bollinger Bands (20 SMA, ±2σ, Bandwidth %);
    - ATR (14-периодный расчет истинного диапазона со сглаживанием Уайлдера);
    - VWAP (Volume-Weighted Average Price по типичной цене);
    - Volume Profile (расчет POC, Value Area High/Low по 70% распределению объемов);
    - CVD (Cumulative Volume Delta).
  - Динамический пересчет показателей непосредственно по загруженным свечам таймфрейма.
- **Хранилище временных рядов (`src/services/storage/TimeSeriesRepository.ts`):**
  - Реализация `MemoryTimeSeriesRepository` с автоматической дедупликацией свечей по `time`.
  - Строгая хронологическая сортировка (`time ASC`).
  - Механизм детекции пропусков в истории (`detectGaps`) с фиксацией пропущенных баров.
  - Ограничение емкости с вытеснением старых свечей для безопасности оперативной памяти.
- **Биржевой стакан цен Level 2 (`src/components/market/OrderBookL2.tsx`):**
  - Визуализация биржевой глубины: Bids (зеленый) и Asks (красный) со шкалой кумулятивного объема.
  - Расчет Mid Price, абсолютного спреда в USD и относительного спреда в базисных пунктах (bps).
  - Подключение к потоку `depth:<symbol>`.
- **Обновление интерфейса `CoinDetailPage.tsx`:**
  - Динамические индикаторы, панель биржевого стакана L2, детальная таблица торговых пар со спредом.

### Этап 3: Realtime WebSockets & Anomaly Engine (Завершен)
- Потоковый WebSocket-клиент `BinanceWebSocketClient` (тикеры, сделки, стакан 20 уровней).
- Внутренняя шина событий `EventBus` с регулируемым троттлингом (250 мс batch).
- Математический движок `AnomalyEngine` (Z-Score всплесков объема, ценовой импульс, расширение волатильности).
- `Header` индикатор статуса WebSocket (`LIVE SPOT (WS ●)`).

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
- Интеграция живых фьючерсных потоков и расчетных агрегаторов OI (Этап 5).
- Движок симуляции бэктестинга (Этап 5).
- WebSocket-потоки фактических биржевых ликвидаций (Этап 6).
- AI-слой аналитических объяснений (Этап 7).
- Биллинг и тарифная система (Этап 8).
- **И отдельно:** ТОРГОВОЕ ИСПОЛНЕНИЕ, ТОРГОВЫЕ БОТЫ, КАСТОДИ И ТОРГОВЫЕ API-КЛЮЧИ ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ И НИКОГДА НЕ БУДУТ РЕАЛИЗОВАНЫ.

---

## 3. Результаты тестов (Все гейты пройдены со 100% успехом)
- **Typecheck (`npm run typecheck`):** PASSED — 0 ошибок TypeScript (`tsc --noEmit`).
- **Unit Tests (`npm test`):** PASSED — 12 тестовых люксов, **87 тестов успешно пройдено**:
  - `tests/unit/indicators.test.ts` (9 тестов: SMA, EMA, RSI Wilder's, MACD, Bollinger Bands, ATR, VWAP, Volume Profile, CVD)
  - `tests/unit/timeSeries.test.ts` (4 теста: сохранение свечей, хронология, детекция пробелов, вытеснение)
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
  - `dist/assets/index-zAoWlj-8.js` (615.37 kB)
- **Playwright E2E Tests (`npm run test:e2e`):** PASSED — **31 сквозной тест** (`@playwright/test`):
  - 14 тестов сетевых маршрутов (`e2e/routes.spec.ts`)
  - 11 тестов пользовательских сценариев (`e2e/flows.spec.tsx` включая Order Book L2, индикаторы и WS badge)
  - 6 адаптивных смоук-тестов (`e2e/responsive.spec.tsx` для 390, 768, 1024, 1440, 1920px)

---

## 4. Следующий конкретный подэтап
- **Этап 5 (05-FUTURES.md):** Полномасштабный сбор, нормализация и агрегация данных деривативов (Open Interest, Funding Rate, Basis, расчетные дельты 1h/24h) по биржам и инструментам.

---

## 5. Версия и Git состояние
- **Версия:** `0.4.0`
- **Ветка:** `arena/01a0a67d-cryptora`
- **Инвариант концепции:** `CRYPTORA DOES NOT EXECUTE TRADES`
