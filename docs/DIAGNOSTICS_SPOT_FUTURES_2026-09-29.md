# CRYPTORA — Spot/Futures market data & chart pipeline diagnostics (2026-09-29)

Baseline fixed **before** any change:

```
git status --porcelain     ->  (clean)
git branch --show-current  ->  arena/01a0ebd4-cryptora
git rev-parse HEAD         ->  9e93a2e464daba343d3481a760241c463a842b6a
git rev-parse origin/main  ->  9e93a2e464daba343d3481a760241c463a842b6a
npm run typecheck          ->  PASS
npm test -- --run          ->  154 files / 1701 tests PASS
```

## 0. Verification classes used in this document

| Class | Meaning |
| --- | --- |
| **UNIT FIXTURE** | Verified against in-repo fixtures / mocked `fetch`. Proves mapping and rendering logic. |
| **INTEGRATION** | Verified through the *real* CRYPTORA module chain (gateway → adapter → normalization → provider → UI) with a stubbed transport at the outermost HTTP boundary only. |
| **LIVE UPSTREAM** | Verified against api.binance.com / fapi.binance.com. |

> ⚠️ **LIVE UPSTREAM verification was not possible from this sandbox.**
> Egress to `api.binance.com` / `fapi.binance.com` is blocked in the build
> environment (TLS handshake refused, `curl` exit 35 / HTTP 000; the HTTP
> fetch tool receives Binance's `Service unavailable from a restricted
> location` body). Every claim below is therefore **UNIT FIXTURE** or
> **INTEGRATION** unless explicitly marked otherwise, and
> `npm run diagnose:charts` is provided so the owner can run the LIVE class
> on a machine with Binance egress (VPS) and attach the output.

---

## 1. ROOT CAUSE — Futures instruments show `—` / `Нет данных`

### RC-1 (primary) — Open Interest was capped at 30 contracts, client-side, N+1

`src/services/data/LiveMarketDataProvider.ts`

```ts
export const FUTURES_OI_DETAIL_LIMIT = 30;
...
const oiSymbols = [...].slice(0, FUTURES_OI_DETAIL_LIMIT);
const oiHistMap = await this.fetchOpenInterestHistory(oiSymbols, now);
const oiSpotMap = await this.fetchOpenInterestSpot(oiSymbols, now);
```

Binance USD-M exposes open interest only per symbol
(`/fapi/v1/openInterest`, weight 1) and OI history only per symbol
(`/futures/data/openInterestHist`). There is **no bulk OI endpoint**.
Because those calls were issued *from the browser*, the code had to cap them
at 30 contracts to avoid a request storm. Consequence on production, for the
~470 remaining USDT perpetuals:

* `openInterest === null` → the **`—`** in the *Открытый интерес* column;
* `openInterestChangeSource === 'UNAVAILABLE'` → `OiDeltaBadge` renders the
  literal string **`Нет данных`** in the *OI 1h Δ* / *OI 24h Δ* columns.

That is exactly the reported symptom. The data **does exist upstream**;
CRYPTORA was dropping it because the fetch budget lived in the wrong tier.

**Fix:** move the sweep to the server
(`server/services/futuresMarketData.js`), where one controlled-concurrency
sweep per TTL serves *all* browsers, and expose it as one aggregated
same-origin payload `GET /api/market/derivatives/futures`.

### RC-2 — `ticker.priceChangePercent` was parsed and thrown away

`DerivativesEngine.normalizeFuturesAsset` computed

```ts
const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
```

and used it **only** as the sign input of the liquidation heuristic. It was
never written to `FuturesAsset`, `FuturesAssetSchema` had no field for it,
and the Futures table had no 24h-change column at all. Real upstream data,
already downloaded, discarded at normalization.

### RC-3 — missing 24h volume was rendered as a fabricated `$0.00`

```ts
const volume24hUsd = ticker ? parseFloat(ticker.quoteVolume) : 0;   // 0 ≠ null
...
{formatCurrency(f.futuresVolume24h, { compact: true })}             // -> "$0.00"
```

A contract whose ticker row was absent rendered `$0.00` — indistinguishable
from a genuinely dead market. This violates the project's own “0 ≠ null”
rule. `futuresVolume24h` is now `number | null` and renders `Нет данных`.

### RC-4 — contracts without a `premiumIndex` row were silently dropped

```ts
const premium = premiumMap.get(contract.exchangeSymbol);
if (!premium) continue;
```

No counter, no diagnostic. A partial upstream failure silently shrank the
universe and the “N активных USDT-M perpetual” caption with it. The server
snapshot now reports `contractsTotal / withPrice / withChange24h / withVolume
/ withFunding / withOpenInterest` so shrinkage is observable.

### RC-5 — Futures rows without an active Spot pair were dead ends

```ts
const spotBase = futuresBaseToSpot(f.symbol.split('/')[0], spotSet);
onClick={spotBase ? () => navigate(`/coin/${spotBase}`) : undefined}
```

Futures-only listings (no Binance Spot pair) were not clickable at all, and
clickable ones navigated to the **Spot** coin page. See RC-6.

### Not a root cause (checked and ruled out)

* `/fapi/v1/exchangeInfo` filter (`quoteAsset==='USDT' && status==='TRADING'
  && contractType==='PERPETUAL'`) — correct, already metadata-driven, not a
  hardcoded list. Delivery/quarterly contracts are counted in
  `activeUsdtContracts` but intentionally not listed (funding/OI/basis are
  perpetual-only concepts). Documented, contract preserved.
* Multiplier contracts (`1000PEPEUSDT`, `1000SHIBUSDT`, `1000000MOGUSDT`,
  `1MBABYDOGEUSDT`): the join key is `exchangeSymbol`, never the base ticker,
  so the ticker/premium join is correct. The *only* place where a base-symbol
  join happened was Spot navigation (`futuresBaseToSpot`), which is now only
  used for the optional “open Spot pair” affordance.
* USDC-quoted contracts (`BTCUSDC`): excluded by the documented
  `quoteAsset === 'USDT'` product filter, not by a bug.
* Rate limiting / pagination / stale cache: `/fapi/v1/ticker/24hr` and
  `/fapi/v1/premiumIndex` are single unpaginated bulk calls (2 requests
  total); they were never the bottleneck.

---

## 2. ROOT CAUSE — charts

### RC-6 (critical) — there was no Futures candle path at all

Verified by exhaustive grep over `src/` and `server/`:

* the gateway allowlist (`server/services/marketDataGateway.js`) had
  **no** `/fapi/v1/klines` route — only `/binance/spot/api/v3/klines`;
* `BinanceFuturesAdapter` had **no** `fetchKlines` method;
* `MarketDataProvider.getCandles(symbol, timeframe, limit, options)` had no
  market dimension;
* `normalizeBinanceKlines` hardcoded `provenance.market = 'spot'`;
* `FuturesPage` navigated to `/coin/:base`, i.e. the **Spot** terminal.

So opening any futures contract produced a **Spot** chart — the exact failure
mode named in §5 of the task. Nothing “detected the market type from the
symbol string” either; the concept simply did not exist.

**Fix:** market type is now an explicit, deep-linkable parameter carried
end-to-end: the dedicated route `/futures/:symbol` → `FuturesContractPage` →
`provider.getCandles(symbol, tf, limit, { market: 'futures' })` →
`BinanceFuturesAdapter.fetchKlines` → gateway
`/binance/futures/fapi/v1/klines` → `https://fapi.binance.com/fapi/v1/klines`.
`provenance.market` is now `'futures'` for those candles, which the unit
tests assert.

### RC-7 — no candle validation anywhere

`normalizeBinanceKlines` was `klines.map(k => ({ time: k[0]/1000, open:
parseFloat(k[1]), ... }))`. A malformed row (`"NaN"`, `null`, a duplicated or
non-monotonic `openTime`, `high < close`) propagated straight into
`lightweight-charts`, which then renders a broken/empty canvas that *looks*
like a loaded chart. Now a single shared validator
(`shared/market/candleSeries.js`) is used by the adapter path, the tests and
the diagnostic harness.

### RC-8 — stale-response protection was keyed without the market

`CoinDetailPage` keyed in-flight candle requests by `` `${routeSymbol}:${timeframe}` ``.
With a market dimension added, switching Spot↔Futures for the same ticker
could apply the previous market's response. Both terminals now key their
in-flight request by `` `${symbol}:${timeframe}:${market}` ``
(`candleRouteKeyRef` on the Spot page, `requestKeyRef` on the Futures page),
re-check it before every `setState`, and the Futures page additionally aborts
the superseded request via `AbortController`.

### RC-9 — Spot WebSocket klines would have been merged into Futures charts

`useRealtimeKline` / `RealtimeFeedManager` subscribe to **Spot**
`wss://stream.binance.com` streams. Merging them into a futures chart would
have silently blended two different markets' prices. `FuturesContractPage`
therefore renders `ChartTerminal` **without** `realtimeKline` (honest
REST-only chart) instead of mixing sources.

---

## 3. ROOT CAUSE — sorting

* Two incompatible implementations: `sortMarketUniverse()` (Spot; nulls last
  but only by accident of `return 1` before the direction flip) and
  `sortData()` (Futures; **not stable**, and `String(valA).localeCompare` is
  applied to anything non-numeric).
* `Array.prototype.sort` in `sortData` returns `0` for equal values, but the
  comparator returns `0` *before* the tie-break, so equal rows had no
  deterministic order across re-renders.
* Futures had no 24h-change and no volume-vs-formatted-string distinction
  because those fields did not exist (RC-2/RC-3).
* No mobile sort control at all: on a 360px viewport the `<th>` elements of
  the horizontally scrolled table are the only sort affordance, and the
  columns that carry them (`OI 1h Δ`, `Объём 24ч`, `Базис %`) are
  `hidden md:table-cell` — i.e. **sorting by those fields was unreachable on
  mobile**.

**Fix:** one shared, stable, null-last comparator model
(`src/utils/marketSort.ts`) plus shared desktop `<th>` and mobile
`<select>`-based controls (`src/components/market/MarketSortControls.tsx`)
used by both tables.

---

## 4. Data-flow map (post-fix)

```
                       ┌──────────────────────── Binance USD-M ───────────────────────┐
                       │ /fapi/v1/exchangeInfo   (universe, TTL 10m, 1 req)           │
                       │ /fapi/v1/ticker/24hr    (bulk, TTL 15s, 1 req)               │
                       │ /fapi/v1/premiumIndex   (bulk, TTL 15s, 1 req)               │
                       │ /fapi/v1/openInterest   (per symbol, TTL 60s, conc. 8)       │
                       │ /futures/data/openInterestHist (per symbol, TTL 5m, conc. 4) │
                       │ /fapi/v1/klines         (per chart request)                  │
                       └──────────────────────────────┬───────────────────────────────┘
                                                      │  server only
   server/services/futuresMarketData.js  ── snapshot cache + SWR background OI sweep
                                                      │
   GET /api/market/derivatives/futures  (1 request per browser per 30s poll)
                                                      │
   LiveMarketDataProvider.getFuturesList() ── normalizeFuturesSnapshotRow()
                                                      │
   FuturesPage  ── filter → search → SORT → paginate → render
                                                      │
   row click → /futures/:base → FuturesContractPage → getCandles(..., { market:'futures' })
                                                      │
   BinanceFuturesAdapter.fetchKlines → /api/market/binance/futures/fapi/v1/klines
```

---

## 5. Honest-gap list (upstream really does not provide it)

| Metric | Status |
| --- | --- |
| Futures 24h change / volume / price / funding / basis | available in bulk — now shown for every contract that upstream returns |
| Futures open interest (USD) | per-symbol only — swept server-side; a contract whose sweep failed shows `Нет данных`, never an estimate |
| Futures OI Δ1h / Δ24h | per-symbol history only; swept for the volume-ranked head of the universe (bounded by the `/futures/data` 1000-req/5-min budget). Outside the sweep → `Нет данных` |
| Futures market cap / circulating supply | not a derivatives concept — column intentionally absent |
| Futures 7d change / sparkline | not provided by `/fapi/v1/ticker/24hr`; would require N kline calls — column intentionally absent |
| Spot funding / OI | not a spot concept — column intentionally absent |

---

## 6. Diagnostics harness (`npm run diagnose:charts`)

`scripts/diagnose-charts.mjs` walks the **full** Spot and USD-M universes
(`/api/market/universe/spot`, `/api/market/universe/futures`) and probes every
instrument × interval through the real CRYPTORA path:

```
npm run diagnose:charts                                   # both markets, 1m/5m/15m/1h/4h/1d
npm run diagnose:charts -- --market futures --limit 50
npm run diagnose:charts -- --base-url http://127.0.0.1:3000 --concurrency 3
npm run diagnose:charts -- --json .diagnostics/charts.json
```

* transport: the in-process gateway by default (`requestMarketData`), or a
  running server with `--base-url` — never a hand-rolled direct client;
* normalization/validation: the same `shared/market/candleSeries.js` the UI
  uses (strictly increasing unique timestamps, finite OHLC,
  `high >= max(open,close)`, `low <= min(open,close)`, non-negative volume,
  no NaN/Infinity, normalizer must not throw);
* classification per probe: `PASS / FAIL / NO_DATA / UNSUPPORTED /
  RATE_LIMITED / ERROR`, aggregated per instrument by worst status;
* controlled concurrency (default 4, max 8) + per-worker pause (default
  250 ms) so a 1000-instrument sweep stays inside Binance's rate budget;
* **read-only**: GET requests only, no DB access, no writes, no env changes.

### Verification status in the delivery sandbox

The build sandbox has **no network egress** (all Binance hosts fail with
connection errors, and Binance itself geo-blocks the sandbox region), so:

* unit-fixture verification — DONE (see §0 class A);
* integration verification with stubbed transports — DONE (class B);
* **live upstream verification — NOT PERFORMED** (class C). The harness is
  provided so the operator can run it on the VPS where Binance is reachable.

No claim of the form “all coins fixed” is made from fixture runs alone.
