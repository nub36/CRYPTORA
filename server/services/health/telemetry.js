/**
 * CRYPTORA — Внутренняя телеметрия процесса (in-memory, без побочных эффектов).
 *
 * ЧТО ЭТО. Единый реестр, куда УЖЕ СУЩЕСТВУЮЩИЕ циклы (монитор сигналов,
 * radar monitor, планировщик стратегий) и клиенты рыночных данных сообщают
 * о своих событиях. `/api/health` только ЧИТАЕТ этот реестр.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ ДОЛЖНО БЫТЬ:
 *  • ни одного `setInterval` ради health. Если цикл уже тикает — он и
 *    публикует событие; отдельного «health-таймера» не создаётся;
 *  • ни одного запроса к БД или бирже. Чтение health не должно создавать
 *    нагрузку, а запись телеметрии не должна удлинять рабочий цикл;
 *  • ни одного секрета. Хранятся только метки времени, счётчики и КОРОТКИЕ
 *    категории ошибок. Текст исключения обрезается и не содержит значений
 *    запроса; строки подключения и токены сюда не попадают по построению.
 *
 * Память ограничена: фиксированный набор ключей, никаких растущих массивов.
 */

import { MARKET_DATA_FEEDS } from './marketDataFreshness.js';

/** Максимальная длина сохраняемого текста ошибки. */
const MAX_ERROR_CHARS = 200;

function shortError(error) {
  if (error === null || error === undefined) return null;
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_CHARS);
}

/**
 * Телеметрия одного периодического цикла.
 *
 * Контракт (одинаков для монитора сигналов, radar monitor и планировщика):
 *   beginCycle()   — цикл начался;
 *   completeCycle({ ok, inspected, updated, errors }) — цикл завершился.
 *
 * `lastSuccessfulCycleAt` двигается ТОЛЬКО при `ok: true`. Цикл, который
 * отработал, но ничего не смог сделать из-за отказа зависимости, успешным
 * не считается — иначе «stale» был бы недостижим при постоянной аварии.
 */
export class CycleTelemetry {
  /**
   * @param {string} name
   * @param {() => number} [now]
   */
  constructor(name, now = () => Date.now()) {
    this.name = name;
    this.now = now;
    /**
     * Обратная ссылка на реестр: цикл, который сам ходит за рыночными
     * данными (radar ticker), публикует их свежесть через `registry`.
     * Для standalone-экземпляра (юнит-тест) она остаётся null, и вызов
     * `registry?.recordMarketData?.()` просто ничего не делает.
     */
    this.registry = null;
    this.reset();
  }

  reset() {
    this.startedAtMs = null;
    this.lastCycleStartedAtMs = null;
    this.lastCycleCompletedAtMs = null;
    this.lastSuccessfulCycleAtMs = null;
    this.lastDurationMs = null;
    this.cycles = 0;
    this.inspected = 0;
    this.updated = 0;
    this.errors = 0;
    this.consecutiveFailures = 0;
    this.lastError = null;
  }

  /** Процесс поднял эту подсистему (нужно для startup grace). */
  markStarted() {
    this.startedAtMs = this.now();
  }

  beginCycle() {
    this.lastCycleStartedAtMs = this.now();
    return this.lastCycleStartedAtMs;
  }

  /**
   * @param {object} [p]
   * @param {boolean} [p.ok]
   * @param {number} [p.inspected]
   * @param {number} [p.updated]
   * @param {number} [p.errors]
   * @param {unknown} [p.error]
   */
  completeCycle({ ok = true, inspected = 0, updated = 0, errors = 0, error = null } = {}) {
    const at = this.now();
    this.lastCycleCompletedAtMs = at;
    this.lastDurationMs = this.lastCycleStartedAtMs === null ? null : Math.max(0, at - this.lastCycleStartedAtMs);
    this.cycles += 1;
    this.inspected = Number.isFinite(inspected) ? inspected : 0;
    this.updated = Number.isFinite(updated) ? updated : 0;
    this.errors = Number.isFinite(errors) ? errors : 0;
    if (ok) {
      this.lastSuccessfulCycleAtMs = at;
      this.consecutiveFailures = 0;
      this.lastError = null;
    } else {
      this.consecutiveFailures += 1;
      if (error !== null) this.lastError = shortError(error);
    }
    return this.snapshot();
  }

  /** Публичная форма. Только времена, счётчики и короткая категория ошибки. */
  snapshot() {
    const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
    return {
      name: this.name,
      startedAt: iso(this.startedAtMs),
      lastCycleStartedAt: iso(this.lastCycleStartedAtMs),
      lastCycleCompletedAt: iso(this.lastCycleCompletedAtMs),
      lastSuccessfulCycleAt: iso(this.lastSuccessfulCycleAtMs),
      durationMs: this.lastDurationMs,
      cycles: this.cycles,
      inspected: this.inspected,
      updated: this.updated,
      errors: this.errors,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
    };
  }
}

