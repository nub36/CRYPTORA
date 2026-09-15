# DATA_SOURCES — Аудит и требования к источникам данных

> **Статус:** Предварительный аудит целевых источников (Этап 2+)  
> **Критический принцип:** Никаких непроверенных утверждений о коммерческих API или условиях лицензирования. Поскольку в текущей изолированной среде отсутствует прямой доступ к актуальным серверам и юридическим разделам документаций бирж, **ВСЕ** параметры помечены как `REQUIRES VERIFICATION`. Перед началом Этапа 2 обязательна отдельная валидация официальных документов каждого источника.

---

## 1. Сводная матрица потенциальных биржевых источников

| Биржа / Провайдер | Рынки | Спот REST/WS | Фьючерсы REST/WS | Open Interest | Funding Rates | Фактические ликвидации | Документация / Статус |
|---|---|---|---|---|---|---|---|
| **Binance** | Spot + USDⓈ-M + COIN-M | REST v3, WS streams (`REQUIRES VERIFICATION`) | Futures v1/v2 REST & WS (`REQUIRES VERIFICATION`) | REST / WS (`REQUIRES VERIFICATION`) | 8h интервалы (`REQUIRES VERIFICATION`) | `forceOrder` WS stream (`REQUIRES VERIFICATION`) | [Binance API Docs](https://developers.binance.com/docs/) / `REQUIRES VERIFICATION` |
| **Bybit** | Spot + Linear / Inverse | V5 REST, V5 WS (`REQUIRES VERIFICATION`) | V5 Linear / Inverse (`REQUIRES VERIFICATION`) | V5 Market (`REQUIRES VERIFICATION`) | Текущий и прогноз (`REQUIRES VERIFICATION`) | V5 execution / liquidation streams (`REQUIRES VERIFICATION`) | [Bybit V5 Docs](https://bybit-exchange.github.io/docs/v5/intro) / `REQUIRES VERIFICATION` |
| **OKX** | Spot + Margin + Futures + Swaps | V5 REST, Public WS (`REQUIRES VERIFICATION`) | V5 Futures / Swap (`REQUIRES VERIFICATION`) | Public Data REST/WS (`REQUIRES VERIFICATION`)| 8h / 4h / 1h по рынкам (`REQUIRES VERIFICATION`) | Public Liquidation Orders (`REQUIRES VERIFICATION`) | [OKX V5 Docs](https://www.okx.com/docs-v5/en/) / `REQUIRES VERIFICATION` |
| **Coinbase** | Spot + Institutional Futures | Advanced Trade REST/WS (`REQUIRES VERIFICATION`) | Derivatives (ограничено) (`REQUIRES VERIFICATION`) | Ограничено (`REQUIRES VERIFICATION`) | N/A (в основном спот) | N/A | [Coinbase Developer](https://docs.cdp.coinbase.com/) / `REQUIRES VERIFICATION` |

---

## 2. Параметры, требующие верификации перед Этапом 2

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
