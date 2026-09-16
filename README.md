# CRYPTORA

> **Crypto Market Intelligence Terminal**  
> *«Рынок. Данные. Решения.»*

CRYPTORA — информационно-аналитический криптовалютный терминал высокой плотности данных (data-dense terminal), созданный для трейдеров, исследователей и аналитиков цифровых активов.

> ⚠️ **Правовая оговорка и статус концепции:**  
> «CRYPTORA» — рабочее название проекта (юридическая и товарная доступность подлежит отдельной проверке).  
> Проект проектируется исключительно как **Crypto Market Intelligence Terminal** (Рынок → Данные → Аналитика → Наблюдения → Решение пользователя).  
> Проект **НЕ является биржей или брокером**, не принимает депозиты, не хранит приватные ключи, не запрашивает торговые API-ключи, не содержит торговых ботов и не исполняет реальные торговые ордера. Торговый функционал полностью исключен из концепции проекта.

---

## 🧭 Ключевые возможности (Этап 1: Visual Foundation & Demo Data)

- **Market Overview (Командный центр):** агрегированная капитализация, суточный объем, доминация BTC/ETH, индекс страха и жадности, распределение рынка (Advance/Decline), интерактивный график BTC, снапшоты деривативов и ликвидаций.
- **Market Table (/market):** котировки 30 ключевых криптовалютных активов, сортировка по колонкам, фильтрация по категориям (L1, DeFi, L2, AI), 7-дневные спарклайны и добавление в избранное (Watchlist).
- **Coin Detail (/coin/:symbol):** детальные карточки монет с мульти-таймфреймным графиком (15m, 1h, 4h, 1D, 1W), стаканом/парами, индикаторами (RSI, MACD, SMA), срезом деривативов и потоком событий радара.
- **Futures & Derivatives (/futures):** открытый интерес (OI), дельта OI (1h, 24h), ставки финансирования (funding rate), базис и ликвидации в едином профессиональном табличном интерфейсе.
- **Liquidations (/liquidations):** агрегированные объемы ликвидаций Long/Short, хронология, разбивка по биржам и активам, а также четкое разделение фактических ликвидаций и расчетных уровней модели.
- **Screener (/screener):** многофакторный скринер криптовалют с интерактивными фильтрами по динамике цены, объемам, открытому интересу, ставке финансирования и RSI.
- **Market Radar (/radar):** поток аномальных рыночных событий (Volume Spike, OI Spike, Funding Extreme, Liquidation Burst) с гранулярной оценкой важности.
- **Heatmaps (/heatmaps):** визуализация рынка плитками по изменению цены, объему, открытому интересу и ставкам фандинга с четкой цветовой шкалой.
- **Tools (/tools):** калькуляторы позиции (Position Size Calculator) и PnL с проверкой риск-параметров.
- **Signals & Strategy Lab Preview (/signals, /strategies):** честная демонстрация методологии будущей аналитики без фиктивных обещаний доходности.

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
node scripts/screenshot-qa.mjs --tag=qa --routes=/,/coin/BTC
node scripts/screenshot-qa.mjs --tag=qa-live --mode=live --viewports=1024x768,1280x800,1440x900,1920x1080
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
