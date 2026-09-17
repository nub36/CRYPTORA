# CRYPTORA

> **Crypto Market Intelligence Terminal**  
> *«Рынок. Данные. Решения.»*

CRYPTORA — информационно-аналитический криптовалютный терминал высокой плотности данных (data-dense terminal), созданный для трейдеров, исследователей и аналитиков цифровых активов.

> ⚠️ **Правовая оговорка и статус концепции:**  
> «CRYPTORA» — рабочее название проекта (юридическая и товарная доступность подлежит отдельной проверке).  
> Проект проектируется исключительно как **Crypto Market Intelligence Terminal** (Рынок → Данные → Аналитика → Наблюдения → Решение пользователя).  
> Проект **НЕ является биржей или брокером**, не принимает депозиты, не хранит приватные ключи, не запрашивает торговые API-ключи, не содержит торговых ботов и не исполняет реальные торговые ордера. Торговый функционал полностью исключен из концепции проекта.

---

## 🧭 Ключевые возможности (v0.8.24)

> Полная карта «что фактическое / расчётное / справочное» по каждой странице — в [`docs/SITE_REPORT.md`](docs/SITE_REPORT.md).

- **Обзор (/):** капитализация, объём, доминация BTC/ETH, breadth и график BTC по фактическим данным Binance/KuCoin; индекс страха и жадности — из Alternative.me; Δ капитализации — из изменений цен источника, Δ объёма — против собственного снимка ≥24ч.
- **Рынок (/market) и монеты (/coin/:symbol):** LIVE-котировки (REST + WebSocket), свечи 15m–1W, стакан, индикаторы, снимок деривативов и переставляемые модули рабочей области.
- **Фьючерсы (/futures):** фактические OI, фандинг, базис (Binance `premiumIndex`); оценочные поля подписаны явно.
- **Ликвидации (/liquidations):** фактические WebSocket-потоки Binance USD-M, Bybit V5 и OKX с раздельным статусом каждой биржи; тепловая карта плотности — расчётная модель `MODEL / ESTIMATED`.
- **Скринер, Радар, Тепловые карты, Корреляции:** фильтры, детектор аномалий и матрица Пирсона/бета к BTC поверх LIVE-данных.
- **Стратегии (/strategies):** неизменяемый Архив исследований — 13 версий с раздельными вердиктом исследования и статусом воспроизводимости, провенансом и предупреждениями о несравнимости. Без обещаний доходности.
- **Алерты:** правила по цене и фандингу оцениваются по фактическим данным; каналы In-app, браузер, Telegram Bot, Webhook с журналом доставки; настройки — только в браузере пользователя.
- **Статьи (/articles):** материалы владельца из `content/articles/*.md`; партнёрские слоты — только из `content/sponsor-slots.json` с бейджем «Sponsored / Partner» (по умолчанию пусто). AI-пояснение на /radar — серверный `/api/ai/explain` со стражем заземления (включается `AI_API_KEY`).
- **Темы DARK / LIGHT / SYSTEM**, адаптивная вёрстка 390–1920px.
- **Справочные разделы:** /ecosystem — TVL сетей из DeFiLlama; /onchain — сеть Bitcoin из mempool.space; /calendar — фандинг и экспирации Binance Futures; /signals — журнал сетапов (append-only, SHA-256), пуст. При отказе источника — «ИСТОЧНИК НЕДОСТУПЕН», без подстановок.

---

## 🛠 Технологический стек

- **Frontend:** React 19, TypeScript 5, Vite
- **Routing:** React Router v7
- **Стилизация:** Tailwind CSS, PostCSS, дизайн-система высокой плотности в темных графитовых тонах
- **Графика:** Lightweight Charts (TradingView) + кастомные SVG Canvas sparklines
- **Схема данных:** Zod + типизированная архитектура провайдеров (`MarketDataProvider`)
- **Тестирование:** Vitest (unit & integration), Playwright (E2E)
- **Иконки:** Lucide React

---

## 🚀 Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск dev-сервера (доступен на 0.0.0.0:5173)
npm run dev

# Проверка типов
npm run typecheck

# Запуск юнит-тестов
npm test

# Сборка production-бандла
npm run build

# Запуск автономного production-сервера (SPA + API Gateway)
npm run start

# Запуск E2E тестов
npm run test:e2e

# Визуальный и геометрический QA вёрстки (Chromium через Playwright):
# скриншоты + замеры overflow / клиппинга / кегля навигации по viewport'ам
node scripts/screenshot-qa.mjs --tag=qa --routes=/,/coin/BTC          # production-режим (LIVE), по умолчанию
node scripts/screenshot-qa.mjs --tag=qa-fixture --mode=qa-fixture       # только против dev-сервера: QA-датасет
```

> QA-скрипт опционально принимает `CRYPTORA_CHROMIUM_PATH`, `CRYPTORA_CHROMIUM_LD_PATH`
> и `CRYPTORA_QA_FONTS_DIR` — они нужны только в изолированных средах без доступа
> к загрузке браузеров Playwright и к Google Fonts. Артефакты складываются в `screenshots/`,
> код возврата `1` означает найденные layout-нарушения.

---

## 🚀 Развертывание на VPS (Production Deployment)

Инструкции по вводу в эксплуатацию, настройке Nginx, Certbot (HTTPS) и Systemd подробно описаны в [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Быстрые операционные команды:
- `./scripts/deploy.sh` — сборка и валидация
- `./scripts/status.sh` — мониторинг статуса сервиса и `/api/health`
- `./scripts/restart.sh` — перезапуск службы
- `./scripts/logs.sh` — просмотр производственных логов
- `./scripts/update.sh` — получение обновлений из Git и бесшовный рестарт

---

## 📚 Архитектурная документация

Вся инженерная документация расположена в директории `docs/`:

- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — руководство по развертыванию на VPS, Nginx, Systemd и HTTPS
- [CONCEPT.md](docs/CONCEPT.md) — видение, ценности, позиционирование
- [MASTER_SPEC.md](docs/MASTER_SPEC.md) — мастер-спецификация платформы
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — системная архитектура и пайплайн данных
- [SECURITY.md](docs/SECURITY.md) — модель безопасности и аудит
- [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — цветовая семантика, типографика, плотность
- [DATA_SOURCES.md](docs/DATA_SOURCES.md) — аудит и верификация внешних биржевых API
- [ROADMAP.md](docs/ROADMAP.md) — последовательная дорожная карта проекта
- [docs/agent-plan/](docs/agent-plan/) — пошаговый план работы агентов и журнал состояния `STATUS.md`

Правила работы для AI-агентов зафиксированы в [AGENTS.md](AGENTS.md).
