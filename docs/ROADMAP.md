# ROADMAP — Дорожная карта развития CRYPTORA

> **Генеральный план поэтапной реализации платформы**  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** CRYPTORA проектируется строго как **Crypto Market Intelligence Terminal** (Рынок → Данные → Аналитика → Наблюдения → Решение пользователя). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью исключены из концепции и всех этапов дорожной карты.

---

## Этап 1: Visual Foundation & Demo Data (ЗАВЕРШЕН)
- [x] Создание полной проектной памяти и архитектурной документации (`docs/`, `docs/agent-plan/`, `AGENTS.md`).
- [x] Настройка стека: React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Zod, Vitest, Playwright.
- [x] Реализация интерфейсов `MarketDataProvider` и детерминированного слоя `DemoMarketDataProvider`.
- [x] Полноценная оболочка терминала высокой плотности с навигацией и бейджами демо-режима.
- [x] Главный командный центр (Overview): макро-показатели, график BTC, деривативы, ликвидации, радар, топ movers.
- [x] Таблица рынка (/market): 30 монет, сортировка, фильтры по секторам, поиск, спарклайны.
- [x] Страница инструмента (/coin/:symbol): мульти-таймфреймный график, показатели деривативов, стакан/пары, индикаторы, радар.
- [x] Раздел фьючерсов (/futures) и раздел ликвидаций (/liquidations) с методологическим дисклеймером (`Actual != Estimated`).
- [x] Интерактивный скринер (/screener) с работающими фильтрами по demo data.
- [x] Поток аномалий Market Radar (/radar).
- [x] Тепловые карты рынка (/heatmaps) с переключением режимов.
- [x] Работающие калькуляторы Position Size и PnL с тестами (/tools).
- [x] Честные превью разделов Strategy Lab (/strategies) и Signals (/signals).
- [x] Watchlist (сохранение в LocalStorage) и Alerts preview.
- [x] Покрытие юнит-тестами Vitest и Playwright E2E тестами (30 проверок).
- [x] Приемочный аудит и фиксация базовой версии v0.1.0.

---

## Этап 2: Spot Market Data (Binance & KuCoin) (ЗАВЕРШЕН)
- [x] Публичные спотовые данные без API-ключей с Binance и KuCoin.
- [x] Контролируемый начальный universe из 25 криптоактивов.
- [x] Централизованный канонический Asset Registry (канонический актив → символ Binance → символ KuCoin).
- [x] Zod-схемы валидации DTO и слой нормализации в каноническую модель CRYPTORA.
- [x] Адаптеры `BinanceSpotAdapter` (primary) и `KuCoinSpotAdapter` (secondary/fallback).
- [x] Фиксация источника и времени каждого значения (Provenance: exchange, market, symbol, timestamp).
- [x] `LiveMarketDataProvider` с изолированными режимами DEMO и LIVE (без подмешивания фиктивных данных при сбоях сети).
- [x] Тесты с детерминированными фикстурами реальных ответов API (без сетевой зависимости в CI).

## Этап 3: Realtime WebSockets & Anomaly Engine (ЗАВЕРШЕН)
- [x] WebSocket шлюз для котировок, публичных сделок и стаканов L2.
- [x] Математический движок детекции аномалий (Z-Score объемов, всплески активности) для Market Radar.

## Этап 4: Historical Time-Series & Deep Indicators (ЗАВЕРШЕН)
- [x] Развертывание хранилища временных рядов (интерфейс TimeSeriesRepository, кэш и детекция пробелов).
- [x] Высокоточный индикаторный движок (SMA, EMA, Wilder's RSI, MACD, Bollinger Bands, ATR, VWAP, Volume Profile, CVD).
- [x] Углубленные карточки активов со стаканом Level 2 и динамической глубиной.

## Этап 5: Derivatives & Aggregated Futures (ТЕКУЩИЙ ЭТАП)
- [ ] Сбор и агрегация метрик фьючерсов (Open Interest, Funding rate, Basis, Liquidation estimates).

## Этап 6: Immutable Signals Engine & Community
- [ ] Алгоритмическая генерация прозрачных аналитических наблюдений с неизменяемым журналом аудита (No Execution).
- [ ] Расширенная система алертов (Telegram, Webhook).

## Этап 7: AI Analyst Explanation Layer
- [ ] Интеграция LLM строго поверх структурированных фактов аналитического движка для объяснения контекста.

## Этап 8: Monetization & Pro Subscriptions
- [ ] Подключение биллинга, разделение тарифов Free / Pro / Researcher (без торгового исполнения).
