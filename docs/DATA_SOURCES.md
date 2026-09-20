# DATA_SOURCES — Источники данных CRYPTORA

> Актуально на v0.8.46, 2026-09-20 (раздел «Свечи: приоритет источника и окно запроса» добавлен в v0.8.46).

## Источники

| Источник | Тип | Данные | Rate Limit | Кэш |
|----------|-----|--------|------------|-----|
| Binance Spot REST | Публичный | Цена, 24h статистика, свечи, спред | 1200 weight/min | 10s (assets), 30s (candles) |
| Binance Futures REST | Публичный | PremiumIndex, OI, 24h тикеры | 2400 weight/min | 10s (futures), 5min (OI history) |
| Binance WS | Публичный | Ticker, trades, depth, kline | 5 streams/user | realtime |
| Binance WS (liquidation) | Публичный | `!forceOrder@arr` | 1 stream | realtime, 24h window |
| KuCoin Spot REST | Публичный | Цена, 24h статистика, свечи | 10 req/s | 10s |
| CoinGecko REST | Публичный (без ключа) | Global market cap, BTC/ETH dominance, ATH/ATL, supply | ~30 req/min | 10min (global), per-coin |
| Alternative.me | Публичный (без ключа) | Fear & Greed Index | ~10 req/min | 10min |
| mempool.space | Публичный (без ключа) | Hashrate, difficulty, mempool, fees | ~10 req/min | 2min |
| DeFiLlama | Публичный (без ключа) | TVL по сетям, Δ7d | ~30 req/min | 5min |
| Bybit V5 WS | Публичный | Liquidation stream | 1 stream | realtime |
| OKX WS | Публичный | Liquidation stream | 1 stream | realtime |

## 25 Canonical Assets — Coverage Matrix

| # | Symbol | Binance Spot | KuCoin | CoinGecko | Binance Futures | Order Book |
|---|--------|-------------|--------|-----------|----------------|------------|
| 1 | BTC | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 2 | ETH | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 3 | SOL | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 4 | BNB | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 5 | XRP | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 6 | ADA | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 7 | DOGE | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 8 | AVAX | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 9 | DOT | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 10 | LINK | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 11 | MATIC | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 12 | UNI | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 13 | SHIB | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 14 | LTC | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 15 | BCH | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 16 | ATOM | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 17 | NEAR | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 18 | FTM | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 19 | APT | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 20 | SUI | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 21 | ARB | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 22 | OP | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 23 | INJ | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 24 | TIA | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |
| 25 | WIF | ✅ | ✅ | ✅ | ✅ (runtime) | ✅ |

- **Spot/Candles/Metadata**: 25/25 (100%)
- **Futures**: runtime-determined via Binance exchangeInfo; not hardcoded
- **Order Book**: all 25 via Binance depth WS stream

## Data Classification

| Метрика | Источник | Класс |
|---------|----------|-------|
| Price | Binance Spot WS | FACTUAL_LIVE |
| change24h | Binance 24hrTicker | FACTUAL_LIVE |
| change1h | Binance 1h klines (CandleHistoryService) | DERIVED_FROM_FACTUAL |
| change7d | Binance 1D klines (CandleHistoryService) | DERIVED_FROM_FACTUAL |
| Sparkline | Binance 1h klines (24 closes) | DERIVED_FROM_FACTUAL |
| Market Cap (universe) | Derived sum of 25 tracked assets | DERIVED_FROM_FACTUAL |
| Market Cap (global) | CoinGecko `/api/v3/global` | FACTUAL_CACHED |
| BTC/ETH Dominance (global) | CoinGecko `/api/v3/global` | FACTUAL_CACHED |
| BTC/ETH Dominance (universe) | Derived from 25-asset catalog | DERIVED_FROM_FACTUAL |
| Fear & Greed | Alternative.me | FACTUAL_CACHED |
| Funding Rate | Binance premiumIndex | FACTUAL_LIVE |
| Open Interest | Binance openInterest REST | FACTUAL_LIVE |
| OI Delta 1h/24h | Binance openInterestHist | DERIVED_FROM_FACTUAL |
| OI Delta (no history) | — | UNAVAILABLE (null) |
| Liquidation events | WS stream (Binance/Bybit/OKX) | FACTUAL_LIVE |
| Liquidation aggregates | Pipeline (24h rolling window) | DERIVED_FROM_FACTUAL |
| Liquidation levels | Model from price + OI | MODEL_ESTIMATED |
| RSI/MACD/SMA | IndicatorEngine on candle data | DERIVED_FROM_FACTUAL |
| ATH/ATL | CoinGecko per-coin | FACTUAL_CACHED |
| Supply (total/max) | CoinGecko per-coin | FACTUAL_CACHED |
| Correlation/Beta | IndicatorEngine on daily klines | DERIVED_FROM_FACTUAL |
| Portfolio Beta | CandleHistoryService daily closes | DERIVED_FROM_FACTUAL |
| Portfolio Beta (no candles) | — | UNAVAILABLE (null) |
| Portfolio Volatility | CandleHistoryService daily closes | DERIVED_FROM_FACTUAL |
| VaR | Derived from volatility | DERIVED_FROM_FACTUAL |

## Freshness Thresholds

| Категория | Порог | Пример |
|-----------|-------|--------|
| WS ticker | 10с | Binance WS price |
| WS order book | 10с | Binance depth stream |
| WS kline | 15с | Binance kline stream |
| WS liquidation | 15с | forceOrder stream |
| REST futures | 60с | premiumIndex, OI |
| REST candles | 2мин | Binance/KuCoin klines |
| REST metadata | 5мин | CoinGecko ATH/ATL/supply |
| REST global | 5мин | CoinGecko global market cap |
| REST onchain | 2мин | mempool.space |

## Свечи: приоритет источника и окно запроса

- **Основной источник** — Binance Spot `GET /api/v3/klines` с `limit ≤ 1000`; LIVE-движок сигналов запрашивает 1000
  закрытых 1h-баров (+4h/1D для структурных серий).
- **Резерв** — KuCoin Spot `GET /api/v1/market/candles` с явным окном `startAt`/`endAt` (Unix seconds) и обрезкой до
  запрошенной глубины (v0.8.46). Без окна биржа отдаёт собственную страницу по умолчанию, и глубина истории не
  гарантирована; если резерв отдал меньше запрошенного, провайдер пишет `console.warn`, а движок честно отчитывается о
  нехватке истории (`getStatus()`), ничего не подставляя и не дорисовывая.

## Неподключённые источники (REMAINING_GAPS)

- MVRV/NUPL: нет бесплатного API без ключа
- Макро-календарь (FOMC/CPI/NFP): нет скраппера Investing.com
- S&P 500 / Gold / DXY: нет бесплатного API
- AI (LLM): OPENAI_API_KEY не в браузере, не deploy

## CoinGecko Usage Policy

- `/api/v3/global`: 1 запрос на Overview (global market cap, BTC/ETH dominance)
- `/api/v3/coins/{id}`: только в `getAssetDetail()` (по одному на карточку актива)
- НЕ запрашивается в `getAssets()` (bulk overview) — избегаем N+1
- Кэш: global 10min, per-coin 5min
- 429: graceful unavailable, stale cache сохраняется
- Attribution: CoinGecko ToS не требует видимой attribution для бесплатного API
