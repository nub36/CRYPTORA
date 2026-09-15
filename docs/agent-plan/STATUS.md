# STATUS — Текущий статус проекта CRYPTORA

> **ЕДИНСТВЕННАЯ ТОЧКА ОСТАНОВКИ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА**  
> **Последнее обновление:** 2026-09-15  
> **Текущая версия:** v0.2.0  
> **Текущий этап:** Этап 2 — Spot Market Data (Binance & KuCoin) Завершен.  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Терминал спроектирован исключительно для сбора и анализа данных (Crypto Market Intelligence Terminal). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью и бесповоротно исключены из архитектуры и дорожной карты платформы.

---

## 1. Что сделано

### Генеральное изменение концепции (No Trade Execution)
- По указанию владельца проекта торговый функционал полностью исключен из CRYPTORA.
- Зафиксировано архитектурное решение **ADR-006: CRYPTORA IS ANALYTICS-ONLY / NO TRADE EXECUTION** в `docs/DECISIONS.md`.
- Целевой конвейер строго заканчивается шагом «Решение пользователя»:  
  `EXCHANGE PUBLIC MARKET DATA → COLLECTORS → NORMALIZATION → MARKET DATA STORAGE → REALTIME / TIME SERIES → INDICATORS / DERIVATIVES / LIQUIDATIONS / VOLUME → EVENT / ANOMALY ENGINE → SCREENER / MARKET RADAR → HISTORICAL ENGINE → BACKTEST / STRATEGY RESEARCH → ANALYTICAL SIGNALS → WEB / API / ALERTS → AI EXPLANATION (LATE STAGE) → USER DECISION`.
  После шага USER DECISION никакого слоя исполнения ордеров нет.
- Проведена ревизия всех документов проекта (`AGENTS.md`, `README.md`, `CHANGELOG.md`, `docs/CONCEPT.md`, `docs/MASTER_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATA_SOURCES.md`, `docs/MARKET_DATA.md`, `docs/STRATEGIES.md`, `docs/BACKTESTING.md`, `docs/SIGNALS.md`, `docs/ALERTS.md`, `docs/AI.md`, `docs/SECURITY.md`, `docs/API.md`, `docs/MONETIZATION.md`, `docs/ROADMAP.md`, `docs/agent-plan/`). Все упоминания будущего торгового исполнения, автотрейдинга, создания ордеров и торговых API-ключей полностью удалены.
- Четко разграничена полезная торговая аналитика (Long/Short статистика, ликвидации, калькуляторы размера позиции и риска, Strategy Lab для исследования правил, ручной журнал) и реальное исполнение ордеров (которое строго запрещено).

