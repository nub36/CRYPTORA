# CRYPTORA — FULL PROJECT AUDIT & HANDOFF

> **Type:** read-only technical audit + design document. **No production code was changed.**
> **Audited commit:** `8eacfb9be5006f317faf9bb563edbc4e7c272d73` (`origin/main`, merge of PR #14)
> **Audit date:** 2026-09-23 (UTC)
> **Auditor:** Arena.ai Agent Mode (branch `arena/01a0cf3a-cryptora`)
> **Production:** https://cryptora.duckdns.org · VPS repo `/root/CRYPTORA` · frontend `/var/www/cryptora`
> · backend systemd `cryptora.service` → `server/index.js` · Nginx `/api` → `127.0.0.1:3000` · PostgreSQL

This document is **self-sufficient**: it does not assume the reader has seen the chat, the previous
audits, or any external notes. Every claim is backed by a file path (usually with a line number),
a command that was actually run in this audit, or a live production response captured during it.

**Hard constraints honoured during this audit**

| Constraint | Status |
|---|---|
| No new functionality | ✅ only this document added |
| No changes to V3.0 / V3.3 / V2.8 algorithms, entry/exit rules, research/backtest logic | ✅ zero source edits |
| No Signals chart implementation (design only) | ✅ §15 is design, not code |
| `main` untouched; work on a branch cut from current `origin/main` | ✅ §1 |
| No destructive production DB operations | ✅ only `GET` probes against production |
| No auth bypass | ✅ admin endpoints probed unauthenticated only to confirm they refuse |
| No credentials/secrets in this report | ✅ no `.env` values, tokens, hashes of secrets, or hostnames beyond the public one |

---

## 0. Executive summary (read this first)

### 0.1 State of the project in five sentences

1. The **frontend is healthy**: `npm ci`, `npm run typecheck`, `npm test` (1176 tests), and
   `npm run build` all pass on the audited commit, and the production site serves live Binance/KuCoin
   data at v0.9.3.
2. The **browser-side signal engine works** and is the only signal generator that actually produces
   anything today: `LiveSignalEngine` is auto-started by `MarketDataContext`, scans the server-owned
   scan universe (24 symbols live), and writes an append-only SHA-256-chained ledger into
   `localStorage`, which `/signals` renders.
3. The **server-side signal engine is dead code that will fail the moment it is switched on**:
   `server/services/strategyEngine/strategyEngine.js:116` calls `engine.scanOnce()`, a method that
   does not exist on the compiled `LiveSignalEngine` (verified by building the bundle in this audit —
   see §7.4). All three strategies are `enabled = FALSE` in production, so nothing is broken *yet*;
   the first admin who flips a switch gets `status: ERROR` and zero signals forever.
4. **`docs/STRATEGY_OPERATIONS.md` describes an architecture that no longer exists.** It claims the
   server produces the signals, that `/signals` reads `GET /api/signals` every 15 s, and that the
   browser engine no longer auto-starts. All three statements are false on `main` (§2.2). This is the
   single most dangerous document in the repo for the next agent.
5. **There is no chart on `/signals`**, and the data needed to draw one is *already computed* by the
   backend engine but partially lost on the way to PostgreSQL (§7.5, §15.4). §15 is a complete,
   implementation-free design for the Signals candlestick chart.

### 0.2 Findings by severity

| ID | Sev | Finding | Evidence | Section |
|---|---|---|---|---|
| F-01 | **P1** | Server strategy engine calls non-existent `LiveSignalEngine.scanOnce()` → enabling any strategy on the VPS produces a permanent `TypeError` and zero signals | `strategyEngine.js:116`; bundle prototype dump in §7.4 | §7.4 |
| F-02 | **P1** | `docs/STRATEGY_OPERATIONS.md` §1/§8 contradict the shipped code (signals source, `/signals` data, browser engine autostart) | §2.2 | §2.2 |
| F-03 | **P1** | `tests/integration/strategyEngineCore.test.ts` reports **6 passed** while silently skipping all 6 (esbuild cannot run under jsdom) → the very test that should catch F-01 is a false green, locally *and* in CI | test run output in §13.3 | §13.3 |
| F-04 | **P1** | `GET /api/signals` has **zero UI consumers**: `fetchSignals()` is exported but never imported anywhere | grep in §7.6 | §7.6 |
| F-05 | **P2** | Signal dedup key is broken server-side: `setup.sourceCandleTs` does not exist on `AnalyticalSetup`, so `signal_candle_ts` falls back to publish time | `strategyEngine.js:132-136`, `SignalsAuditLedger.ts:70-91` | §7.5 |
| F-06 | **P2** | TP3 is silently dropped when persisting: `signals` has only `tp1`/`tp2`, `insertSignal` maps `targets[0]`/`targets[1]` | `strategyEngine.js:139-140`, `007_signals.sql` | §7.5, §8.3 |
| F-07 | **P2** | Server-side signal lifecycle never runs: `closeSignal()` is called only from a test, and the `status` CHECK constraint does not even contain `FILLED`/`CLOSED`/`CANCELLED`/`UNRESOLVED` → rows stay `ACTIVE` forever | grep in §7.7 | §7.7 |
| F-08 | **P2** | V2.8 timeframe is advertised as `15m` (catalog, `/api/strategies`, server preload) while the implementation runs on `1h` + `4h`/`1d` | live `/api/strategies` response, `v28Live.ts:52`, `LiveSignalEngine.ts:56` | §6.3, §7.8 |
| F-09 | **P2** | Server market-data path passes the frontend timeframe literal `'1D'` straight into the Binance `interval=` query param → HTTP 400 for V2.8's daily series | `LiveSignalEngine.ts:458`, `marketDataFetcher.js` | §7.9 |
| F-10 | **P2** | The server provider adapter drops the `limit` argument → server evaluates a 300-bar window while the browser evaluates 1000 bars for the *same* strategy | `strategyEngine.js` provider shim, `LiveSignalEngine.ts:53` | §7.9 |
| F-11 | **P2** | `systemd/cryptora.service` + `nginx/cryptora.conf` in the repo do not match the deployed production (wrong entry file, wrong `root`, wrong bind host, dead env vars) → copying them over the VPS would silently disable auth/DB/strategies | §12.4 | §12.4 |
| F-12 | **P2** | Scheduler has no error backoff: a persistent DB/engine failure is re-attempted and re-logged every tick forever | `strategyScheduler.js:95-103` | §11.4, §14 |
| F-13 | **P2** | Admin scan-universe API (`/api/admin/scan-universe`) has **no UI**: `adminScanUniverseState`/`addScanUniverseSymbol`/`removeScanUniverseSymbol` are never called from any component | grep in §5.6 | §5.6 |
| F-14 | **P3** | Main JS bundle is 900.69 kB (gzip 247.44 kB) — roadmap 16.1 not started | build log in §13.4 | §13.4, §14 |
| F-15 | **P3** | Liquidation journal filters are missing the `$1M` tier and a per-symbol filter (roadmap 8.2) | `LiquidationsPage.tsx:61` | §14 |
| F-16 | **P3** | Stale concept docs still describe Stage-1 architecture (TimescaleDB/ClickHouse/Redis, `/api/v1/*`, DemoMarketDataProvider) | §2.3 | §2.3 |

**No P0 findings.** The last P0 (Chrome renderer hang) is fixed and correctly guarded (§10).

### 0.3 What was verified, and how

| Check | Command / method | Result |
|---|---|---|
| Dependencies | `npm ci --no-audit --no-fund` | ✅ 384 packages, postinstall Playwright patch applied |
| Types | `npm run typecheck` (`tsc --noEmit`) | ✅ exit 0, zero errors |
| Unit + integration | `npm test` | ✅ **116 files / 1176 tests passed**, 141 s |
| Integration only | `npx vitest run tests/integration --reporter=verbose` | ✅ 4 files / 56 tests; real PostgreSQL via `embedded-postgres` **did** run (006/007/008 + scheduler + auth asserted against SQL) |
| False-green detection | same run, stderr | ⚠️ `strategyEngineCore.test.ts` 6/6 "passed" but every body skipped (F-03) |
| Production build | `npm run build` | ✅ built in 6.47 s; main chunk 900.69 kB / gzip 247.44 kB |
| Whitespace errors | `git diff --check` | ✅ clean (exit 0) |
| Server strategy bundle | `node --input-type=module` → `loadStrategyCore()` | ✅ esbuild builds `src/` → `.generated/strategyCore.mjs`; **`scanOnce` is `undefined`**, `scanNow` is a function (F-01) |
| Browser E2E | `npx playwright install chromium --with-deps` | ❌ **could not run** — sandbox lacks the system packages (`libxrandr2`, `xvfb`, font packages, …). See §13.5 for the exact owner-side commands |
| Production liveness | `fetch_page` on 6 public endpoints | ✅ v0.9.3, DB connected, universe 494 spot / 732 futures, 24-symbol scan universe, 3 strategies OFF, `/api/signals` empty, admin endpoints refuse unauthenticated callers |

---

## 1. Git and repository state

### 1.1 Branches and SHAs

```
origin/main                       8eacfb9be5006f317faf9bb563edbc4e7c272d73
HEAD (audit branch)               8eacfb9be5006f317faf9bb563edbc4e7c272d73   (before this doc)
audit branch                      arena/01a0cf3a-cryptora
working tree before this audit    clean
```

The clone is **shallow** (`.git/shallow` present, graft at HEAD), therefore:

* `git log --oneline` shows exactly one commit — this is a clone artefact, **not** the real history.
* Parent-based diffs such as `git diff 8eacfb9^1 8eacfb9` fail with `unknown revision`.
* For history, use the GitHub API (`gh pr list`, `gh pr view`) or `git fetch --unshallow` first.

### 1.2 Remote / PR state (via `gh`, authenticated read-only)

* Repository: `nub36/CRYPTORA`.
* **All 14 pull requests are merged.** The latest, PR #14 ("полный universe Binance"), merged
  `2026-09-23T15:14:48Z`. CI on `main` is green (run `35880160017`).
* There are **no open PRs and no unmerged branches** with production code.
* Consequence for `docs/PRODUCTION_ROADMAP.md`: its §1 still calls PR #14 `[~] open, not merged`, and
  ten tasks inherit that status. They are merged and deployed — see §14.

### 1.3 Files added by this audit

Exactly one: `docs/agent-plan/FULL_PROJECT_AUDIT.md` (this file). Nothing else was created,
modified, renamed, or deleted. Build artefacts produced while verifying (`dist/`,
`tsconfig.tsbuildinfo`, `server/services/strategyEngine/.generated/`) are all covered by
`.gitignore` and are **not** part of the change set.

---

## 2. Documentation vs. code cross-check

Method: every document in `docs/` and the root was read, its concrete claims extracted, and each
claim checked against source. "Stale" below means *the code is fine, the document is wrong* — in no
case did this audit "fix" a behaviour by editing a document silently; the corrections are listed here
for the owner to approve.

### 2.1 Documents that are accurate and safe to trust

| Document | Verdict | Notes |
|---|---|---|
| `docs/SIGNALS.md` | ✅ **Accurate** (best doc in the repo) | Model, lifecycle, immutability, caveats and the offline validation protocol all match the code. Two staleness details: it is versioned "v0.8.48" (repo is 0.9.3), and §1.1 still says the scan covers a hardcoded `BTC, ETH, BNB, SOL, XRP, DOGE` — the symbol list is now the **server-owned scan universe** (`src/services/signals/scanUniverse.ts`, 24 symbols live, cap 100). |
| `docs/MARKET_DATA.md` | ✅ Accurate | Gateway allowlist, TTLs and provenance rules match `server/services/marketDataGateway.js`. |
| `docs/DEPLOYMENT.md` | ✅ Mostly accurate | Correctly names `server/index.js` + `server/app.js` as production and explicitly calls `productionServer.js` "the standalone alternative". |
| `docs/LIQUIDATIONS.md` | ✅ Accurate | Multi-exchange WS (`fstream`/`bybit`/`okx`), `LiquidationDataStatus` honesty contract, sessionStorage persistence and the `MODEL / ESTIMATED` heatmap all match the code. Version label v0.8.44 is stale, content is not. |
| `AGENTS.md`, `docs/agent-plan/RULES.md`, `docs/DONT_DO.md` | ✅ Accurate | Invariants match what the code enforces. |
| `docs/PRODUCTION_ROADMAP.md` | ⚠️ Accurate in structure, **stale in status** | See §14 for a per-item re-grade with evidence. |
| `docs/STRATEGY_SETTINGS_MIGRATION_PLAN.md` | ✅ Executed | Migrations 006/007/008 exist and are applied in production (verified live). |

### 2.2 `docs/STRATEGY_OPERATIONS.md` — actively wrong (F-02, P1)

This is the document a next agent will open first when asked about signals, and it describes a design
that was **superseded and reverted** before PR #14. Verified contradictions:

| Doc claim | Reality on `8eacfb9` | Evidence |
|---|---|---|
| §1 "сигналы производит **серверный движок** … Фронтенд их только читает" | Signals shown to users are produced **in the browser** by `LiveSignalEngine` and stored in `localStorage` | `src/context/MarketDataContext.tsx:183-212` (autostart), `src/pages/SignalsPage.tsx:83-126` (reads only the ledger + engine status) |
| §8 `/signals` — "данные из `GET /api/signals`, обновление каждые 15 с" | `SignalsPage.tsx` contains **zero** `fetch()` calls and no timer against `/api`; the 15 s refresh does not exist | grep `fetch\(\|/api/` on `src/pages/SignalsPage.tsx` → no matches |
| §8 "Чего на фронте больше нет: автостарта `LiveSignalEngine` — браузер не генерирует сигналы" | The browser engine **is** auto-started in live mode and is the only thing that generates signals | `MarketDataContext.tsx:193-197` |
| §8 "подписи «Сканирование 6 символов · 60с» … больше нет" | The page renders exactly that kind of label, with the *current* universe size | `SignalsPage.tsx:163` — `LIVE-скан {engineStatus.symbols.length} инструментов · каждые {scanIntervalMs/1000}с` |
| §7 "в сетап добавлено поле `sourceCandleTs`" | `AnalyticalSetup`/`SetupIssuance` have **no** `sourceCandleTs`; the field is `setupOpenTime` | `src/services/signals/SignalsAuditLedger.ts:70-91` |
| §2 table: V2.8 timeframes = `15m` | Live implementation runs `1h` and needs `4h`+`1d` | `v28Live.ts:52-54`, `LiveSignalEngine.ts:56`, `LiveSignalEngine.ts:457-458` |
| §9 "противоречивый сетап … фиксируется в `lastRejected`" | `lastRejected` exists nowhere in `src/`; the server reads `engine.lastRejected` which is always `undefined` | `strategyEngine.js:163`; grep for `lastRejected` in `src/` → no hits |
| §6 "Артефакт проверяется тестом `strategyEngineCore.test.ts`" | That test silently skips everything (F-03) | §13.3 |
| §5 "Каждое переключение пишет в `audit_log`" | ✅ **True** — verified by integration test against real PostgreSQL | `tests/integration/strategyOperations.test.ts` |
| §4 "seed: три строки, все `enabled = FALSE`" | ✅ **True** — verified against real PostgreSQL and live production | `006_strategy_settings.sql`, live `/api/strategies` |

**Recommended correction (owner approval needed, docs-only):** mark §1, §7, §8, §9 as describing the
*server-side subsystem only*, add a prominent header stating that the user-visible `/signals` page is
fed by the browser engine + `localStorage` ledger, and that `GET /api/signals` currently has no UI
consumer. Do **not** delete the document — it is the best description of the server subsystem that
exists, it is just not the description of the product.

### 2.3 Stale Stage-1 concept documents (F-16, P3)

These were written for the "Visual Foundation" phase and now misdescribe the system. They are not
dangerous (they are labelled conceptual) but they cost the next agent time:

| Document | What it claims | What is true |
|---|---|---|
| `docs/ARCHITECTURE.md` | "v0.1.0 target model"; concrete provider is `DemoMarketDataProvider`; `LiveMarketDataProvider` is a "future replacement (Stage 2+)"; storage plan = ClickHouse/TimescaleDB + Redis | Live is the only mode (`src/config/dataModePolicy.ts`, QA fixture is gated and never published to the ledger — `LiveSignalEngine.ts:484`). There is **no Redis, no ClickHouse, no TimescaleDB**. Storage = PostgreSQL + in-process caches + `localStorage`/`sessionStorage` |
| `docs/DATABASE.md` | Three-tier storage with TimescaleDB/ClickHouse and Redis pub/sub; "frontend uses a deterministic in-memory Demo Store" | PostgreSQL only. Migrations `001`–`008` in `server/db/migrations/` |
| `docs/API.md` | `GET /api/v1/market/overview`, `/api/v1/derivatives/*`, `POST /api/v1/screener/query`, `wss://api.cryptora.terminal/ws/v1/*` | No `/api/v1` namespace exists. Actual surface: `/api/health`, `/api/auth/*`, `/api/me`, `/api/admin/*`, `/api/strategies*`, `/api/signals`, `/api/market/*` (allowlisted exchange gateway). No first-party WebSocket — the browser subscribes to exchange WS directly (CSP-permitted) |
| `docs/STRATEGIES.md` | "Strategy Lab" with a YAML rule constructor (`conditions_entry_long`, operators) | No such constructor exists. `/strategies` shows three frozen archived strategies plus a research simulator with three fixed rule types (`RSI_REVERSAL`, `EMA_CROSS`, `BREAKOUT` — `src/pages/StrategiesPage.tsx:34`) |
| `docs/SECURITY.md` | "Rate limiting on all endpoints", "strict CSP" | ✅ Rate limiting is real (`server/middleware/rateLimit.js`, applied in `server/app.js:107-111`) and CSP is real — but it is served by **Nginx**, not the app (`server/app.js:77` disables helmet's CSP). `script-src 'unsafe-inline'` is present and, per `AUDIT_REPORT_2026-09-17.md:143`, may no longer be needed |

### 2.4 Root-level reports

`AUDIT_REPORT_2026-09-17.md`, `DEEP_AUDIT_2026-09-18.md`, `DESIGN_AUDIT_2026-09-17.md`,
`QA_REPORT.md`, `SERVER_ARCHITECTURE_DESIGN.md`, `BACKEND_SETUP.md` and `CHANGELOG.md` (1736 lines)
are historical. They are consistent with the code where they describe things that still exist, and
they correctly document the SSRF proxy removal (`DEEP_AUDIT_2026-09-18.md` Н1 → `/api/proxy/*` is
gone from `productionServer.js`). They should be read as history, not as specification.

---

## 3. Architecture map (end to end, with files)

### 3.1 The two signal paths — the most important diagram in this audit

```
                                ┌──────────────────────────── BROWSER ───────────────────────────┐
 Exchange REST/WS               │  MarketDataContext (live mode)                                 │
 ────────────────               │    └─ LiveSignalEngine.getInstance({provider, symbols})  :193  │
 api.binance.com  ◄─── /api/market gateway (same-origin proxy, allowlist)                       │
 fstream.binance.com ◄──────────┼──── direct WS (CSP connect-src)                                │
 stream.bybit.com    ◄──────────┼──── direct WS (liquidations)                                   │
 ws.okx.com          ◄──────────┼──── direct WS (liquidations)                                   │
 api.coingecko.com   ◄──────────┼──── direct REST (global cap, ATH/ATL)                          │
 api.alternative.me  ◄──────────┼──── direct REST (Fear & Greed)                                 │
                                │                                                                │
                                │  LiveSignalEngine.scanSymbol()  → runV30/V33/V28LiveReplay     │
                                │      → publish() → SignalsAuditLedger (localStorage, hash chain)│
                                │      → trackOpenSetups() → lifecycle (fill / TP / SL / timeout) │
                                │                     │                                          │
                                │                     └──► /signals  (SignalsPage.tsx)           │
                                └────────────────────────────────────────────────────────────────┘

                                ┌──────────────────────────── SERVER ────────────────────────────┐
 systemd cryptora.service ──────►  server/index.js → createApp() (server/app.js)                 │
                                │    ├─ helmet (CSP off — Nginx owns it)                         │
                                │    ├─ express-session + connect-pg-simple (PostgreSQL)         │
                                │    ├─ csrfProtection, apiLimiter, marketDataLimiter            │
                                │    ├─ /api/health /api/auth /api/me /api/admin                 │
                                │    ├─ /api/strategies  (public read)                           │
                                │    ├─ /api/signals     (public read)  ◄── NO UI CONSUMER (F-04)│
                                │    └─ /api/market/*    (allowlisted exchange gateway)          │
                                │                                                                │
                                │  StrategyScheduler (15 s tick, only if DB reachable)           │
                                │    └─ scanStrategySafely() → runStrategyScan()                 │
                                │         ├─ strategyCoreBundle.js: esbuild bundles entry.ts │
                                │         │    → .generated/strategyCore.mjs → import            │
                                │         ├─ marketDataFetcher: api.binance.com/api/v3/klines    │
                                │         │    DIRECT (not via gateway), 60 s TTL, single-flight │
                                │         ├─ engine.scanOnce()   ◄── DOES NOT EXIST (F-01)       │
                                │         └─ insertSignal() → PostgreSQL `signals` (hash chain)  │
                                │                                                                │
                                │  PostgreSQL: users, sessions, audit_log, strategy_settings(006)│
                                │              signals(007), scan_universe(008)                  │
                                └────────────────────────────────────────────────────────────────┘
```

**Two independent signal generators exist.** They share the *strategy cores* (the server literally
compiles the browser TypeScript with esbuild — a genuinely good design), but they do **not** share
storage, lifecycle, dedup, or UI. Only the browser one is wired to a page.

### 3.2 Request-level map of every production page

| Route | Page file | Data source | Polling / realtime |
|---|---|---|---|
| `/` | `src/pages/OverviewPage.tsx` (884 L) | `useMarketData()` provider → `/api/market/*` gateway; direct CoinGecko/alternative.me | WS ticker + 30 s-ish provider caches |
| `/market` | `MarketPage.tsx` (413 L) | provider `getAssets()`, universe endpoints | provider caches |
| `/futures` | `FuturesPage.tsx` (436 L) | provider `getFuturesList()`, `/api/market/universe/futures` | provider caches |
| `/coin/:symbol` | `CoinDetailPage.tsx` (1220 L) | `provider.getCandles(symbol, tf, 500)` + `useRealtimeKline` WS + `MemoryTimeSeriesRepository` | WS kline; REST catch-up on reconnect |
| `/liquidations` | `LiquidationsPage.tsx` (844 L) | `provider.getLiquidationsSnapshot()` (WS: Binance/Bybit/OKX), `LiquidationPriceChart` REST candles | events 5 s, candles 30 s |
| `/signals` | `SignalsPage.tsx` (657 L) | **`SignalsAuditLedger` (localStorage) + `LiveSignalEngine.getStatus()/getRetrospective()`** — no HTTP | engine scan every 60 s |
| `/strategies` | `StrategiesPage.tsx` (333 L) + `ProductStrategiesSection` + `StrategyOpsPanel` | `fetchStrategies()` → `GET /api/strategies` (PostgreSQL); archive registry; `provider.getCandles` for the simulator | on mount + after toggle |
| `/radar` | `RadarPage.tsx` (314 L) | provider `getRadarEvents()`, `getAssetDetail`, `getFuturesList`, `getCandles(1h)` | WS anomaly engine |
| `/screener` | `ScreenerPage.tsx` (377 L) | `provider.getScreenerResults(filters)` | on demand |
| `/heatmaps` | `HeatmapsPage.tsx` (88 L) | provider | on demand |
| `/correlations` | `CorrelationsPage.tsx` (235 L) | `provider.getCandles(sym, '1D')` for a fixed symbol set | on mount |
| `/portfolio` | `PortfolioRiskPage.tsx` (331 L) | user-entered positions + provider prices | on demand |
| `/journal` | `JournalPage.tsx` (332 L) | **localStorage only** (explicitly labelled as such at `:267`) | — |
| `/onchain` | `OnChainPage.tsx` (142 L) | mempool.space via provider/gateway | on demand |
| `/calendar` | `CalendarPage.tsx` (152 L) | provider (macro calendar) | on demand |
| `/ecosystem` | `EcosystemPage.tsx` (160 L) | DeFiLlama via provider | on demand |
| `/news`, `/articles` | `NewsPage.tsx`, `ArticlesPage.tsx` | `content/` static index built by `scripts/build-articles-index.mjs` | — |
| `/tools` | `ToolsPage.tsx` (538 L) | pure client-side calculators | — |
| `/admin` | `AdminPage.tsx` (514 L) | `/api/admin/dashboard`, `/api/admin/users`, `/api/admin/system`, block/unblock | on mount |
| `/profile` | `ProfilePage.tsx` (170 L) | `/api/me` | on mount |
| `/login`, `/register`, `/verify-email` | auth pages | `/api/auth/*` | — |

Routes and navigation are declared in `src/App.tsx` and `src/components/layout/navigation.ts` — both were read;
the table above lists **only pages that actually exist**. There is no page named "Liquidation X":
that product name maps to the `/liquidations` route and the `LiquidationPriceChart` component (§9).

### 3.3 Server module map

| File | Role | Notes |
|---|---|---|
| `server/index.js` | Production entry; starts scheduler **only if DB reachable**; `app.listen(config.PORT, config.HOST)`; SIGTERM/SIGINT graceful stop | `config.HOST` defaults to **`127.0.0.1`** (`server/config.js:14`) |
| `server/app.js` | Express app factory (no listen) — reused by integration tests | helmet with CSP disabled (`:77`); body limit 100 kb; `/api/market` mounted before the general limiter with its own budget (`:107`) |
| `server/config.js` | All env-driven settings, no secrets committed | Argon2id 64 MB/t=3/p=1; rate limits 10 login / 5 register / 100 api per minute |
| `server/productionServer.js` | **Legacy** zero-dependency static server + `/api/market` + `/api/health` + AI explain; owns the `CONNECT_SRC` list that `tests/unit/cspConnectSrc.test.ts` reads | Not running in production (proved in §12.4) |
| `server/routes/{health,auth,me,admin,strategies,signals,marketData}.js` | HTTP surface | `admin.js` gates the whole router with `requireAuth, requireAdmin` (`:49`) |
| `server/services/marketDataGateway.js` | Allowlisted GET-only exchange proxy, 8 s timeout, `ROUTES` + `COMPUTED_ROUTES` | `/universe/spot`, `/universe/futures`, `/metadata/assets` are computed server-side |
| `server/services/exchangeUniverse.js` | `filterActiveSpotUsdt`, `filterActiveUsdmFutures`, `UniverseCache` (TTL 10 min, stale-while-error up to 6 h) | Source of the 494/732 numbers below |
| `server/services/assetMetadata.js` | CoinGecko paged markets → `SYMBOL → {name, logo}`; TTL **12 h**, sequential pages with 1.5 s delay, stale-on-error | 150 lines; canonical assets are pinned by id first so BTC/ETH can't be hijacked |
| `server/services/scanUniverse.js` | PostgreSQL-backed scan universe, cap 100, add requires an *active Binance Spot* symbol, audited | Migration `008` seeds 25 canonical symbols |
| `server/services/strategySettings.js` | `mapRow`, `listStrategyStates`, `deriveStatus` (OFF/ERROR/ON), `getEnabledStrategies`, `setStrategyEnabled`, `recordScanResult`, `recordSignalEmitted`, `engineStatus` | Status derivation: `last_error` set ⇒ ERROR, else `enabled` ⇒ ON, else OFF |
| `server/services/strategyCatalog.js` | The only allowed strategy list server-side (`isKnownStrategyId`) | Mirrors the `CHECK` in migration 006 |
| `server/services/signalRepository.js` | `insertSignal` (advisory lock 730117 + SHA-256 chain), `listSignals`, `countActiveSignals`, `closeSignal`, `verifyChain` | `closeSignal`/`verifyChain` unused in production (F-07) |
| `server/services/strategyEngine/*` | `entry.ts`, `strategyCoreBundle.js`, `marketDataFetcher.js`, `strategyEngine.js`, `strategyScheduler.js` | The dead-on-arrival server engine (F-01, F-05…F-10) |
| `server/middleware/{auth,csrf,rateLimit,errorHandler}.js` | Session auth, CSRF on state-changing requests, per-IP limiters, JSON error envelope | |
| `server/db/pool.js`, `server/db/migrations/001…008` | pg pool + ordered SQL migrations applied by `scripts/migrate.mjs` | Transactional, idempotent, tracked in `schema_migrations` |

---

## 4. Production page-by-page audit

Scope: every route reachable from `src/App.tsx` / `src/components/layout/navigation.ts`. For each page:
component, endpoints, polling, and an honest verdict on broken/mock/performance/UX. "Live-verified"
means the production HTML or JSON was actually fetched during this audit.

### 4.1 `/` — Overview (`OverviewPage.tsx`, 884 lines)

* **Data:** provider `getMarketOverview()`, `getAssets()`, `getFuturesList()`, `getCandles('BTC','1h')`,
  `getLiquidationsSnapshot()`, `getRadarEvents()`; direct CoinGecko (global cap, dominance) and
  `api.alternative.me` (Fear & Greed).
* **Live-verified content (2026-09-23):** BTC $83,891.81 (−2.98 %), market cap $2.86 T (−5.41 %),
  spot volume $13.05 B, BTC dominance 58.8 %, Fear & Greed **71 (Greedness)** from alternative.me,
  breadth **84 ▲ / 399 ▼ (17 % up)**, aggregated OI **$19.34 B (−4.77 %)**, futures daily volume
  $61.05 B, BTC basis −0.030 %, funding extremes AIN/USDT +0.0765 % and ONE/USDT −0.8175 %,
  RSI-14 26.83 computed from Binance 1h closes.
* **Honest zero-states confirmed live:** "24h Спот Объем Δ24ч —" with the explanation
  *"Δ24ч появится после 24ч наблюдений в этом браузере"*; liquidations *"Поток фактических ликвидаций
  подключен, события ещё не поступали. Оценочные суммы не подставляются."*; radar *"Новых рыночных
  событий пока нет"*.
* **Mock/broken:** none. The "Аналитические сетапы (превью)" block is explicitly labelled
  `НЕТ SETUP · НЕ СИГНАЛ` and states that entry range and invalidation are **not calculated**
  because no setup algorithm is attached to that preview. This is the correct behaviour, not a bug.
* **Performance:** one 24hr bulk ticker request replaces N per-symbol requests
  (`BinanceSpotAdapter.fetchAll24hrTickers`, documented at `:118-124` as weight 40 vs 25). Good.
* **UX notes:** the live ticker strip renders the same 10 assets twice in the fetched HTML
  (marquee duplication for seamless scrolling) — intentional, but it doubles the DOM nodes;
  consider `aria-hidden` on the duplicate if it is not already there.

### 4.2 `/market` and `/futures`

* **Data:** `/api/market/universe/spot` and `/api/market/universe/futures` (computed routes) plus the
  bulk ticker; paginated client-side.
* **Live-verified:** spot `count = 494` (`source: binance-spot-exchangeInfo`);
  futures `activeUsdtContracts = 732`, `perpetualCount = 523`, listed contracts 523
  (`source: binance-usdm-exchangeInfo`).
* **Mock/broken:** none found. `/futures` shows **PERPETUAL only** — the roadmap required that this be
  stated in the UI; verify the wording on the deployed build (cannot be confirmed from JSON alone).
* **Performance:** no N × candles — the catalogue is `exchangeInfo` + one bulk ticker (§5). Pagination
  present (`src/components/common/Pagination.tsx`, separate 1.85 kB chunk).
* **UX:** search debounce was explicitly flagged "not verified" by the roadmap; the code path uses the
  same `SymbolPickerModal` pattern as liquidations, which renders at most
  `PICKER_RENDER_LIMIT = 60` rows — that is the effective protection against a 494-row DOM explosion.

### 4.3 `/coin/:symbol` — Coin detail (`CoinDetailPage.tsx`, 1220 lines)

* **Chart:** `CandleChart` (`src/components/common/CandleChart.tsx`, 490 lines) — lightweight-charts v4
  candlestick/bar/line + volume histogram + SMA20/50/200 + Bollinger, optional RSI/MACD sub-panes via
  `IndicatorPaneChart`, `ChartTimeRangeSync` to keep panes aligned.
* **Candles:** `provider.getCandles(routeSymbol, timeframe, 500, { forceRefresh: true })` for the
  **selected symbol/timeframe only** (`:172`, `:318`) — this is exactly the pattern §15 wants to reuse.
* **Realtime:** `useRealtimeKline` (`:239`) + `mergeKlineIntoCandles` / `detectCandleGap` /
  `mergeCandleHistory` from `src/services/realtime/candleHandoff.ts` for WS↔REST handoff, plus
  `TimeSeriesRepository` (`MemoryTimeSeriesRepository.getInstance().saveCandles`) (`:188`, `:334`) as a local history cache.
* **Race protection:** `candleRouteKeyRef` (`:94`) and a `requestKey = symbol:timeframe` guard
  (`:167`, `:203`) — a slow response for an old symbol/timeframe cannot overwrite the current one.
  This is the correct single-flight pattern; §15 requires the same.
* **Provenance UI (live-verified):** `LIVE · BINANCE`, `KLINE REST`, `LOCAL` badges; SMA20/SMA50/RSI-14
  values rendered next to the chart; `⟲ fit` control.
* **Mock/broken:** none. Timeframe set = `5m 15m 30m 1h 4h 1D 1W` (live-verified).
* **Risk:** `/coin/UNKNOWN` (roadmap 17.1) has **no fast "instrument not supported" path** — the symbol
  resolver (`:49-52`) falls back to the raw uppercase token and the page then fails inside
  `provider.getCandles`, which surfaces as `candlesUnavailable` + `DataSourceUnavailable`. Functionally
  honest, but it costs a round-trip and shows "source unavailable" rather than "not supported".

### 4.4 `/liquidations` (`LiquidationsPage.tsx`, 844 lines) — see §9 for the chart engine

* **Filters present:** exchange (`filterExchange`), side (`filterSide`), minimum size
  (`filterMinUsd` with tiers `0 | 1000 | 10000 | 100000`) — `:59-61`, applied purely client-side at
  `:210-215` (no network requests, as the roadmap requires).
* **Missing vs roadmap 8.2:** the `$1M` tier and a **per-symbol** filter for the journal feed. The chart
  already filters by symbol internally (`:192`), so the data model supports it.
* **Polling:** events 5 s, candles 30 s (`LiquidationPriceChart`).
* **Honest zero-state (live-verified):** "Поток фактических ликвидаций подключен, события ещё не
  поступали. Оценочные суммы не подставляются."
* **Mock:** none. The heatmap is labelled `MODEL / ESTIMATED` and prints its input provenance
  (`ВХОД: ФАКТИЧЕСКИЕ СВЕЧИ` / `ВХОД: DEMO-СВЕЧИ`) per `docs/LIQUIDATIONS.md` §3.3.

### 4.5 `/signals` (`SignalsPage.tsx`, 657 lines)

* **Data:** `SignalsAuditLedger.getInstance()` (localStorage key `cryptora_signals_ledger_v2`) at
  `:83`; `LiveSignalEngine.getInstance()?.getStatus()` at `:85`; `engine.getRetrospective(...)` capped
  at 60 rows at `:125`; manual rescan button calls `engine.scanNow()` at `:137`.
* **No HTTP at all.** Confirmed by grep: the file contains no `fetch(` and no `/api/` string (F-04).
* **Renders:** integrity verdict (`ledger.verifyIntegrity()` at `:110`), summary statistics
  (`ledger.getSummary()` at `:109`), per-symbol scan status with provenance, setup cards with corridor,
  stop, targets, R:R, confirming/invalidating factors, exit reason and hashes.
* **No chart.** This is the gap §15 designs for.
* **Consequence for users:** the ledger is per-browser. A second browser, an incognito window or a
  phone shows a different (usually empty) journal. `docs/SIGNALS.md` §6 states this honestly.
* **UX:** `engineStatus === null` (engine not started, e.g. QA fixture mode) is handled — the status
  block simply does not render, so no fake "running" badge can appear.

### 4.6 `/strategies` (`StrategiesPage.tsx`, 333 L + `ProductStrategiesSection.tsx` + `StrategyOpsPanel.tsx`)

* **Primary UI:** three product-strategy cards from the frozen archive registry
  (`src/services/strategyArchive/`), each with the research verdict, caveats, variants and reproduction
  evidence. Mathematics is **read from the registry**, never redefined in the page (`StrategiesPage.tsx:27-28`).
* **Ops panel:** `fetchStrategies()` → `GET /api/strategies` (PostgreSQL). Toggle is a real
  `PATCH /api/admin/strategies/:id` (`src/services/strategyOps.ts:103-111`), enabled only when
  `isAdmin` from `AuthContext`, optimistic with rollback to the server value on error
  (`StrategyOpsPanel.tsx:56-73`). If the state could not be fetched, the panel is not rendered at all
  (`ProductStrategiesSection.tsx:243` — `{opsState && <StrategyOpsPanel …/>}`), so no invented
  "Работает" can appear.
* **Research simulator:** `BacktestEngine.runBacktest` on live candles with three fixed rule types,
  explicit `takerFeePct: 0.05`, `slippagePct: 0.02` (`StrategiesPage.tsx:82-87`). Runs automatically
  once candles exceed 30 (`:93-97`).
* **Live-verified:** production `/api/strategies` returns exactly three rows, `enabled: false`,
  `status: "OFF"`, `lastScanAt: null`, `lastError: null`, `activeSignalCount: 0`,
  `updatedAt: 2026-09-23T15:19:23.048Z` for all three (≈5 minutes after the PR #14 merge).
* **Defect carried into the UI:** V2.8 advertises `timeframes: ["15m"]` while the implementation runs
  `1h` (F-08). The card therefore tells the user the wrong timeframe.

### 4.7 `/admin` (`AdminPage.tsx`, 514 lines)

* **Endpoints:** `GET /api/admin/dashboard`, `GET /api/admin/users?search&page&pageSize`,
  `GET /api/admin/system`, `PATCH /api/admin/users/:id/block`, `PATCH /api/admin/users/:id/unblock`
  (`:88`, `:102`, `:115`, `:139`, `:160`), all with `credentials: 'include'`.
* **Server-side protection verified live:** `GET /api/admin/scan-universe` without a session returns
  `{"error":"Требуется авторизация"}`. No auth bypass was attempted and none is needed — the router
  applies `requireAuth, requireAdmin` to everything (`server/routes/admin.js:49`).
* **Self-block protection** exists (`admin.js:150-152` region) and blocking also deletes the target's
  sessions, so a blocked admin cannot keep a live session.
* **Gap (F-13):** the page has **no strategy section and no scan-universe section**. Strategy toggles
  live on `/strategies`; scan-universe management has an API and integration tests but no UI at all.
* **Gap:** roadmap 11.1 (per-source health: Binance Spot REST/WS, Binance Futures, Bybit, OKX,
  CoinGecko, PostgreSQL with latency/last success/last error/staleness) is not implemented server-side.
  `SourceHealthTracker` exists but only in the browser (`src/services/data/adapters/sourceHealth.ts`).

### 4.8 Auth and account pages

`/login`, `/register`, `/verify-email`, `/profile` use `/api/auth/*` and `/api/me`. Registration can be
disabled by env (`REGISTRATION_ENABLED`), verification mail goes through SMTP with a `json` transport
for dev only, and resend/verify endpoints have their own tight limiters (3/15 min and 20/15 min).
`scripts/create-admin.mjs` creates the first admin; `ADMIN_PASSWORD` in `.env` is explicitly **not**
used (`docs/STRATEGY_OPERATIONS.md` §10 — verified consistent with the script's existence and with
`config.js`, which has no `ADMIN_PASSWORD` key at all).

### 4.9 Pages that are pure client-side (no backend, no exchange)

`/journal` (localStorage, labelled as such), `/tools` (calculators), `/portfolio` (user-entered
positions + provider prices), `/news`, `/articles` (static `content/` index). None of them present
local data as server data. `/journal` explicitly says entries are stored only in this browser.

---

## 5. Market Universe deep audit

### 5.1 Server: what "active" means

`server/services/exchangeUniverse.js`:

* **Spot** — `filterActiveSpotUsdt(exchangeInfo)`: `quoteAsset === 'USDT'` **and** `status === 'TRADING'`
  **and** spot trading permitted for the symbol. Source: Binance Spot `exchangeInfo` via the gateway.
  Live result: **494 symbols** (`source: binance-spot-exchangeInfo`).
* **Futures** — `filterActiveUsdmFutures(exchangeInfo)`: `quoteAsset === 'USDT'`, `status === 'TRADING'`,
  `contractType === 'PERPETUAL'`. Live result: `activeUsdtContracts = 732`, `perpetualCount = 523`,
  listed contracts 523. Quarterly/delivery contracts are excluded — deliberate, and it is what the UI
  shows.
* **Why 494 and not the roadmap's 746:** the roadmap measured the *bulk ticker* (`746` USDT-suffixed
  rows including VEN, XRPBULL, XLMUP, BCC/BCHABC and other dead instruments). The active filter removes
  them. This is the intended outcome of roadmap 2.1, not a regression.

### 5.2 Caching and refresh

| Layer | TTL / policy | File |
|---|---|---|
| Server `UniverseCache` | fresh 10 min; on upstream failure serves **stale** up to 6 h rather than falling back to a hardcoded list | `server/services/exchangeUniverse.js` |
| Server asset metadata (CoinGecko) | **12 h**, sequential pages, 1.5 s between pages, stale-on-error | `server/services/assetMetadata.js:16-20`, `:114-130` |
| Gateway HTTP cache | `Cache-Control: public, max-age=…` per route (`result.cacheSeconds`) | `server/app.js` / `productionServer.js:105` |
| Browser universe client | TTL 5 min + 60 s retry backoff on failure | `src/services/data/registry/exchangeUniverse.ts` |
| Browser scan universe | TTL 5 min (`REFRESH_MS`), plus a 60 s `ensureFreshScanUniverse` tick | `src/services/signals/scanUniverse.ts`, `MarketDataContext.tsx:222` |
| Browser candles | `cacheTtlMs * 3` for the candle cache, keyed `symbol_timeframe_limit` | `src/services/data/LiveMarketDataProvider.ts:394-402` |
| Server engine candles | 60 s TTL per `(symbol, timeframe)` + in-flight dedup | `server/services/strategyEngine/marketDataFetcher.js` |

### 5.3 Selectors

* `getSelectableSpotSymbols()` — authoritative exchangeInfo first; falls back to `CANONICAL_ASSETS`
  **only** when the authoritative source is unavailable, and the fallback is covered by
  `tests/unit/scanUniverseFallback.test.ts` and `tests/unit/marketUniverse.test.ts`.
* `futuresBaseToSpot()` — maps a futures contract base asset onto its spot symbol so the liquidation
  picker can offer instruments that actually have candles.
* `SymbolPickerModal.tsx` — full spot universe with search, `PICKER_RENDER_LIMIT = 60` rows rendered,
  so a 494-symbol universe cannot produce a 494-node list.

### 5.4 Scan universe (the subset the signal engine actually evaluates)

* **Storage:** PostgreSQL table `scan_universe` (migration `008`), seeded with 25 canonical symbols,
  capped at `SCAN_UNIVERSE_MAX = 100`.
* **Live production value (verified):** 24 symbols —
  `AAVE ADA APT ARB AVAX BNB BTC DOGE DOT ETH FET INJ LINK NEAR OP RENDER RUNE SEI SOL SUI TAO TIA UNI XRP`,
  `activeKnown: true`.
* **Semantics (important and easy to break):** `src/services/signals/scanUniverse.ts` treats PostgreSQL
  as the only source of truth. `localStorage` is **not** used. If the active universe cannot be
  confirmed (`activeKnown === false`), the engine scans **nothing** — it never falls back to a guessed
  list. The server scheduler does the same: `saved ∩ active`, and it skips the scan entirely when
  `exchangeInfo` is unavailable (asserted in `tests/integration/scanUniverse.test.ts`).
* **Admin surface:** `GET/POST /api/admin/scan-universe`, `DELETE /api/admin/scan-universe/:symbol`,
  audited in `audit_log`, rejecting unknown/inactive symbols and enforcing the cap.
  Live-verified: `GET` returns `{"symbols":[…24…],"activeKnown":true}`; the admin variant refuses
  unauthenticated callers.

### 5.5 No N × candles

Verified in both directions:

* **Catalogue pages** (`/market`, `/futures`) are built from `exchangeInfo` + **one** bulk
  `ticker/24hr` request. No per-symbol candle or metadata fan-out.
* **Detail pages** fetch candles for exactly one symbol/timeframe (`CoinDetailPage.tsx:172`, `:318`).
* **Metadata** is one server-side cached document (`/api/market/metadata/assets`), not N CoinGecko calls.
* **The one place that does fan out is the browser signal engine**, by design: `LiveSignalEngine`
  fetches 1h candles for **every** scan-universe symbol each cycle, plus 4h/1d when a new 1h bar
  closes. At the cap (100 symbols) that is ≈100 requests/minute steady state through the gateway and a
  ≈200–300 request burst on the hourly close. It stays inside the gateway budget, but it is the
  dominant source of browser requests and the first thing to watch if the universe grows (§11.2).

### 5.6 Gap: the scan-universe admin UI does not exist (F-13)

`src/services/signals/scanUniverse.ts` exports `adminScanUniverseState`, `addScanUniverseSymbol`,
`removeScanUniverseSymbol` and `scanUniverseMax`. A repo-wide grep shows **no component imports any of
them** — the only consumer of the module is the engine wiring in `MarketDataContext`. So roadmap 3.1's
"Admin → Монеты shows *Доступно на рынке: N* / *В скане: M*, search any active coin, Add to scan /
Remove from scan" is **server-complete, UI-missing**. Today the only way to change the scan universe is
`curl` with an admin session.

---

## 6. Deep audit of the three production strategies

Reading guide: each strategy gets **35 numbered points** in a fixed order — identity, implementation
location, invocation, data, timeframes, indicators, LONG/SHORT conditions in human language (with
file/line references), entry/SL/TP arithmetic, scoring, lifecycle, dedup, DB fields, data loss along
`strategy → DB → API → frontend`, configuration, tests and edge cases.

**Nothing in this section proposes a change to any rule.** Where the audit found a divergence between
an implementation and its documentation, the divergence is reported and the *frozen* behaviour is
treated as correct.

Shared machinery used by all three:

| Piece | File | Role |
|---|---|---|
| Archive candle type | `src/services/strategyArchive/types.ts` (`ArchiveCandle`, `ARCHIVE_TF_MS`) | `openTime/closeTime/isClosed` in ms |
| OHLCV → archive | `src/services/signals/live/ohlcvAdapter.ts:13-29` | `isClosed = closeTime < nowMs`; `nowMs === undefined` ⇒ closed (archive/backtest compatibility) |
| Frozen V2 primitives | `src/services/strategyArchive/shared/frozenSettings.ts` | swing_lookback 3, atr_period 14, volume_period 20, sl_atr_mult 1.5, min_rr 1, min_room_r 1.5, timeout_bars 48, stop_buffer_atr 0.25, breakout_min_body_atr 0.5, liquidity_tol_atr 0.25, fvg_min_size_atr 0.15, displacement_min_body_atr 0.6 |
| Geometry invariant | `src/services/signals/live/setupGeometry.ts:40-63` | `validateSetupGeometry` → `STOP_ON_WRONG_SIDE`, `TP1_ON_WRONG_SIDE`, `TP_ORDER_INVERTED`, `NON_POSITIVE_RISK` |
| Published-setup lifecycle | `src/services/signals/live/lifecycle.ts:53` | `trackPublishedSetup(entry, h1)` — corridor tracking, then trade management |
| Replay plumbing | `src/services/signals/live/replays/shared.ts` | `managedExitPrice`, `managedStatus`, `outcomeFromManagedTrade`, `rrFrom`, `corridorGeometryOk`, `fmtPx`, `round` |
| Ledger | `src/services/signals/SignalsAuditLedger.ts` | append-only, SHA-256 chained, `localStorage` key `cryptora_signals_ledger_v2`, `MAX_STORED = 500` |
| Engine | `src/services/signals/live/LiveSignalEngine.ts` | one scan cycle, per-symbol isolation, publish gate, lifecycle tracking |

### 6.1 V3.0 — HTF Liquidation Trap (`V3_0_HTF_LIQUIDATION_TRAP`)

1. **Identity.** id `V3_0_HTF_LIQUIDATION_TRAP`, version `3.0`, name "HTF Liquidation Trap",
   Russian name "Ловушка ликвидности на старшем таймфрейме"
   (`definitions/v3_0-htf-liquidation-trap/definition.ts:128-131`; mirrored in
   `server/services/strategyCatalog.js` and in the `CHECK` of `006_strategy_settings.sql`).
2. **Research verdict.** `VALIDATED_FOR_RESEARCH`, `reproducibility: 'REPRODUCED'`
   (`definition.ts:132-133`). Public badge: **"Research validated"**. Validated on 3 of 6 symbols; the
   overlap discrepancy is preserved as `D-V30-001`, not "fixed".
3. **Implementation location (frozen core).**
   `src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core.ts` (250 lines):
   `V30_CONSTANTS:20`, `bodyRatio:76`, `detectTrap:83`, `legFeeR:102`, `manageTrade:124`,
   `corridorStep:212`, `buildPending:234`, `confirmedLevels:51`.
4. **Implementation location (research runner).** `v30Runner.ts` — `runV30Series`; iterates
   `for (let i = 60; …)` i.e. the same `WARMUP_BARS = 60` the live replay uses.
5. **Implementation location (LIVE adapter).**
   `src/services/signals/live/replays/v30LiveReplay.ts:57-164` (`runV30LiveReplay`). It calls the
   frozen `detectTrap` / `buildPending` / `corridorStep` / `manageTrade` — it does **not** reimplement
   them. Constants are destructured from `V30_CONSTANTS` at `:58`.
6. **Invocation (browser).** `LiveSignalEngine.runReplay()` dispatches on strategy id; for V3.0 it
   calls `runV30LiveReplay({ symbol, h1, h4 })` from `scanSymbol()`
   (`LiveSignalEngine.ts:428-492`, strategy loop at `:467`).
7. **Invocation (server).** Same function, reached through the esbuild bundle:
   `server/services/strategyEngine/entry.ts` (re-exports from `src/`) → `strategyCoreBundle.js` →
   `strategyEngine.js:116`. **This call site is broken** (F-01): it invokes `engine.scanOnce()`, which
   does not exist. The compiled prototype exposes
   `constructor, updateSymbols, start, stop, isActive, subscribe, emit, getStatus, getRetrospective,
   scanNow, freshState, scan, runScan, scanSymbol, runReplay, publish, trackOpenSetups`
   (dumped in §7.4).
8. **Data needs.** Closed 1h candles (execution) + closed 4h candles (structure). Fetched at
   `LiveSignalEngine.ts:434` (1h, limit 1000) and `:457` (4h, limit 1000). No 1d series is requested
   for V3.0 (`needs1d` is true only when V2.8 is enabled).
9. **Timeframes.** `EXEC_TF = '1h'`, `STRUCT_TF = '4h'` (`v30Core.ts:31-32`; surfaced as
   `definition.execTimeframe` / `structuralTimeframe` at `definition.ts:136-137`). Production
   `/api/strategies` correctly reports `timeframes: ["1h","4h"]`.
10. **Research symbol scope.** `SYMBOLS: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT`
    (`v30Core.ts:35`). LIVE scope is **not** this list: it is the server scan universe (24 symbols
    live, cap 100). `DEFAULT_SIGNAL_SYMBOLS` at `LiveSignalEngine.ts:49` is only the pre-universe
    default and is overwritten by `MarketDataContext.tsx:195`.
11. **Indicators.** ATR(14) on 1h via the causal series `atrSeriesV2(h1, atrPeriod)`
    (`v30LiveReplay.ts:76`, comment states causality: value at `i` depends only on bars `0..i`);
    RVOL(20) via `rvolAt(h1, i, volPeriod)` (`:113`); 4h swing pivots via `findSwingsV2(h4, 3)` inside
    `confirmedLevels` (`v30Core.ts:51-67`).
12. **Swing causality (the subtle part).** `confirmedLevels(h4, asOfCloseTime, strength)` applies **two**
    filters: only 4h bars closed by the 1h bar's close time, and within those a pivot counts only from
    `confirmedIndex` onward (`v30Core.ts:45-50` doc comment). This is what stops the strategy from
    "seeing" a swing before a human could have.
13. **LONG condition, human language.** *A closed 1h candle pierces the most recent confirmed 4h swing
    low with its wick and then closes back above that swing low, on a candle with a real body and
    unusual volume.* Formally: `levels.swingLow !== null && c.low < levels.swingLow &&
    c.close > levels.swingLow` (`v30Core.ts:94-97`), gated by body ratio and RVOL.
14. **SHORT condition, human language.** *The mirror: a closed 1h candle pierces the confirmed 4h swing
    high and closes back below it.* `levels.swingHigh !== null && c.high > levels.swingHigh &&
    c.close < levels.swingHigh` (`v30Core.ts:90-93`).
15. **Gate 1 — body ratio.** `bodyRatio(c) = |close − open| / (high − low)`, `0` for a zero-range bar
    (`v30Core.ts:76-80`); must be **≥ 0.35** (`MIN_BODY_RATIO`, `v30Core.ts:21`; checked at `:87`).
16. **Gate 2 — relative volume.** `rvol` must be non-null and **strictly > 1.25**
    (`MIN_RVOL`, `v30Core.ts:22` — the comment notes this is deliberately different from V2.x's 1.2;
    check at `v30Core.ts:88` uses `!(rvol > MIN_RVOL)`).
17. **Gate 3 — order of tests.** Body ratio is tested before RVOL, and SHORT is tested before LONG
    (`v30Core.ts:87-97`). A bar that satisfies both (impossible in practice, since it would need to
    close above the swing high *and* below the swing low) resolves as SHORT. Frozen behaviour.
18. **Gate 4 — both swings required.** Even after a trap is detected, the replay skips the bar unless
    *both* `swingHigh` and `swingLow` are known (`v30LiveReplay.ts:118`), because TP1 is the midpoint of
    the 4h range and TP2 is the opposing swing.
19. **Entry type.** `LIMIT_CORRIDOR` (`v30LiveReplay.ts:132`). Not a market entry: the setup publishes a
    price corridor and waits for price to come back.
20. **Entry corridor arithmetic.** `half = CORRIDOR_ATR_FRAC × ATR = 0.10 × ATR(1h)`;
    `zoneLow = close − half`, `zoneHigh = close + half` (`v30Core.ts:239`, `:247`).
21. **Stop-loss arithmetic.** `stop = sweepExtreme ∓ STOP_BUFFER_ATR × ATR`, i.e. for LONG
    `swingLow-sweep low − 0.15 × ATR`, for SHORT `sweep high + 0.15 × ATR` (`v30Core.ts:241-243`).
    The stop is anchored to the **extreme of the liquidity sweep**, not to the candle body.
22. **Take-profit arithmetic.** `tp1 = (swingHigh + swingLow) / 2` — the 4h **equilibrium**
    (`v30Core.ts:240`, `:248`); `tp2 = swingHigh` for LONG / `swingLow` for SHORT — the **opposing 4h
    swing** (`v30Core.ts:244`). Two targets, fixed at setup time, never recomputed.
23. **Risk/reward.** `riskRewardRatio = rrFrom(direction, mid, stop, tp2)` where `mid` is the corridor
    midpoint (`v30LiveReplay.ts:121`, `:136`; `shared.ts:77`). R is measured to **TP2**, the final
    target — a conservative choice relative to measuring to TP1.
24. **Scoring / ranking.** There is **no score**. V3.0 publishes at most one pending setup at a time per
    symbol: the replay keeps a single `pend` slot and only looks for a new trap when `pend === null`
    (`v30LiveReplay.ts:110`). No candidate ranking exists, so no "best setup" heuristic can drift.
25. **Pre-publish geometry gate.** `corridorGeometryOk(direction, zoneLow, zoneHigh, stop, tp1, tp2)`
    (`v30LiveReplay.ts:123`, `shared.ts:92`) sets `record.publishable`. A failing setup is **kept in the
    retrospective** with `publishNote` explaining that the runner would reject it at the execution bar,
    but it is not published (`:156-157`). This keeps the funnel counters aligned with research.
26. **Execution (fill) semantics.** `corridorStep(p, c, barIndex)` runs from bar `setupIndex + 1`
    onward, for at most `CORRIDOR_EXPIRY_BARS = 3` bars (`v30Core.ts:212-231`):
    * corridor touched **and** stop touched on the same bar ⇒ `CANCELLED` (ambiguous bar, worst case
      assumed — `:218`);
    * corridor touched ⇒ fill at the **worse edge**: `fill = min(open, zoneHigh)` for LONG,
      `max(open, zoneLow)` for SHORT (`:220`);
    * geometry re-checked at the actual fill price; failure ⇒ `REJECTED_GEOMETRY` (`:222-225`);
    * stop touched without a corridor touch ⇒ `CANCELLED` (`:228`);
    * `waited >= 3` ⇒ `EXPIRED` (`:229`); otherwise `WAIT`.
27. **Trade management.** `manageTrade(direction, entry, stop0, tp1, tp2, bars)` (`v30Core.ts:124-188`)
    with five pre-registered intrabar rules: **R1** stop checked before targets on every bar; **R2** TP1
    books before TP2 when both land on one bar; **R3** breakeven arms only on bars strictly *after* the
    TP1 bar; **R4** the stop never moves backwards (BE = `entry`, which is never worse than `stop0`);
    **R5** timeout counts the entry bar as bar 1.
28. **Partial exit and fees.** TP1 books **50 %** of the position (`realised += 0.5 × rOf(tp1)`,
    `v30Core.ts:167`), the remainder exits at TP2/stop/timeout. Fee accounting is per leg on that leg's
    own notional: entry maker 2 bps, every closing leg taker 5 bps (`legFeeR`, `v30Core.ts:102-105`;
    `legs` array `:138-146`); stress variant 5/5 bps is carried in the constants (`:29-30`).
29. **Exit enum.** `SL | TP2 | TP1_THEN_BE | TP1_THEN_SL | TP1_THEN_TIMEOUT | TIMEOUT`
    (`v30Core.ts:38-39`). `TIMEOUT_BARS = 50` (`:26`) — note this is the V3.0 timeout; V3.3 uses 48 and
    the frozen V2 settings use 48 as well.
30. **Unresolved boundary.** If the window ends before an exit, `manageTrade` returns `null`
    (`v30Core.ts:187`) and the record keeps `fill` without `outcome` (`v30LiveReplay.ts:105` comment).
    The ledger later marks such setups `UNRESOLVED` rather than inventing a result.
31. **Lifecycle in production.** `LiveSignalEngine.trackOpenSetups()` (`:541-552`) runs **before** the
    new-bar evaluation (`:442`) and calls `trackPublishedSetup` (`lifecycle.ts:53`), which for
    `LIMIT_CORRID` re-runs `corridorStep` on bars N+1…N+3 and then `manageTrade`, using the **published
    (already hashed) levels** — never a fresh strategy run. Statuses: `ACTIVE → FILLED →
    TARGET_REACHED | INVALIDATED | CLOSED`, or `ACTIVE → EXPIRED | CANCELLED`, plus `UNRESOLVED`.
32. **Dedup.** Setup id = `setupId(strategyId, symbol, setupOpenTime)` (`LiveSignalEngine.ts:146`), i.e.
    `V3_0_HTF_LIQUIDATION_TRAP-BTC/USDT-<openTime ms>`; `publish()` returns early if
    `ledger.getById(id)` exists (`:515`). Deterministic ⇒ re-scans cannot duplicate. Only records whose
    `setupOpenTime` equals the **last closed bar** are published (`:486`), so latency is 0 bars.
33. **What reaches PostgreSQL.** `insertSignal` writes `strategy_id, symbol, timeframe, direction,
    signal_candle_ts, entry_min, entry_max, stop_loss, tp1, tp2, status, metadata{engineSetupId,
    riskRewardRatio, confirmingFactors, invalidationFactors, engineVersion}, hash, previous_hash`
    (`strategyEngine.js:125-149`, `signalRepository.js:137-160`).
34. **What is lost between strategy and DB (V3.0 specifically).** `validForBars` (3), `exitRule` (the
    Russian exit description), `entryType` (`LIMIT_CORRIDOR`), `setupClose`, `latencyBars`, the fill
    (price/time/shifted stop), and every outcome field (`resultR`, `netResultR`, `barsHeld`,
    `exitReason`) are **not persisted**. `status` is hard-coded `'ACTIVE'` at insert
    (`strategyEngine.js:141`) and never updated (F-07). For V3.0 the two targets *are* both persisted,
    so no target is lost — unlike V2.8 (F-06).
35. **Configuration and tests.** No runtime configuration exists: every constant is frozen in
    `V30_CONSTANTS` and `frozenSettings.ts`; `strategy_settings` deliberately stores no mathematical
    parameters (only `enabled`, `scan_interval_seconds`, `symbols`, telemetry). Tests:
    `tests/unit/signals/liveReplays.test.ts` (replay parity against the archived runner),
    `tests/unit/liveSignalLookAhead.test.ts` (forming candle is never closed),
    `tests/unit/v33SetupGeometry.test.ts`, `tests/unit/strategyArchive/` (10 files: `foundation`, `legacyV2`, `presentation`, `v21`, `v27v28`, `v30Core`, `v30Parity`, `v31`, `v32`, `v33` — frozen artefacts + SHA-256 pins),
    `tests/integration/strategyOperations.test.ts` (dedup + hash chain against real PostgreSQL).
    **Edge cases worth remembering:** (a) a 4h zone/swing formed by the newest 4h bar is not visible
    until the next 4h bar closes; (b) with a 1000-bar 1h window only ~940 bars are evaluable after
    warmup; (c) `document.hidden` pauses non-manual scans (`LiveSignalEngine.ts:394`), so a background
    tab does not scan; (d) provider errors are recorded **per symbol** and never stop the other symbols
    (`:409-416`).

### 6.2 V3.3 — HTF Zone Mitigation & LTF Squeeze (`V3_3_HTF_ZONE_MITIGATION`)

1. **Identity.** id `V3_3_HTF_ZONE_MITIGATION`, version `3.3`, name "HTF Zone Mitigation & LTF Squeeze"
   (`definition.ts:168-171`). Public badge: **"Train only"**.
2. **Research verdict.** `TRAIN_ONLY_NOT_VALIDATED`, `reproducibility: 'REPRODUCED'`
   (`definition.ts:172-173`). Headline variant `while-protective-displacement` (`:176`,
   `v33LiveReplay.ts:46`). The result is tail-fragile: without the top-1 % of trades it falls below
   fees. It must never be presented as validated.
3. **Implementation location (frozen core).**
   `definitions/v3_3-htf-zone-mitigation/v33Core.ts` (327 lines): `V33_CONSTANTS:20`, `bodyRatio:48`,
   `closePosition:53`, `rejectionWick:58`, `Zone:66`, `legAt:98`, `buildZones:104`, `intersects:154`,
   `advanceFill:158`, `trackZone:178`, `absorption:214`, `legFeeR:227`, `manageTrade:241`,
   `confirmedSwingLevels:298`.
4. **Implementation location (research runner).** `v33Runner.ts` — this is the file that owns the
   geometry invariant the LIVE adapter used to skip; the invariant was extracted into
   `setupGeometry.ts` rather than the adapter being rewritten (`docs/STRATEGY_OPERATIONS.md` §9 C).
5. **Implementation location (LIVE adapter).** `src/services/signals/live/replays/v33LiveReplay.ts`
   (283 lines): `runV33LiveReplay:72`, `v33ReplayCounts:279`. Zone construction, mitigation tracking
   and absorption are the frozen functions; only orchestration is local.
6. **Invocation (browser).** `LiveSignalEngine.scanSymbol()` → `runReplay()` →
   `runV33LiveReplay({ symbol, h1, h4 })` (`LiveSignalEngine.ts:467-492`).
7. **Invocation (server).** Same bundle path as V3.0; blocked by the identical `scanOnce()` defect
   (F-01). Nothing V3.3-specific is broken in the bundle itself.
8. **Data needs.** Closed 1h candles + closed 4h candles. Crucially, the **4h series is not clipped to
   the 1h window** (`v33LiveReplay.ts:87-91` comment): ATR/RVOL/swings and the opposing confirmed swing
   (TP2) must be computed on the longest available history. Zones known before the 1h window starts get
   `startIndex = 0` and are then dropped by the warmup rule (`:126`).
9. **Timeframes.** `EXEC_TF = '1h'`, `STRUCT_TF = '4h'` (`v33Core.ts:36-37`). Production
   `/api/strategies` correctly reports `["1h","4h"]`.
10. **Minimum history.** `h1.length > WARMUP_BARS (60)` and `h4.length >= atrPeriod + 2` — otherwise the
    replay returns with an explicit note (`v33LiveReplay.ts:83-95`). No silent empty result.
11. **Indicators.** `atrSeriesV2(h1, 14)` and `atrSeriesV2(h4, 14)` (`:97-98`); `rvolAt(h4, i, 20)`
    (`:99`) and `rvolAt(h1, i, 20)` (`:187`); `findSwingsV2(h4, 3)` (`:100`);
    `confirmedSwingLevels(h4, swings4)` (`:101`) producing per-index `high[]`/`low[]` tables.
12. **Zone construction — what a zone is.** `buildZones` walks every 4h bar `i` from 1 to `len−2`
    (`v33Core.ts:110`), requires a positive ATR, requires `detectDisplacement(h4, i, atr, rvol,
    displacementMinBodyAtr = 0.6)` (`:114`), then emits up to two zones from that bar:
    * **OB** (order block) — the last opposite candle within ≤ 5 bars, `knownAt4h = i` (`:119-133`);
    * **FVG** (fair value gap) — a 3-candle imbalance of at least `fvgMinSizeAtr = 0.15` ATR,
      `knownAt4h = i + 1` (`:135-149`).
    Each zone carries `legLow/legHigh` (the displacement leg range) and the confirmed swing leg.
13. **Zone origin labelling.** `origin` is the structure-break type when a non-wick-only break agrees
    with the displacement direction, otherwise `SWEEP_REACTION` (`v33Core.ts:117-118`); FVG origins are
    `BULLISH_IMBALANCE` / `BEARISH_IMBALANCE` (`:147`). These strings reach the user in
    `confirmingFactors`.
14. **The 4h lag (must be understood before any chart work).** Because an FVG needs bar `i+1`, a zone
    created by the newest closed 4h bar only becomes visible **after the next 4h bar closes** — up to a
    4-hour delay. `docs/SIGNALS.md` §6 documents this as a property of the frozen strategy (the archived
    runner behaves identically), not as a LIVE divergence.
15. **Mitigation tracking.** `trackZone(h1, zone, closed4hAt, FVG_FILL_MIN = 0.50)` (`v33Core.ts:178-212`):
    * first 1h index whose `closed4hAt[i] >= zone.knownAt4h + 1` is `startIndex` (`:181-186`) — strict
      causality between the 4h zone and the 1h window;
    * **OB:** mitigated on first intersection (`intersects`, `:195`), killed when the 1h **close** goes
      beyond the far edge (`:200-201`);
    * **FVG:** fill advanced by `advanceFill` (`:158-168`, monotone, `1` when price goes fully through),
      mitigated at `fill >= 0.50`, killed at `fill >= 1`;
    * a zone killed **before** ever being mitigated returns `null` — it never becomes a setup (`:204`).
16. **Warmup filter.** Windows with `startIndex < WARMUP_BARS` are counted as `skippedByWarmup` and
    reported in `out.notes` (`v33LiveReplay.ts:124-133`) — the same diagnostic the research runner
    produces, so funnel counters reconcile.
17. **LONG condition, human language.** *Price trades back into a live bullish 4h zone (an order block
    or a partially filled FVG) on a 1h candle that shows absorption — a rejection wick and/or a strong
    close in the top of its range — with unusual volume.* Formally: an active window whose
    `mitigationIndex <= i` (`:191`), `intersects(c, zoneLow, zoneHigh)` (`:193`),
    `absorption(c, 'LONG')` non-null (`:194`), `rvol >= 1.25` (`:188`), `atr > 0` (`:186`).
18. **SHORT condition, human language.** *The mirror on a bearish zone: price re-enters the zone from
    below and the 1h candle absorbs the move with a lower wick and/or a weak close near the bottom of
    its range.* Same code path with `z.dir === 'SHORT'`; `absorption(c, 'SHORT')` requires
    `closePosition(c) <= 0.30` for the reclaim branch (`v33Core.ts:220`).
19. **Absorption definition.** `absorption(c, dir)` (`v33Core.ts:214-225`) returns
    `WICK` when `rejectionWick >= 0.35`, `RECLAIM` when `bodyRatio >= 0.40` **and** the close sits in the
    extreme 30 % of the range (`>= 0.70` for LONG, `<= 0.30` for SHORT), `WICK+RECLAIM` when both, and
    `null` otherwise. Note `MIN_RVOL` here is **inclusive** (`>= 1.25`, `v33Core.ts:21` comment
    "inclusive, as written") while V3.0's is strict (`> 1.25`). Both are frozen quirks; do not
    "harmonise" them.
20. **Candidate selection (Amendment-1).** When several zones intersect the same bar, candidates are
    sorted by `knownAt4h` **descending** (newest zone first), ties broken OB before FVG
    (`v33LiveReplay.ts:199-204`). Documented consequence: at scan time an older zone may be chosen
    differently than in a retrospective full-history run, so **published levels are "as of the scan"**
    and are never rewritten.
21. **One pending setup at a time.** A new trigger is only evaluated when `pend === null`
    (`v33LiveReplay.ts:184`), and the active window list is pruned by `i < w.deathIndex` (`:182`).
22. **Entry type and corridor.** `LIMIT_CORRIDOR`, `zoneLow = close − 0.10 × ATR(1h)`,
    `zoneHigh = close + 0.10 × ATR(1h)` (`v33LiveReplay.ts:207`, `:218`), valid for
    `CORRIDOR_EXPIRY_BARS = 3` bars (`:237`).
23. **Stop-loss arithmetic.** `protective` stop mode (the frozen headline variant):
    `stop = min(climax, zoneEdge) − 0.15 × ATR` for LONG and `max(climax, zoneEdge) + 0.15 × ATR` for
    SHORT, where `climax` is the trigger candle's extreme (`c.low` / `c.high`) and `zoneEdge` is
    `z.zoneLow` for LONG / `z.zoneHigh` for SHORT (`v33LiveReplay.ts:208-212`).
24. **Take-profit arithmetic.** `tp1 = (z.legLow + z.legHigh) / 2` — the **midpoint of the displacement
    leg** (`:216`); `tp2 = opposing confirmed 4h swing`, looked up causally as
    `levels.high[closed4hAt[i]]` for LONG / `levels.low[closed4hAt[i]]` for SHORT (`:213-215`). If the
    opposing swing is unknown, the bar is skipped entirely (`:215` `continue`) — no invented target.
25. **Risk/reward.** `rrFrom(z.dir, mid = c.close, stop, opposing)` (`:221`, `:236`) — measured to TP2.
26. **Scoring / ranking.** No numeric score. Ranking is purely the recency + type tiebreak of point 20.
    `meta` carries `zoneType`, `zoneOrigin`, `zoneKnownAt4hOpenTime`, `zoneFirstTrackedOpenTime`,
    `zoneMitigatedAtOpenTime`, `absorption`, `rvol` (`:258-266`) — useful for a future detail view, and
    **not persisted server-side**.
27. **Pre-publish geometry gate.** `corridorGeometryOk(...)` (`:223`) sets `publishable`; a failing
    setup stays in the retrospective with the note *"TP1 позади коридора (или TP2 не ближе TP1) —
    раннер отклонит на баре исполнения (REJECTED_GEOMETRY); в журнал не публикуется"* (`:257`).
    Research measured ≈51 % of V3.3 pendings failing this way, which is why the gate matters.
28. **Execution semantics.** Identical shape to V3.0 but implemented inline in the replay
    (`v33LiveReplay.ts:144-178`): touch + stop ⇒ `CANCELLED`; touch ⇒ fill at the worse edge
    (`min(open, zoneHigh)` / `max(open, zoneLow)`), geometry re-checked at the fill, failure ⇒
    `REJECTED_GEOMETRY` recorded as `CANCELLED` with that exit reason (`:160`); stop alone ⇒
    `CANCELLED`; `waited >= 3` ⇒ `EXPIRED`.
29. **Trade management.** Frozen `manageTrade` from `v33Core.ts:241-297` with the same R1–R5 intrabar
    rules as V3.0 and `TIMEOUT_BARS = 48` (`v33Core.ts:29`). Exit enum is the same six values
    (`v33Core.ts:46`). TP1 books 50 %, then BE from the next bar.
30. **Fees.** Maker 2 bps on entry, taker 5 bps on each closing leg, stress 5/5
    (`v33Core.ts:30-33`, `legFeeR:227`). Net R is computed in the ledger with the same 2/5 bps model.
31. **Lifecycle in production.** Same `trackOpenSetups` → `trackPublishedSetup` path as V3.0
    (`lifecycle.ts:53`, corridor branch), using published levels only.
32. **Dedup.** `V3_3_HTF_ZONE_MITIGATION-<PAIR>-<setupOpenTime>` (`LiveSignalEngine.ts:146`, `:515`);
    publish restricted to the last closed 1h bar (`:486`).
33. **What reaches PostgreSQL.** Same column set as V3.0 (two targets, entry corridor, stop, status
    hard-coded `ACTIVE`, metadata with RR + factor arrays + `engineVersion: 'V3.3'`).
34. **What is lost.** In addition to the V3.0 list: the whole `meta` block (zone type/origin, mitigation
    time, absorption kind, RVOL) is dropped — it lives only in the browser ledger's setup record. For a
    future chart, zone rectangles and the mitigation timestamp would have to come from the browser
    engine, not from `/api/signals`.
35. **Configuration and tests.** No tunables at runtime; the variant is selected by code
    (`V33_LIVE_VARIANT_ID`). Tests: `tests/unit/signals/liveReplays.test.ts` (replay parity),
    `tests/unit/v33SetupGeometry.test.ts` (the geometry-invariant regression from the production ETH
    SHORT bug — that exact setup must yield `STOP_ON_WRONG_SIDE` + `TP_ORDER_INVERTED`),
    `tests/unit/strategyArchive/v33.test.ts` (frozen core + artefact pins), and
    `tests/integration/strategyEngineCore.test.ts` (asserts the same rejection on the **built** bundle —
    currently a false green, F-03). **Edge cases:** a zone can die without ever being mitigated
    (returns `null`, never a setup); `startIndex = 0` zones are dropped by warmup; overlapping pendings
    are impossible by construction; and the `while` window mode means *any* bar inside the window can
    trigger, not just the mitigation bar.

### 6.3 V2.8 — Zero-fee Sniper + Trailing (`V2_8_ZERO_FEE_SNIPER_TRAILING`)

> ⚠️ **Every V2.8 figure is GROSS (zero fees).** At the programme's 2/5 bps model this entry population
> carries ≈0.1555 R/trade of fee drag, i.e. the strategy is **net-negative**. It must never be shown
> next to V3.x net numbers without the incomparability warning (`definition.ts:8-10`, `V28_CAVEATS_RU`).

1. **Identity.** id `V2_8_ZERO_FEE_SNIPER_TRAILING`, version `2.8`, name
   "Zero-fee Sniper + Trailing (gross-only)" (`definition.ts:174-178`). Public badge:
   **"Gross-only validated"**.
2. **Research verdict.** `VALIDATED_GROSS_ONLY`, `reproducibility: 'REPRODUCED'`
   (`definition.ts:179-180`). VALIDATION: gross **+0.0488 R**, PF **1.1087**, n = **98** — but removing
   **one** trade (top 1 %) flips it to **−0.0143**, and the median R sign-flipped TRAIN → VALIDATION
   (+0.0364 → −0.1270) (`D-V28-002`, `definition.ts:87-94`).
3. **Provenance pins.** Source commits `54243a7` (TRAIN) → `852167c` (candidate freeze) → `1d4d575`
   (VALIDATION); frozen V2 engine `4839074`; dataset `c3c1dce…` (`V28_COMMITS`, `definition.ts:69-76`).
   16 source pins with SHA-256 (`V28_SOURCE_PINS:51-67`), including the frozen
   `settings.json`/`splits.json` artefacts.
4. **Implementation location (archive wrapper).**
   `definitions/v2_8-zero-fee-sniper-trailing/v28Live.ts` (354 lines): `V28_LIVE_TIMEFRAME:52`,
   `V28_LIVE_HTF:54`, `V28_LIVE_NET_FEES:56`, `v28NetR:129`, `runV28Live:145`,
   `v28EntryAtNextOpen:316`, `v28TrailOutcome:346`.
5. **Implementation location (frozen engine it wraps).**
   `src/services/strategyArchive/legacy/v2/`: `engine.ts:424 evaluateV2`, `engine.ts:189 buildTargets`,
   `stateMachine.ts:7 resolveEntry`, `v2Runner.ts:7 executableLadder`, `tracker.ts:79 trackOutcome`,
   `corridorEntry.ts:185 extremePoolKind`, `v24Engine.ts:34 baseSniper`,
   `shared/legacyResearch/v25Trailing.ts:38 simulateTrailing`.
   **Isolation rule (verified in `D-V28-005`):** the LIVE engine consumes the legacy port **only**
   through `v28Live.ts` and never imports `legacy/v2` directly; `BacktestEngine` never uses it.
6. **Implementation location (LIVE adapter).**
   `src/services/signals/live/replays/v28LiveReplay.ts` (114 lines): `runV28LiveReplay:98` calls
   `runV28Live` and maps each `V28LiveEvent` to a `ReplayRecord` via `toRecord:34-96`.
7. **Invocation (browser).** `LiveSignalEngine.scanSymbol()` fetches 1h + 4h + **1d** (`needs1d` is true
   only when V2.8 is enabled — `:458`) and calls
   `runV28LiveReplay({ symbol, h1, htf: { '4h': h4, '1d': h1d } })`.
8. **Timeframes — the documented divergence (F-08).** `V28_LIVE_TIMEFRAME = '1h'` and
   `V28_LIVE_HTF = HTF_MAP['1h'] = ['4h','1d']` (`v28Live.ts:52-54`, `legacy/v2/htf.ts:16-25`).
   But `definition.execTimeframe = '15m'` (`definition.ts:186`) because the *research* pooled
   `15m/30m/1h/4h` (`V28_CONSTANTS.SCOPE`, `v28Core.ts:30`), and
   `server/services/strategyCatalog.js` copies that value → live `/api/strategies` reports
   `timeframes: ["15m"]` (verified). `strategyEngine.EXEC_TIMEFRAME` also maps V2.8 → `'15m'`, so the
   server preloads 15m candles that nothing consumes, while the engine actually asks for 1h/4h/1d.
   Published setups carry `timeframe: '1h'` (`LiveSignalEngine.ts:522`), so a DB row and its strategy
   card would disagree. **Do not "fix" this by changing the strategy** — the correction belongs in the
   catalog/server map, and it needs owner approval because it changes what the UI advertises.
9. **Data needs and window.** `runV28Live` computes `minBars = max(80, swing_lookback × 6 + 40) = 80`
   and `winLen = engine.lookback_candles (300) + WINDOW_MARGIN (60) = 360` (`v28Live.ts:150-151`).
   Each bar evaluates a **sliding visible window** `closed.slice(max(0, i − winLen + 1), i + 1)`
   (`:190-191`) — the engine never sees more history than a live trader would at that bar.
10. **HTF causality.** For each HTF in `['4h','1d']` the wrapper bounds the series with
    `htfUpperBound(hc, asOf = candle.closeTime, span)` and keeps at most the last **200** closed bars
    (`v28Live.ts:194-202`). A future HTF bar cannot leak in; `htfEma200Bullish` additionally refuses the
    leg when fewer than `HTF_EMA_MIN_BARS = 200` closed HTF bars exist (`v24Engine.ts:27-28`, `:82`).
11. **Indicators.** Wilder ATR(14) (`risk.atr_period`), RVOL over `v2.volume_period = 20` (current bar
    excluded), swings with `engine.swing_lookback = 3` (pivot confirmed at `index + strength`),
    EMA200 on the primary HTF. All read from the frozen registry via
    `Settings.fromFrozenSnapshot()` (`v28Live.ts:146`).
12. **Setup generation.** `evaluateV2({ symbol, timeframe: '1h', candles: visible, settings, htfCandles })`
    returns a `V2Setup` or `null` (`v28Live.ts:204`). A setup is only considered when
    `direction !== 'WAIT'`, `stop !== null`, `entry !== null` and `targets.length > 0` (`:205`).
13. **LONG condition, human language.** *The frozen V2 engine reports a REVERSAL setup after price swept
    a real structural low, and that sweep passes the pre-registered sniper filter: a genuine liquidity
    pool was taken, price reclaimed it quickly, and the reclaim candle had real penetration, a real
    rejection wick, a real body and unusual volume.* Entry is then taken at the **open of the next bar**.
14. **SHORT condition, human language.** *The exact mirror on a swept structural high.* Note the frozen
    asymmetry: in the V2.4 lineage, `longAsymmetry` adds an HTF/RSI-confluence leg for LONGs while
    "SHORTs always pass — no symmetric gate exists, by design" (`v24Engine.ts:87-95`). **V2.8 does not
    call `longAsymmetry`** — it gates on `baseSniper` only (`v28Live.ts:212-215`).
15. **Sniper filter, exactly.** `baseSniper(s, poolKind)` (`v24Engine.ts:34-55`) rejects, in order, with
    these reasons: `wait`, `continuation_disabled` (only `kind === 'REVERSAL'`), `no_sweep`,
    `no_structural_extreme` (pool must be `SWING`, `EQUAL` or `CLUSTER`), `sweep_wrong_direction`,
    `not_reclaimed`, `reclaim_too_slow` (`reclaimBars > RECLAIM_MAX_BARS = 3`),
    `shallow_penetration` (`penetrationAtr < 0.10`), `weak_rejection_wick` (`wickRatio < 0.25`),
    `weak_body_reclaim` (`bodyRatio < 0.35`), `low_rvol` (`!(rvol > 1.2)` — strict).
16. **Selectivity (why it is silent).** Out of ≈1150–1250 actionable V2 setups per symbol over four
    years, only **10–14** pass the sniper filter (`docs/SIGNALS.md` §7.2). Full 1h history over 6 symbols
    for 4 years produced **65** setups total (≈1 per symbol every 3–5 months). In a 10-day window the
    expected count is ≈0.05 per symbol. **Silence is the expected behaviour, not a fault.**
17. **Entry type.** `MARKET_NEXT_OPEN` (`v28LiveReplay.ts:49`) — no corridor. `validForBars = 1` (`:55`).
18. **Entry price before the fill.** Until bar N+1 opens, the published `entryZone` is
    `[entryRef, entryRef]` where `entryRef = ev.fill?.price ?? ev.plannedEntry` (`v28LiveReplay.ts:36`,
    `:51`) and `plannedEntry = s.entry` (the engine's entry for bar N, effectively its close). The
    confirming factor states this explicitly: *"Ожидается открытие бара N+1: вход по его OPEN, стоп и
    цели сдвинутся на дельту исполнения"* (`:63`).
19. **Execution.** `resolveEntry(candle.openTime, tfMs, next)` (`legacy/v2/stateMachine.ts:7`) requires a
    **contiguous** next bar; otherwise the event is `NO_ENTRY` with reason
    `NO_CONTIGUOUS_NEXT_BAR` (`v28Live.ts:240-250`, `v28LiveReplay.ts:78-82`).
20. **Level shift on fill (V2.8's signature mechanic).** `shift = ent.entryPrice − s.entry`; then
    `stopPrice = s.stop.price + shift` and every target `t.price + shift` (`v28Live.ts:252-254`). The
    published `plannedStop`/`plannedTargets` are therefore **not** the traded levels; `fill.stop` and
    `fill.targets` are. The identical arithmetic is re-implemented for already-published setups in
    `v28EntryAtNextOpen` (`v28Live.ts:316-331`) so lifecycle tracking uses the frozen rules.
21. **Stop-loss.** Structural, from the frozen engine: behind the sweep wick plus
    `v2.stop_buffer_atr = 0.25` ATR (`V28_RULES_RU.stop`, `definition.ts:167`), then shifted by the fill
    delta (point 20).
22. **Targets / ladder.** `buildTargets` (`legacy/v2/engine.ts:189`) collects structurally valid
    candidates ahead of entry (bases `INTERNAL_LIQUIDITY`, `EQUILIBRIUM`, `RANGE_EDGE`), falls back to
    fixed **1R/2R/3R** when structure supplies nothing (explicitly "NOT fitted to any slice",
    `engine.ts:185-187`), de-duplicates clusters within `clusterTolAtr`, and returns **at most three**
    rungs. `executableLadder(direction, entry, stop, targets)` (`legacy/v2/v2Runner.ts:7`) then filters
    for executability and computes `rr1`.
23. **Validity gate at the fill.** `valid = risk > 0 && lad.targets.length > 0 && lad.rr1 >= risk.min_rr
    (1.0) && (LONG ? stopPrice < entryPrice : stopPrice > entryPrice)` (`v28Live.ts:257-258`). The same
    check runs *before* the fill for the awaiting case (`plannedValid`, `:219-220`) and again inside
    `v28EntryAtNextOpen` (`:327-328`), which returns `NO_ENTRY / LADDER_INVALID_AT_FILL` on failure.
24. **Exit — the frozen candidate `Trail` (V2.5).** `simulateTrailing`
    (`shared/legacyResearch/v25Trailing.ts:38`) with `BREAKEVEN_R = 1.0`, `TRAIL_DISTANCE_R = 1.0`,
    `TRAIL_STEP_R = 0.25`, `TIMEOUT_BARS = 10` (`:12-15`). Human language: *breakeven once MFE ≥ 1R;
    then trail a stop 1R below the MFE peak, ratcheting in 0.25R steps; no fixed targets; if +1R is
    never reached, exit at the close after 10 bars.* Exit reasons: `TRAIL | BE | SL | TIMEOUT` (`:17`).
25. **Exit reason → ledger status mapping.** `SL ⇒ INVALIDATED`, everything else ⇒ `CLOSED`
    (`v28LiveReplay.ts:86`). `NO_ENTRY ⇒ CANCELLED` (`:80`).
26. **The frozen slot is also tracked.** Independently of the Trail simulation, `runV28Live` keeps **one
    open slot per symbol** and runs the frozen `trackOutcome` on it (`v28Live.ts:176-187`), marking
    `frozenSlotResolved` on the published event (`:184`, `:275`). This is what enforces "no overlapping
    positions" exactly as the research did.
27. **Scoring / ranking.** No score. Arms are a research concept only: `ARM_ORDER =
    ['SMC','Trail','RR15','RR20','RR25','RR30','RR40']` (`v28Core.ts:22`), `CANDIDATE_ARM = 'Trail'`
    (`:31`), `VALIDATION_ARMS = ['SMC','Trail']` (`:24`). Only `Trail` runs live. SMC was the TRAIN
    gross winner (0.1490) and collapsed on VALIDATION (−0.1821) — the candidate was frozen **before**
    validation on outlier robustness, which is documented rather than retro-fitted (`D-V28-003`).
28. **Fee semantics.** `V28_CONSTANTS.MAKER_BPS = 0`, `TAKER_BPS = 0` (`v28Core.ts:29`) — zero by design.
    The SMC arm recovers gross by adding back the frozen 0.1 % lump fee via
    `recoverGrossFromFrozenTracker(storedR, entry, risk) = storedR + 0.001 × entry / risk`
    (`v28Core.ts:37-39`, identity verified by the source across 1.69 M trades).
29. **Net R for display.** `V28_LIVE_NET_FEES = { makerBps: 2, takerBps: 5 }` (`v28Live.ts:56`) and
    `v28NetR(grossR, entryPrice, exitPrice, risk)` (`:129`) — so the ledger can show the honest
    net-of-fees number **alongside** the gross research number, without changing the frozen strategy.
30. **Publish gate.** `publishable: true` unconditionally in `toRecord` (`v28LiveReplay.ts:74`) — but the
    wrapper only emits events for sniper setups with a valid ladder, and only for the **last** bar when
    N+1 has not opened yet (`isLastBar` branch, `v28Live.ts:222-237`, which then `break`s). Non-sniper
    valid setups are counted in `nonSniperSetups` and reported in `out.notes`
    (`v28LiveReplay.ts:110-112`) so the funnel stays honest.
31. **Lifecycle in production.** `trackPublishedSetup` takes the V2.8 branch: `v28EntryAtNextOpen` on bar
    N+1 (fill, shifted stop/targets) and then `v28TrailOutcome` on closed bars from the entry
    (`lifecycle.ts:53`, `v28Live.ts:316`, `:346`). `v28TrailOutcome` slices at most
    `FROZEN_ENGINE.outcomeTimeoutBars (48) + 64` bars (`:349`) — bounded work, matching `v28Runner`.
32. **Dedup.** `V2_8_ZERO_FEE_SNIPER_TRAILING-<PAIR>-<setupOpenTime>` (`LiveSignalEngine.ts:146`).
    Because a V2.8 setup is published on bar N with `AWAITING_NEXT_OPEN` semantics and then updated by
    lifecycle tracking, the **setup id stays stable** and the ledger updates the existing record
    (`markFilled` / `resolve`) instead of appending a second one (`LiveSignalEngine.ts:541-552`).
33. **What reaches PostgreSQL — and the TP3 loss (F-06).** `insertSignal` maps only
    `tp1 = targets[0]` and `tp2 = targets[1]` (`strategyEngine.js:139-140`), while `signals` has no
    `tp3` column (`007_signals.sql`). A V2.8 ladder with three rungs therefore **loses the third target
    server-side**. The browser ledger keeps the full `targets[]` array, so the same setup shows three
    targets on `/signals` and two in `/api/signals`. Any chart built on `/api/signals` alone would draw
    an incomplete ladder.
34. **Other V2.8-specific losses.** `entryType` (`MARKET_NEXT_OPEN`), `validForBars` (1), the shift
    delta, `fill.rr1`, `poolKind`, `engineReasons[]` (the frozen engine's own justification strings),
    `sweepLevel`, `trail.reason/exitPrice/barsHeld/grossR/netR` and `frozenSlotResolved` are **not**
    persisted. `metadata` keeps only `engineSetupId`, `riskRewardRatio`, the two factor arrays and
    `engineVersion: 'V2.8'`.
35. **Configuration and tests.** Frozen registry values actually used
    (`results/v2-real-20260915-080338/settings.json`): `engine.lookback_candles = 300`,
    `engine.swing_lookback = 3`, `risk.atr_period = 14`, `risk.min_rr = 1`, `risk.sl_atr_mult = 1.5`,
    `v2.volume_period = 20`, `v2.stop_buffer_atr = 0.25`, `v2.min_room_r = 1.5`,
    `v2.sweep_min_penetration_atr = 0.1`, `v2.sweep_min_wick_ratio = 0.25`,
    `v2.sweep_reclaim_window = 3`, `v2.breakout_min_body_atr = 0.5`,
    `v2.structure_min_penetration_atr = 0.05`, `v2.displacement_min_body_atr = 0.6`,
    `v2.fvg_min_size_atr = 0.15`, `outcome.timeout_bars = 48`, `detectors.ob_lookback_bars = 8`.
    Tests: `tests/unit/signals/v28Live.test.ts` (parity with the archived runner),
    `tests/unit/strategyArchive/v27v28.test.ts` + `legacyV2.test.ts` (SHA-256 pins on artefacts and source files),
    `tests/unit/liveSignalLookAhead.test.ts`. **Edge cases:** the 1000-bar 1h window loses no full-history
    setup (0 missing in validation) but 31 of 65 differ by one tick in entry/stop because ATR is computed
    from the start of the *window*, not of history — a documented, accepted quantisation effect
    (`docs/SIGNALS.md` §7.1). The `1d` series must be available or the HTF leg is simply absent
    (`bounded[h]` skipped at `v28Live.ts:199`) — which on the server currently ends in an HTTP 400
    because of the `'1D'` interval bug (F-09).

---

## 7. Full signal pipeline trace

### 7.1 Path A — browser (the one that works today)

```
MarketDataContext.tsx:183-212        dataMode === 'live'
  └─ LiveSignalEngine.getInstance({ provider: singletonLiveProvider,
                                    symbols: getScanUniverse() })   :193-196
     └─ .start()  :197  → first scan after 5 s (DEFAULT_INITIAL_DELAY_MS), then every 60 s
MarketDataContext.tsx:217-227        subscribeScanUniverse → engine.updateSymbols(getScanUniverse())
                                     + refreshScanUniverse() + setInterval(ensureFreshScanUniverse, 60_000)
LiveSignalEngine.ts:389 scan()       single-flight (currentScan), skips when document.hidden && !manual
LiveSignalEngine.ts:399 runScan()    sequential over symbols, per-symbol try/catch → status.lastError,
                                     setTimeout(0) yield between symbols
LiveSignalEngine.ts:428 scanSymbol() :434 getCandles(symbol,'1h',1000)  → ohlcvArrayToArchive(..., nowMs)
                                     :442 trackOpenSetups(pair, h1)     ← lifecycle FIRST (cheap)
                                     :445-449 skip when no new closed 1h bar
                                     :457-458 getCandles 4h(1000) + 1d(400, only if V2.8 enabled)
                                     :467 for each strategy → runReplay()
                                     :484 if (!provider.isDemo)         ← QA fixtures never published
                                     :486 only records with setupOpenTime === lastClosed.openTime
                                     :487 only records with publishable === true
                                     :488 publish(rec, pair, nowMs)
LiveSignalEngine.ts:513 publish()    :515 dedup by ledger.getById(setupId(...))
                                     :522 timeframe = EXEC_TIMEFRAME ('1h')
                                     validateSetupGeometry() → reject + count if invalid
                                     :537 ledger.append(input)          ← hash chain written here
SignalsAuditLedger.ts                localStorage 'cryptora_signals_ledger_v2', MAX_STORED 500
                                     append / markFilled / resolve / verifyIntegrity / getSummary
SignalsPage.tsx:83-137               ledger + engine.getStatus() + engine.getRetrospective() (≤60 rows)
                                     + manual engine.scanNow()
```

**Types on this path** (`SignalsAuditLedger.ts`):
`SetupIssuance` (`:70-91`) → `id, strategyId, strategyVersion, symbol, direction, timeframe:'1h',
setupOpenTime, entryType, entryZone:[min,max], invalidationLevel, targets:number[], riskRewardRatio,
confirmingFactors:string[], invalidationFactors:string[], exitRule, validForBars, createdAt,
latencyBars`;
`AnalyticalSetup extends SetupIssuance` (`:110-…`) → `+ status, fill?, closedAt?, exitReason?,
exitPrice?, resultR?, netResultR?, pnlResultPct?, barsHeld?, prevHash, auditHash, outcomeHash?`;
`SetupStatus = ACTIVE | FILLED | TARGET_REACHED | INVALIDATED | CLOSED | EXPIRED | CANCELLED | UNRESOLVED`;
`SetupFill` carries the **post-fill** `price, at, barOpenTime, stop?, targets?`.

### 7.2 Path B — server (complete, tested, and unreachable)

```
server/index.js:36-43      startStrategyScheduler() ONLY if checkDatabase() succeeded
strategyScheduler.js:95    setInterval(tick, 15_000)  (+ immediate first tick at :103)
strategyScheduler.js:~140  re-reads strategy_settings EVERY cycle → getEnabledStrategies()
                           in-flight lock per strategy, released in finally
                           symbols = saved scan_universe ∩ active Binance Spot
strategyEngine.js:93-109   preloads candles for execTf + meta.timeframes over the whole universe,
                           Promise.allSettled; ANY rejected series ⇒ throws MARKET_DATA_UNAVAILABLE
                           (deliberate: "no data" must never look like "no setups")
strategyEngine.js:116      await engine.scanOnce()            ← METHOD DOES NOT EXIST (F-01)
strategyEngine.js:118      fresh = ledger.getSetups() \ before
strategyEngine.js:125-149  insertSignal({...}) per fresh setup
signalRepository.js:137-160 pg_advisory_xact_lock(730117) → read tail hash → INSERT … ON CONFLICT
                           (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING
strategySettings.js        recordScanResult / recordSignalEmitted → strategy_settings telemetry
routes/signals.js          GET /api/signals?strategy&status&symbol&limit  (public)
                           status filter validated → 400 INVALID_STATUS
routes/strategies.js       GET /api/strategies (public), GET /api/strategies/scan-universe (public)
routes/admin.js            PATCH /api/admin/strategies/:id, GET /api/admin/strategies/status,
                           GET/POST/DELETE /api/admin/scan-universe (requireAuth + requireAdmin)
```

### 7.3 `signals` table — exact schema (migration `007_signals.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK default gen_random_uuid()` | |
| `strategy_id` | `TEXT NOT NULL` | not a FK on purpose; the authoritative list is in code + the 006 `CHECK` |
| `symbol` | `TEXT NOT NULL` | normalised pair, quoted exactly once (`ETH/USDT`) via `pairLabel()` |
| `timeframe` | `TEXT NOT NULL` | part of the dedup key |
| `direction` | `TEXT NOT NULL CHECK IN ('LONG','SHORT')` | |
| `signal_candle_ts` | `TIMESTAMPTZ NOT NULL` | open time of the **closed trigger candle**; part of the dedup key |
| `entry_min`, `entry_max` | `NUMERIC NULL` | limit corridor; NULL = "not defined", never zero |
| `stop_loss` | `NUMERIC NULL` | |
| `tp1`, `tp2` | `NUMERIC NULL` | **no `tp3`** (F-06) |
| `status` | `TEXT NOT NULL DEFAULT 'ACTIVE' CHECK IN ('ACTIVE','INVALIDATED','TARGET_REACHED','EXPIRED')` | **cannot represent** `FILLED`, `CLOSED`, `CANCELLED`, `UNRESOLVED` (F-07) |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | `updated_at` maintained by trigger `trg_signals_touch_updated_at` |
| `closed_at` | `TIMESTAMPTZ NULL` | never written in production |
| `close_price` | `NUMERIC NULL` | never written |
| `close_reason` | `TEXT NULL` | never written |
| `metadata` | `JSONB NULL` | `engineSetupId, riskRewardRatio, confirmingFactors, invalidationFactors, engineVersion` |
| `hash` | `TEXT NOT NULL` | `'sha256-' || sha256(JSON(payload) with prevHash)` |
| `previous_hash` | `TEXT NOT NULL DEFAULT 'GENESIS'` | append-only integrity chain |
| constraint | `UNIQUE (strategy_id, symbol, timeframe, signal_candle_ts)` (`signals_unique_per_candle`) | DB-level dedup |

20 columns total — asserted against a real PostgreSQL by
`tests/integration/migrationsPostgres.test.ts` ("таблица существует со всеми 20 колонками").

**The migration's own header comment is stale:** it says *"`/signals` reads this table instead of the
browser's localStorage ledger … exactly ONE source of truth"*. On `main` `/signals` does not read this
table at all (F-02/F-04). The schema is fine; the comment describes an intention that was reverted.

### 7.4 The blocking defect, proved (F-01)

The audit built the server bundle exactly the way the server does, in plain Node:

```
$ node --input-type=module -e "import {loadStrategyCore} from './server/services/strategyEngine/strategyCoreBundle.js'; …"
BUILT OK -> server/services/strategyEngine/.generated/strategyCore.mjs
LiveSignalEngine prototype methods: constructor, updateSymbols, start, stop, isActive, subscribe,
  emit, getStatus, getRetrospective, scanNow, freshState, scan, runScan, scanSymbol, runReplay,
  publish, trackOpenSetups
has scanOnce: undefined
has scanNow:  function
exports: ARCHIVE_TF_MS, LiveSignalEngine, SignalsAuditLedger, ohlcvArrayToArchive, ohlcvToArchive,
  validateSetupGeometry
```

So `strategyEngine.js:116 await engine.scanOnce()` throws
`TypeError: engine.scanOnce is not a function` on the very first scan of any enabled strategy. The
throw is caught by `scanStrategySafely` (`strategyEngine.js:173-…`), written to
`strategy_settings.last_error`, and surfaced as `status: 'ERROR'` on `/strategies`. **Symptoms an owner
would see after flipping a switch:** the card turns red with a `TypeError` message, `lastScanAt` stays
`null`, `/api/signals` stays empty, and the scheduler retries every 15 s forever (F-12).

The two neighbouring defects are equally real:

* `strategyEngine.js:163 rejected: engine.lastRejected ?? null` — `lastRejected` exists nowhere in
  `src/` (grep: only `server/` and the test mention it), so it is always `null`. The V3.3
  geometry-rejection counter described in `docs/STRATEGY_OPERATIONS.md` §9 is not reported.
* `strategyEngine.js:132-136` — `setup.sourceCandleTs` is not a field of `AnalyticalSetup`
  (`SignalsAuditLedger.ts:70-91` has `setupOpenTime`), so `signal_candle_ts` **always** falls back to
  `new Date(setup.createdAt)` = publish time. The DB-level dedup then keys on publish time, which
  defeats its entire purpose: the same closed candle re-published after a restart gets a new
  `created_at` and therefore a **new row**.

The minimal, algorithm-preserving repair (owner approval required, **not** done in this audit) is:
`scanOnce()` → `scanNow()`; `sourceCandleTs` → `setupOpenTime`; drop or implement `lastRejected`.
None of these touch a strategy rule.

### 7.5 Level fidelity: strategy → DB → API → frontend

| Level / field | Strategy computes | Browser ledger | `signals` table | `GET /api/signals` | `/signals` UI |
|---|---|---|---|---|---|
| Entry corridor min/max | ✅ | ✅ `entryZone` | ✅ `entry_min/max` | ✅ | ✅ |
| Stop (invalidation) | ✅ | ✅ | ✅ `stop_loss` | ✅ | ✅ |
| TP1 | ✅ | ✅ `targets[0]` | ✅ | ✅ | ✅ |
| TP2 | ✅ | ✅ `targets[1]` | ✅ | ✅ | ✅ |
| **TP3 (V2.8 ladder)** | ✅ `targets[2]` | ✅ | ❌ **dropped** | ❌ | ✅ (from ledger) |
| Entry type | ✅ | ✅ | ❌ | ❌ | ✅ |
| Valid-for bars | ✅ | ✅ | ❌ | ❌ | ✅ |
| Exit rule text | ✅ | ✅ | ❌ | ❌ | ✅ |
| R:R | ✅ | ✅ | ⚠️ `metadata.riskRewardRatio` | ⚠️ nested | ✅ |
| Confirming / invalidating factors | ✅ | ✅ | ⚠️ `metadata.*` | ⚠️ nested | ✅ |
| Strategy version | ✅ `strategyVersion` | ✅ | ⚠️ `metadata.engineVersion` | ⚠️ nested | ✅ |
| Signal candle open time | ✅ `setupOpenTime` | ✅ | ⚠️ **wrong value** (F-05) | ⚠️ | ✅ |
| Fill price / time / shifted stop & targets | ✅ | ✅ `fill` | ❌ | ❌ | ✅ |
| Outcome (status, exit reason, exit price, R, net R, %, bars held) | ✅ | ✅ | ❌ (`status` stuck at `ACTIVE`) | ❌ | ✅ |
| Hash chain | ✅ | ✅ `auditHash/outcomeHash` | ✅ `hash/previous_hash` | ✅ | ✅ |

**Conclusion for §15:** everything a signals chart needs *already exists* — but only in the browser
ledger. `/api/signals` cannot currently draw an honest chart (no fills, no outcomes, no TP3, wrong
candle timestamp). The design in §15 therefore uses the ledger as the level source and treats
`/api/signals` as an optional future mirror, with the exact schema additions listed if the owner ever
wants the server to be the source of truth.

### 7.6 `GET /api/signals` has no consumer (F-04)

```
$ grep -rn "fetchSignals" src/ tests/ | grep -v strategyOps.ts:
(no matches)
```

`fetchSignals` and its `SignalDto`/`SignalFilters` types are exported from `src/services/strategyOps.ts:121-132`
and imported nowhere. `fetchStrategies` from the same module *is* used (by `ProductStrategiesSection`).
Live production confirms the endpoint works and is empty: `{"signals":[],"count":0,"source":"server"}`,
and `?status=BOGUS` correctly returns `400 {"error":"INVALID_STATUS", …}`.

### 7.7 Server-side lifecycle is dead (F-07)

`signalRepository.js` exports `closeSignal()` and `verifyChain()`. A repo-wide grep shows `closeSignal`
is called **only** from `tests/integration/strategyOperations.test.ts:428`. No production code path
closes a signal. Compounding this, the `status` CHECK constraint does not even allow the statuses the
engine produces (`FILLED`, `CLOSED`, `CANCELLED`, `UNRESOLVED`), so even a correct call would fail for
most outcomes. Net effect: if the server engine were fixed today, every signal row would remain
`ACTIVE` forever and `activeSignalCount` on `/strategies` would grow monotonically.

### 7.8 Timeframe consistency (F-08)

| Where | V3.0 | V3.3 | V2.8 |
|---|---|---|---|
| Frozen definition `execTimeframe` | `1h` | `1h` | **`15m`** (research scope was 15m/30m/1h/4h) |
| LIVE implementation | `1h` | `1h` | **`1h`** (`V28_LIVE_TIMEFRAME`) |
| `LiveSignalEngine.EXEC_TIMEFRAME` (published `timeframe`) | `1h` | `1h` | `1h` |
| `server/services/strategyCatalog.js` → `/api/strategies` | `["1h","4h"]` | `["1h","4h"]` | **`["15m"]`** |
| `strategyEngine.EXEC_TIMEFRAME` (server preload) | `1h` | `1h` | **`15m`** (preloads a series nothing reads) |

### 7.9 Server market-data defects on the signal path (F-09, F-10)

* **`'1D'` interval.** The engine asks for daily candles with the frontend `Timeframe` literal
  `'1D'` (`LiveSignalEngine.ts:458`; `Timeframe` includes `'1D'` — `src/types/market.ts:3`). The browser
  provider translates it (`LiveMarketDataProvider.mapTimeframeToBinance` → `'1d'`,
  `useRealtimeKline.ts:17`). The **server** fetcher does not: `marketDataFetcher.getCandles(symbol,
  timeframe)` interpolates the value straight into
  `https://api.binance.com/api/v3/klines?symbol=…&interval=${timeframe}&limit=…`, so `interval=1D` is
  rejected by Binance. V2.8's daily HTF series would fail on every symbol.
* **Dropped `limit`.** The provider shim in `strategyEngine.js` is
  `getCandles: (symbol, timeframe) => fetcher.getCandles(symbol, timeframe)` — the third argument
  (`CANDLE_LIMIT_1H = 1000`) is discarded, so the server evaluates a **300-bar** window
  (`CANDLE_LIMIT['1h'] = 300`) while the browser evaluates **1000**. Same strategy, same code, different
  results. V3.3 is the most sensitive: its 4h series must not be clipped, and its warmup rule already
  discards early zones.
* **No KuCoin fallback and no gateway.** The server fetcher calls Binance directly (correct for a
  server, and it keeps the gateway budget for browsers), but there is no secondary source: a Binance
  outage means `MARKET_DATA_UNAVAILABLE` for every strategy — which is the intended honest failure,
  just worth stating.
* **Symbol vocabulary differs between paths.** The server uses Binance symbols (`BTCUSDT`, filtered by
  `endsWith('USDT')`), the browser uses base tickers (`BTC`). `toPair()`/`pairLabel()` normalise the
  published label to `BTC/USDT` on both paths, so the ledger and the DB agree on `symbol`. This is
  correct today but is a trap for anyone wiring the two paths together.

---

## 8. Migrations

### 8.1 Inventory and runner

`server/db/migrations/`: `001_create_users`, `002_create_sessions`, `003_create_user_preferences`,
`004_create_audit_log`, `005_email_verification`, `006_strategy_settings`, `007_signals`,
`008_scan_universe`.

`scripts/migrate.mjs` runs them in filename order inside a transaction each, records the version in
`schema_migrations`, rolls back on error, and never drops anything. `npm run migrate:status` prints
applied/pending. **No destructive statement exists in any migration** (`DROP`/`TRUNCATE`/`DELETE` are
absent from 006–008; verified by reading all three). `migrate.mjs` reads `DATABASE_URL` from the
environment only — it does **not** load `.env`, which is exactly the failure mode roadmap 7.1
diagnosed; the documented VPS procedure (`set -a; . ./.env; set +a`) is the correct workaround.

### 8.2 `006_strategy_settings`

* `strategy_id TEXT PRIMARY KEY` + `CHECK (strategy_id IN ('V3_0_HTF_LIQUIDATION_TRAP',
  'V3_3_HTF_ZONE_MITIGATION', 'V2_8_ZERO_FEE_SNIPER_TRAILING'))` — a **fourth strategy cannot be
  created** by API (404 from `isKnownStrategyId`) or by direct `INSERT` (SQLSTATE 23514). Both paths are
  asserted against real PostgreSQL in `tests/integration/migrationsPostgres.test.ts`.
* `enabled BOOLEAN NOT NULL DEFAULT FALSE`; seed inserts three rows with `ON CONFLICT DO NOTHING`, so a
  re-run **cannot** reset a strategy an admin already enabled (asserted: "повторный прогон SQL 006/007 не
  сбрасывает включённую стратегию").
* `scan_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (>= 15)` — the floor protects public
  endpoints.
* `symbols JSONB NULL` — NULL means "use the list from code"; no mathematical parameter has a column
  (asserted: "в миграции НЕТ математических параметров стратегии").
* `updated_by UUID REFERENCES users(id) ON DELETE SET NULL`.
* Telemetry: `last_scan_at`, `last_signal_at`, `last_error`, `updated_at`.
* **Live production state:** three rows, `enabled: false`, `status: "OFF"`, all telemetry `null`,
  `updatedAt: 2026-09-23T15:19:23.048Z`.

### 8.3 `007_signals`

Schema in §7.3. Design decisions worth preserving: `NUMERIC` prices (not `REAL`) so equality/dedup
comparisons have no binary-float artefacts; NULL means "level not defined", never zero; the hash chain
is an **append-only integrity log**, explicitly *not* a blockchain; every signal must carry
`strategy_id` so there are no sourceless signals. Asserted against real PostgreSQL including
"direction принимает только LONG/SHORT", "status принимает только ACTIVE/INVALIDATED/TARGET_REACHED/
EXPIRED", "цены хранятся в NUMERIC без float-артефактов", "триггер поддерживает updated_at".

**Gap:** no `tp3`, no `entry_type`, no `valid_for_bars`, no `exit_rule`, no `strategy_version` column
(only `metadata.engineVersion`), no fill columns, no `result_r`/`net_result_r`, and a `status` domain
that cannot express the engine's real outcomes. Adding these is a **schema migration**, not a strategy
change — but it is out of scope for this audit.

### 8.4 `008_scan_universe`

Seeds the canonical symbols, enforces `SCAN_UNIVERSE_MAX = 100`, and stores one row per symbol with
audit metadata. Adding a symbol requires it to be an **active Binance Spot** instrument; delisted
symbols already stored are simply never scanned (`saved ∩ active`), and an unavailable `exchangeInfo`
skips the scan with an explicit error instead of falling back to a stored-only list. All four behaviours
are asserted against real PostgreSQL in `tests/integration/scanUniverse.test.ts`.

### 8.5 Production migration state — verified live, not assumed

| Evidence | Conclusion |
|---|---|
| `GET /api/health` → `{"status":"ok","version":"0.9.3","node":"v22.23.2","environment":"production","database":"connected"}` | Backend is `server/index.js` (that response shape only exists in `server/routes/health.js:33-42`); PostgreSQL reachable |
| `GET /api/strategies` → 3 rows, no 500 | `strategy_settings` exists ⇒ **006 applied** |
| `GET /api/signals` → `{"signals":[],"count":0}` (not a 500) | `signals` exists ⇒ **007 applied** |
| `GET /api/strategies/scan-universe` → 24 symbols, `activeKnown: true` | `scan_universe` exists ⇒ **008 applied** |

Roadmap 7.1 ("`relation "strategy_settings" does not exist`") is therefore **obsolete**: the migrations
have been applied on production. This audit ran no migration and touched no production data.

---

## 9. Liquidation chart engine — deep dive for reuse

"Liquidation X" in the owner's terminology is the `/liquidations` page and its chart component. There
is no identifier containing that string anywhere in the repo (verified by grep) — the code names are
`LiquidationsPage.tsx` and `LiquidationPriceChart.tsx`.

### 9.1 `src/components/market/LiquidationPriceChart.tsx`

| Concern | Implementation | Reuse value for Signals |
|---|---|---|
| Chart creation | `createChart(container, …)` at `:92`, candlestick series at `:127` | Direct template |
| Candle normalisation | `normalizeLiquidationCandles` — ms → s, dedupe by time, enforce `high >= low`, sorted | **Reuse as-is**: lightweight-charts throws on unsorted/duplicate times |
| Data source | REST via `provider.getCandles(symbol, timeframe, 240)`, polled every **30 s** | Same call the Signals chart needs, with the limit chosen per timeframe |
| Realtime | `useRealtimeKline`; the tick is applied **only** when `provenance.exchange === 'binance'` | Prevents a KuCoin tick from mutating a Binance series — keep this guard |
| Markers | `seriesRef.current?.setMarkers(mapped.markers.map(...))` at `:205`, produced by `mapLiquidationMarkers` | **This is the only `setMarkers` call in the codebase** — the pattern to copy for signal arrows |
| Marker mapping rules | snap event time to the timeframe bucket, cap at **200** markers, size by `amountUsd` | Signal markers need the same bucketing (a signal at 10:00:00 must land on the 10:00 bar) |
| HTML overlay badges | top 28 events positioned with `timeToCoordinate` / `priceToCoordinate` | Template for labelling Entry/SL/TP levels with prices instead of bare lines |
| Fit | `fitContent()` **once per `symbol:timeframe`** | Avoids the "chart jumps while you look at it" bug |
| Zero states | honest "no events yet" / "source unavailable" copy, never placeholders | Required by the project invariants |

### 9.2 `src/components/common/CandleChart.tsx` (the general chart)

* 490 lines; candlestick/bar/line series + volume histogram + SMA20/50/200 + Bollinger;
  optional RSI/MACD sub-panes via `IndicatorPaneChart`; `ChartTimeRangeSync` keeps panes aligned.
* **Price lines:** `createPriceLine` at `:344` and `:381`; `removePriceLine` at `:333`, `:340`, `:380`.
  The component keeps a single `currentPriceRef` and removes the old line before creating a new one —
  the exact discipline a Signals overlay needs (otherwise every re-render adds another line and leaks).
* **Duplicate-label fix worth copying:** the candle series is created with
  `lastValueVisible: false, priceLineVisible: false` (`:195-196`) because the component draws its own
  price line; the 20-line comment at `:180-194` explains the production symptom (two identical price
  labels stacked on the right axis). Any new overlay must respect this.
* **No markers here.** Adding signal arrows to `CandleChart` would mean adding a `markers` prop; the
  alternative (a dedicated chart component modelled on `LiquidationPriceChart`) keeps the general chart
  untouched. §15 recommends the latter.
* **Teardown is complete** (`:298-307`): resize listener, `ResizeObserver`, crosshair subscription,
  time-sync registration, `chart.remove()`, and ref nulling. Reuse this shape verbatim.

### 9.3 `SymbolPickerModal.tsx`

Full spot universe with search, `PICKER_RENDER_LIMIT = 60` rows, logo + name + ticker. This is the
selector the Signals chart should reuse for "any active supported coin" — it is already universe-driven
rather than canonical-25-driven, which is exactly roadmap 6.2's requirement.

---

## 10. Chrome hang regression — root cause, fix, guardrails

### 10.1 Symptom

Switching timeframe on `/coin/:symbol` froze the Chrome renderer ("Страница не отвечает"), and the tab
stayed dead even after navigating back to `/`. Reported as P0 and shipped in PR #13
(merge commit `e82e4ff18d7b8efca488ab6e07fd23068390a7a7`).

### 10.2 Root cause

`IndicatorEngine.calculateVolumeProfile()` (`src/services/indicators/IndicatorEngine.ts:276-366`)
computes a 70 % value area by expanding two cursors (`upIdx`, `downIdx`) away from the POC bucket. The
old loop compared volumes using `0` for an exhausted side. Once `upIdx` ran past the last bucket, an
**empty (zero-volume) bucket below the POC** made the comparison `0 >= 0` true, so the loop kept
incrementing the already-exhausted `upIdx` while `downIdx >= 0` stayed true — an unbounded synchronous
loop on the renderer's single JS thread.

This is reachable with ordinary market data: a gapped volume distribution (POC in the top bucket with
an empty bucket beneath it) is normal for real OHLCV, and every timeframe switch recomputes indicators
on the freshly fetched candles.

### 10.3 The fix (verified by reading the shipped code)

`src/services/indicators/IndicatorEngine.ts:340-357`:

```ts
while (accumulatedVolume < targetVolume && (upIdx < bucketsCount || downIdx >= 0)) {
  const upAvailable = upIdx < bucketsCount;
  const downAvailable = downIdx >= 0;
  // Expand the richer side, but only ever a side that still exists, so each
  // pass strictly advances one cursor and the loop always terminates.
  const takeUp = upAvailable && (!downAvailable || buckets[upIdx] >= buckets[downIdx]);
  if (takeUp) { accumulatedVolume += buckets[upIdx]; upIdx++; }
  else        { accumulatedVolume += buckets[downIdx]; downIdx--; }
}
```

**Why it terminates:** every iteration consumes exactly one *live* bucket index; `upIdx` is
monotonically increasing and `downIdx` monotonically decreasing; the loop guard fails as soon as both
are out of range. The iteration count is therefore bounded by `bucketsCount` (24 by default). The
`0 >= 0` degenerate comparison can no longer select an exhausted side, because `takeUp` requires
`upAvailable` and the `else` branch is only reached when `downAvailable` holds (otherwise the guard has
already exited). The 30-line comment at `:330-339` documents the old failure mode in place — good
practice, keep it.

### 10.4 Guardrails

* **Unit:** `tests/unit/volumeProfileTermination.test.ts` — five tests, **all wall-clock bounded**:
  a gapped distribution with the POC above an empty bucket (`< 2 s`), a **sweep over every POC-adjacent
  gap position** (`gap = 1..22`, `< 5 s`), a single-bucket case, a normal distribution that must still
  produce a correct value area covering ≥ 70 % of volume, and
  `computeCompleteIndicators` staying bounded on gapped candles. A re-introduced hang fails the suite or
  trips the runner timeout instead of passing silently.
* **Browser E2E:** `e2e/timeframeHang.spec.ts` — BTC `1h → 15m → 1h → 5m` then navigation to `/`, and
  SOL `1h → 15m`. Assertions are **renderer-responsiveness only**
  (`requestAnimationFrame` resolving inside `page.evaluate`, plus `pageerror` must stay empty), never
  candle contents — because exchange data is frequently 451-blocked from CI IPs. This is the honest way
  to test a hang, and it satisfies the roadmap invariant "any P0 Chrome hang is closed only together
  with a browser E2E regression test".
* **Not run in this audit:** Playwright browsers could not be installed in the sandbox (§13.5). The unit
  guardrail **did** run and passed.

---

## 11. Performance and API audit

### 11.1 Budgets that exist in code

| Layer | Budget | File |
|---|---|---|
| Nginx `/api/` | `limit_req zone=cryptora_api rate=30r/s burst=50 nodelay` | `nginx/cryptora.conf:11`, `:89` |
| Express `/api/market` | **1200 requests / minute / IP** (dedicated budget, mounted before the general limiter) | `server/routes/marketData.js:9-11`, `server/app.js:107` |
| Express `/api/*` | `API_RATE_LIMIT = 100 / min / IP` | `server/config.js:49`, `rateLimit.js:36` |
| Express auth | login 10/min, register 5/min, resend 3/15min, verify 20/15min | `server/config.js:47-59` |
| Gateway upstream | 8 s abort timeout, GET only, allowlisted routes | `marketDataGateway.js:13`, `:45`, `:88-91` |
| Gateway response cache | `Cache-Control: public, max-age=2` for proxied reads; 300 s for `/universe/*`; 3600 s for `/metadata/assets` | `marketDataGateway.js:145`, `:89-91` |
| Body size | `express.json({ limit: '100kb' })` | `server/app.js:82` |
| Server engine candles | 60 s TTL per `(symbol, timeframe)` + in-flight dedup + `stats.httpRequests` counter | `marketDataFetcher.js` |
| Browser candles | cache keyed `symbol_timeframe_limit`, TTL `cacheTtlMs × 3` | `LiveMarketDataProvider.ts:394-402` |
| Derived candle service | `MAX_CONCURRENT = 6`, 8 s timeout, 60 s TTL | `CandleHistoryService.ts:38-40` |

### 11.2 Request storms — where the real pressure is

* **Browser signal engine (dominant).** Each 60 s cycle fetches **1h candles for every scan-universe
  symbol**; on an hourly close it additionally fetches 4h (and 1d when V2.8 is enabled). At the current
  24 symbols that is ~24 requests/min steady state and ~50 on the hourly close. At the
  `SCAN_UNIVERSE_MAX = 100` cap it becomes ~100/min steady and ~200–300/min in the burst — inside the
  1200/min gateway budget, but it is the single largest browser-side consumer and the first thing that
  will hit the limit if the universe grows or a second tab is opened. **Mitigations already present:**
  single-flight per engine (`currentScan`, `LiveSignalEngine.ts:390`), per-symbol yield
  (`setTimeout(0)`, `:416`), `document.hidden` pause (`:394`), provider-level candle cache,
  gateway `max-age=2`.
  **Residual risk:** two tabs = two engines = double the traffic; the pause only applies to hidden tabs.
* **Server engine (currently unreachable, but designed to fan out).** `strategyEngine.js:95-99` preloads
  `universe × timeframes` series before evaluating. With 100 symbols and V3.0's `['1h','4h']` that is
  **200 direct Binance requests per scan**, per strategy, per interval — straight to
  `api.binance.com` (not through the gateway, so it does not consume the browser budget, but it does
  consume the VPS's own Binance weight). The 60 s TTL cache and in-flight dedup mean concurrent
  strategies share series, and `enabled = false` means **zero** requests today. This is the one place
  where the roadmap invariant "no N × candles" is intentionally relaxed server-side; it is documented
  here so nobody is surprised.
* **Catalogue pages:** no fan-out (§5.5). **Metadata:** one cached document per 12 h. **Detail pages:**
  one symbol/timeframe.

### 11.3 Race conditions

| Place | Protection | Verdict |
|---|---|---|
| `CoinDetailPage` candle loads | `candleRouteKeyRef` (`:94`) + `requestKey = symbol:timeframe` guard (`:167`, `:203`) + `active` flag in the effect cleanup (`:345`) | ✅ stale responses cannot overwrite the current view |
| WS ↔ REST handoff | `detectCandleGap` + `mergeKlineIntoCandles` + `mergeCandleHistory` (`candleHandoff.ts`) | ✅ gaps are reconciled, not blindly appended |
| Browser engine scan | `currentScan` single-flight; `scanNow()` returns the in-flight promise (`:370`, `:390`) | ✅ the manual "scan now" button cannot start a second pass |
| Server scheduler | in-flight lock per strategy released in `finally` | ✅ a long scan cannot overlap itself; an exception cannot wedge the strategy |
| Signal insert | `pg_advisory_xact_lock(730117)` around read-tail-hash + insert, plus the `UNIQUE` constraint | ✅ two parallel scans cannot fork the hash chain or duplicate a row |
| Strategy toggle | single transaction updating `strategy_settings` **and** writing `audit_log` | ✅ state and audit cannot diverge (asserted against real PostgreSQL) |
| Universe caches | stale-while-error with an explicit `activeKnown` flag | ✅ an unavailable `exchangeInfo` never produces a guessed list |

**One real ordering hazard remains**, and it is masked by F-01: `strategyEngine.js:112-118` snapshots
`ledger.getSetups()` before the scan and diffs after. The ledger is a **singleton shared with the
engine** (`core.SignalsAuditLedger.getInstance()`), so if the server ever runs two strategies
concurrently in the same process, the `before`/`fresh` diff of one can pick up setups published by the
other. Today the scheduler serialises per strategy and the whole path throws before reaching the diff,
so it is latent, not active.

### 11.4 Leaks

* **Timers:** `LiveSignalEngine.stop()` clears both the interval and the initial timeout (`:299-305`);
  `MarketDataContext` calls `stop()` in the effect cleanup and `resetInstance()` on mode change
  (`:204-211`). The scheduler's `stop()` cancels timers and awaits in-flight scans, wired to
  SIGTERM/SIGINT (`server/index.js:67-74`).
* **Charts:** `CandleChart` teardown removes the resize listener, disconnects the `ResizeObserver`,
  unsubscribes the crosshair handler, unregisters time sync and calls `chart.remove()` (`:298-307`);
  `LiquidationPriceChart` follows the same shape. No orphaned chart instances found.
* **Listeners:** `SignalsAuditLedger.subscribe`, `LiveSignalEngine.subscribe` and
  `subscribeScanUniverse` all return unsubscribe functions and every call site stores and calls them.
* **Unbounded growth:** the ledger caps at `MAX_STORED = 500` records; the liquidation pipeline caps at
  100 events in `sessionStorage`; the retrospective view caps at 60 rows. The server `signals` table is
  **append-only with no retention policy** — fine at today's volume (0 rows), worth a partitioning or
  archival note before strategies are enabled at scale.
* **Scheduler error loop (F-12):** `setInterval(tick, 15_000)` with `tick().catch(recordError)`
  (`strategyScheduler.js:95-103`) has **no backoff and no consecutive-failure circuit breaker**. A
  permanent failure (exactly what F-01 produces) writes the same `last_error` and logs the same message
  every 15 s forever — 5760 identical log lines per day. Roadmap 14.1 asks for this; it is not done.

### 11.5 Bundle

`npm run build` output (this audit): main `index-*.js` **900.69 kB** (gzip **247.44 kB**), plus
`vendor-react` 164.56 kB, `vendor-charts` 162.76 kB, and 20+ lazy page chunks (`CoinDetailPage` 69.75 kB,
`StrategiesPage` 53.02 kB, `LiquidationsPage` 52.02 kB, `SignalsPage` 29.38 kB, `AdminPage` 20.01 kB).
Vite warns about the >600 kB chunk. Route-level code splitting **is** in place (CoinPage does not load
Admin/Strategies code), so roadmap 16.1 is partially satisfied; the remaining work is inside the main
chunk (context providers, services, registry, formatters).

---

## 12. Security audit

### 12.1 No destructive operations anywhere

* No migration contains `DROP`, `TRUNCATE` or `DELETE` (006–008 read in full).
* No API endpoint deletes market data, signals, or ledger rows. `DELETE /api/admin/scan-universe/:symbol`
  removes a **scan subscription** only — it never removes an asset from the site and never touches
  historical signals (roadmap 17.2's requirement).
* `closeSignal()` exists but is unused; there is no `DELETE FROM signals` path.
* The ledger is append-only by design: `expireStale()` (which rewrote records) was **removed** in an
  earlier version, and `docs/SIGNALS.md` §4 records that removal.
* This audit performed **only** `GET` requests against production, plus one unauthenticated `GET` of an
  admin endpoint to confirm it refuses.

### 12.2 Authentication and authorisation

* Session auth with `express-session` + `connect-pg-simple`; `SESSION_STORE=memory` is **refused
  outright** when `NODE_ENV=production` (`server/app.js:42-53`) — a stray env var cannot silently
  degrade production.
* Cookies: `httpOnly`, `secure` in production, `sameSite=lax` (`server/app.js:93-99`).
* CSRF middleware applied to state-changing requests (`server/app.js:104`), with `APP_ORIGIN` as the
  single source of truth for origin checks (`server/config.js:24`).
* `server/routes/admin.js:49` gates the **entire** admin router with `requireAuth, requireAdmin`.
  Verified live: `GET /api/admin/scan-universe` → `{"error":"Требуется авторизация"}`.
* The frontend's `isAdmin` is used **only** to decide whether a control is clickable; the server check is
  the protection (`StrategyOpsPanel.tsx:12-13`, asserted by integration tests: guest → 401, ordinary
  user → 403, admin → 200 and persisted).
* Passwords: Argon2id, 64 MB / t=3 / p=1, length 8–128 (`server/config.js:78-88`).
* Blocking a user also deletes their sessions, so a blocked admin cannot keep a live session.
* Self-block is rejected.

### 12.3 Injection, SSRF, and data exposure

* All SQL uses parameterised queries; the only dynamic SQL is the admin user search, which builds a
  `WHERE` clause from a **fixed** template with `$n` placeholders (`admin.js:107-111`).
* The old SSRF-prone `/api/proxy/*` endpoints were **removed** (`productionServer.js:85-86`, and
  `DEEP_AUDIT_2026-09-18.md` Н1 documents the original finding). The gateway now resolves upstreams from
  a fixed allowlist (`ROUTES` + `COMPUTED_ROUTES`) and **never** derives a host from user input; it is
  GET-only and returns `405` with an `Allow: GET` header otherwise.
* No trade-execution endpoints, no exchange API keys, no private endpoints anywhere — consistent with
  `docs/SECURITY.md` and `docs/API.md`'s read-only principle. Verified by inspection of every route file.
* `SMTP_PASS` is never logged and never returned by any API (`server/config.js:67-68`).
* Error responses go through a single JSON envelope (`middleware/errorHandler.js`); no stack traces were
  observed in production responses during this audit.

### 12.4 Deployment configuration drift (F-11, P2) — the highest-risk *operational* finding

The repo's deployment templates do **not** describe the running production system:

| Item | Repo template | Actual production (owner-stated + verified) |
|---|---|---|
| systemd entry | `systemd/cryptora.service:10` → `ExecStart=… node /home/user/CRYPTORA/server/productionServer.js` | systemd `cryptora.service` → **`server/index.js`** |
| Working dir / user | `/home/user/CRYPTORA`, `User=user` | `/root/CRYPTORA` |
| Bind host | `Environment=HOST=0.0.0.0` | `server/config.js:14` defaults to **`127.0.0.1`**; nginx proxies `/api` → `127.0.0.1:3000` |
| Env vars | `MARKET_DATA_PROXY_ENABLED`, `MARKET_DATA_CACHE_TTL_MS` | **Neither is read by any code** (grep: zero references) — dead variables |
| Static root | `nginx/cryptora.conf:32` → `root /home/user/CRYPTORA/dist` | `/var/www/cryptora` |
| TLS | HTTPS server block is **commented out**; port 80 serves directly, redirect line commented | `https://cryptora.duckdns.org` is live, managed by Certbot |
| Security hardening | `ProtectHome=read-only`, `ReadWritePaths=/home/user/CRYPTORA/dist` | Not applicable to `/root/CRYPTORA` |

**Why this matters:** `productionServer.js` has **no database, no sessions, no auth, no
`/api/strategies`, no `/api/signals`, no `/api/admin`**. If anyone "restores" the repo template on the
VPS, the site will still render (it serves `dist/` and `/api/market`) while **every account, admin and
strategy feature silently disappears**. The proof that `index.js` is what runs today: production
`/api/health` returns `node`, `environment` and `database` fields, which exist only in
`server/routes/health.js:33-42` — `productionServer.js`'s health handler returns a different shape.

**The most dangerous line in the documentation.** `package.json` defines
`"start": "node server/productionServer.js"` and `"server": "node server/index.js"` — and
`docs/STRATEGY_OPERATIONS.md` §10 instructs the operator:

```bash
npm run server         # или npm start в проде
```

`npm start` **in production** launches the legacy static server: the site renders, `/api/market` and
`/api/health` answer, and every account, admin, strategy and signal endpoint silently returns 404. An
operator following that line verbatim would produce exactly the outage described above, with a
healthy-looking homepage. The correct production command is `npm run server` (what systemd already runs).

Roadmap 12.1 already notes the systemd mismatch. This audit adds: the nginx `root`, the bind host, the
dead env vars, and the commented-out TLS block are mismatched too. **Do not overwrite the VPS's
Certbot-managed nginx config with the repo template** (roadmap 15.4 says the same).

### 12.5 Remaining security to-dos (verified, not assumed)

* **CSP** is served by Nginx (`server/app.js:77` disables helmet's CSP) and duplicated in
  `productionServer.js:59-74`; `tests/unit/cspConnectSrc.test.ts` enforces that every external origin
  referenced in `src/` appears in **both** lists. That test passed in this run. `script-src 'unsafe-inline'`
  is still present and, per `AUDIT_REPORT_2026-09-17.md:143`, may be removable (the Vite build contains
  no inline scripts).
* **`npm audit`** (roadmap 15.1): the owner reported 7 vulnerabilities (5 moderate, 1 high, 1 critical)
  on the VPS. This audit ran `npm ci --no-audit` and therefore did **not** re-measure; the correct next
  step is `npm audit --json` on the VPS, classify prod vs dev, and never run `npm audit fix --force`.
* **Rate limiting** is in-memory per process (`rateLimit.js:5`) — correct for a single instance, and it
  will silently under-count if the service is ever scaled horizontally.
* **Backend bind** (roadmap 15.2): the code default is already `127.0.0.1`; whether the VPS overrides it
  with `HOST=0.0.0.0` cannot be determined from the repo and must be checked on the machine
  (`ss -ltnp | grep 3000`).

### 12.6 No secrets in this report

This document contains no `.env` contents, no `DATABASE_URL`, no `SESSION_SECRET`, no SMTP credentials,
no admin e-mails, no user records, no audit-log contents and no authentication tokens. Production
probes were unauthenticated `GET`s of public endpoints; the one admin endpoint touched returned its
refusal, which is quoted verbatim because the refusal *is* the finding.

---

## 13. Tests inventory and verification results

### 13.1 Inventory

```
tests/unit/          112 files   (jsdom; React Testing Library where needed)
tests/integration/     4 files   (real PostgreSQL via embedded-postgres; real Express app)
e2e/                   7 specs   (Playwright, baseURL http://localhost:5173, webServer `npm run dev`)
```

Configuration: `vitest.config.ts` includes `tests/unit` **and** `tests/integration`, `environment:
'jsdom'`, with the setup file installing the `jsx-runtime` patch (`scripts/patch-playwright-jsx.cjs`
runs on `postinstall`). `playwright.config.ts` uses `workers: 1` and excludes `screenshotQA` unless
`CI_SCREENSHOTS` is set. `tsconfig.json` is `strict` with `noUnusedLocals`/`noUnusedParameters`.

Notable test groups relevant to this audit:

| Area | Files |
|---|---|
| Signal engine & ledger | `tests/unit/signals/{liveReplays,liveSignalEngineE2E,v28Live}.test.ts` plus `tests/unit/{signalsEngineGuard,liveSignalLookAhead,v33SetupGeometry}.test.ts` |
| Strategy archive | `tests/unit/strategyArchive*` — frozen artefacts, SHA-256 source pins, deterministic digests |
| Volume-profile hang | `tests/unit/volumeProfileTermination.test.ts` + `e2e/timeframeHang.spec.ts` |
| Universe & selectors | `marketUniverse.test.ts`, `scanUniverseFallback.test.ts`, `assetRegistry.test.ts`, `timeframeMapping.test.ts` |
| Honesty contracts | `liquidationChart.test.ts`, `liquidations.test.ts`, `dataModePolicy.test.ts`, `monetization.test.ts`, `sponsorSlots.test.ts` |
| Presentation | `chartTimePresentation`, `localTimePresentation`, `typography`, `coinWorkspaceLayout`, `sorting` |
| Infra | `cspConnectSrc.test.ts`, `proxyRemoval.test.ts`, `versionConsistency.test.ts`, `backtest.test.ts` |
| Integration (real SQL) | `migrationsPostgres.test.ts`, `strategyOperations.test.ts`, `scanUniverse.test.ts`, `strategyEngineCore.test.ts` |

### 13.2 Results of the gates actually run in this audit

| Gate | Command | Result |
|---|---|---|
| Install | `npm ci --no-audit --no-fund` | ✅ 384 packages, 8 s, postinstall patch applied |
| Typecheck | `npm run typecheck` | ✅ **exit 0**, zero errors |
| Full suite | `npm test` | ✅ **116 files / 1176 tests passed**, 141.09 s (transform 3.06 s, collect 13.19 s, tests 66.20 s) |
| Integration only | `npx vitest run tests/integration --reporter=verbose` | ✅ 4 files / 56 tests, 12.57 s — **real PostgreSQL ran** (embedded-postgres binary available; 006/007/008 DDL, CHECK/UNIQUE/trigger behaviour, idempotency, auth 401/403/200, dedup, SHA-256 chain verification, scheduler ∩ active universe all asserted against SQL) |
| Build | `npm run build` | ✅ built in 6.47 s; `dist/index.html` present; main chunk 900.69 kB / gzip 247.44 kB |
| Whitespace | `git diff --check` | ✅ exit 0, no output |
| Server core bundle | ad-hoc `node --input-type=module` (see §7.4) | ✅ builds; ❌ `scanOnce` missing |
| Browser E2E | `npx playwright install chromium --with-deps` | ❌ **not run** — see §13.5 |

No test failed. No test was modified, skipped by hand, or filtered out.

### 13.3 The false green (F-03, P1)

`tests/integration/strategyEngineCore.test.ts` exists specifically to prove that the **built** bundle
carries the same protections as the source, and it asserts
`expect(typeof core.LiveSignalEngine.prototype.scanOnce).toBe('function')` at line 48 — the one
assertion that would have caught F-01.

It never runs. `beforeAll` tries `loadStrategyCore()`; under vitest's global `jsdom` environment esbuild
fails its environment invariant:

```
Invariant violation: "new TextEncoder().encode("") instanceof Uint8Array" is incorrectly false.
This indicates that your JavaScript environment is broken. You cannot use esbuild in this environment…
```

The catch stores a `skipReason`, and every test body starts with `if (guard()) return;` — so all six
tests **return early and are reported as passed**:

```
 ✓ tests/integration/strategyEngineCore.test.ts (6 tests) 6ms
   ✓ …собирается и экспортирует нужный интерфейс
   ✓ …формирующаяся свеча НЕ считается закрытой
   ✓ …инвариант геометрии отклоняет прод-сетап V3.3 SHORT
 Test Files  4 passed (4)      Tests  56 passed (56)
```

Because CI uses the same vitest configuration, this is a false green **on GitHub too**, not just in this
sandbox. The file's own docblock promises the opposite ("Без этого бандл мог бы тихо разойтись с
исходниками"). Note the contrast with `migrationsPostgres.test.ts`, which the roadmap praises for
"честно помечается skipped и печатает причину — молча не «зеленеет»": that file uses real vitest
skipping, while `strategyEngineCore.test.ts` uses an early `return` that reports success.

**Correct fix (docs-only recommendation, not applied):** give that file
`// @vitest-environment node` (or move it to a node-environment project in `vitest.config.ts`) so
esbuild can run, and replace the `guard()` early-return with `it.skipIf(!core)(…)` so an unloadable
bundle is reported as *skipped* rather than *passed*. Both changes are test-infrastructure only and
touch no strategy code. Once it actually runs, it will fail on `scanOnce` — which is the point, and
which is why F-01 and F-03 should be fixed in the same PR.

### 13.4 What the suite does **not** cover

* No test asserts that the server engine's provider shim passes a `limit` (F-10) or normalises `'1D'`
  (F-09).
* No test asserts that `/api/signals` has a UI consumer (F-04) — understandably, since it does not.
* No test covers the server-side lifecycle (`closeSignal`) in a production path, because there is none
  (F-07).
* No test covers `scanOnce`-vs-`scanNow` at the *source* level; the only assertion lives in the file that
  silently skips.
* Bundle-size budgets (roadmap 16.1) are not enforced in CI.
* Screenshot QA exists (`scripts/screenshot-qa.mjs`) but is opt-in via `CI_SCREENSHOTS`.

### 13.5 Browser smoke test — honest statement of what could not be done

The task list asks for a browser smoke test of BTC/SOL, timeframe switching, Signals, Liquidation X and
Admin. **It could not be performed from this sandbox**, for three independent reasons:

1. **No browser binaries, and they cannot be installed.**
   `npx playwright install chromium --with-deps` failed with
   `E: Unable to locate package libxrandr2 / xvfb / fonts-noto-color-emoji / …`,
   `Package 'fonts-liberation' has no installation candidate`, `Failed to install browsers`,
   `Installation process exited with code: 100`. `~/.cache/ms-playwright` does not exist. Playwright
   itself is present (v1.63.0) — only the browsers and their system libraries are missing.
2. **No exchange egress.** Direct `curl` from the sandbox to `api.binance.com`, `api.coingecko.com` and
   `cryptora.duckdns.org` fails with `SSL_ERROR_SYSCALL` (egress firewall). A local dev server would
   render the shell but every provider call would fail, so "does BTC load" is not answerable locally.
   (`fetch_page` reaches production because it runs outside the sandbox — that is how the live probes in
   this document were obtained.)
3. **No PostgreSQL.** The integration suite's `embedded-postgres` works, but there is no long-lived
   database service for a full `npm run dev` + `npm run server` smoke run.

What **was** verified instead: production HTML/JSON for `/`, `/api/health`, `/api/strategies`,
`/api/signals`, `/api/strategies/scan-universe`, `/api/admin/scan-universe` (refusal), the full unit +
integration suite, the production build, and a static read of every page component listed in §3.2.

**Update — the browser half *was* executed, by CI, on this PR.** GitHub Actions installs Chromium
(`npx playwright install --with-deps chromium`) and runs `npm run test:e2e` (= `playwright test`, all
specs in `e2e/`, `screenshotQA` excluded unless `CI_SCREENSHOTS` is set). On PR #15 both jobs passed:

```
Browser e2e (Chromium)        pass   57s
Typecheck + Unit + Build      pass   1m42s
```

That means `e2e/timeframeHang.spec.ts` — the P0 regression covering **BTC `1h → 15m → 1h → 5m` and SOL
`1h → 15m`**, renderer responsiveness after each switch, navigation back to `/`, and an empty
`pageerror` list — **passes on the audited commit**, as do `routes.spec.ts`, `browser.spec.ts`,
`flows.spec.tsx`, `responsive.spec.tsx` and `uiRegression.spec.tsx`. What CI does *not* cover is live
exchange data (the specs are deliberately data-agnostic because exchange APIs 451 cloud IPs) and any
interaction with the production deployment. So the remaining manual smoke test is about **production
data and layout**, not about the renderer hanging.

**Exact commands for the owner (or a CI runner with browsers) to reproduce locally:**

```bash
# local / CI, from the repo root
npx playwright install --with-deps chromium
npm run dev                                   # vite, host 0.0.0.0, /api → localhost:3000
npm run server                                # in a second shell, needs DATABASE_URL + .env
npx playwright test e2e/timeframeHang.spec.ts # P0 regression: BTC/SOL timeframe switching
npx playwright test                           # full e2e (workers=1)

# production, read-only, no auth needed
for p in /api/health /api/strategies /api/signals /api/strategies/scan-universe \
         /api/market/universe/spot /api/market/universe/futures; do
  echo "== $p"; curl -fsS "https://cryptora.duckdns.org$p" | head -c 300; echo; done

# browser, manual: /coin/BTC and /coin/SOL → 5m/15m/30m/1h/4h/1D/1W, watch for hangs
#                   /signals → engine status, per-symbol provenance, retrospective
#                   /liquidations → picker, timeframe, markers, filters
#                   /admin → login as admin only; never bypass auth
```

### 13.6 CI observation on this PR (recorded honestly, unresolved)

This PR contains **only** `docs/agent-plan/FULL_PROJECT_AUDIT.md`. CI ran twice:

| Commit | Typecheck + Unit + Build | Browser e2e (Chromium) |
|---|---|---|
| `011045a` (audit document) | ✅ pass 1m42s | ✅ pass 57s |
| `ca4105c` (+34 lines of markdown) | ❌ **fail 1m32s**, step `Run npm test`, exit 1 | ✅ pass 57s |

A markdown-only diff cannot change the behaviour of `npm test`, and the same suite passes locally
(1176/1176, twice — full run and integration-only run). The conclusion is that the second failure is
**environmental/flaky, not caused by this PR**. The failing test could not be identified because the
Actions log blob host (`productionresultssa13.blob.core.windows.net`) is unreachable from the audit
sandbox, `gh run rerun --failed` refused (`run cannot be rerun`), and the only annotation published is
`Process completed with exit code 1` on the `Run npm test` step.

Most probable causes, in order — both are pre-existing fragilities, not new defects:

1. **`tests/integration/migrationsPostgres.test.ts`** starts a real PostgreSQL through
   `embedded-postgres`. The roadmap already records this failing on the VPS with `initdb EACCES`
   (§12 of the roadmap, task 12.1). On a loaded or freshly-imaged GitHub runner the same binary can be
   slow or fail to initialise. It passed in the previous run, which is consistent with intermittency.
2. **`tests/unit/volumeProfileTermination.test.ts`** is deliberately **wall-clock bounded**
   (`< 2 s` and `< 5 s` for the 22-position gap sweep) so that a re-introduced hang fails instead of
   hanging the runner. That is the right trade for a P0 guardrail, but it also means the test can fail
   on a slow runner without any hang. Locally the whole file takes ~1.3 s of test time.

**Recommended follow-ups (both test-infrastructure only, no strategy code):**
make the integration suite's PostgreSQL startup retry once and print `initdb` output on failure; and
either raise the wall-clock ceilings for the termination sweep or express the bound in *iterations*
(the loop is provably bounded by `bucketsCount`, so an iteration counter is a stronger and
machine-independent assertion). Also worth adding: `retry: 1` for the unit job, or splitting
`tests/integration` into its own job so a PostgreSQL-runner hiccup does not red-flag a documentation PR.

Until this is understood, **a red `Typecheck + Unit + Build` on a docs-only commit should be treated as
suspect and re-run**, not as a regression — but it should never be ignored either, because the same job
is what protects the P0 hang guardrail.

---

## 14. Roadmap gap analysis (`docs/PRODUCTION_ROADMAP.md`, re-graded with evidence)

Legend used below: **DONE** (merged *and* verified), **DONE-unverified** (merged, needs an owner check on
the VPS/browser), **PARTIAL**, **NOT STARTED**, **BLOCKED**, **REGRESSION**.
"Roadmap says" is the status printed in the document on the audited commit; "Audit verdict" is what the
code, the tests and the live production responses actually show.

### 14.1 Section 1 — "Уже сделано"

| Item | Roadmap says | Audit verdict | Evidence |
|---|---|---|---|
| PR #12 gateway & infrastructure | `[x]` | **DONE** | `/api/market/*` allowlist live; `tests/unit/proxyRemoval.test.ts` passes |
| PR #13 Chrome hang | `[x]` | **DONE** | Fix read in source (§10.3); unit guardrail passed in this run; E2E exists but was not executed here (§13.5) |
| PR #14 full universe | `[~]` "открыт, не слит" | **DONE — the roadmap is wrong** | `gh pr list` → all 14 PRs merged; PR #14 merged `2026-09-23T15:14:48Z`; `origin/main = 8eacfb9` is that merge; CI green (run 35880160017); production serves the resulting code (`/api/health` v0.9.3) |

### 14.2 Section 2 — Market universe

| Item | Roadmap says | Audit verdict | Evidence / correction |
|---|---|---|---|
| 2.1 Spot universe from `exchangeInfo` | `[~]` | **DONE (code + production), one acceptance criterion still open** | Live `GET /api/market/universe/spot` → `count = 494`, `source: binance-spot-exchangeInfo`; filter is `quoteAsset=USDT ∧ status=TRADING ∧ spot-allowed` (`server/services/exchangeUniverse.js`); no hardcoded 25/50/736 anywhere; unavailable `exchangeInfo` ⇒ stale cache then honest failure, never a historical list. **Open:** "`.count` equals the number of `/market` rows across all pages" needs a browser check (§13.5). **Correction:** the roadmap's evidence numbers (bulk ticker 3710 / 746 USDT / ~736 rows) describe the *old* behaviour; the correct current figure is **494** |
| 2.2 Futures universe | `[~]` | **DONE (code + production), UI wording to confirm** | Live `GET /api/market/universe/futures` → `activeUsdtContracts = 732`, `perpetualCount = 523`, listed contracts 523; PERPETUAL only, quarterly excluded. **Open:** confirm the deployed UI states "PERPETUAL only" as the acceptance criterion requires |

### 14.3 Section 3 — Admin scan universe

| Item | Roadmap says | Audit verdict | Evidence |
|---|---|---|---|
| 3.1 Server-side scan universe | `[~]` | **PARTIAL — backend DONE, admin UI MISSING (F-13)** | Migration 008 applied in production; live `GET /api/strategies/scan-universe` → 24 symbols, `activeKnown: true`; `GET /api/admin/scan-universe` refuses unauthenticated callers; `tests/integration/scanUniverse.test.ts` asserts persistence, audit logging, `saved ∩ active`, inactive-symbol rejection and the exchangeInfo-unavailable skip against real PostgreSQL. **Missing:** no component imports `adminScanUniverseState` / `addScanUniverseSymbol` / `removeScanUniverseSymbol`, so "Admin → Монеты: *Доступно на рынке: N* / *В скане: M*, search, Add/Remove" does not exist. The roadmap's acceptance criteria about surviving reload and being visible in another browser are satisfied **at the API level only** |

### 14.4 Sections 4–6 — performance, metadata, selectors

| Item | Roadmap says | Audit verdict | Evidence |
|---|---|---|---|
| 4.1 No regressions on a large universe | `[~]` | **PARTIAL** | Done: catalogue = `exchangeInfo` + one bulk ticker; pagination (`Pagination` chunk); single-flight in `LiveSignalEngine`/`marketDataFetcher`; `PICKER_RENDER_LIMIT = 60`; `MAX_CONCURRENT = 6` in `CandleHistoryService`. **Not done:** the roadmap explicitly asks for a *test* that fixes the absence of N × candles — no such test exists; search debounce in the selectors is still unverified (the roadmap already flagged it). **New information:** the browser signal engine is itself an N × candles consumer by design (≤100 symbols/min through the gateway, ~200–300 in the hourly burst) — inside budget, but it is the real pressure point and is not mentioned in the roadmap (§11.2) |
| 5.1 symbol → name/logo/metadata | `[~]` | **DONE (code + production), logo spot-check open** | `server/services/assetMetadata.js`: one paged CoinGecko pull, TTL **12 h**, sequential pages with a 1.5 s delay, stale-on-error, canonical assets pinned by id first; served as `/api/market/metadata/assets` with `cacheSeconds: 3600`. Browser therefore makes ≤1 metadata request per session. **Open:** the acceptance criterion "logos verified for BTC, ETH, SOL, LTC, BCH, ZEC, PEPE, USDC + a few dynamic assets" needs a browser (§13.5) |
| 6.1 Coin selector | `[~]` | **DONE-unverified** | `getSelectableSpotSymbols()` is universe-driven with a canonical fallback covered by `scanUniverseFallback.test.ts`; `SymbolPickerModal` searches by ticker and name with logos. Browser confirmation outstanding |
| 6.2 Liquidations selector | `[~]` | **DONE-unverified** | Uses the active universe ∩ candle availability via `futuresBaseToSpot`; markers/candles/streams untouched by the change. The roadmap's own caveat stands: verify low-liquidity assets on production |

### 14.5 Section 7 — database and strategies

| Item | Roadmap says | Audit verdict | Evidence / correction |
|---|---|---|---|
| 7.1 Apply migrations on production | `[ ]` with evidence `relation "strategy_settings" does not exist` | **DONE — the evidence is obsolete** | `/api/strategies` returns three rows (table exists), `/api/signals` returns an empty list rather than a 500 (table exists), `/api/strategies/scan-universe` returns 24 symbols (table exists), `/api/health` reports `database: connected`. All three migrations are applied. The `.env`-not-loaded diagnosis remains valid as a *procedure* note (`scripts/migrate.mjs` reads only the environment), so the documented `set -a; . ./.env; set +a` step should stay in the runbook |
| — (not in roadmap) | — | **NEW P1: server engine cannot run (F-01)** | `strategyEngine.js:116` calls a method that does not exist on the compiled engine (§7.4). Migration and UI work are complete; the engine behind them is not. **This must be inserted into the roadmap as a P1 task before any strategy is enabled** |
| — (not in roadmap) | — | **NEW P2: server lifecycle + schema gaps (F-05/F-06/F-07)** | Dedup key falls back to publish time; TP3 dropped; `status` cannot express real outcomes and `closeSignal` is never called |

### 14.6 Sections 8–10 — liquidations, signals, freshness

| Item | Roadmap says | Audit verdict | Evidence |
|---|---|---|---|
| 8 candles / actual events / markers / streams | `[x]` | **DONE** | `LiquidationPriceChart` + multi-exchange WS + `LiquidationDataStatus` honesty contract; live production shows the honest "connected, no events yet" state |
| 8.1 remove large empty vertical areas | `[~]` | **DONE-unverified** | Cards stack with `items-start` and the fixed `min-h-[184px]` is gone; needs a desktop/tablet/mobile look on production |
| 8.2 filters | `[ ]` | **PARTIAL** | Present: exchange, side, minimum size with tiers `0/1 000/10 000/100 000` (`LiquidationsPage.tsx:59-61`), applied client-side only (`:210-215`) so no network requests are generated. **Missing:** the `$1M` tier and a per-symbol filter for the journal (the chart already filters by symbol at `:192`, so the plumbing exists) |
| 8.3 short server-side history of actual events | `[ ]` | **NOT STARTED** | Events live in `sessionStorage` (≤100) per `docs/LIQUIDATIONS.md` §3.2; there is no server table or endpoint for liquidation events, so F5 still resets the journal |
| 9.1 Signal detail & extended context | `[ ]` | **PARTIAL, and its dependency note is now wrong** | The browser ledger already carries symbol, strategy, timeframe, event time, entry corridor, invalidation, state, outcome, exit reason, R/net-R, bars held and hashes, and `/signals` renders them with `—` for absent values. What is missing is the *server-side* mirror: the roadmap's dependency "7.1 (серверные `signals`), если источником станет `/api/signals`" is satisfied for the migration but the endpoint has no consumer (F-04) and lacks the fields (F-05/F-06/F-07). **Recommend re-scoping 9.1** into "make the server store what the ledger already computes" + "add the chart" (§15) |
| 10.1 LIVE / STALE / DEGRADED badges with data age | `[ ]` | **PARTIAL** | Live production shows `LIVE · BINANCE`, `KLINE REST`, `LOCAL` badges on the coin chart, and `CandleChart.tsx:98-99` computes `klineFresh` from a 5 s clock (−5 s … +15 s window); liquidations carry `LIVE_STREAM / AWAITING_STREAM / UNAVAILABLE / DEMO`. **Missing:** a single documented threshold set applied uniformly to ticker, candles, OI, funding and liquidations, with `2s / 35s / 3m` age labels |
| 10.2 WS reconnection with REST catch-up | `[ ]` | **PARTIAL** | The mechanism exists and is unit-tested: `useRealtimeKline` exposes `onReconnect`, `CoinDetailPage` uses `recoverCandleHistory` with `forceRefresh: true` plus `detectCandleGap`/`mergeCandleHistory` (`:167-200`). **Missing:** the roadmap's required offline→online browser test |

### 14.7 Sections 11–20

| Item | Roadmap says | Audit verdict | Evidence |
|---|---|---|---|
| 11.1 Admin/System source status | `[ ]` | **NOT STARTED** | `AdminPage.tsx` calls only `/api/admin/dashboard`, `/users`, `/system`, block/unblock. `/api/admin/system` returns version, node, environment, uptime, database and memory — no per-source status/latency/last-error. `SourceHealthTracker` is browser-only |
| 11.2 split `/health` and `/ready` | `[ ]` | **PARTIAL** | `/api/health` already returns 503 + `status: "degraded"` when the DB check fails (`routes/health.js:33`), which is readiness semantics in a liveness endpoint; there is no separate `/ready` and no migration-state check |
| 11.3 frontend error reporting | `[ ]` | **NOT STARTED** | No error-reporting client found; errors surface in UI states and `console.error` |
| 11.4 gateway metrics | `[ ]` | **PARTIAL** | `marketDataFetcher` counts `stats.httpRequests`; the gateway itself exposes no errors/latency/rate-limit/timeout metrics |
| 12.1 fix the deploy pipeline | `[ ]` | **NOT STARTED, and broader than documented (F-11)** | `scripts/deploy.sh` still runs `npm ci && npm run typecheck && npm test && npm run build` — i.e. the integration suite with embedded PostgreSQL, which fails on the VPS with `initdb EACCES`. The systemd mismatch the roadmap notes is confirmed, and the nginx `root`, bind host, dead env vars and commented TLS block are mismatched too (§12.4) |
| 12.2 automated deploy with rollback | `[ ]` | **NOT STARTED** | No backup → ff-only merge → build → atomic swap → health → rollback script exists; `scripts/restart.sh` and `scripts/update.sh` are manual helpers |
| 13.1 version endpoint | `[ ]` | **PARTIAL** | Live `/api/health` returns `version: "0.9.3"`, `node`, `environment`, `uptimeSeconds`, `database` — **no Git SHA and no build time**. `tests/unit/versionConsistency.test.ts` keeps package.json, the footer and the header badge in sync. Frontend build ID: asset filenames are content-hashed, but there is no exposed build id/meta |
| 14.1 pending-migration detection + scheduler backoff | `[ ]` | **NOT STARTED (F-12)** | The scheduler starts only when the DB is reachable (`server/index.js:36-43`), which is a partial guard, but there is no pending-migration check and **no backoff**: `setInterval(tick, 15_000)` re-attempts and re-logs a permanent failure forever (`strategyScheduler.js:95-103`). With F-01 present, enabling a strategy produces exactly this infinite error loop |
| 15.1 `npm audit` | `[ ]` | **NOT STARTED** | Not re-measured in this audit (`npm ci --no-audit`). Procedure: `npm audit --json` on the VPS, classify prod vs dev, never `--force` |
| 15.2 bind backend | `[ ]` | **PARTIAL / likely DONE in code** | `server/config.js:14` defaults `HOST` to `127.0.0.1` and `index.js:46` listens on `config.HOST`; the stale systemd template sets `HOST=0.0.0.0`. What the VPS actually does must be checked with `ss -ltnp | grep 3000` |
| 15.3 firewall | `[ ]` | **NOT VERIFIABLE from the repo** | Owner-side check |
| 15.4 real production CSP & headers | `[ ]` | **PARTIAL** | The repo's CSP is enforced by a test against `src/` origins and matches `nginx/cryptora.conf`; but the *deployed* nginx config is Certbot-managed and differs from the template (§12.4), so the effective headers must be read on the VPS (`curl -I https://cryptora.duckdns.org`) |
| 16.1 main bundle ~897–900 kB | `[ ]` | **NOT STARTED (still 900.69 kB)** | Build log in §11.5. Route-level splitting already exists; no CI performance budget |
| 16.2 CoinPage budgets | `[ ]` | **NOT STARTED** | No budget tests for switch time, subscription count, memory release, render/callback counts. The PR #13 regression test is preserved (that part of the criterion holds) |
| 17.1 `/coin/UNKNOWN` | `[ ]` | **NOT STARTED** | No fast "instrument not supported" path; the resolver falls back to the raw token and the page fails inside `getCandles`, surfacing as `DataSourceUnavailable` (§4.3). Honest, but it costs a request and shows the wrong message |
| 17.2 delisted asset handling | `[~]` | **DONE-unverified** | `saved ∩ active` is enforced server-side and asserted against real PostgreSQL; historical journal/signals are untouched. The roadmap's "verify separately" note stands |
| 18.1 spot/mark/index/volume/OI/funding semantics audit | `[ ]` | **PARTIAL** | Provenance is shown per block in the UI (live-verified on `/`: each metric carries its source string, e.g. "Binance USD-M `/fapi/v1/openInterest` × markPrice"). No systematic written audit exists, and the audit found no counter-example of mixing |
| 19.1 empty areas on `/liquidations` | `[~]` | **DONE-unverified** | Same as 8.1 |
| 19.2 responsive check | `[ ]` | **NOT STARTED** (needs a browser) | §13.5 |
| 19.3 error/empty/loading states | `[ ]` | **PARTIAL** | The honesty contracts are strong and tested (`DataSourceUnavailable`, `AWAITING_STREAM`, "не подставляются" copy). No systematic pass over every card's empty-state height |
| 20.1 read-only browser audit | `[ ]` | **BLOCKED in the sandbox** | This document is the static + API half of it; the browser half needs the owner or a CI runner with browsers (§13.5) |

### 14.8 Regressions

**None found.** Specifically checked and clean: the P0 volume-profile fix is intact and guarded (§10);
`main` has no unmerged divergence; typecheck/build/tests all pass; the SSRF proxy removal is still in
place and still tested; migrations 001–005 are unchanged (asserted by a test).

The two items that *look* like regressions but are not:

* `/signals` reading `localStorage` instead of `/api/signals` is not a regression against `main` — it is
  the state `main` has always had on this branch of history. It **is** a regression against
  `docs/STRATEGY_OPERATIONS.md`'s description, which is why F-02 is graded P1: the document, not the code,
  moved.
* `activeSignalCount: 0` and an empty `/api/signals` in production are correct consequences of all three
  strategies being disabled, not data loss.

### 14.9 Recommended roadmap edits (docs-only, owner approval required)

1. Change PR #14's entry from `[~]` to `[x]` with merge commit `8eacfb9be5006f317faf9bb563edbc4e7c272d73`
   and cascade that to 2.1, 2.2, 3.1 (→ PARTIAL, UI missing), 4.1, 5.1, 6.1, 6.2, 8.1, 17.2, 19.1.
2. Mark 7.1 `[x]` with the live evidence from §8.5, keeping the `.env` procedure note.
3. **Insert a new P1 task:** "Server strategy engine calls `scanOnce()` — fix the contract and un-skip
   `strategyEngineCore.test.ts`" (F-01 + F-03), with the acceptance criterion *"enabling a strategy on a
   staging DB produces `lastScanAt` advancing and no `last_error`"*.
4. **Insert a new P1 task:** "Decide the single source of truth for signals" (F-02 + F-04) — either wire
   `/signals` to `/api/signals` and finish the server lifecycle, or document the browser ledger as the
   product and mark the server store as an internal mirror.
5. Insert P2 tasks for F-05/F-06/F-07 (dedup key, TP3, lifecycle + status domain), F-08 (timeframe
   advertisement), F-09/F-10 (server provider `'1D'` and `limit`), F-11 (deployment templates),
   F-12 (scheduler backoff), F-13 (scan-universe admin UI).
6. Correct the spot-universe evidence number from 746/736 to **494** and add the futures numbers
   (732 / 523).

---

## 15. DESIGN ONLY — Signals candlestick chart (no implementation)

> **This section is a design.** Nothing here was implemented, and nothing here may be implemented before
> the owner confirms the two decisions in §15.2. It changes no strategy rule, no level and no formula.

### 15.1 Goal, in one paragraph

On `/signals`, add a candlestick chart for **one user-selected active coin and one user-selected
timeframe**, overlaid with the levels the engine actually computed for each published setup: the entry
corridor, the stop, **all** targets, the strategy version, and the setup's current status — plus, once a
setup is filled, the real fill price/time and the post-shift stop/targets. No level may ever be derived,
rounded, extrapolated or invented in the frontend: if the engine did not produce a number, the chart shows
`—` and says why.

### 15.2 Two decisions the owner must make first (blocking)

| # | Decision | Option A | Option B | Audit recommendation |
|---|---|---|---|---|
| D1 | **Where do the levels come from?** | Browser `SignalsAuditLedger` (what `/signals` already reads) | `GET /api/signals` (PostgreSQL) | **A now, B later.** A is the only source that currently has all levels, all targets, fills and outcomes (§7.5). B is the right long-term answer (survives browser/profile change, one source of truth for all users) but requires the schema work in §15.7 **and** the F-01 fix. Design the component against an interface so the swap is a provider change, not a rewrite |
| D2 | **Which chart component?** | Extend `CandleChart.tsx` with an optional `overlays` prop | New `SignalChart.tsx` modelled on `LiquidationPriceChart.tsx` | **B.** `CandleChart` is used by `/coin/:symbol` and the Overview; adding marker/price-line lifecycle to it risks the P0 page. `LiquidationPriceChart` already solves markers + provenance + fit + honest empty states, and the roadmap invariant says a P0 page's regression test must not be disturbed |

### 15.3 Data flow (Option A, the recommended first step)

```
SymbolPickerModal (reuse)  ──► selectedSymbol  (any ACTIVE supported spot instrument)
TimeframeControl  (reuse)  ──► selectedTimeframe ∈ {5m,15m,30m,1h,4h,1D,1W}
        │
        ├─► provider.getCandles(selectedSymbol, selectedTimeframe, LIMIT[tf])   ← ONE symbol, ONE timeframe
        │      (LiveMarketDataProvider: Binance → KuCoin fallback, provenance stamped)
        │
        ├─► useRealtimeKline({ symbol, timeframe })                             ← optional, only for the
        │      applied ONLY when provenance.exchange === 'binance'                 selected pair
        │
        └─► ledger.getSetups()                                                   ← already in memory
               .filter(s => s.symbol === pairLabel(selectedSymbol))
               .filter(s => s.timeframe === selectedTimeframe)     ← '1h' today; see §15.6
               .map(toOverlay)                                     ← pure mapping, NO arithmetic
                        │
                        ▼
              SignalChart.tsx  (lightweight-charts: candles + markers + price lines + HTML badges)
```

**Hard rule:** the candle request is issued **only** for the selected symbol/timeframe. No universe
preload, no batch, no "warm the cache for the other 23 symbols". This mirrors
`CoinDetailPage.tsx:172`/`:318` and satisfies the owner's explicit constraint.

### 15.4 What the overlay must show, and exactly where each number comes from

| Visual | Source field (Option A) | Fallback if absent |
|---|---|---|
| Entry corridor band (shaded rectangle between two horizontal lines) | `setup.entryZone[0]`, `setup.entryZone[1]` | For `MARKET_NEXT_OPEN` (V2.8) both are equal ⇒ draw **one** line labelled "Entry (open N+1)" — never a fake band |
| Stop-loss line | `setup.invalidationLevel` | `—` in the legend; no line drawn |
| TP lines — **all of them** | `setup.targets[]` iterated (2 entries for V3.0/V3.3, up to 3 for V2.8) | Draw only the rungs that exist; label `TP1…TPn` from the array index, never synthesise a missing rung |
| Post-fill levels (dashed, distinct colour) | `setup.fill.stop`, `setup.fill.targets[]`, `setup.fill.price`, `setup.fill.at`, `setup.fill.barOpenTime` | If `status === 'ACTIVE'` show only the planned levels and label them "план" |
| Entry marker (arrow on the setup bar) | `setup.setupOpenTime` → bucket to the selected timeframe | Marker only if the bar exists in the loaded window; otherwise list the setup in the side panel with "вне окна графика" |
| Fill marker | `setup.fill.barOpenTime` | omit when unfilled |
| Exit marker | `setup.closedAt` / outcome `barOpenTime` | omit while open |
| Strategy version badge | `setup.strategyVersion` (`'3.0'`/`'3.3'`/`'2.8'`) with `setup.strategyId` in `title` | required — a signal without a source must not be drawable |
| Status badge | `setup.status` (8-value `SetupStatus`) | required |
| R:R | `setup.riskRewardRatio` | `—` |
| Exit reason / result | `setup.exitReason`, `setup.resultR`, `setup.netResultR`, `setup.barsHeld` | `—` with the honest "исхода ещё нет" copy |
| Direction | `setup.direction` (LONG/SHORT) — drives colour and arrow shape | required |

**Prohibited in the component:** computing a stop from ATR, deriving a target from R multiples,
rounding a level to a "nice" number, averaging a corridor into a single entry, copying a level from
another timeframe, or reusing a level from a previous symbol. If a number is not in the setup record, it
does not exist. This is the same rule `docs/SIGNALS.md` §4 and the project invariants already impose on
the ledger.

### 15.5 Reuse inventory — exact files and the lines to copy

| Need | Reuse from | What to take |
|---|---|---|
| Chart + candle normalisation | `src/components/market/LiquidationPriceChart.tsx:92` (createChart), `:127` (addCandlestickSeries), `normalizeLiquidationCandles` | ms→s conversion, dedupe by time, `high >= low` repair, sorted output |
| **Markers** | `LiquidationPriceChart.tsx:205` + `mapLiquidationMarkers` | The only `setMarkers` usage in the repo. Copy: bucket event time to the timeframe, cap the marker count (200 there; ~100 is plenty for signals), sort ascending by time (lightweight-charts v4 requires it), one marker set per series |
| HTML price badges | `LiquidationPriceChart.tsx` overlay block (top-28 badges via `timeToCoordinate`/`priceToCoordinate`) | Label each level with its exact price instead of a bare line; keep the cap so a 3-target setup × many setups cannot create hundreds of DOM nodes |
| **Price lines** | `src/components/common/CandleChart.tsx:344`, `:381` (create) and `:333`, `:340`, `:380` (remove) | The remove-before-create discipline with a ref, plus `lastValueVisible: false` / `priceLineVisible: false` (`:195-196`) so overlay lines do not duplicate the axis label |
| Realtime guard | `LiquidationPriceChart.tsx` (`provenance.exchange === 'binance'` check) | Never apply a KuCoin tick to a Binance series |
| Fit policy | `LiquidationPriceChart.tsx` (`fitContent()` once per `symbol:timeframe`) | Prevents the chart jumping under the user |
| Symbol selector | `src/components/common/SymbolPickerModal.tsx` | Full active spot universe, search by ticker and name, logo, `PICKER_RENDER_LIMIT = 60` |
| Universe for the selector | `src/services/data/registry/exchangeUniverse.ts` (`getSelectableSpotSymbols`) | Authoritative first, canonical fallback — never a hardcoded 25 |
| Candles for one pair | `src/pages/CoinDetailPage.tsx:167-200`, `:306-352` | `requestKey = symbol:timeframe` race guard, `active` cleanup flag, `TimeSeriesRepository` (`MemoryTimeSeriesRepository.getInstance().saveCandles`), `Promise.race` deadline, `detectCandleGap` + `mergeCandleHistory` on reconnect |
| Timeframe control | `CoinDetailPage.tsx:687` + `src/types/market.ts:3` (`Timeframe`) | Same 7 values, same labels |
| Pair normalisation | `src/utils/labels.ts` (`pairLabel`) and `LiveSignalEngine.toPair` (`:142`) | Ledger symbols are `BTC/USDT`; the picker yields `BTC` — normalise once, at the boundary |
| Time formatting | `src/utils/chartTime.ts`, `src/utils/timePresentation.ts` | UTC internally, browser-local by default (project invariant) |
| Empty/error states | `src/components/common/DataSourceUnavailable.tsx` | "No setups for this symbol/timeframe" and "candles unavailable" are different states and must look different |
| Ledger access | `src/services/signals/SignalsAuditLedger.ts` (`getSetups`, `subscribe`, `getById`) | Subscribe and re-render on ledger change; do not poll |

### 15.6 The timeframe problem (must be designed around, not papered over)

Every published setup carries `timeframe: '1h'` because `LiveSignalEngine.EXEC_TIMEFRAME = '1h'`
(`LiveSignalEngine.ts:56`, applied at `:522`). Consequences for a timeframe switcher:

* On **1h** the overlay is exact: setup bars, corridor, stop, targets and fills all belong to that series.
* On **5m/15m/30m** the levels are still *valid prices* (they are absolute, computed on 1h), but the
  setup bar is not a bar of that series. Design: draw the level **lines** (they are price levels, not
  bars), place the marker at the 1h setup open time bucketed into the visible timeframe, and label the
  group *"сетап 1h — уровни показаны на младшем таймфрейме"*. Do **not** resample, re-derive or re-run
  anything.
* On **4h/1D/1W** the same rule applies, with the marker bucketed to the containing bar.
* V2.8 additionally *consumes* 4h and 1d internally, but publishes on 1h. Its HTF zones are **not** in
  the setup record (V3.3's zone metadata is — `v33LiveReplay.ts:258-266` — but only in the browser
  ledger, and only as numbers in `meta`, not as rectangles). Drawing V3.3 zone rectangles is therefore
  possible from `meta.zoneKnownAt4hOpenTime` + the zone bounds **only if** the ledger keeps them; today
  `meta` is not part of `SetupIssuance`, so zone rectangles are **out of scope** for v1 of the chart.

Recommended control set: `15m · 1h · 4h · 1D`, defaulting to **1h** (the execution timeframe), with the
current setup count for the selected pair shown next to the selector so an empty chart is explained
before the user wonders why.

### 15.7 If the owner chooses Option B (server as the source of truth)

Required, in this order — all of it schema/plumbing, **none** of it strategy logic:

1. **Fix F-01** (`scanOnce` → `scanNow`) or nothing is ever written. Same PR: fix F-03 so the contract
   test actually runs.
2. **Fix F-05** — persist `setup.setupOpenTime` into `signal_candle_ts` (the field already exists; the
   server reads a name that does not).
3. **Migration `009_signals_levels`** (new file, additive, idempotent, no destructive statement):
   `ALTER TABLE signals ADD COLUMN IF NOT EXISTS tp3 NUMERIC NULL`, `entry_type TEXT NULL`,
   `valid_for_bars INTEGER NULL`, `exit_rule TEXT NULL`, `strategy_version TEXT NULL`,
   `fill_price NUMERIC NULL`, `fill_at TIMESTAMPTZ NULL`, `fill_stop NUMERIC NULL`,
   `fill_targets JSONB NULL`, `result_r NUMERIC NULL`, `net_result_r NUMERIC NULL`,
   `bars_held INTEGER NULL`. Keep `metadata` as-is for backwards compatibility.
   **Widen the status domain**: the current `CHECK (ACTIVE|INVALIDATED|TARGET_REACHED|EXPIRED)` cannot
   store `FILLED`, `CLOSED`, `CANCELLED` or `UNRESOLVED`. Changing a CHECK constraint requires
   `DROP CONSTRAINT` + `ADD CONSTRAINT`, which *is* a schema rewrite — take a `pg_dump` first and do it
   in a transaction, per the roadmap's migration safety rules.
4. **Wire the lifecycle**: call `closeSignal()` from the server-side equivalent of `trackOpenSetups`
   (`lifecycle.ts:53`) so rows leave `ACTIVE` (F-07). Without this, a chart fed by `/api/signals` would
   show every historical setup as live.
5. **Fix F-09/F-10** (normalise `'1D'` → `'1d'`, forward the `limit`) so server-side results match the
   browser's; otherwise the two sources will disagree on the same symbol and the chart will be blamed.
6. **Consume it**: import the already-written `fetchSignals()` (`src/services/strategyOps.ts:121`) behind
   the same `SignalOverlaySource` interface as the ledger, with a 15 s refresh (matching the interval
   `docs/STRATEGY_OPERATIONS.md` §8 already promises) and single-flight.
7. **Never mix sources on one chart.** One provider per render; a badge shows which one
   (`ИСТОЧНИК: ЛОКАЛЬНЫЙ ЖУРНАЛ` vs `ИСТОЧНИК: СЕРВЕР (PostgreSQL)`), consistent with the project's
   provenance discipline.

### 15.8 Component contract (what to build, without building it)

```
SignalChart.tsx
  props:
    symbol: string                  // base ticker, e.g. 'BTC'
    timeframe: Timeframe
    overlays: SignalOverlay[]       // already mapped, already filtered — the component does NO selection
    candles: OHLCV[]                // for this symbol/timeframe only
    source: 'ledger' | 'server'
    loading / unavailable / emptyReason
  behaviour:
    - setData(normalised candles); setMarkers(sorted, bucketed, capped)
    - price lines: remove-then-create per level, keyed by `${setupId}:${role}` so a re-render cannot leak
    - HTML badges capped (e.g. 12 per setup, 60 total)
    - fitContent once per `${symbol}:${timeframe}`
    - teardown: remove listeners, ResizeObserver, chart.remove(), null the refs (copy CandleChart:298-307)

SignalOverlay (type)
    setupId, strategyId, strategyVersion, direction, status,
    setupOpenTime, entryType, entryZone:[min,max]|null, stop, targets:number[],
    fill?: { price, at, barOpenTime, stop?, targets? },
    outcome?: { exitReason, exitPrice, resultR, netResultR, barsHeld },
    riskRewardRatio, timeframeOfRecord   // '1h' — used for the §15.6 disclaimer
```

### 15.9 Test plan for the future implementation

* **Unit (no browser):** `toOverlay(setup)` is a pure mapping — assert that for a V2.8 setup with three
  targets all three survive; that a missing `invalidationLevel` yields `null` and not `0`; that no field
  is rounded; that `entryZone[0] === entryZone[1]` collapses to a single line; that the status/exit
  strings pass through untouched.
* **Unit (guard against invention):** a test that mutates a setup's targets and asserts the overlay
  changes identically — i.e. the chart is a projection, not a calculator.
* **Chart logic:** reuse the `liquidationChart.test.ts` approach for marker bucketing/capping/sorting.
* **E2E (Playwright):** select a symbol, switch timeframe, assert the renderer stays responsive (the
  `timeframeHang.spec.ts` pattern) and that no `pageerror` occurs; assert the "no setups" state for a
  symbol with an empty ledger. Data-agnostic assertions only, because exchange data is 451-blocked from
  CI IPs.
* **Invariant test:** assert the chart issues exactly **one** candle request per symbol/timeframe change
  (no fan-out) — this is the roadmap 4.1 acceptance criterion the suite currently lacks.

### 15.10 Out of scope (explicitly)

Zone rectangles for V3.3 (needs `meta` in the persisted/shared record); liquidation markers on the same
chart (different provenance, would violate the actual-vs-estimated invariant); PnL equity curves;
multi-symbol comparison; any re-computation of levels; any change to a strategy rule; alerts/Telegram
notifications.

---

## 16. NEXT AGENT HANDOFF

Read this section first. It is written so that an agent with **no access to this conversation** can
continue safely.

### 16.1 Repository coordinates

| Item | Value |
|---|---|
| Repository | `github.com/nub36/CRYPTORA` |
| `origin/main` at audit time | **`8eacfb9be5006f317faf9bb563edbc4e7c272d73`** (merge of PR #14, `2026-09-23T15:14:48Z`) |
| Audit branch | **`arena/01a0cf3a-cryptora`**, cut from that SHA |
| App version | `0.9.3` (`package.json`) |
| Clone caveat | **shallow** — `git log` shows one commit; use `gh` or `git fetch --unshallow` for history |
| Files changed by this audit | **exactly one**: `docs/agent-plan/FULL_PROJECT_AUDIT.md` (this file). No source, config, test, migration or dependency was touched |
| PR | Docs-only. **Do not merge without the owner's approval** (project rule: agents never merge) |

### 16.2 Architecture in ten lines

1. React 18 + Vite 6 SPA, TypeScript strict, Tailwind; 25 pages; route-level code splitting.
2. All market data reaches the browser through a **same-origin allowlisted gateway** `/api/market/*`
   (`server/services/marketDataGateway.js`, GET-only, 8 s timeout, 1200 req/min/IP) — except exchange
   WebSockets and a few public REST hosts, which the browser calls directly under a CSP `connect-src`
   allowlist that a unit test keeps in sync with `src/`.
3. `LiveMarketDataProvider` is the only provider; Binance primary, KuCoin fallback, `SourceHealthTracker`
   circuit breaker, provenance stamped on every candle. A QA fixture mode exists and is **never** allowed
   to publish a signal (`LiveSignalEngine.ts:484`).
4. **Two independent signal generators share the same frozen strategy cores.** The browser one
   (`LiveSignalEngine` → `SignalsAuditLedger` in `localStorage` → `/signals`) is what users see. The
   server one (`StrategyScheduler` → esbuild bundle of the same `src/` code → PostgreSQL `signals` →
   `GET /api/signals`) is complete, tested at the DB level, and **unreachable** because of F-01.
5. The server compiles the browser's TypeScript at startup (`strategyCoreBundle.js` → esbuild →
   `.generated/strategyCore.mjs`, gitignored). This is why "the server has no own mathematics" is true —
   and why `esbuild`, currently a **transitive dev dependency of Vite**, is a de-facto runtime dependency
   of the backend. If a deploy ever runs `npm ci --omit=dev`, the strategy engine cannot build.
6. PostgreSQL holds users, sessions, audit_log, `strategy_settings` (006), `signals` (007),
   `scan_universe` (008). Everything else is cache or browser storage.
7. The scan universe is **server-owned** (PostgreSQL, 24 symbols live, cap 100) and both engines scan
   `saved ∩ active` — never a guessed list.
8. Liquidations are actual exchange events only (Binance/Bybit/OKX WS, `sessionStorage`, ≤100 events);
   the heatmap is a model and is permanently labelled `MODEL / ESTIMATED`.
9. Nginx terminates TLS and serves `/var/www/cryptora`, proxying `/api` to `127.0.0.1:3000` where
   `server/index.js` (Express) runs under systemd.
10. `systemd/cryptora.service` and `nginx/cryptora.conf` in the repo **do not match** that reality (§12.4).

### 16.3 Production state (all of it verified live during this audit)

| Probe | Result |
|---|---|
| `GET /api/health` | `{"status":"ok","version":"0.9.3","node":"v22.23.2","environment":"production","database":"connected"}` |
| `GET /api/market/universe/spot` | `count = 494`, `source = binance-spot-exchangeInfo` |
| `GET /api/market/universe/futures` | `activeUsdtContracts = 732`, `perpetualCount = 523` |
| `GET /api/strategies` | 3 rows, all `enabled: false`, `status: "OFF"`, `lastScanAt/lastSignalAt/lastError: null`, `activeSignalCount: 0`, `updatedAt: 2026-09-23T15:19:23.048Z`; V2.8 advertises `timeframes: ["15m"]` |
| `GET /api/signals` | `{"signals":[],"count":0,"source":"server"}` |
| `GET /api/signals?status=BOGUS` | `400 {"error":"INVALID_STATUS", …}` ✅ validation works |
| `GET /api/strategies/scan-universe` | 24 symbols, `activeKnown: true` |
| `GET /api/admin/scan-universe` (no session) | `{"error":"Требуется авторизация"}` ✅ no bypass |
| `GET /` | Live data: BTC $83,891.81 (−2.98 %), cap $2.86 T, dominance 58.8 %, F&G 71, breadth 84▲/399▼, OI $19.34 B, funding extremes, RSI-14 26.83, honest empty states for liquidations/radar, analytics preview explicitly "НЕТ SETUP · НЕ СИГНАЛ" |

**Interpretation:** production is healthy and up to date with `main`; the signal subsystem is switched
off, so nothing is generating or storing signals. This is the *default* state by design (migration 006
seeds `enabled = FALSE`), not a failure. **Do not enable a strategy on production before F-01 is fixed** —
it will error every 15 s forever and write nothing.

### 16.4 Per-strategy state

| | V3.0 HTF Liquidation Trap | V3.3 HTF Zone Mitigation | V2.8 Zero-fee Sniper + Trailing |
|---|---|---|---|
| Registry id | `V3_0_HTF_LIQUIDATION_TRAP` | `V3_3_HTF_ZONE_MITIGATION` | `V2_8_ZERO_FEE_SNIPER_TRAILING` |
| Verdict | `VALIDATED_FOR_RESEARCH` (3 of 6 symbols; `D-V30-001` preserved) | `TRAIN_ONLY_NOT_VALIDATED`, tail-fragile | `VALIDATED_GROSS_ONLY`; net-negative at 2/5 bps; one trade flips the sign |
| Badge shown | "Research validated" | "Train only" | "Gross-only validated" |
| Execution / structure TF | 1h / 4h | 1h / 4h | **1h** / 4h+1d (advertised as 15m — F-08) |
| Entry | Limit corridor `close ± 0.10 ATR`, 3 bars, worse edge | same | Market at **open of N+1**, levels shifted by the fill delta |
| Stop | sweep extreme ∓ 0.15 ATR | `min/max(climax, zone edge)` ∓ 0.15 ATR | structural behind the sweep wick + 0.25 ATR (frozen), then shifted |
| Targets | TP1 = 4h equilibrium (50 %), TP2 = opposing 4h swing | TP1 = displacement-leg midpoint (50 %), TP2 = opposing confirmed 4h swing | ≤3-rung frozen ladder (Trail uses none of them) |
| Exit | `manageTrade`, timeout **50** bars, R1–R5 | `manageTrade`, timeout **48** bars, R1–R5 | `simulateTrailing` (V2.5): BE at MFE ≥ 1R, trail 1R step 0.25R, timeout **10** bars |
| Fees | maker 2 / taker 5 bps per leg | same | **zero** (gross only); net shown separately via `v28NetR` |
| Frequency | ≈1 setup per symbol per few days | rarer after the geometry filter (≈51 % of pendings rejected) | ≈65 setups in 4 years across 6 symbols — silence is normal |
| Browser path | ✅ works | ✅ works | ✅ works (needs the `1d` series) |
| Server path | ❌ blocked by F-01 | ❌ blocked by F-01 | ❌ blocked by F-01, and additionally by F-09 (`'1D'` → HTTP 400) |
| Production | OFF, never scanned | OFF, never scanned | OFF, never scanned |

**All three are frozen.** No rule, threshold, target formula, timeout or fee model may be changed
without the owner's explicit separate approval (`docs/DONT_DO.md`, roadmap §0).

### 16.5 Subsystem state

* **Signals (browser):** works end to end. Engine autostarts in live mode, scans the server universe
  every 60 s, publishes only the last closed 1h bar, only `publishable` records, never from a QA fixture;
  ledger is append-only, SHA-256 chained, capped at 500 records; lifecycle runs before each scan.
  UI shows status, per-symbol provenance, retrospective (≤60), integrity verdict and full setup detail.
  **No chart. No HTTP. Per-browser storage.**
* **Signals (server):** schema, repository, dedup, hash chain, advisory lock, API, admin toggle, audit
  logging and integration tests are all in place and pass against real PostgreSQL. The **engine call is
  broken** (F-01), the dedup key is wrong (F-05), TP3 is dropped (F-06), the lifecycle never runs (F-07),
  the daily timeframe string is wrong (F-09), the candle limit is dropped (F-10) — and the API has no
  consumer (F-04).
* **Liquidation X (`/liquidations` + `LiquidationPriceChart`):** candles, actual events, markers,
  three exchange streams, filters (exchange/side/min size), honest zero states, `MODEL / ESTIMATED`
  heatmap. Missing: the `$1M` filter tier, a per-symbol journal filter, and server-side event history
  (F5 resets the journal).
* **Market universe:** spot 494 / futures 732 (523 perpetual) from `exchangeInfo`, server cache 10 min
  with 6 h stale-while-error, browser cache 5 min with 60 s backoff, metadata cached 12 h server-side,
  selectors universe-driven with a canonical fallback, pickers render ≤60 rows. No N × candles on
  catalogue pages.
* **Scan universe:** PostgreSQL, 24 symbols live, cap 100, `saved ∩ active`, refuses unknown/inactive
  symbols, audited, skips the scan when `exchangeInfo` is unavailable. **Admin UI missing** (F-13).
* **Migrations:** 001–008 all present; 006/007/008 **applied in production** (proved by live endpoints,
  §8.5); runner is transactional, idempotent, non-destructive, and does not read `.env`.

### 16.6 Test results (this audit)

`npm ci` ✅ · `npm run typecheck` ✅ exit 0 · `npm test` ✅ **116 files / 1176 tests** ·
`tests/integration` ✅ 56 tests with **real PostgreSQL** · `npm run build` ✅ (main chunk 900.69 kB /
gzip 247.44 kB) · `git diff --check` ✅ clean · server bundle build ✅ but `scanOnce` **undefined** ·
Playwright E2E ❌ not run **in the sandbox** (no installable browser binaries, no exchange egress, no
persistent PostgreSQL) — but ✅ **run by CI on this PR**: `Browser e2e (Chromium) pass 57s` and
`Typecheck + Unit + Build pass 1m42s`, which includes the P0 `timeframeHang.spec.ts` BTC/SOL timeframe
regression (§13.5).

### 16.7 Bug list (ordered)

| ID | Sev | One-line | Fix sketch (needs approval) |
|---|---|---|---|
| F-01 | P1 | `strategyEngine.js:116` calls `engine.scanOnce()`; the engine only has `scanNow()` | Rename the call. No strategy code changes |
| F-03 | P1 | `strategyEngineCore.test.ts` reports 6 passed while skipping all 6 (esbuild + jsdom) | `// @vitest-environment node` + `it.skipIf(!core)`; then it will fail on F-01 until F-01 is fixed — do both in one PR |
| F-02 | P1 | `docs/STRATEGY_OPERATIONS.md` §1/§7/§8/§9 describe a reverted architecture | Docs-only correction (§2.2 lists each claim and the truth) |
| F-04 | P1 | `GET /api/signals` has zero UI consumers | Decide D1 in §15.2, then either wire it or document the ledger as the product |
| F-05 | P2 | `setup.sourceCandleTs` doesn't exist ⇒ dedup keys on publish time | Use `setup.setupOpenTime` (`strategyEngine.js:132-136`) |
| F-06 | P2 | TP3 dropped when persisting | Migration `009` adds `tp3` (or store the ladder in `metadata` as an interim) |
| F-07 | P2 | Server lifecycle never runs; `status` domain too narrow | Call `closeSignal()` from a server-side tracker; widen the CHECK (backup first) |
| F-08 | P2 | V2.8 advertised as `15m`, runs `1h` | Correct `strategyCatalog.js` + `strategyEngine.EXEC_TIMEFRAME`; **do not** touch the strategy |
| F-09 | P2 | Server passes `'1D'` to Binance `interval=` ⇒ HTTP 400 | Normalise via the same mapping the browser uses (`mapTimeframeToBinanceInterval`) |
| F-10 | P2 | Server provider shim drops `limit` ⇒ 300 bars vs 1000 | Forward the third argument |
| F-11 | P2 | systemd/nginx templates don't match production | Bring templates + `docs/DEPLOYMENT.md` in line with `/root/CRYPTORA`, `server/index.js`, `/var/www/cryptora`, `127.0.0.1`; **never** overwrite the Certbot-managed live config |
| F-12 | P2 | Scheduler has no error backoff | Consecutive-failure backoff + a visible status |
| F-13 | P2 | No admin UI for the scan universe | Build the "Admin → Монеты" panel against the existing, tested API |
| F-14 | P3 | Main bundle 900.69 kB, no CI budget | Split providers/services out of the main chunk; add a budget check |
| F-15 | P3 | Liquidation filters miss `$1M` and per-symbol | Two small additions to `LiquidationsPage.tsx:59-61`, `:210-215` |
| F-16 | P3 | Stage-1 concept docs misdescribe the system | Add "historical concept" banners to `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `STRATEGIES.md` |

### 16.8 Risks

1. **Enabling a strategy on production today breaks it visibly and permanently** (F-01 + F-12): red card,
   `TypeError` in `last_error`, an error log line every 15 s, zero signals. Highest-probability accident
   for the next agent — the toggle is one click away on `/strategies` for an admin.
2. **Deploying the repo's systemd template — or running `npm start` in production as
   `docs/STRATEGY_OPERATIONS.md` §10 instructs — would silently delete auth, DB, strategies and admin**
   from the running site while the pages still render (F-11). `npm start` = `productionServer.js`;
   `npm run server` = `index.js`.
3. **Two sources of truth for signals** will diverge the moment the server engine is fixed: the browser
   ledger has fills/outcomes/TP3, PostgreSQL does not. Any UI that reads both will show contradictory
   numbers. Decide D1 before implementing.
4. **`esbuild` is an undeclared runtime dependency** of the backend (transitive via Vite). A
   `--omit=dev` install on the VPS breaks the strategy engine at startup.
5. **Unbounded `signals` growth** once the engine works (append-only, no retention policy).
6. **Browser request pressure scales with the scan universe** (§11.2): at the 100-symbol cap with two
   open tabs the gateway budget becomes tight.
7. **The false-green test (F-03) hides any future bundle/source divergence** — the exact class of bug it
   was written to catch (the V3.3 geometry bug came from a hand-written copy drifting from the source).
8. **Shallow clone** can mislead an agent into thinking the project has one commit.

### 16.9 Roadmap — what remains (condensed; full grading in §14)

* **DONE and verified in production:** PR #12, PR #13, PR #14, universe 2.1/2.2, migrations 7.1,
  metadata 5.1 (code side).
* **DONE but needs a browser/VPS check:** 4.1 (partly), 6.1, 6.2, 8.1, 17.2, 19.1, 15.2, 15.4.
* **PARTIAL:** 3.1 (UI missing), 8.2, 9.1, 10.1, 10.2, 11.2, 11.4, 13.1, 18.1, 19.3.
* **NOT STARTED:** 8.3, 11.1, 11.3, 12.1, 12.2, 14.1, 15.1, 16.1, 16.2, 17.1, 19.2.
* **BLOCKED (sandbox):** 20.1 browser half — commands provided in §13.5.
* **REGRESSIONS:** none.
* **New tasks this audit adds:** F-01…F-16, with F-01+F-03 as the first PR.

### 16.10 Recommended next PR (single, small, reviewable)

**Title:** `fix(server): align the strategy engine with the compiled core, and make its contract test real`

**Scope — three files, no strategy logic, no schema:**

1. `server/services/strategyEngine/strategyEngine.js`
   * `:116` `engine.scanOnce()` → `engine.scanNow()`
   * `:132-136` `setup.sourceCandleTs` → `setup.setupOpenTime` (keep the "don't persist without a key"
     guard: if it is not a number, skip the insert rather than fall back to publish time)
   * `:163` remove `engine.lastRejected` or report the real rejection count the engine does expose
   * provider shim: forward the `limit` argument (F-10) and normalise `'1D'` → `'1d'` (F-09)
2. `tests/integration/strategyEngineCore.test.ts` — add `// @vitest-environment node` at the top and
   convert the `guard()` early-returns into `it.skipIf(!core)(…)` so a skipped test is *reported* as
   skipped (F-03). Keep every existing assertion, including `scanOnce` → change it to `scanNow`.
3. `docs/STRATEGY_OPERATIONS.md` + `docs/PRODUCTION_ROADMAP.md` — the corrections listed in §2.2 and
   §14.9 (F-02), plus a new roadmap entry for this PR.

**Why this order:** it is the only change that makes the server subsystem *able* to work, it is provable
with the tests that already exist, it touches zero strategy mathematics, and it removes the false green
that hid the bug. Everything else (schema 009, lifecycle wiring, the Signals chart, admin UI, deploy
templates) is a separate PR.

**Explicitly NOT in that PR:** the Signals chart (§15 — awaiting decisions D1/D2), any migration, any
change to `strategyCatalog.js` timeframes (F-08 changes what users are told and needs owner sign-off),
any deploy-template edit (F-11 needs the VPS in front of you).

**Verification for that PR:** `npm run typecheck` · `npm test` (expect the integration file to now report
real passes, not silent ones) · `npm run build` · then, on a **staging** database only:
`PATCH /api/admin/strategies/V3_0_HTF_LIQUIDATION_TRAP {"enabled":true}` and confirm `lastScanAt`
advances, `lastError` stays `null`, and `journalctl -u cryptora` shows no repeating error. Never test
this on the production database without a `pg_dump` first.

### 16.11 Exact files for the future Signals Chart

**Read before writing any code**

```
docs/agent-plan/FULL_PROJECT_AUDIT.md                     §15 (this design) and §7 (pipeline + schema)
docs/SIGNALS.md                                           model, lifecycle, immutability, caveats
src/services/signals/SignalsAuditLedger.ts                AnalyticalSetup / SetupFill / SetupOutcome / SetupStatus
src/services/signals/live/LiveSignalEngine.ts             what a setup actually contains; EXEC_TIMEFRAME='1h'
src/services/signals/live/setupGeometry.ts                level invariants (LONG/SHORT ordering)
src/services/signals/live/lifecycle.ts                    how fill/outcome are produced
src/services/strategyOps.ts                               fetchSignals / SignalDto (Option B)
server/db/migrations/007_signals.sql                      the persisted subset
```

**Reuse (copy patterns from, do not modify)**

```
src/components/market/LiquidationPriceChart.tsx   createChart:92 · addCandlestickSeries:127 · setMarkers:205
                                                  normalizeLiquidationCandles · mapLiquidationMarkers
                                                  HTML badges (timeToCoordinate/priceToCoordinate) · fitContent
src/components/common/CandleChart.tsx             createPriceLine:344,381 · removePriceLine:333,340,380
                                                  lastValueVisible/priceLineVisible:false · teardown:298-307
src/components/common/SymbolPickerModal.tsx       active-universe picker, search, PICKER_RENDER_LIMIT=60
src/services/data/registry/exchangeUniverse.ts           getSelectableSpotSymbols · futuresBaseToSpot
src/pages/CoinDetailPage.tsx                      :167-200 race guard · :306-352 load + WS handoff
src/services/realtime/candleHandoff.ts            detectCandleGap · mergeKlineIntoCandles · mergeCandleHistory
src/services/storage/TimeSeriesRepository.ts   saveCandles / local history cache
src/hooks/useRealtimeKline.ts                     mapTimeframeToBinanceInterval · onReconnect
src/utils/labels.ts                               pairLabel (BTC → BTC/USDT, idempotent)
src/utils/chartTime.ts, src/utils/timePresentation.ts   UTC inside, browser-local outside
src/components/common/DataSourceUnavailable.tsx   honest empty/error copy
src/types/market.ts                               Timeframe = 5m|15m|30m|1h|4h|1D|1W · OHLCV · provenance
```

**Create (new files only)**

```
src/components/signals/SignalChart.tsx            the chart (§15.8 contract)
src/components/signals/signalOverlays.ts          toOverlay(setup) — pure projection, no arithmetic
src/components/signals/SignalChartPanel.tsx       selector + timeframe + source badge + setup list
tests/unit/signalOverlayProjection.test.ts        all targets survive; nothing invented; no rounding
tests/unit/signalChartSingleRequest.test.ts       one candle request per symbol/timeframe change
e2e/signalsChart.spec.ts                          responsiveness + empty state (data-agnostic)
```

**Touch only if the owner picks Option B (§15.7)**

```
server/services/strategyEngine/strategyEngine.js  F-01/F-05/F-09/F-10 (already in the recommended PR)
server/services/signalRepository.js               persist tp3 / fill / outcome; call closeSignal
server/db/migrations/009_signals_levels.sql       additive columns + widened status CHECK (backup first)
src/pages/SignalsPage.tsx                         mount SignalChartPanel; choose ONE source per render
```

### 16.12 Standing rules for whoever continues

* Never modify V3.0 / V3.3 / V2.8 rules, thresholds, targets, timeouts, fee models, or research/backtest
  logic. Frozen means frozen, including the quirks (V3.0's strict `> 1.25` RVOL vs V3.3's inclusive
  `>= 1.25`; V3.0's timeout 50 vs V3.3's 48).
* Never present demo/mock/estimated data as live or as actual. `null` renders as `—`, never as `0`.
* Never run a production migration or deploy from a sandbox. Provide exact commands; the owner runs them
  after `pg_dump`.
* Never bypass auth to "check" an admin screen.
* Never merge your own PR. `main` moves only through a PR with green CI.
* Any P0 browser hang is closed only together with a browser E2E regression test.
* Internal timestamps in UTC; display in browser-local by default.
* Update `docs/PRODUCTION_ROADMAP.md` **and** `docs/agent-plan/STATUS.md` when a task's status changes.
* Trust the code over the docs — and when they disagree, say so loudly in the docs (that is what §2 is for).

*End of audit.*
