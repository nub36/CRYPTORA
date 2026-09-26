# RADAR — Market Radar (Детектор рыночных аномалий)

> **Назначение:** доставлять структурированные наблюдения о статистических отклонениях рынка, не требуя от пользователя держать страницу открытой.
>
> **Implementation status (2026-09-26, unmerged / not deployed):** this branch moves the authoritative LIVE Radar runtime to the production backend. The browser is an API consumer; it is not a detector and does not own Radar warm-up.

---

## 1. Authoritative architecture

```text
Admin Scan Universe (PostgreSQL scan_universe)
  → server effective universe (saved ∩ active Binance Spot)
  → one server Binance Spot ticker subscription topology
  → shared frozen AnomalyCalculationCore
  → PostgreSQL radar_events
  → GET /api/radar/events + GET /api/radar/status
  → /radar and Overview presentation
```

`server/index.js` owns the monitor lifecycle. It starts the singleton only after the database health check succeeds and shuts it down before PostgreSQL closes. The existing `systemd/cryptora.service` starts `server/index.js`, so normal service/process/VPS restart starts a fresh monitor automatically; no second daemon is installed.

A browser tab, page refresh, or number of users does **not** create a server exchange subscription or restart detector state. Browser `RealtimeFeedManager` continues to serve non-Radar UI ticker/trade/depth needs but no longer creates authoritative Radar events.

## 2. Frozen calculation core

`shared/radar/anomalyCalculationCore.js` is the one deterministic source used by:

- `src/services/realtime/AnomalyEngine.ts` — retained browser adapter for deterministic tests/debug compatibility only;
- `server/services/radar/radarMonitor.js` — the production detector.

The migration does not alter calculation order, conditions, lookbacks, thresholds, z-score/price/volatility formulas, cooldown behavior, event/severity classification, or formatting. The server owns runtime state, not alternate math. `tests/unit/anomalyCalculationParity.test.ts` supplies a golden vector and compares browser adapter output against the server-imported shared core.

## 3. Scan Universe and market-data topology

The monitor obtains the configured effective universe through the existing server `getScanUniverseState()` implementation. It never uses a hardcoded count or a canonical fallback list. If Binance `exchangeInfo` is unknown, the monitor clears subscriptions and reports `unavailable`; it does not scan unverified/delisted symbols.

Admin add/remove mutations emit an in-process change notification only as a convergence optimization. The monitor always rereads PostgreSQL-derived effective state, also every 30 seconds, so it recovers after restart and safely handles another Admin session. Removed symbols are unsubscribed and have their rolling state/cooldowns removed; added symbols begin honest warm-up.

`BinanceRadarTickerStream` holds **one** dynamic server WebSocket (`wss://stream.binance.com:9443/ws`) and chunks Binance `SUBSCRIBE`/`UNSUBSCRIBE` messages. It is bounded by Scan Universe's existing maximum of 100 symbols, reconnects with capped exponential backoff, and reports a 30-second silent stream as `stale` before reconnecting. No per-symbol socket and no per-browser topology is created.

## 4. Warm-up and status

After startup the monitor reads the effective universe, subscribes, then fills exactly the existing rolling histories. It reports:

- `warming` — one or more active symbols lack the frozen core's required observation window;
- `live` — all active symbols are warmed and the server feed is connected;
- `feed-stale` / `feed-disconnected` — upstream state is not presented as LIVE;
- `unavailable` — effective universe cannot be confirmed;
- `idle` — confirmed effective universe is empty.

`/radar` displays server `Scan Universe`, `warmed`, and `feed` fields. It does not claim that a browser WebSocket is Radar's data source. Reloading `/radar` only refetches status/history and cannot reset warm-up.

## 5. Persisted events, deduplication, retention

Migration `012_radar_events.sql` adds the additive `radar_events` table:

- UUID stable row id;
- symbol/type/severity/event timestamp and UI facts;
- JSON metrics metadata;
- Binance Spot provenance plus source ticker timestamp;
- unique deterministic `dedupe_key`.

The monitor writes an emitted event through `ON CONFLICT (dedupe_key) DO NOTHING`. This protects durable history from identical ticker replays/reconnects and remains effective across monitor/process restart without changing the frozen detector cooldown semantics.

**Retention decision (requires owner review before production deployment):** no prior retention policy existed. This branch explicitly proposes a configurable, bounded default of `RADAR_EVENT_RETENTION_DAYS=30` (shown in `.env.example`). The monitor deletes only expired rows in batches of at most 5,000 every six hours. This is storage policy, not anomaly math; setting must be reviewed for production retention/compliance requirements before deployment. It prevents unbounded table growth without a hidden destructive policy.

## 6. API

All endpoints are same-origin read-only APIs and expose no secrets or Admin credentials:

- `GET /api/radar/events?limit=1..100&symbol=<optional>&before=<optional ISO>` — newest persisted server events, `{ events, count, source: "server" }`;
- `GET /api/radar/status` — server monitor lifecycle, configured/effective counts, frozen-core warm-up telemetry, feed freshness/state, retention configuration, and non-secret error state.

There is no server-to-browser WebSocket/SSE service in the current project. `/radar` polls these APIs, preserving the project's existing transport conventions while the server remains 24/7 authoritative.

## 7. RadarEvent

```typescript
export interface RadarEvent {
  id: string; // stable persisted UUID for LIVE server events
  timestamp: string; // ISO-8601 UTC
  symbol: string;
  type: 'VOLUME_SPIKE' | 'OI_SPIKE' | 'FUNDING_EXTREME' | 'LIQUIDATION_BURST' | 'PRICE_MOVE' | 'VOLATILITY_EXPANSION';
  severity: 'HIGH' | 'MEDIUM' | 'INFO';
  metricValue: string;
  observation: string;
  isDemo: boolean; // always false for /api/radar LIVE events
  provenance?: { exchange: 'binance'; market: 'spot'; symbol: string; timestamp: number };
  metadata?: Record<string, unknown>;
}
```

## 8. Verification scope

Regression coverage includes frozen-core parity, singleton start, warm-up, server-only generation, durable/restart dedupe, Scan Universe A→B convergence, actual PostgreSQL persistence/API history, page reload/history rendering, and server-status presentation. Browser E2E is included for server event rendering and reload; it requires Chromium in the executing environment.

**Not deployed:** this document describes branch behavior only. No production settings, Scan Universe rows, signals, database, migration, or service were modified by this work.