### Реализация Этапа 2: Публичные спотовые данные (Binance & KuCoin)
- **Канонический Asset Registry (`src/services/data/registry/assetRegistry.ts`):**
  - Централизован начальный контролируемый universe из 25 криптоактивов (`BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `ADA`, `DOGE`, `AVAX`, `LINK`, `DOT`, `SUI`, `NEAR`, `APT`, `RENDER`, `TAO`, `INJ`, `UNI`, `AAVE`, `OP`, `ARB`, `TIA`, `FET`, `KAS`, `RUNE`, `SEI`).
  - Обеспечен строгий маппинг тикеров на биржи: канонический символ → Binance (`BTCUSDT`) → KuCoin (`BTC-USDT`).
  - Реализована грациозная деградация при отсутствии пары на одной из бирж.
- **Схемы DTO и валидация (`src/services/data/adapters/schemas.ts`):**
  - Созданы Zod-схемы валидации: `BinanceTicker24hrSchema`, `BinanceKlinesResponseSchema`, `KuCoinStatsResponseSchema`, `KuCoinAllTickersResponseSchema`, `KuCoinCandlesResponseSchema`.
- **Адаптеры бирж (`src/services/data/adapters/`):**
  - `BinanceSpotAdapter`: опрос публичных спотовых 24h тикеров и OHLCV свечей с таймаутами и обработкой лимитов (HTTP 429/418).
  - `KuCoinSpotAdapter`: опрос публичных спотовых 24h stats, allTickers и свечей с таймаутами и валидацией.
  - Иерархия типизированных ошибок: `AdapterNetworkError`, `AdapterTimeoutError`, `AdapterValidationError`, `AdapterRateLimitError`, `SymbolNotFoundError`.
- **Нормализация и происхождение данных (Provenance):**
  - Реализована функция нормализации в доменные модели CRYPTORA (`AssetSummary`, `OHLCV`).
  - Каждая запись несет метаданные происхождения (`DataProvenance: { exchange, market, symbol, timestamp, isFallback }`).
- **Живой провайдер данных (`LiveMarketDataProvider`):**
  - Реализован `LiveMarketDataProvider` (`isDemo: false`) с поддержкой первичного опроса Binance и автоматического переключения на KuCoin при сбоях (Multi-Exchange Fallback).
  - Строгое разделение DEMO и LIVE: если оба живых шлюза недоступны, генерируется явная ошибка сети без подмешивания фиктивных демо-данных под вывеской LIVE.
  - Подсистемы, не входящие в спотовый Этап 2 (Futures, Liquidations, Radar), честно помечены как демонстрационные с флагом `isDemo: true`.
  - Внедрено переключение режимов `DEMO` и `LIVE` в `MarketDataContext` и модальном окне `DemoModal`.
  - В `Header` добавлен визуальный индикатор активного режима (`ДЕМО-ДАННЫЕ` / `LIVE SPOT`).

---

## 2. Что НЕ сделано (Намеренно отложено согласно дорожной карте)
- WebSocket realtime pipeline для котировок и стаканов (запланирован на Этап 3).
- Интеграция живых фьючерсных потоков и расчетных агрегаторов (запланирована на Этап 5).
- WebSocket-потоки фактических биржевых ликвидаций (запланированы на Этап 6).
- Собственное серверное хранилище временных рядов (TimescaleDB / ClickHouse — запланировано на Этап 4).
- Вычислительный Indicator Engine (Этап 4).
- Движок симуляции бэктестинга (Этап 5).
- AI-слой аналитики (Этап 7).
- Биллинг и тарифная система (Этап 8).
- **И отдельно:** ТОРГОВОЕ ИСПОЛНЕНИЕ, ТОРГОВЫЕ БОТЫ, КАСТОДИ И ТОРГОВЫЕ API-КЛЮЧИ ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ И НИКОГДА НЕ БУДУТ РЕАЛИЗОВАНЫ.

---

## 3. Результаты тестов (Все гейты пройдены со 100% успехом)
- **Typecheck (`npm run typecheck`):** PASSED — 0 ошибок TypeScript (`tsc --noEmit`).
- **Unit Tests (`npm test`):** PASSED — 7 тестовых люксов, **59 тестов успешно пройдено**:
  - `tests/unit/adapters.test.ts` (15 тестов: DTO валидация Binance и KuCoin, нормализация, provenance, ошибки сети, таймауты, 429, 404).
  - `tests/unit/liveDataProvider.test.ts` (9 тестов: LiveMarketDataProvider, Binance primary, KuCoin fallback, обработка отказа обоих шлюзов, свечи, обзор, скринер, изоляция demo-подсистем).
  - `tests/unit/assetRegistry.test.ts` (7 тестов: 25 активов, ранжирование 1..25, маппинг символов, устойчивость к регистру, неподдерживаемые тикеры).
  - `tests/unit/calculators.test.ts` (6 тестов: формулы размера позиции и PnL).
  - `tests/unit/dataProvider.test.ts` (9 тестов: контракты DemoMarketDataProvider, детерминированность).
  - `tests/unit/formatters.test.ts` (10 тестов: валюты, проценты, объемы).
  - `tests/unit/sorting.test.ts` (3 теста: многоколоночная сортировка).
- **Build (`npm run build`):** PASSED — чистая production-сборка (`tsc -b && vite build`):
  - `dist/index.html` (1.48 kB)
  - `dist/assets/index-CvH-z7yk.css` (32.04 kB)
  - `dist/assets/index-B10xs5Wo.js` (588.89 kB)
- **Playwright E2E Tests (`npm run test:e2e`):** PASSED — **30 сквозных тестов** (`@playwright/test`):
  - 14 тестов сетевых маршрутов (`e2e/routes.spec.ts`)
  - 10 тестов пользовательских сценариев (`e2e/flows.spec.tsx`)
  - 6 адаптивных смоук-тестов (`e2e/responsive.spec.tsx` для 390, 768, 1024, 1440, 1920px)

---

## 4. Известные ограничения
- В Этапе 2 живой сбор данных реализован для спотового рынка (Spot Market Data). Фьючерсы, открытый интерес, ликвидации и аномалии радара сохраняются в демонстрационном режиме до соответствующих этапов дорожной карты.
- CI запускается на детерминированных фикстурах и не зависит от доступности серверов Binance и KuCoin.

---

## 5. Следующий конкретный подэтап
- **Этап 3 (03-REALTIME.md):** Разработка легкого WebSocket конвейера реального времени для тикеров и стаканов публичных спотовых котировок, а также запуск базового математического движка детекции аномалий объема для Market Radar.

---

## 6. Версия и Git состояние
- **Версия:** `0.2.0`
- **Ветка:** `arena/01a0a67d-cryptora`
- **Инвариант концепции:** `CRYPTORA DOES NOT EXECUTE TRADES`
- **Статус Git Remote:** Ветка отправлена в `origin/arena/01a0a67d-cryptora` (https://github.com/nub36/CRYPTORA.git).
