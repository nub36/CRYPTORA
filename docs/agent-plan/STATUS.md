# STATUS — Текущий статус проекта CRYPTORA

> **ЕДИНСТВЕННАЯ ТОЧКА ОСТАНОВКИ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА**  
> **Последнее обновление:** 2026-09-16  
> **Текущая версия:** v0.6.0  
> **Текущий этап:** Этапы 6, 8, 10, 12, 14, 15, 16 успешно реализованы и верифицированы.  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Терминал спроектирован исключительно для сбора и анализа данных (Crypto Market Intelligence Terminal). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью и бесповоротно исключены из архитектуры и дорожной карты платформы.

---

## 1. Что сделано

### Новые специализированные разделы аналитического терминала
- **Макро-календарь и катализаторы (`src/pages/CalendarPage.tsx` & `src/services/analytics/CalendarService.ts`):**
  - Трекинг заседаний ФРС США (FOMC), публикации инфляции CPI и Non-Farm Payrolls (NFP), хардфорков сетей и крупных cliff-разблокировок токенов с прогнозами и предыдущими значениями.
  - Фильтрация по уровням важности (HIGH/MEDIUM) и категориям с выделением активов в зоне риска волатильности.
- **Экосистемы и Layer-2 сети (`src/pages/EcosystemPage.tsx` & `src/services/analytics/EcosystemService.ts`):**
  - Анализ Total Value Locked (TVL), суточных доходов от комиссий сетей, реальной пропускной способности (TPS), активных адресов и объемов стейблкоинов для сетей Ethereum, Solana, Arbitrum, Base, Optimism, Polygon, Avalanche.
  - Расчет доли L2-сетей в глобальном TVL.
- **Матрица корреляций и Бета (`src/pages/CorrelationsPage.tsx` & `src/services/analytics/CorrelationEngine.ts`):**
  - Расчет коэффициента корреляции Пирсона между топовыми криптовалютами и макро-бенчмарками (S&P 500, Gold, DXY).
  - Расчет коэффициента Beta относительно Bitcoin ($\beta = \text{Cov}(R_i, R_{\text{BTC}}) / \text{Var}(R_{\text{BTC}})$) для выявления высокобетовых и защитных активов.
- **Он-чейн и макро-метрики (`src/pages/OnChainPage.tsx` & `src/services/analytics/OnChainService.ts`):**
  - MVRV Z-Score, NUPL (Net Unrealized Profit/Loss), хешрейт Bitcoin, активные адреса, стейкинг ETH и медианный Gas Gwei.
  - Таблица суточных потоков монет на биржах (Exchange Inflows, Outflows, Netflow USD).
- **Ручной журнал сделок и рефлексии (`src/pages/JournalPage.tsx` & `src/services/journal/JournalService.ts`):**
  - Автономная тетрадь трейдера для фиксации сетапов, ошибок, самодисциплины (шкала 1–5) и уроков.
  - Расчет Win Rate %, совокупного PnL и средней оценки дисциплины без подключения к биржевым ключам.

### Этап 16: Коммерческая архитектура и тарифные планы (`src/services/subscription/PlanManager.ts`)
- Разграничение прав доступа и лимитов для уровней `FREE`, `PRO` и `ENTERPRISE` (Institutional Terminal).
- Управление лимитами алертов, доступом к бэктестингу, AI-аналитику, кластерам ликвидаций и экспорту данных.

### Этап 15: AI-ассистент и объясняющий слой (`src/services/ai/AiExplanationEngine.ts`)
- Генерация объяснений динамики рынка и аномалий strictly поверх детерминированных фактов (RSI, фандинг, открытый интерес, Z-Score всплесков объема).
- Строгий запрет на финансовые советы или генерацию торговых ордеров. Обязательный дисклеймер аналитического терминала.

### Этап 14: Движок сетапов и неизменяемый аудит (`src/services/signals/SignalsAuditLedger.ts`)
- Формализованные сетапы с обязательными подтверждающими и опровергающими факторами, зонами входа и жесткими уровнями инвалидации.
- Неизменяемый хешированный аудит-лог (SHA-256 chain) с запретом редактирования задним числом.
- Прозрачный расчет результативности и винрейта без ошибки выжившего (survivorship bias).

### Этап 12: Движок бэктестинга (`src/services/backtest/BacktestEngine.ts`)
- Побарная симуляция без заглядывания вперед (Zero Look-Ahead Bias).
- Реалистичный учет комиссий тейкера и проскальзывания (slippage).
- Автоматический расчет метрик: Win Rate %, Profit Factor, Max Drawdown %, Net PnL, Sharpe Ratio.

### Этап 10: Движок алертов (`src/services/alerts/AlertService.ts`)
- Оценка условий: ценовые пороги, суточное изменение, экстремальные значения фандинга.
- Подавление дребезга (cooldown), поддержка каналов In-App, Telegram, Webhook.
- Журналирование истории срабатываний.

