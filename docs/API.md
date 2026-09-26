# API — Спецификация внешних и внутренних интерфейсов

> **Статус:** Контракты взаимодействия (Этап 1: локальный провайдер; Этап 2+: REST/WS API)  
> ⚠️ **ПРИНЦИП:** API CRYPTORA предназначено исключительно для чтения аналитических и рыночных данных (Read-Only Market Intelligence). В API полностью отсутствуют эндпоинты отправки, модификации или отмены торговых ордеров, а также эндпоинты ввода торговых API-ключей бирж.

---

## 1. Основные REST-эндпоинты (Целевой бэкенд)

### 1.1. Рыночные снимки
- `GET /api/v1/market/overview` — сводка глобального рынка (капитализация, объемы, доминация, Fear & Greed).
- `GET /api/v1/market/tickers` — список актуальных котировок активов.
- `GET /api/v1/market/candles?symbol=BTCUSDT&timeframe=1h&limit=500` — исторические свечи OHLCV.

### 1.2. Деривативы и ликвидации
- `GET /api/v1/derivatives/futures` — срез фьючерсов (OI, funding rate, basis).
- `GET /api/v1/derivatives/liquidations?window=24h` — агрегированная сводка ликвидаций и последние события.

### 1.3. Радар и скринер
- `GET /api/radar/events?limit=1..100&symbol=<optional>&before=<optional ISO>` — persisted, newest-first server Radar history (`source: "server"`).
- `GET /api/radar/status` — server monitor lifecycle, effective Scan Universe counts, warm-up and upstream-feed status. This endpoint does not expose exchange credentials or Admin settings.
- `POST /api/v1/screener/query` — фильтрация активов по комплексному телу параметров.

---

## 2. WebSocket потоки реального времени (Этап 2+)
- `wss://api.cryptora.terminal/ws/v1/tickers` — поток обновлений цен и изменений 24ч.
- `wss://api.cryptora.terminal/ws/v1/liquidations` — поток фактических ликвидаций в реальном времени.
- `wss://api.cryptora.terminal/ws/v1/radar` — мгновенные пуши аномалий радара.
