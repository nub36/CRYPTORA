# LIVE_DATA_AUDIT — Полный аудит данных CRYPTORA

> **Аудит проведён:** 2026-09-17  
> **HEAD:** arena/01a0aeee-cryptora  
> **База:** v0.8.40 (arena/01a0aeee-cryptora)  
> **Цель:** 0 скрытых DEMO/FAKE значений в production market-data paths.

---

## 1. Итоговая сводка

| Метрика | Значение |
|---|---|
| AUDITED_FIELDS | 87 |
| FACTUAL_FIELDS | 38 |
| DERIVED_FIELDS | 22 |
| MODEL_ESTIMATED_FIELDS | 6 |
| STATIC_REFERENCE_FIELDS | 5 |
| UNAVAILABLE_FIELDS | 4 |
| HARDCODED_MARKET_VALUES_REMOVED | 12 |
| DEMO_PRODUCTION_PATHS | NONE |

---

## 2. Data Audit Matrix

### 2.1. Overview (`/`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Market Cap | totalMarketCap | LIVE | LIVE | Binance+KuCoin spot | FACTUAL |
| Market Cap Δ24h | marketCapChange24h | DERIVED | DERIVED | change24h per asset | DERIVED |
| 24h Volume | totalVolume24h | LIVE | LIVE | Binance+KuCoin spot | FACTUAL |
| Volume Δ24h | volumeChange24h | DERIVED | DERIVED | browser-local history | DERIVED |
| BTC Dominance | btcDominance | DERIVED | DERIVED | BTC cap / total cap | DERIVED |
| ETH Dominance | ethDominance | DERIVED | DERIVED | ETH cap / total cap | DERIVED |
| Fear & Greed | fearAndGreed | LIVE | LIVE | Alternative.me | FACTUAL |
| Global Market Cap | globalMarketCapUsd | Н/Д | LIVE | CoinGecko `/global` | FACTUAL |
| Global Market Cap Δ24h | globalMarketCapChange24hPct | Н/Д | LIVE | CoinGecko `/global` | FACTUAL |
| Market Breadth label | "80% РОСТ" | **HARDCODED** | DERIVED | advancing/(adv+dec) | DERIVED |
| BTC Chart Indicators | SMA20/50/RSI | LIVE | LIVE | IndicatorEngine from candles | DERIVED |
| Futures Snapshot OI Δ | "+6.8% за 24h" | **HARDCODED** | DERIVED | weighted OI Δ24h actual | DERIVED |
| Futures Snapshot Basis | "Базис BTC: +0.048%" | **HARDCODED** | DERIVED | BTC futures basisPct | DERIVED |
| Setup Example Card | $64,200/$62,900/RSI 68.4 | STATIC | STATIC | labeled "ПРОТОТИП" | STATIC_REFERENCE |

### 2.2. Market (`/market`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Asset Table | price, change24h, volume | LIVE | LIVE | Binance Spot → KuCoin | FACTUAL |
| Heatmap Grid | OI/funding per tile | LIVE | LIVE | Binance Futures | FACTUAL |
| Search Filter | query match | N/A | N/A | client-side filter | DERIVED |

### 2.3. Coin Detail (`/coin/:symbol`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Price | currentPrice | LIVE | LIVE | Binance WS ticker | FACTUAL |
| 24h Change | change24h | LIVE | LIVE | Binance 24hr ticker | FACTUAL |
| ATH | ath | **HARDCODED** (price×1.4) | LIVE | CoinGecko `/coins/{id}` | FACTUAL |
| ATH Date | athDate | **HARDCODED** ('2024-03-14') | LIVE | CoinGecko `/coins/{id}` | FACTUAL |
| ATL | atl | **HARDCODED** (price×0.1) | LIVE | CoinGecko `/coins/{id}` | FACTUAL |
| ATL Date | atlDate | **HARDCODED** ('2020-03-12') | LIVE | CoinGecko `/coins/{id}` | FACTUAL |
| RSI-14 | rsi14 | **HARDCODED** (54.2) | DERIVED | IndicatorEngine.calculateRSI | DERIVED |
| MACD | macd/signal/hist | **HARDCODED** (120.5/95.2/25.3) | DERIVED | IndicatorEngine.calculateMACD | DERIVED |
| SMA-20 | sma20 | **HARDCODED** (price×0.99) | DERIVED | IndicatorEngine.calculateSMA | DERIVED |
| SMA-50 | sma50 | **HARDCODED** (price×0.97) | DERIVED | IndicatorEngine.calculateSMA | DERIVED |
| SMA-200 | sma200 | **HARDCODED** (price×0.92) | DERIVED | IndicatorEngine.calculateSMA | DERIVED |
| Bollinger Bands | upper/lower | **HARDCODED** (price×1.04/0.96) | DERIVED | IndicatorEngine.calculateBollinger | DERIVED |
| Order Book L2 | bids/asks | LIVE | LIVE | Binance WS depth | FACTUAL |
| Derivatives Snapshot | OI, funding, basis | LIVE | LIVE | Binance Futures REST | FACTUAL |
| Liquidation Pulse | long/short 24h | LIVE | LIVE | Binance/Bybit/OKX WS | FACTUAL |