### Этап 8: Мультифакторный скринер (`src/services/screener/ScreenerEngine.ts`)
- Композитная фильтрация активов: категория, изменение 24ч, спотовый объем, капитализация, RSI(14), ставка фандинга, дельта открытого интереса.
- Предустановленные системные пресеты (`oversold_rsi`, `volume_leaders`, `short_squeeze`, `oi_breakout`, `ai_sector`) и сохранение пользовательских конфигураций.

### Этап 6: Конвейер ликвидаций и расчет кластеров (`src/services/liquidations/LiquidationPipeline.ts`)
- Парсинг WebSocket сообщений ликвидаций (`forceOrder`).
- Расчет скользящих агрегатов за 24 часа с разбивкой по активам и сторонам (Long vs Short).
- Модель оценки теоретических кластеров риска ликвидаций ($10\times, 25\times, 50\times, 100\times$) с обязательным дисклеймером `Actual != Estimated`.
- Интеграция с `LiveMarketDataProvider` и страницей `LiquidationsPage.tsx`.

### Этап 5: Деривативный конвейер (`src/services/data/adapters/BinanceFuturesAdapter.ts`)
- Подключение к публичному REST API Binance USD-M Futures (`fapi.binance.com`).
- Расчет годовой ставки фандинга (APR), базиса, Contango/Backwardation и долларового открытого интереса.
- Страница `FuturesPage.tsx` с live-метками и фильтрами шорт-сквиза.

### Этапы 2, 3, 4: Спот, WebSockets, TimeSeries, Индикаторы
- Адаптеры Binance и KuCoin Spot с валидацией Zod DTO.
- WebSocket-клиент и AnomalyEngine на Z-Score объема и волатильности.
- Индикаторный движок `IndicatorEngine` (SMA, EMA, RSI, MACD, Bollinger, ATR, VWAP, Volume Profile, CVD).
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
- **Unit Tests (`npm test`):** PASSED — 22 тестовых люкса, **134 теста успешно пройдено**:
  - `tests/unit/calendarAndEcosystem.test.ts` (4 теста: макро-календарь, фильтры событий, метрики экосистем L1/L2)
  - `tests/unit/extendedAnalytics.test.ts` (5 тестов: корреляция Пирсона, бета к BTC, он-чейн метрики, журнал сделок)
  - `tests/unit/calculators.test.ts` (10 тестов: размер позиции, PnL/ROE, цена ликвидации, фандинг, DCA)
  - `tests/unit/liquidations.test.ts` (5 тестов: forceOrder парсинг, 24h агрегаты, кластеры риска)
  - `tests/unit/screener.test.ts` (6 тестов: мультифакторная фильтрация, пресеты)
  - `tests/unit/alerts.test.ts` (4 теста: триггеры, кулдаун, каналы доставки)
  - `tests/unit/backtest.test.ts` (3 теста: no look-ahead bias, учет комиссий и проскальзывания)
  - `tests/unit/signals.test.ts` (3 теста: неизменяемый аудит сетапов, SHA-256 хеш)
  - `tests/unit/aiExplanation.test.ts` (2 теста: контекстные объяснения на основе фактов)
  - `tests/unit/monetization.test.ts` (2 теста: гейтинг тарифов Free / Pro / Enterprise)
  - `tests/unit/derivatives.test.ts` (9 тестов: DTO валидация, расчет APR, базис, OI USD, агрегаты)
  - `tests/unit/indicators.test.ts` (9 тестов)
  - `tests/unit/timeSeries.test.ts` (4 теста)
  - `tests/unit/adapters.test.ts` (15 тестов)
  - `tests/unit/liveDataProvider.test.ts` (9 тестов)
  - `tests/unit/realtimeWs.test.ts` (5 тестов)
  - `tests/unit/eventBus.test.ts` (5 тестов)
  - `tests/unit/anomalyEngine.test.ts` (5 тестов)
  - `tests/unit/dataProvider.test.ts` (9 тестов)
  - `tests/unit/assetRegistry.test.ts` (7 тестов)
  - `tests/unit/formatters.test.ts` (10 тестов)
  - `tests/unit/sorting.test.ts` (3 теста)
- **Build (`npm run build`):** PASSED — чистая production-сборка (`tsc -b && vite build`).
- **Playwright E2E Tests (`npm run test:e2e`):** PASSED — **36 сквозных тестов** (`@playwright/test`):
  - 19 тестов сетевых маршрутов (`e2e/routes.spec.ts`)
  - 11 тестов пользовательских сценариев (`e2e/flows.spec.tsx`)
  - 6 адаптивных смоук-тестов (`e2e/responsive.spec.tsx` для 390, 768, 1024, 1440, 1920px)

---

## 4. Версия и Git состояние
- **Версия:** `0.6.0`
- **Ветка:** `arena/01a0a67d-cryptora`
- **Инвариант концепции:** `CRYPTORA DOES NOT EXECUTE TRADES`

