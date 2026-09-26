/**
 * Server-owned 24/7 Radar runtime.
 *
 * The monitor owns lifecycle, Scan Universe convergence, ticker transport,
 * warm-up state and durable event delivery. It deliberately imports the same
 * frozen calculation source used by the legacy browser adapter; it does not
 * restate any anomaly formulas or thresholds.
 */

import { AnomalyCalculationCore } from '../../../shared/radar/anomalyCalculationCore.js';
import { getScanUniverseState } from '../scanUniverse.js';
import { subscribeScanUniverseChanged } from '../scanUniverseEvents.js';
import { config } from '../../config.js';
import { BinanceRadarTickerStream } from './binanceRadarTickerStream.js';
import { persistRadarEvent, purgeExpiredRadarEvents } from './radarEventRepository.js';

const UNIVERSE_REFRESH_MS = 30_000;
const RETENTION_SWEEP_MS = 6 * 60 * 60_000;

function normalizeSymbols(symbols) {
  return [...new Set((symbols ?? []).map((raw) => String(raw).trim().toUpperCase()).filter(Boolean))].sort();
}

export class RadarMonitor {
  constructor({
    core,
    createStream,
    getUniverse,
    persistEvent,
    purgeExpired,
    subscribeUniverseChanges,
    retentionDays = config.RADAR_EVENT_RETENTION_DAYS,
    universeRefreshMs = UNIVERSE_REFRESH_MS,
    retentionSweepMs = RETENTION_SWEEP_MS,
    now = () => Date.now(),
    logger = console,
  } = {}) {
    this.core = core ?? new AnomalyCalculationCore();
    this.getUniverse = getUniverse ?? (() => getScanUniverseState());
    this.persistEvent = persistEvent ?? persistRadarEvent;
    this.purgeExpired = purgeExpired ?? purgeExpiredRadarEvents;
    this.subscribeUniverseChanges = subscribeUniverseChanges ?? subscribeScanUniverseChanged;
    this.retentionDays = retentionDays;
    this.universeRefreshMs = universeRefreshMs;
    this.retentionSweepMs = retentionSweepMs;
    this.now = now;
    this.logger = logger;

    this.running = false;
    this.starting = false;
    this.universeRefreshTimer = null;
    this.retentionTimer = null;
    this.unsubscribeUniverseChanges = null;
    this.refreshPromise = null;
    this.persistenceQueue = Promise.resolve();
    this.activeSymbols = [];
    this.universe = { saved: [], effective: [], inactive: [], activeKnown: false, activeCount: null };
    this.feed = { state: 'idle', subscribedSymbols: 0, lastMessageAt: null, stale: false, reconnectAttempt: 0, error: null };
    this.startedAt = null;
    this.lastUniverseRefreshAt = null;
    this.lastPersistedEventAt = null;
    this.persistedEvents = 0;
    this.deduplicatedEvents = 0;
    this.retainedDeletes = 0;
    this.lastError = null;

    const factory = createStream ?? ((handlers) => new BinanceRadarTickerStream(handlers));
    this.stream = factory({
      onTick: (tick) => this.processTicker(tick),
      onStateChange: (feed) => {
        this.feed = { ...this.feed, ...feed };
        if (feed.error) this.lastError = feed.error;
      },
    });
  }

  /** Idempotent singleton lifecycle; a second initialization path does nothing. */
  async start() {
    if (this.running || this.starting) return;
    this.starting = true;
    this.running = true;
    this.startedAt = new Date(this.now()).toISOString();
    try {
      this.unsubscribeUniverseChanges = this.subscribeUniverseChanges(() => {
        void this.refreshUniverse();
      });
      await this.refreshUniverse();
      this.universeRefreshTimer = setInterval(() => {
        void this.refreshUniverse();
      }, this.universeRefreshMs);
      this.universeRefreshTimer.unref?.();
      this.retentionTimer = setInterval(() => {
        void this.runRetention();
      }, this.retentionSweepMs);
      this.retentionTimer.unref?.();
    } catch (error) {
      this.recordError(error);
    } finally {
      this.starting = false;
    }
  }

