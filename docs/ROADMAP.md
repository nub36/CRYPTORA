# ROADMAP — Дорожная карта развития CRYPTORA

> **Генеральный план поэтапной реализации платформы**

---

## Этап 1: Visual Foundation & Demo Data (ТЕКУЩИЙ ЭТАП)
- [x] Создание полной проектной памяти и архитектурной документации (`docs/`, `docs/agent-plan/`, `AGENTS.md`).
- [x] Настройка стека: React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Zod, Vitest, Playwright.
- [x] Реализация интерфейсов `MarketDataProvider` и детерминированного слоя `DemoMarketDataProvider`.
- [x] Полноценная оболочка терминала высокой плотности с навигацией и бейджами демо-режима.
- [x] Главный командный центр (Overview): макро-показатели, график BTC, деривативы, ликвидации, радар, топ movers.
- [x] Таблица рынка (/market): 30 монет, сортировка, фильтры по секторам, поиск, спарклайны.
- [x] Страница инструмента (/coin/:symbol): мульти-таймфреймный график, показатели деривативов, стакан/пары, индикаторы, радар.
- [x] Раздел фьючерсов (/futures) и раздел ликвидаций (/liquidations) с методологическим дисклеймером.
- [x] Интерактивный скринер (/screener) с работающими фильтрами по demo data.
- [x] Поток аномалий Market Radar (/radar).
- [x] Тепловые карты рынка (/heatmaps) с переключением режимов.
- [x] Работающие калькуляторы Position Size и PnL с тестами (/tools).
- [x] Честные превью разделов Strategy Lab (/strategies) и Signals (/signals).
- [x] Watchlist (сохранение в LocalStorage) и Alerts preview.
- [x] Покрытие юнит-тестами и E2E тестами на Playwright.

---

## Этап 2: Live Market Data Ingestion
- [ ] Развертывание базового бэкенда сбора публичных данных (Binance, Bybit).
- [ ] Нормализация спотовых котировок и базовых фьючерсных тикеров.
- [ ] Реализация `LiveMarketDataProvider` на фронтенде без изменения UI-компонентов.

## Этап 3: Realtime WebSockets & Anomaly Engine
- [ ] WebSocket шлюз для котировок, сделок и ликвидаций.
- [ ] Математический движок детекции аномалий (Z-Score объемов, всплески OI, экстремумы фандинга) для Market Radar.

## Этап 4: Historical Time-Series & Deep Indicators
- [ ] Развертывание хранилища временных рядов (TimescaleDB / ClickHouse).
- [ ] Расчет расширенного каталога индикаторов (CVD, Volume Profile, Breadth).

## Этап 5: Strategy Lab & No-Look-Ahead Backtesting
- [ ] Декларативный конструктор правил стратегий.
- [ ] Движок бэктестинга с учетом комиссий, фандинга и проскальзывания.

## Этап 6: Immutable Signals Engine & Community
- [ ] Алгоритмическая генерация прозрачных сетапов с неизменяемым журналом аудита.
- [ ] Расширенная система алертов (Telegram, Webhook).

## Этап 7: AI Analyst Explanation Layer
- [ ] Интеграция LLM строго поверх структурированных фактов аналитического движка.

## Этап 8: Monetization & Pro Subscriptions
- [ ] Подключение биллинга, разделение тарифов Free / Pro / Trader.