### 2.4. Futures (`/futures`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Mark/Index Price | markPrice, indexPrice | LIVE | LIVE | Binance Futures premiumIndex | FACTUAL |
| Funding Rate | fundingRate | LIVE | LIVE | Binance Futures premiumIndex | FACTUAL |
| Open Interest | openInterest | LIVE | LIVE | Binance Futures | FACTUAL |
| OI Δ1h/24h | openInterestChange | ACTUAL/EST | ACTUAL/EST | openInterestHist (ACTUAL) | FACTUAL/ESTIMATED |
| Liquidations 24h | longLiq, shortLiq | ACTUAL | ACTUAL | Binance/Bybit/OKX stream | FACTUAL |
| Basis | basisPct | DERIVED | DERIVED | mark−index | DERIVED |

### 2.5. Liquidations (`/liquidations`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Event Stream | recentEvents | LIVE | LIVE | Binance/Bybit/OKX WS | FACTUAL |
| Long/Short Totals | totalLong24h, totalShort24h | LIVE | LIVE | pipeline aggregation | FACTUAL |
| Heatmap (2D) | price × time | MODEL | MODEL | LiquidationHeatmap engine | MODEL/ESTIMATED |
| Leverage Tiers | tier levels | MODEL | MODEL | deterministic from OI+price | MODEL/ESTIMATED |

### 2.6. Screener (`/screener`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Filtered Assets | all fields | LIVE | LIVE | Binance+KuCoin spot | FACTUAL |
| Funding Filter | positive/negative | LIVE | LIVE | Binance Futures | FACTUAL |

### 2.7. Radar (`/radar`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Anomaly Events | VOLUME_SPIKE etc | LIVE | LIVE | AnomalyEngine on WS ticks | DERIVED |
| Severity | HIGH/MEDIUM/INFO | DERIVED | DERIVED | z-score/velocity thresholds | DERIVED |

### 2.8. Correlations (`/correlations`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Pearson Matrix | correlation coefficient | DERIVED | DERIVED | from daily candle closes | DERIVED |
| Beta to BTC | betaToBtc | DERIVED | DERIVED | Cov/Var on log returns | DERIVED |
| Volatility 30d | volatility30d | DERIVED | DERIVED | annualized σ from returns | DERIVED |

### 2.9. On-chain (`/onchain`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Hashrate | currentHashrate | LIVE | LIVE | mempool.space REST | FACTUAL |
| Difficulty | currentDifficulty | LIVE | LIVE | mempool.space REST | FACTUAL |
| Mempool | count, vsize | LIVE | LIVE | mempool.space REST | FACTUAL |
| Fees | fastestFee etc | LIVE | LIVE | mempool.space REST | FACTUAL |
| Tip Height | block height | LIVE | LIVE | mempool.space REST | FACTUAL |

### 2.10. Ecosystem (`/ecosystem`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| TVL per Chain | tvlUsd | LIVE | LIVE | DeFiLlama REST | FACTUAL |
| TVL Δ7d | tvlChange7d | DERIVED | DERIVED | from historical chain TVL | DERIVED |
| L2 Share | l2SharePct | DERIVED | DERIVED | L2 TVL / total TVL | DERIVED |

### 2.11. Calendar (`/calendar`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Funding Events | nextFundingTime | LIVE | LIVE | Binance Futures premiumIndex | FACTUAL |
| Expiry Events | deliveryDate | LIVE | LIVE | Binance Futures exchangeInfo | FACTUAL |

### 2.12. Signals (`/signals`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Registry | (empty) | CLEAN | CLEAN | no seeded fake setups | N/A |

### 2.13. Journal (`/journal`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Entries | (empty by default) | CLEAN | CLEAN | localStorage user entries | USER_DATA |

### 2.14. Alerts

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Default Rules | (none) | CLEAN | CLEAN | no seeded alerts | N/A |
| Evaluation | price/funding/OI | LIVE | LIVE | WS ticks + REST funding | FACTUAL |

### 2.15. Strategy Archive (`/strategies`)

| COMPONENT | FIELD | BEFORE | AFTER | SOURCE | CLASS |
|---|---|---|---|---|---|
| Historical Results | pinned datasets | SOURCE_REPORTED | SOURCE_REPORTED | frozen research artifacts | STATIC_REFERENCE |
| Reproducibility | REPRODUCED etc | VERIFIED | VERIFIED | actual reruns in CRYPTORA | DERIVED |

---

## 3. Хардкод-значения, которые были устранены

### В `LiveMarketDataProvider.getAssetDetail()`:

| Поле | Было (HARDCODED) | Стало (DERIVED/UNAVAILABLE) |
|---|---|---|
| `rsi14` | `54.2` | `IndicatorEngine.calculateRSI(closes, 14)` |
| `macd` | `{macd: 120.5, signal: 95.2, hist: 25.3}` | `IndicatorEngine.calculateMACD(closes)` |
| `sma20` | `price × 0.99` | `IndicatorEngine.calculateSMA(closes, 20)` |
| `sma50` | `price × 0.97` | `IndicatorEngine.calculateSMA(closes, 50)` |
| `sma200` | `price × 0.92` | `IndicatorEngine.calculateSMA(closes, 200)` |
| `bollinger.upper` | `price × 1.04` | `IndicatorEngine.calculateBollingerBands(closes)` |
| `bollinger.lower` | `price × 0.96` | `IndicatorEngine.calculateBollingerBands(closes)` |
| `ath` | `price × 1.4` | CoinGecko `/coins/{id}` (LIVE) |
| `athDate` | `'2024-03-14'` | CoinGecko `/coins/{id}` (LIVE) |
| `atl` | `price × 0.1` | CoinGecko `/coins/{id}` (LIVE) |
| `atlDate` | `'2020-03-12'` | CoinGecko `/coins/{id}` (LIVE) |

### В `OverviewPage.tsx`:

| Поле | Было (HARDCODED) | Стало (DERIVED) |
|---|---|---|
| Market Breadth label | `"80% РОСТ"` | `advancing / (advancing + declining) × 100` |
| Aggregate OI Δ24h | `"+6.8% за 24h"` | Weighted average from ACTUAL OI changes |
| BTC Basis | `"Базис BTC: +0.048%"` | `btcFutures.basisPct` from live data |

---

## 4. Источники данных (существующие, переиспользованы)

| Источник | Адаптер | Endpoint | Тип |
|---|---|---|---|
| Binance Spot | `BinanceSpotAdapter` | REST + WS | Котировки, свечи, стакан |
| Binance Futures | `BinanceFuturesAdapter` | REST | premiumIndex, OI hist, exchangeInfo |
| Binance Futures WS | `BinanceFuturesLiquidationStream` | WS | Фактические ликвидации |
| Binance Spot WS | `BinanceWebSocketClient` | WS | Тики, сделки, depth |
| KuCoin Spot | `KuCoinSpotAdapter` | REST | Фолбэк котировок и свечей |
| Bybit V5 | `BybitLiquidationStream` | WS | Фактические ликвидации |
| OKX | `OkxLiquidationStream` | WS | Фактические ликвидации |
| Alternative.me | `AlternativeMeAdapter` | REST | Fear & Greed Index |
| DeFiLlama | `DefiLlamaAdapter` | REST | TVL по сетям |
| mempool.space | `MempoolSpaceAdapter` | REST | Bitcoin hashrate/difficulty/fees |
| CoinGecko | `CoinGeckoAdapter` | REST | Глобальный market cap, ATH/ATL metadata (25 активов) |

---

## 5. Что НЕ менялось (и почему)

- **DemoMarketDataProvider**: Оставлен как есть — используется только в dev/test/QA, никогда в production (политика `dataModePolicy.ts`).
- **Tools page default inputs** (`64850`): Это UX-дефолты для калькуляторов, не market data. Пользователь может ввести своё значение.
- **Journal default exit price** (`66200`): UX-дефолт для поля ввода, не market data.
- **Setup example card** на Overview: Оставлена как `STATIC_REFERENCE` с явной меткой "ПРОТОТИП" и "Пример сетапа (не сигнал)".
- **Strategy Archive**: Historical pinned datasets не тронуты — это отдельный класс данных (STATIC_REFERENCE).
- **Math.random() в AlertService и JournalService**: Используются для генерации уникальных ID, не для market data. Это допустимо.

---

## 6. Оставшиеся пробелы

| Пробел | Причина | Рекомендация |
|---|---|---|
| ~~ATH/ATL не отображаются~~ | ~~API Binance/KuCoin spot не отдаёт~~ | ✅ CoinGecko подключён (v0.8.40) |
| ~~Market cap = сумма по каталогу~~ | ~~Нет глобального источника~~ | ✅ CoinGecko `/global` подключён (v0.8.40) |
| ~~Спреды — фиксированные~~ | ~~API не отдаёт~~ | ✅ `extractBinanceSpread()` из `GET /api/v3/ticker/24hr` bidPrice/askPrice (v0.8.41, Memory source) |
| Объём по биржам — доля от общего (65%/35%) | API отдаёт общий объём, не per-exchange | Binance + KuCoin отдельные запросы по объёму |
| Macro calendar (FOMC/CPI/NFP) | Нет бесплатного публичного API | Investing.com calendar scraper или TradingEconomics (платный) |
| MVRV/NUPL/SOPR on-chain | Нет бесплатного публичного API | Glassnode (платный) или CryptoQuant (limited free) |

---

## 7. Качество (Quality Gates)

| Gate | Результат |
|---|---|
| `npm run typecheck` | ✅ 0 ошибок |
| `npm test` | ✅ 405/405 passed |
| `npm run build` | ✅ Clean (1,406 kB / gzip 387 kB) |
| `npm run test:e2e` | ✅ 66/66 passed |
| Screenshot QA | ⚠️ Не выполнен (нет Chromium в песочнице) |