/** Наблюдение свежести одного потока рыночных данных. */
class FeedTelemetry {
  constructor(feedId, descriptor, now) {
    this.feedId = feedId;
    this.descriptor = descriptor;
    this.now = now;
    this.sourceTimestampMs = null;
    this.receivedAtMs = null;
    this.lastSuccessAtMs = null;
    this.lastFailureAtMs = null;
    this.lastError = null;
    this.intervalSeconds = 0;
    this.successes = 0;
    this.failures = 0;
  }

  recordSuccess({ sourceTimestampMs = null, receivedAtMs = null, intervalSeconds = 0 } = {}) {
    const at = Number.isFinite(receivedAtMs) ? receivedAtMs : this.now();
    this.receivedAtMs = at;
    this.lastSuccessAtMs = at;
    this.lastError = null;
    this.successes += 1;
    if (Number.isFinite(sourceTimestampMs)) this.sourceTimestampMs = sourceTimestampMs;
    if (Number.isFinite(intervalSeconds) && intervalSeconds > 0) this.intervalSeconds = intervalSeconds;
  }

  recordFailure(error) {
    this.lastFailureAtMs = this.now();
    this.lastError = shortError(error) ?? 'UNKNOWN';
    this.failures += 1;
  }
}

/**
 * Реестр процесса.
 *
 * Один экземпляр на процесс; тесты создают свой и инъецируют часы.
 */
export class HealthTelemetryRegistry {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.processStartedAtMs = now();
    /** @type {Map<string, CycleTelemetry>} */
    this.cycles = new Map();
    /** @type {Map<string, FeedTelemetry>} */
    this.feeds = new Map();
    for (const [feedId, descriptor] of Object.entries(MARKET_DATA_FEEDS)) {
      this.feeds.set(feedId, new FeedTelemetry(feedId, descriptor, now));
    }
  }

  /** @returns {CycleTelemetry} */
  cycle(name) {
    let entry = this.cycles.get(name);
    if (!entry) {
      entry = new CycleTelemetry(name, this.now);
      entry.registry = this;
      this.cycles.set(name, entry);
    }
    return entry;
  }

  /**
   * Успешное получение рыночных данных.
   * Неизвестный feedId ИГНОРИРУЕТСЯ: телеметрия не имеет права упасть и
   * уронить горячий путь загрузки свечей из-за опечатки в имени потока.
   */
  recordMarketData(feedId, payload) {
    const feed = this.feeds.get(feedId);
    if (!feed) return;
    feed.recordSuccess(payload);
  }

  recordMarketDataFailure(feedId, error) {
    const feed = this.feeds.get(feedId);
    if (!feed) return;
    feed.recordFailure(error);
  }

  /** Сырые наблюдения потоков — классификацию делает healthService. */
  marketDataObservations() {
    const out = {};
    for (const [feedId, feed] of this.feeds) {
      out[feedId] = {
        feedId,
        exchange: feed.descriptor.exchange,
        market: feed.descriptor.market,
        kind: feed.descriptor.kind,
        class: feed.descriptor.class,
        critical: feed.descriptor.critical,
        observed: feed.receivedAtMs !== null || feed.lastFailureAtMs !== null,
        sourceTimestampMs: feed.sourceTimestampMs,
        receivedAtMs: feed.receivedAtMs,
        lastSuccessAtMs: feed.lastSuccessAtMs,
        lastFailureAtMs: feed.lastFailureAtMs,
        intervalSeconds: feed.intervalSeconds,
        successes: feed.successes,
        failures: feed.failures,
        lastError: feed.lastError,
      };
    }
    return out;
  }

  cycleSnapshots() {
    const out = {};
    for (const [name, cycle] of this.cycles) out[name] = cycle.snapshot();
    return out;
  }

  uptimeSeconds() {
    return Math.max(0, Math.floor((this.now() - this.processStartedAtMs) / 1000));
  }
}

let singleton = null;

/** @returns {HealthTelemetryRegistry} */
export function getHealthTelemetry() {
  if (!singleton) singleton = new HealthTelemetryRegistry();
  return singleton;
}

/** Тестовый шов. */
export function __setHealthTelemetryForTests(registry) {
  singleton = registry ?? null;
}

/** Имена циклов — чтобы строка-ключ не разъехалась между модулями. */
export const CYCLE_SIGNAL_MONITOR = 'signalMonitor';
export const CYCLE_RADAR_MONITOR = 'radarMonitor';
export const CYCLE_STRATEGY_SCHEDULER = 'strategyScheduler';