  async stop() {
    this.running = false;
    this.starting = false;
    if (this.universeRefreshTimer) clearInterval(this.universeRefreshTimer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.universeRefreshTimer = null;
    this.retentionTimer = null;
    this.unsubscribeUniverseChanges?.();
    this.unsubscribeUniverseChanges = null;
    this.stream.stop();
    await this.persistenceQueue;
  }

  /** Reread PostgreSQL-derived effective Universe; notification is only an optimization. */
  async refreshUniverse() {
    if (!this.running) return;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const universe = await this.getUniverse();
        this.universe = universe;
        this.lastUniverseRefreshAt = new Date(this.now()).toISOString();
        if (!universe.activeKnown) {
          const removed = this.activeSymbols;
          this.activeSymbols = [];
          this.core.clearSymbols(removed);
          this.stream.setSymbols([]);
          this.feed = { ...this.feed, state: 'unavailable', subscribedSymbols: 0 };
          this.lastError = 'Active Spot universe (exchangeInfo) unavailable';
          return;
        }

        const next = normalizeSymbols(universe.effective);
        const nextSet = new Set(next);
        const removed = this.activeSymbols.filter((symbol) => !nextSet.has(symbol));
        // Removed symbols cannot keep windows/cooldowns or emit mislabeled events.
        if (removed.length > 0) this.core.clearSymbols(removed);
        this.activeSymbols = next;
        this.lastError = null;
        this.stream.setSymbols(next);
      } catch (error) {
        this.recordError(error);
      }
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  processTicker(tick) {
    if (!this.running || !this.activeSymbols.includes(tick.symbol)) return [];
    const detected = this.core.processTick(tick);
    for (const event of detected) this.queuePersistence(event, tick.timestamp);
    return detected;
  }

  queuePersistence(event, sourceTickTimestamp) {
    const persist = async () => {
      try {
        const result = await this.persistEvent({ event, sourceTickTimestamp, source: { exchange: 'binance', market: 'spot' } });
        if (result.inserted) {
          this.persistedEvents += 1;
          this.lastPersistedEventAt = new Date(this.now()).toISOString();
        } else {
          this.deduplicatedEvents += 1;
        }
        return result;
      } catch (error) {
        this.recordError(error);
        return { inserted: false, event: null, error: this.lastError };
      }
    };
    // Keep future persistence alive after one rejected database request.
    this.persistenceQueue = this.persistenceQueue.then(persist, persist);
    return this.persistenceQueue;
  }

  async drain() {
    await this.persistenceQueue;
  }

  async runRetention() {
    if (!this.running) return 0;
    try {
      const deleted = await this.purgeExpired({ retentionDays: this.retentionDays });
      this.retainedDeletes += deleted;
      return deleted;
    } catch (error) {
      this.recordError(error);
      return 0;
    }
  }

  getStatus() {
    const detector = this.core.getStatus(this.activeSymbols);
    const feed = typeof this.stream.getStatus === 'function' ? this.stream.getStatus() : this.feed;
    const warm = this.activeSymbols.length > 0 && detector.warmedSymbols === this.activeSymbols.length;
    let lifecycle = 'stopped';
    if (this.running && !this.universe.activeKnown) lifecycle = 'unavailable';
    else if (this.running && this.activeSymbols.length === 0) lifecycle = 'idle';
    else if (this.running && feed.state === 'stale') lifecycle = 'feed-stale';
    else if (this.running && !['connected'].includes(feed.state)) lifecycle = 'feed-disconnected';
    else if (this.running && !warm) lifecycle = 'warming';
    else if (this.running) lifecycle = 'live';

    return {
      source: 'server',
      running: this.running,
      lifecycle,
      configuredUniverseCount: this.universe.saved?.length ?? 0,
      activeUniverseCount: this.activeSymbols.length,
      inactiveUniverseCount: this.universe.inactive?.length ?? 0,
      activeUniverseKnown: Boolean(this.universe.activeKnown),
      detector: {
        ...detector,
        warm,
      },
      marketFeed: {
        ...feed,
        source: 'binance-spot-ticker',
      },
      startedAt: this.startedAt,
      lastUniverseRefreshAt: this.lastUniverseRefreshAt,
      lastPersistedEventAt: this.lastPersistedEventAt,
      persistedEvents: this.persistedEvents,
      deduplicatedEvents: this.deduplicatedEvents,
      retainedDeletes: this.retainedDeletes,
      retentionDays: this.retentionDays,
      lastError: this.lastError,
    };
  }

  recordError(error) {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.logger.error?.('[radarMonitor]', this.lastError);
  }
}

let singleton = null;

export function getRadarMonitor() {
  if (!singleton) singleton = new RadarMonitor();
  return singleton;
}

/** Test-only singleton reset; production starts only through server/index.js. */
export async function resetRadarMonitor() {
  if (singleton) await singleton.stop();
  singleton = null;
}

export function radarMonitorStatus() {
  return singleton?.getStatus() ?? {
    source: 'server',
    running: false,
    lifecycle: 'stopped',
    configuredUniverseCount: 0,
    activeUniverseCount: 0,
    inactiveUniverseCount: 0,
    activeUniverseKnown: false,
    detector: { windowSize: 20, trackedSymbols: 0, warmedSymbols: 0, maxObservations: 0, symbols: [], warm: false },
    marketFeed: { state: 'idle', subscribedSymbols: 0, lastMessageAt: null, stale: false, reconnectAttempt: 0, source: 'binance-spot-ticker' },
    startedAt: null,
    lastUniverseRefreshAt: null,
    lastPersistedEventAt: null,
    persistedEvents: 0,
    deduplicatedEvents: 0,
    retainedDeletes: 0,
    retentionDays: config.RADAR_EVENT_RETENTION_DAYS,
    lastError: null,
  };
}
