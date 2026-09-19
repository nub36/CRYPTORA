/**
 * CRYPTORA — Планировщик серверного движка.
 *
 * Контракт, который здесь обеспечен:
 *  1. PostgreSQL — источник истины. Перед КАЖДЫМ циклом планировщик перечитывает
 *     `strategy_settings`, поэтому переключение ВКЛ/ВЫКЛ в админке действует
 *     БЕЗ перезапуска бэкенда.
 *  2. `enabled = false` ⇒ ноль вычислений: стратегия не доходит до evaluate,
 *     свечи для неё не запрашиваются.
 *  3. Никаких наложений: на стратегию есть in-flight замок, освобождаемый в
 *     `finally`. Долгий скан не запускает второй параллельный.
 *  4. Ошибки логируются и пишутся в `last_error`, процесс не падает.
 *  5. Корректное завершение: `stop()` отменяет таймеры и дожидается текущих
 *     сканов.
 */

import { getEnabledStrategies } from '../strategySettings.js';
import { scanStrategySafely } from './strategyEngine.js';
import { getMarketDataFetcher } from './marketDataFetcher.js';

/** Шаг основного цикла. Конкретный интервал берётся из strategy_settings. */
export const TICK_MS = 15_000;

export class StrategyScheduler {
  /**
   * @param {object} [opts]
   * @param {number} [opts.tickMs]
   * @param {Function} [opts.getEnabled] — инъекция для тестов
   * @param {Function} [opts.scan] — инъекция для тестов
   * @param {Function} [opts.now]
   */
  constructor({ tickMs = TICK_MS, getEnabled, scan, now } = {}) {
    this.tickMs = tickMs;
    this.getEnabledFn = getEnabled ?? (() => getEnabledStrategies());
    this.scanFn = scan ?? ((p) => scanStrategySafely(p));
    this.nowFn = now ?? (() => Date.now());

    /** @type {Map<string, Promise<any>>} in-flight замок на стратегию */
    this.inFlight = new Map();
    /** @type {Map<string, number>} когда стратегия сканировалась последний раз */
    this.lastRunAt = new Map();

    this.timer = null;
    this.running = false;
    this.cycles = 0;
    this.errors = [];
  }

  isRunning() {
    return this.running;
  }

  /** Видно ли прямо сейчас параллельное выполнение конкретной стратегии. */
  isInFlight(strategyId) {
    return this.inFlight.has(strategyId);
  }

  get stats() {
    return {
      running: this.running,
      cycles: this.cycles,
      inFlight: [...this.inFlight.keys()],
      errors: this.errors.slice(-10),
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Первый цикл сразу: после рестарта не ждём полного тика.
    this.timer = setInterval(() => {
      // Проверка флага здесь, а не внутри tick(): tick() — единица работы и
      // должна вызываться напрямую (тесты, ручной запуск, первый цикл).
      if (!this.running) return;
      this.tick().catch((e) => this.recordError(e));
    }, this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    // Первый цикл сразу: после рестарта не ждём полного тика.
    this.tick().catch((e) => this.recordError(e));
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Дождаёмся текущих сканов, чтобы не оборвать запись сигнала на середине.
    await Promise.allSettled([...this.inFlight.values()]);
  }

  recordError(e) {
    const message = e instanceof Error ? e.message : String(e);
    this.errors.push({ at: new Date().toISOString(), message });
    if (this.errors.length > 100) this.errors.shift();
    // eslint-disable-next-line no-console
    console.error('[strategyScheduler] cycle error:', message);
  }

  /**
   * Один цикл. Возвращает, какие стратегии были запущены — нужно тестам,
   * чтобы доказать «выключено ⇒ evaluate не вызывался».
   *
   * @returns {Promise<{considered:number, launched:string[], skippedDisabled:number, skippedNotDue:string[]}>}
   */
  async tick() {
    this.cycles++;
    const now = this.nowFn();

    // Перечитываем состояние из БД КАЖДЫЙ цикл — переключение действует сразу.
    // Сбой чтения НЕ пробрасывается: недоступная БД не должна ронять бэкенд,
    // ошибка уходит в лог, а цикл просто пропускается.
    let enabled;
    try {
      enabled = await this.getEnabledFn();
    } catch (e) {
      this.recordError(e);
      return { considered: 0, launched: [], skippedDisabled: 0, skippedNotDue: [] };
    }

    const launched = [];
    const skippedNotDue = [];

    for (const row of enabled) {
      // getEnabledStrategies() отдаёт ТОТ ЖЕ формат, что и остальные методы
      // репозитория (camelCase из mapRow). Раньше здесь читали row.strategy_id
      // и получали undefined: скан запускался с несуществующей стратегией и
      // молча завершался ошибкой, а last_scan_at оставался пустым.
      const strategyId = row.strategyId;

      // Замок: длинный скан не порождает второй параллельный.
      if (this.inFlight.has(strategyId)) {
        skippedNotDue.push(strategyId);
        continue;
      }

      const intervalMs = Math.max(row.scanIntervalSeconds ?? 60, 1) * 1000;
      const last = this.lastRunAt.get(strategyId);
      if (last !== undefined && now - last < intervalMs) {
        skippedNotDue.push(strategyId);
        continue;
      }

      this.lastRunAt.set(strategyId, now);

      const promise = (async () => {
        try {
          return await this.scanFn({
            strategyId,
            symbols: Array.isArray(row.symbols) ? row.symbols : null,
          });
        } catch (e) {
          // scanStrategySafely уже глотает ошибки; это страховка от
          // непредвиденного отказа, чтобы цикл не умер целиком.
          this.recordError(e);
          return { ok: false, strategyId, error: e instanceof Error ? e.message : String(e) };
        }
      })();

      this.inFlight.set(strategyId, promise);
      launched.push(strategyId);

      promise.finally(() => {
        // Освобождение строго в finally — иначе исключение оставило бы
        // стратегию заблокированной навсегда.
        this.inFlight.delete(strategyId);
      });
    }

    return {
      considered: enabled.length,
      launched,
      skippedDisabled: 0,
      skippedNotDue,
    };
  }
}

let singleton = null;

/** @returns {StrategyScheduler} */
export function getStrategyScheduler() {
  if (!singleton) singleton = new StrategyScheduler();
  return singleton;
}

export function resetStrategyScheduler() {
  singleton = null;
}

/** Диагностика для GET /api/admin/strategies/status. */
export function schedulerStatus() {
  const s = singleton;
  if (!s) return { running: false, cycles: 0, inFlight: [], errors: [] };
  return s.stats;
}
