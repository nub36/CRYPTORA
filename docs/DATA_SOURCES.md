# DATA_SOURCES — Аудит и требования к источникам данных

> **Статус:** Предварительный аудит целевых источников (Этап 2+)  
> **Критический принцип:** Никаких непроверенных утверждений о коммерческих API или условиях лицензирования. Поскольку в текущей изолированной среде отсутствует прямой доступ к актуальным серверам и юридическим разделам документаций бирж, **ВСЕ** параметры помечены как `REQUIRES VERIFICATION`. Перед началом Этапа 2 обязательна отдельная валидация официальных документов каждого источника.

---

## 1. Сводная матрица потенциальных биржевых источников

| Биржа / Провайдер | Рынки | Спот REST/WS | Фьючерсы REST/WS | Open Interest | Funding Rates | Фактические ликвидации | Документация / Статус |
|---|---|---|---|---|---|---|---|
| **Binance** | Spot + USDⓈ-M + COIN-M | REST v3: Ticker 24hr, Klines, ExchangeInfo (Подтверждено для Этапа 2) | Futures v1/v2 REST & WS (`REQUIRES VERIFICATION`) | REST / WS (`REQUIRES VERIFICATION`) | 8h интервалы (`REQUIRES VERIFICATION`) | `forceOrder` WS stream — **подключено (v0.8.2):** `wss://fstream.binance.com/ws/!forceOrder@arr`, публичный поток, только чтение | [Binance Spot API Docs](https://developers.binance.com/docs/binance-spot-api-docs) |
| **KuCoin** | Spot + Margin + Futures | REST v1/v2: Stats 24h, allTickers, Candles, Symbols (Подтверждено для Этапа 2) | Futures REST/WS (`REQUIRES VERIFICATION`) | REST (`REQUIRES VERIFICATION`) | Фьючерсный фандинг (`REQUIRES VERIFICATION`) | WebSocket stream (`REQUIRES VERIFICATION`) | [KuCoin Spot Docs](https://www.kucoin.com/docs-new/rest/spot-trading/market-data/) |
| **Bybit** | Spot + Linear / Inverse | V5 REST, V5 WS (`REQUIRES VERIFICATION`) | V5 Linear / Inverse (`REQUIRES VERIFICATION`) | V5 Market (`REQUIRES VERIFICATION`) | Текущий и прогноз (`REQUIRES VERIFICATION`) | V5 execution / liquidation streams (`REQUIRES VERIFICATION`) | [Bybit V5 Docs](https://bybit-exchange.github.io/docs/v5/intro) / `REQUIRES VERIFICATION` |
| **OKX** | Spot + Margin + Futures + Swaps | V5 REST, Public WS (`REQUIRES VERIFICATION`) | V5 Futures / Swap (`REQUIRES VERIFICATION`) | Public Data REST/WS (`REQUIRES VERIFICATION`)| 8h / 4h / 1h по рынкам (`REQUIRES VERIFICATION`) | Public Liquidation Orders (`REQUIRES VERIFICATION`) | [OKX V5 Docs](https://www.okx.com/docs-v5/en/) / `REQUIRES VERIFICATION` |
| **Coinbase** | Spot + Institutional Futures | Advanced Trade REST/WS (`REQUIRES VERIFICATION`) | Derivatives (ограничено) (`REQUIRES VERIFICATION`) | Ограничено (`REQUIRES VERIFICATION`) | N/A (в основном спот) | N/A | [Coinbase Developer](https://docs.cdp.coinbase.com/) / `REQUIRES VERIFICATION` |

### 1.1. Реализованные потоки фактических данных (v0.8.2)

| Источник | Транспорт | Статус в коде | Примечание |
| --- | --- | --- | --- |
| Binance USD-M Futures — фактические ликвидации | WS `wss://fstream.binance.com/ws/!forceOrder@arr` | `src/services/realtime/BinanceFuturesLiquidationStream.ts` | Только чтение публичных рыночных данных, без API-ключей. Публичные market-стримы Binance не требуют торговых прав. |
| Binance Spot — котировки, сделки, стакан | WS `wss://stream.binance.com:9443/stream` | `src/services/realtime/BinanceWebSocketClient.ts` | Подписки `@ticker`, `@trade`, `@depth20@100ms`. |
| Binance Futures — метка цены, открытый интерес, фандинг | REST Futures v1/v2 | `src/services/data/adapters/*`, `LiveMarketDataProvider` | Используется как вход расчетной модели кластеров ликвидаций. |

**Не подключено (и не подменяется оценками):** потоки фактических ликвидаций Bybit V5 (`allLiquidation`) и
OKX (liquidation-orders). До их подключения разбивка ликвидаций по биржам отражает только те источники,
которые действительно отдали события.

---

## 2. Подтвержденные спецификации спотовых REST API для Этапа 2

### 2.1. Binance Spot Public REST API
- **Официальный URL документации:** https://developers.binance.com/docs/binance-spot-api-docs
- **Базовые URL:** `https://api.binance.com`, резервный: `https://data-api.binance.vision`
- **Поддержка спотового рынка:** Полная поддержка всех спотовых пар с USDT (`BTCUSDT`, `ETHUSDT` и др.).
- **Подтвержденные эндпоинты:**
  - `GET /api/v3/ticker/24hr?symbol={symbol}` — 24-часовая статистика цен и объемов (Weight: 2 для единичного символа, 80 для всех символов).
  - `GET /api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}` — бары OHLCV (Weight: 2, поддерживаемые интервалы: 1m, 15m, 1h, 4h, 1d, 1w).
  - `GET /api/v3/exchangeInfo?symbol={symbol}` — метаданные инструмента, статус торгов, точность и шаг цены (Weight: 20).
- **Требования к аутентификации:** Отсутствуют (публичные эндпоинты не требуют API-ключей или подписей HMAC).
- **Ограничения частоты (Rate Limits):** 1200 единиц веса в минуту на IP-адрес. Ответ содержит заголовок `x-mbx-used-weight-1m`. При превышении — HTTP 429 / HTTP 418 IP ban.
- **Ограничения использования/redistribution:** Публичные рыночные данные доступны для отображения и анализа; `REQUIRES VERIFICATION` в части коммерческой синдикации сторонним клиентам.

### 2.2. KuCoin Spot Public REST API
- **Официальный URL документации:** https://www.kucoin.com/docs-new/rest/spot-trading/market-data/
- **Базовый URL:** `https://api.kucoin.com`
- **Поддержка спотового рынка:** Полная поддержка спотовых пар с разделителем дефис (`BTC-USDT`, `ETH-USDT` и др.).
- **Подтвержденные эндпоинты:**
  - `GET /api/v1/market/stats?symbol={symbol}` — 24-часовая статистика цены, объема и волатильности (Weight: 1).
  - `GET /api/v1/market/allTickers` — полный снимок всех спотовых пар в одном запросе (Weight: 15).
  - `GET /api/v1/market/candles?symbol={symbol}&type={type}` — бары OHLCV (Weight: 3, типы: 1min, 15min, 1hour, 4hour, 1day, 1week).
  - `GET /api/v1/symbols` / `GET /api/v2/symbols` — реестр инструментов и метаданные валют (Weight: 4).
- **Требования к аутентификации:** Отсутствуют (публичные рыночные данные работают без API-ключей).
- **Ограничения частоты (Rate Limits):** Публичный пул лимитов по весам (`api-rate-limit-pool: Public`). `REQUIRES VERIFICATION` для пиковых пакетных опросов.
- **Ограничения использования/redistribution:** Публичный доступ для отображения котировок; `REQUIRES VERIFICATION` в части коммерческих ограничений повторного распространения.

---

## 3. Параметры, требующие верификации для последующих этапов (Этапы 3+)

Каждый выбранный биржевой источник перед подключением должен пройти аудит по следующим критериям:

### 2.1. Лимиты запросов (Rate Limits) — `REQUIRES VERIFICATION`
- Точные веса эндпоинтов (IP rate limits, account rate limits).
- Поведение при `429 Too Many Requests` и `418 IP Ban`.
- Лимиты на количество входящих сообщений и подписок на одном WebSocket соединении.

### 2.2. Доступность исторических данных (Historical Availability) — `REQUIRES VERIFICATION`
- Глубина доступности минутных (1m) и часовых (1h) свечей через публичный REST.
- Историческая глубина снапшотов открытого интереса (OI) и ставок фандинга.
- Доступность логов исторических ликвидаций (архивы сделок).

### 2.3. Лицензирование и ограничения распространения (Licensing & Redistribution) — `REQUIRES VERIFICATION`
- Правовые условия использования биржевых данных в аналитическом терминале (Commercial / Non-Commercial).
- Ограничения на повторное распространение (redistribution constraints) через публичный WebSocket или API третьим лицам.
- Требования к задержкам (delayed data policy).

### 2.4. Аутентификация и географические ограничения — `REQUIRES VERIFICATION`
- Доступность публичных рыночных котировок без API-ключей (Public Endpoints).
- Географические блокировки IP-адресов серверов (Cloudflare / Geo-fencing).

---

## 3. Специфика сбора и нормализации деривативных метрик

### 3.1. Открытый интерес (Open Interest)
- На разных биржах OI отдается либо в базовой валюте, либо в контрактах, либо в USD.
- Конвейер нормализации CRYPTORA обязан приводить значения к единому знаменателю: **USD Notional Value** (`OI_contracts * contract_val * mark_price` или `OI_coins * mark_price`).

### 3.2. Ставка финансирования (Funding Rate)
- Стандартный расчетный интервал — 8 часов (00:00, 08:00, 16:00 UTC). Некоторые инструменты имеют динамический интервал 4h или 1h.
- Нормализация: сохранение интервальной ставки и расчет годового эквивалента (APR %).

### 3.3. Ликвидации (Liquidations)
- **ACTUAL LIQUIDATION EVENT != ESTIMATED LIQUIDATION LEVEL.**
- Фактические события принудительного закрытия фиксируются из потока ликвидаций бирж.
- Расчетные тепловые карты уровней являются математической моделью (`ESTIMATED / MODEL`).
