# DATA_SOURCES — Аудит и требования к источникам данных

> **Статус:** Исследовательский документ целевых источников (Этап 2+)  
> **Принцип:** Никаких непроверенных предположений о коммерческих API. Все неподтвержденные вживую параметры помечены как `REQUIRES VERIFICATION`.

---

## 1. Сводная матрица биржевых источников данных

| Биржа / Провайдер | Рынки | Спот REST/WS | Фьючерсы REST/WS | Open Interest | Funding Rates | Фактические ликвидации | Документация / Статус |
|---|---|---|---|---|---|---|---|
| **Binance** | Spot + USDⓈ-M + COIN-M | REST v3, WS streams | Futures v1/v2 REST & WS | Доступен (REST / WS 5m-1d) | 8h интервалы (REST / WS) | `forceOrder` WS stream | [Binance API Docs](https://developers.binance.com/docs/) / `REQUIRES VERIFICATION` (региональные ограничения IP) |
| **Bybit** | Spot + Linear / Inverse | V5 REST, V5 WS | V5 Linear / Inverse | Доступен через V5 Market | Доступен (текущий и прогноз) | V5 execution / liquidation streams | [Bybit V5 Docs](https://bybit-exchange.github.io/docs/v5/intro) / `VERIFIED ARCHITECTURE` |
| **OKX** | Spot + Margin + Futures + Swaps | V5 REST, V5 Public WS | V5 Futures / Swap | Доступен (Public Data REST/WS)| Доступен (8h / 4h / 1h по рынкам) | V5 Public Liquidation Orders | [OKX V5 Docs](https://www.okx.com/docs-v5/en/) / `REQUIRES VERIFICATION` |
| **Coinbase** | Spot + Institutional Futures | Advanced Trade REST/WS | Derivatives (ограничено) | Ограничено | N/A (в основном спот) | N/A | [Coinbase Developer](https://docs.cdp.coinbase.com/) / `REQUIRES VERIFICATION` |

---

## 2. Специфика сбора деривативных метрик

### 2.1. Открытый интерес (Open Interest)
- **Суть метрики:** Общее количество незакрытых контрактов деривативов в обращении на бирже.
- **Особенности нормализации:**
  - На разных биржах OI отдается либо в базовой валюте (например, BTC), либо в контрактах (номинал контракта), либо в USD.
  - Конвейер нормализации CRYPTORA обязан переводить все значения в единую базовую единицу: **USD Notional Value** (`OI_contracts * contract_val * mark_price` или `OI_coins * mark_price`).

### 2.2. Ставка финансирования (Funding Rate)
- **Суть метрики:** Механизм привязки цены бессрочного фьючерса (Perpetual Swap) к спотовой индексной цене.
- **Особенности нормализации:**
  - Периодичность: стандартный интервал 8 часов (00:00, 08:00, 16:00 UTC), однако некоторые биржи (OKX, Bybit для волатильных инструментов) используют динамические интервалы 4h, 2h или 1h.
  - Нормализация CRYPTORA: хранение оригинальной ставки за период (`rate_per_interval`) и расчет годовой ставки (`annualized_rate = rate * (24 / interval_hours) * 365 * 100%`).

### 2.3. Ликвидации (Liquidations)
- **Критический архитектурный рубеж:**
  - Биржевой поток ликвидаций (например, Binance `forceOrder` stream) сообщает о **фактически сработавшем принудительном рыночном ордере** (`Actual liquidation`).
  - Расчетная тепловая карта ликвидаций (Liquidation Levels Heatmap) — это **математическая симуляция / гипотетическая модель** (`Estimated / Model`), основанная на анализе открытого интереса, объемов на разных уровнях плеча и движении цен.
  - **ПРАВИЛО:** Никогда не объединять и не подменять фактические данные симулированными без огромного предупреждения.

---

## 3. Лимиты запросов (Rate Limits) и стратегия устойчивости

1. **REST Rate Limits:**
   - Каждая биржа реализует систему весов запросов (Weight based) или скользящих окон (например, 1200 request weight/min у Binance, 120 req/sec у Bybit).
   - Будущий модуль `Collector` обязан содержать внутренний Token Bucket Rate Limiter для каждого API ключа / IP адреса.
2. **WebSocket Resilience:**
   - Реализация постоянного heartbeat (ping/pong) каждые 15–30 секунд.
   - Экспоненциальный откат (Exponential Backoff) при разрыве сокета.
   - Механизм дедупликации сообщений по уникальным `event_id` или монотонным sequence-номерам.
