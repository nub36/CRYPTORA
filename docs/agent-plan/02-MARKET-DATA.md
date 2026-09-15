# 02-MARKET-DATA — Этап 2: Публичные спотовые рыночные данные (Binance & KuCoin)

> **Статус:** ТЕКУЩИЙ ЭТАП (В реализации)  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** Интеграции используются ИСКЛЮЧИТЕЛЬНО для получения публичных рыночных данных (Market Intelligence). Никаких торговых endpoints, аутентифицированных торговых API или запросов торговых ключей.

---

## 1. Область охвата (Scope)

### Биржи
1. **Binance** (Primary source)
2. **KuCoin** (Secondary source / fallback / comparison)

### Начальный контролируемый Universe: 25 криптоактивов
Universe централизован, конфигурируем и строго зафиксирован в каноническом реестре (Asset Registry):
`BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `ADA`, `DOGE`, `AVAX`, `LINK`, `DOT`, `SUI`, `NEAR`, `APT`, `RENDER`, `TAO`, `INJ`, `UNI`, `AAVE`, `OP`, `ARB`, `TIA`, `FET`, `KAS`, `RUNE`, `SEI`.

> *Примечание:* Список не называется динамическим «Top 25 по капитализации», так как внешний динамический источник глобального рейтинга подключается на последующих этапах.

### Канонический Asset Registry
- Канонический тикер (например, `BTC`)
- Название и сектор
- Маппинг символа Binance (например, `BTCUSDT`)
- Маппинг символа KuCoin (например, `BTC-USDT`)
- Грациозная деградация: отсутствие инструмента на одной бирже не ломает систему.

---

## 2. Поставляемые данные

- Публичные spot market data;
- Ticker / последняя цена (`lastPrice`);
- 24h статистика (high, low, open, change, changePercent);
- Объем базового и котируемого актива (baseVolume, quoteVolume);
- OHLCV свечи (исторические бары);
- Метаданные инструментов;
- Метки времени (timestamp);
- Происхождение данных (Data Provenance: `exchange`, `market`, `symbol`, `timestamp`).

---

## 3. Архитектурная цепочка данных

```
UI Components (Overview, Market, CoinDetail, etc.)
                      │
                      ▼
            MarketDataProvider Interface
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
DemoMarketDataProvider    LiveMarketDataProvider
                                   │
                      ┌────────────┴────────────┐
                      ▼                         ▼
             BinanceSpotAdapter        KuCoinSpotAdapter
             (Primary REST API)       (Secondary / Fallback)
```

1. **DTO Runtime Validation:** Специфичные ответы бирж проверяются строгими схемами Zod.
2. **Normalization:** Валидированные DTO трансформируются в унифицированные доменные сущности CRYPTORA (`CryptoAsset`, `CandleData`).
3. **Multi-Exchange Fallback:** При недоступности Binance автоматически опрашивается KuCoin с сохранением прозрачной метки источника (`exchange: 'kucoin'`).
4. **Режимы DEMO и LIVE:**
   - Режимы изолированы.
   - Запрещено подставлять фиктивные demo-числа при сбое сети в Live-режиме (отображается явное состояние ошибки / unavailable / stale).
   - Подсистемы, еще не переведенные на живой поток (Futures, Liquidations), остаются явно маркированными как Демонстрационные.

---

## 4. Что НЕ входит в Этап 2
- WebSocket realtime pipeline (запланирован на Этап 3);
- Futures live integration (запланирован на Этап 5);
- Open Interest / Funding / Liquidations live streams (сохраняются в контролируемом demo-режиме);
- Собственная историческая база данных (Этап 4);
- Indicator Engine, Strategy Engine, Backtest Engine, AI;
- Торговые боты, аутентификация, кошельки, управление сделками (ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ).

---

## 5. Тестирование
- Тесты CI не зависят от внешних серверов Binance и KuCoin.
- Используются детерминированные фикстуры с реальной структурой ответов обеих бирж.
- Покрываются: валидация DTO, нормализация, маппинг символов, неподдерживаемые тикеры, битые ответы, таймауты, fallback с Binance на KuCoin, свечи OHLCV и сохранение provenance.
