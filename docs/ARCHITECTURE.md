# ARCHITECTURE — Системная архитектура CRYPTORA

> **Проект:** CRYPTORA — Crypto Market Intelligence Terminal  
> **Версия архитектуры:** v0.1.0 (Целевая модель конвейера и фазирование)

---

## 1. Целевая архитектурная цепочка данных

В долгосрочной перспективе CRYPTORA строится вокруг однонаправленного потока обработки рыночной информации:

```
+---------------------------------------------------------+
|                EXCHANGE WEBSOCKETS & REST               |
|            (Binance, Bybit, OKX, Coinbase)              |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|                  COLLECTORS & WORKERS                   |
|        (Resilient Ingestion, Connection Pooling)        |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|               NORMALIZATION & VALIDATION                |
|      (Zod Schemas, Canonical Asset & Symbol Map)        |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|                  MARKET DATA STORAGE                    |
|      (TimescaleDB / ClickHouse for High-Frequency       |
|            PostgreSQL for Core State & Relational)      |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|            CALCULATION ENGINES (DETERMINISTIC)          |
|  ┌───────────────────┬────────────────────────────────┐ |
|  | Indicators (RSI,  | Derivatives (Aggregated OI,    | |
|  | MACD, EMA, CVD)   | Funding Weighting, Basis)      | |
|  ├───────────────────┼────────────────────────────────┤ |
|  | Liquidations Track| Volume & Market Structure      | |
|  └───────────────────┴────────────────────────────────┘ |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|                 EVENT & ANOMALY ENGINE                  |
|    (Statistical Outliers: Z-Score Volume, OI Bursts)    |
+---------------------------------------------------------+
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
+───────────────────────+       +───────────────────────+
| SCREENER & RADAR STREAM       |   HISTORICAL ENGINE   |
| (Low-latency cache/SSE)       | (Candle Rollup, OHLCV)|
+───────────────────────+       +───────────────────────+
            │                               │
            │                               ▼
            │                   +───────────────────────+
            │                   |    BACKTEST ENGINE    |
            │                   | (No Look-Ahead, Fees) |
            │                   +───────────────────────+
            │                               │
            │                               ▼
            │                   +───────────────────────+
            │                   |   STRATEGIES ENGINE   |
            │                   +───────────────────────+
            │                               │
            └───────────────┬───────────────┘
                            ▼
+---------------------------------------------------------+
|              SIGNALS & AUDITABLE HISTORY                |
|          (Immutable Records, Replay Support)            |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|                 WEB API & ALERTS SYSTEM                 |
|             (FastAPI / Go / Node REST + WS)             |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|                 FRONTEND CLIENT TERMINAL                |
|           (React, TypeScript, Lightweight Charts)       |
+---------------------------------------------------------+
                            │
                            ▼
+---------------------------------------------------------+
|               AI EXPLANATION LAYER (LATE)               |
|      (Grounding LLM on Deterministic Engine Facts)      |
+---------------------------------------------------------+
```

---

## 2. Архитектура Этапа 1 (Visual Foundation & Demo Provider)

На первом этапе мы намеренно **НЕ разворачиваем тяжелую серверную инфраструктуру, микросервисы и WebSocket-пайплайны**, чтобы не размывать фокус и избежать преждевременной оптимизации.

Однако граница данных на фронтенде заложена так, словно бэкенд уже существует:

```
┌─────────────────────────────────────────────────────────┐
│                     UI Components                       │
│    (Overview, MarketTable, CoinView, Screener, etc.)    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼ Uses hook
┌─────────────────────────────────────────────────────────┐
│               MarketDataProvider Interface              │
│  - getMarketOverview(): Promise<MarketOverviewData>     │
│  - getAssets(): Promise<AssetSummary[]>                 │
│  - getAssetDetail(symbol): Promise<AssetDetail>         │
│  - getFuturesList(): Promise<FuturesAsset[]>            │
│  - getLiquidationsSnapshot(): Promise<LiquidationData>  │
│  - getRadarEvents(): Promise<RadarEvent[]>              │
│  - getScreenerResults(criteria): Promise<AssetSummary[]>│
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼ Concrete implementation
┌─────────────────────────────────────────────────────────┐
│               DemoMarketDataProvider                    │
│   (Deterministic typed store, strictly isolated mock    │
│    dataset, explicit isDemo: true metadata)             │
└─────────────────────────────────────────────────────────┘
                             │
                             ▼ Future replacement (Stage 2+)
┌─────────────────────────────────────────────────────────┐
│               LiveMarketDataProvider                    │
│   (REST client + WebSocket client to API Gateway)       │
└─────────────────────────────────────────────────────────┘
```

### Преимущество подхода
Любой компонент приложения вызывает методы провайдера (`useMarketData()`). Ни один экран не обращается к глобальным константам или статическим файлам напрямую. При наступлении Этапа 2 подменяется только инстанс реализации провайдера на `LiveMarketDataProvider`.

---

## 3. Модели данных и валидация

Все сущности валидируются через схемы **Zod**:
1. `AssetSummarySchema`: рыночный снимок инструмента (цена, изменения за 1h/24h/7d, капитализация, суточный объем, спарклайн).
2. `OHLCVSchema`: таймсерия свечей (timestamp, open, high, low, close, volume).
3. `FuturesAssetSchema`: деривативные метрики (funding rate, open interest, дельты 1h/24h, базис, суточные ликвидации).
4. `LiquidationEventSchema`: единичное фактическое событие ликвидации (время, символ, сторона, объем USD, биржа, цена исполнения).
5. `RadarEventSchema`: обнаруженная математическая аномалия (время, символ, тип аномалии, важность, текстовое описание).
6. `ScreenerFilterSchema`: параметры запроса фильтрации.

---

## 4. Стратегия масштабирования хранения данных (Future Phases)

1. **Таймсерии высокой частоты (High Frequency Trades / Order Book Snapshots):**
   - ClickHouse или TimescaleDB с партиционированием по дням/месяцам.
   - Сжатие исторических срезов (Gorilla compression для float, Delta-of-delta для timestamps).
2. **Агрегированные свечи (1m, 5m, 1h, 1D):**
   - Pre-aggregated continuous aggregates (автоматическое инкрементальное обновление представлений).
3. **Метаданные пользователей, настройки скринера, списки наблюдения:**
   - Реляционная СУБД (PostgreSQL) с транзакционной целостностью.
4. **Кэш реального времени:**
   - Redis для горячих котировок, последних сделок и pub/sub каналов радара.
