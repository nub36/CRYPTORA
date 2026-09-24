/**
 * CRYPTORA — Серверный монитор позиций по опубликованным сигналам.
 *
 * ЗАДАЧА. Пока браузер закрыт, сайт продолжает следить за опубликованным
 * сигналом: ожидание входа → исполнение → сопровождение → TP/SL/таймаут/
 * отмена → терминальный исход → R. Источник правды — PostgreSQL и серверный
 * монитор, а не открытая вкладка.
 *
 * ГЛАВНОЕ ОГРАНИЧЕНИЕ — BOUNDED. Запрещено «N открытых сигналов × независимые
 * запросы свечей × непрерывный цикл»:
 *
 *   • читаются ТОЛЬКО открытые сигналы (`listOpenSignals`, один SELECT, предел);
 *   • они ГРУППИРУЮТСЯ по (символ, таймфрейм): 5 открытых BTC/USDT 1h дают
 *     ОДИН запрос свечей, а не пять;
 *   • запрос свечей идёт через общий `MarketDataFetcher` (кэш TTL + дедуп
 *     in-flight), поэтому монитор и сканер стратегий не тянут одну серию дважды;
 *   • групп на тик ограничено, конкурентность групп ограничена, lookback
 *     ограничен (ровно окно ядра), таймаут запроса и ретрай с backoff есть;
 *   • UPDATE идемпотентен: `syncSignalLifecycle` монотонен и возвращает
 *     ALREADY_CLOSED для закрытой строки, поэтому повторный тик с теми же
 *     свечами не меняет ничего.
 *
 * ПАРИТЕТ. Исход считает frozen-функция `trackPublishedSetup` из
 * `src/services/signals/live/lifecycle.ts` — та самая, которой браузерный
 * движок ведёт журнал и из которой серверный движок получает fill/outcome.
 * Собственной копии правил выхода здесь нет и быть не должно.
 *
 * ПОСЛЕ РЕСТАРТА монитор поднимается, читает открытые сигналы из БД и
 * продолжает наблюдение с того же места: состояние — в PostgreSQL, а не в
 * памяти процесса.
 */

import { loadStrategyCore } from '../strategyEngine/strategyCoreBundle.js';
import { getMarketDataFetcher, toExchangeSymbol } from '../strategyEngine/marketDataFetcher.js';
import {
  listOpenSignals,
  syncSignalLifecycle,
  recordSignalMonitorCheck,
  MAX_OPEN_SIGNALS_FOR_SYNC,
} from '../signalRepository.js';
import { toPublishedSetup, toLifecyclePatch } from './signalTradeManager.js';

/** Шаг основного цикла наблюдения. */
export const MONITOR_TICK_MS = 30_000;

/** Сколько открытых сигналов обрабатывается за тик (рабочий набор, как у скана). */
export const MAX_MONITOR_OPEN_SIGNALS = MAX_OPEN_SIGNALS_FOR_SYNC;

/** Сколько групп (символ × таймфрейм) запрашивается за тик. */
export const MAX_MONITOR_GROUPS = 64;

/** Сколько групп грузятся параллельно. */
export const MAX_GROUP_CONCURRENCY = 4;

/**
 * Окно наблюдения в барах — РОВНО окно ядра (`CANDLE_LIMIT_1H` = 1000).
 * Значение переопределяется из скомпилированного ядра, если оно там есть:
 * ручная копия константы разошлась бы с тем, что реально исполняется.
 */
export const MAX_LOOKBACK_BARS = 1000;

/** Запас баров после бара сетапа: исход может наступить не на следующем баре. */
export const LOOKBACK_MARGIN_BARS = 16;

/** Таймаут одного запроса свечей. */
export const MONITOR_REQUEST_TIMEOUT_MS = 10_000;

/** Сколько раз повторяется неудачный запрос группы за тик. */
export const MONITOR_GROUP_RETRIES = 2;

/** База backoff между ретраями внутри тика. */
export const MONITOR_RETRY_BACKOFF_MS = 500;

/** Столько тиков подряд с отказом рынка считается «stale» (данные устарели). */
export const MONITOR_STALE_AFTER_FAILURES = 2;

/** Причины, при которых строка заведомо не изменилась (журнал наблюдения). */
export const MONITOR_RESULTS = Object.freeze({
  UNCHANGED: 'UNCHANGED',
  FILLED: 'FILLED',
  RESOLVED: 'RESOLVED',
  SKIP: 'SKIP',
  ERROR: 'ERROR',
  OUT_OF_WINDOW: 'OUT_OF_WINDOW',
});

/**
 * Группировка открытых сигналов по (символ, таймфрейм).
 *
 * Это ядро защиты от веера N×candles: ключ группы — инструмент, а не сигнал.
 * Функция чистая и покрыта тестом.
 *
 * @param {Array<object>} rows строки signals в форме mapRow()
 * @returns {{groups: Array<{symbol:string, timeframe:string, exchangeSymbol:string, rows:Array<object>}>, total:number}}
 */
export function groupOpenSignals(rows) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const symbol = String(row.symbol ?? '');
    const timeframe = String(row.timeframe ?? '');
    if (!symbol || !timeframe) continue;
    const key = `${symbol}|${timeframe}`;
    let group = byKey.get(key);
    if (!group) {
      let exchangeSymbol = symbol;
      try {
        exchangeSymbol = toExchangeSymbol(symbol);
      } catch {
        // Невалидный символ не выдумывается: группа помечается и пропускается.
        exchangeSymbol = null;
      }
      group = { symbol, timeframe, exchangeSymbol, rows: [] };
      byKey.set(key, group);
    }
    group.rows.push(row);
  }
  // Самые старые сетапы первыми: у них раньше заканчивается окно наблюдения.
  const groups = [...byKey.values()].sort(
    (a, b) =>
      Math.min(...a.rows.map((r) => new Date(r.signalCandleTs).getTime())) -
      Math.min(...b.rows.map((r) => new Date(r.signalCandleTs).getTime()))
  );
  return { groups, total: (Array.isArray(rows) ? rows : []).length };
}

/**
 * Сколько баров нужно запросить, чтобы покрыть самый старый сетап группы.
 *
 * Окно ядра — последние `MAX_LOOKBACK_BARS` закрытых баров. Если самый старый
 * сетап группы моложе окна, запрашивается ровно столько, сколько нужно (+запас):
 * нет смысла тянуть 1000 баров ради сигнала возрастом два бара. Если старше —
 * запрашивается окно ядра, и `trackPublishedSetup` честно скажет, что бар
 * сетапа вне окна (семантика ядра, а не монитора).
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @param {number} tfMs длительность бара в мс
 * @param {number} [maxBars]
 */
export function computeLookbackBars(rows, nowMs, tfMs, maxBars = MAX_LOOKBACK_BARS) {
  let oldest = Infinity;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = new Date(r.signalCandleTs).getTime();
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  if (!Number.isFinite(oldest) || !(tfMs > 0)) return Math.max(1, maxBars);
  const barsSince = Math.ceil((nowMs - oldest) / tfMs);
  const needed = barsSince + LOOKBACK_MARGIN_BARS;
  return Math.max(1, Math.min(maxBars, needed));
}

/**
 * Сырые OHLCV биржи → закрытые ArchiveCandle в хронологическом порядке.
 *
 * Форму перевода и семантику `isClosed` (`closeTime < nowMs`) берём у ядра,
 * чтобы монитор отсекал формирующийся бар ТАК ЖЕ, как браузерный движок: это
 * ровно та граница look-ahead, которую зафиксировал P0-фикс `ohlcvAdapter`.
 */
function toClosedArchive(rawCandles, timeframe, nowMs, core) {
  const list = Array.isArray(rawCandles) ? rawCandles : [];
  let archive;
  if (typeof core?.ohlcvArrayToArchive === 'function') {
    archive = core.ohlcvArrayToArchive(list, timeframe, nowMs);
  } else if (typeof core?.ohlcvToArchive === 'function') {
    archive = list.map((c) => core.ohlcvToArchive(c, timeframe, nowMs));
  } else {
    archive = list;
  }
  const out = [];
  for (const c of archive) {
    if (c && c.isClosed) out.push(c);
  }
  out.sort((a, b) => a.openTime - b.openTime);
  // Дедуп по openTime: биржа иногда отдаёт дубль при разрыве соединения.
  const dedup = [];
  for (const c of out) {
    const last = dedup[dedup.length - 1];
    if (last && last.openTime === c.openTime) dedup[dedup.length - 1] = c;
    else dedup.push(c);
  }
  return dedup;
}

export class SignalMonitor {
  /**
   * @param {object} [opts]
   * @param {number} [opts.tickMs]
   * @param {Function} [opts.now]
   * @param {Function} [opts.listOpen] — инъекция для тестов
   * @param {Function} [opts.sync] — инъекция для тестов
   * @param {Function} [opts.getCandles] — инъекция для тестов
   * @param {Function} [opts.recordMonitor] — журнал наблюдения (БД)
   * @param {Function} [opts.loadCore]
   * @param {Function} [opts.sleep] — инъекция для тестов (backoff)
   * @param {number} [opts.requestTimeoutMs] — таймаут запроса свечей
   */
  constructor({
    tickMs = MONITOR_TICK_MS,
    now = () => Date.now(),
    listOpen,
    sync,
    getCandles,
    recordMonitor,
    loadCore = loadStrategyCore,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    requestTimeoutMs = MONITOR_REQUEST_TIMEOUT_MS,
  } = {}) {
    this.tickMs = tickMs;
    this.nowFn = now;
    this.listOpenFn = listOpen ?? ((limit) => listOpenSignals(null, limit));
    this.syncFn = sync ?? ((patch) => syncSignalLifecycle(patch));
    this.getCandlesFn = getCandles ?? (null);
    // Журнал наблюдения: в тестах подменяется, в продакшене пишет в signals.
    this.recordMonitorFn = recordMonitor ?? ((id, patch) => recordSignalMonitorCheck(id, patch));
    this.loadCoreFn = loadCore;
    this.sleepFn = sleep;
    this.requestTimeoutMs = requestTimeoutMs;

    this.timer = null;
    this.running = false;
    this.inFlight = null;
    this.cycles = 0;
    this.errors = [];

    /** @type {any} */
    this.core = null;
    this.coreError = null;

    this.lastTickStartedAt = null;
    this.lastTickFinishedAt = null;
    this.lastTickDurationMs = null;
    this.lastError = null;
    this.consecutiveFailures = 0;
    this.lastSummary = null;
  }

  isRunning() {
    return this.running;
  }

  get stats() {
    return {
      running: this.running,
      cycles: this.cycles,
      inFlight: this.inFlight !== null,
      lastTickStartedAt: this.lastTickStartedAt,
      lastTickFinishedAt: this.lastTickFinishedAt,
      lastTickDurationMs: this.lastTickDurationMs,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
      stale: this.consecutiveFailures >= MONITOR_STALE_AFTER_FAILURES,
      lastSummary: this.lastSummary,
      errors: this.errors.slice(-10),
    };
  }  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      if (!this.running) return;
      this.tick().catch((e) => this.recordError(e));
    }, this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    // Первый тик сразу: после рестарта наблюдение продолжается без ожидания.
    this.tick().catch((e) => this.recordError(e));
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.allSettled(this.inFlight ? [this.inFlight] : []);
  }

  recordError(e) {
    const message = e instanceof Error ? e.message : String(e);
    this.errors.push({ at: new Date().toISOString(), message });
    if (this.errors.length > 100) this.errors.shift();
    this.lastError = message;
    // eslint-disable-next-line no-console
    console.error('[signalMonitor] cycle error:', message);
  }

  /** Ядро стратегий — ленивая загрузка, ошибка не роняет монитор. */
  async core_() {
    if (this.core) return this.core;
    if (!this.coreError) {
      try {
        this.core = await this.loadCoreFn();
      } catch (e) {
        this.coreError = e instanceof Error ? e.message : String(e);
      }
    }
    if (!this.core) throw new Error(`Strategy core unavailable: ${this.coreError ?? 'unknown'}`);
    return this.core;
  }

  /**
   * Один тик наблюдения.
   *
   * @returns {Promise<{openSignals:number, groups:number, candleRequests:number,
   *                    checked:number, filled:number, resolved:number, unchanged:number,
   *                    skipped:number, errors:number, outOfWindow:number, durationMs:number}>}
   */
  async tick() {
    const startedMs = this.nowFn();
    this.lastTickStartedAt = new Date(startedMs).toISOString();
    const summary = {
      openSignals: 0,
      groups: 0,
      candleRequests: 0,
      checked: 0,
      filled: 0,
      resolved: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
      outOfWindow: 0,
      durationMs: 0,
    };

    try {
      const rows = await this.listOpenFn(MAX_MONITOR_OPEN_SIGNALS);
      summary.openSignals = Array.isArray(rows) ? rows.length : 0;
      if (summary.openSignals === 0) {
        this.consecutiveFailures = 0;
        this.lastError = null;
        return this.finishTick(summary, startedMs);
      }

      const { groups } = groupOpenSignals(rows);
      const bounded = groups.slice(0, MAX_MONITOR_GROUPS);
      summary.groups = bounded.length;

      const core = await this.core_();
      const tfMs = core?.ARCHIVE_TF_MS?.['1h'] ?? 3_600_000;
      const maxBars = Number(core?.CANDLE_LIMIT_1H ?? MAX_LOOKBACK_BARS) || MAX_LOOKBACK_BARS;

      // Очередь групп с ограниченной конкурентностью.
      const queue = [...bounded];
      const workers = Array.from({ length: Math.min(MAX_GROUP_CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const group = queue.shift();
          if (!group) return;
          const before = this.requestCount();
          try {
            await this.monitorGroup(group, { core, tfMs, maxBars, nowMs: this.nowFn(), summary });
          } catch (e) {
            summary.errors += group.rows.length;
            this.recordError(e);
            await this.recordGroupError(group, e);
          }
          summary.candleRequests += Math.max(0, this.requestCount() - before);
        }
      });
      await Promise.all(workers);

      // «Данные устарели» = за тик не получено НИ ОДНОЙ серии свечей. Одна
      // сбойная группа из десяти — это отказ по инструменту, а не потеря рынка:
      // помечать весь монитор stale было бы ложью в статусе UI.
      if (bounded.length > 0 && summary.candleRequests === 0) {
        this.consecutiveFailures += 1;
      } else {
        this.consecutiveFailures = 0;
        this.lastError = null;
      }
      return this.finishTick(summary, startedMs);
    } catch (e) {
      this.consecutiveFailures += 1;
      this.recordError(e);
      this.lastError = e instanceof Error ? e.message : String(e);
      return this.finishTick(summary, startedMs);
    }
  }

  finishTick(summary, startedMs) {
    const finishedMs = this.nowFn();
    summary.durationMs = finishedMs - startedMs;
    this.lastTickFinishedAt = new Date(finishedMs).toISOString();
    this.lastTickDurationMs = summary.durationMs;
    this.lastSummary = { ...summary };
    this.cycles += 1;
    return { ...summary };
  }

  /**
   * Счётчик HTTP-запросов свечей общего фетчера.
   *
   * Возвращает 0, если кэш свечей инъецирован (юнит-тесты, канарейные
   * прогоны): в этом режиме реального синглтона фетчера нет, и трогать его
   * нельзя — иначе в процессе тестов создался бы настоящий фетчер с ключами
   * провайдера. Тесты считают запросы своим инъецированным кэшем.
   */
  requestCount() {
    const fetcher = this.getCandlesFn ? null : getMarketDataFetcher();
    return Number(fetcher?.stats?.httpRequests ?? 0);
  }

  /**
   * Наблюдение одной группы (символ × таймфрейм).
   *
   * ОДИН запрос свечей на группу + ретрай с backoff. Отказ рынка НЕ приводит к
   * записи исхода: строка помечается ERROR и остаётся открытой — «нет данных»
   * не превращается в «исход определён».
   */
  async monitorGroup(group, { core, tfMs, maxBars, nowMs, summary }) {
    if (!group.exchangeSymbol) {
      for (const row of group.rows) {
        await this.writeMonitor(row, { result: 'SKIP', error: 'UNSUPPORTED_SYMBOL' });
        summary.skipped += 1;
      }
      return;
    }

    const lookbackBars = computeLookbackBars(group.rows, nowMs, tfMs, maxBars);

    let rawCandles = null;
    let lastError = null;
    for (let attempt = 0; attempt <= MONITOR_GROUP_RETRIES; attempt++) {
      try {
        rawCandles = await this.fetchCandles(group.exchangeSymbol, group.timeframe, lookbackBars);
        lastError = null;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt < MONITOR_GROUP_RETRIES) {
          await this.sleepFn(MONITOR_RETRY_BACKOFF_MS * (attempt + 1));
        }
      }
    }
    if (lastError !== null) {
      // Stale-data handling: данные недоступны ⇒ наблюдение отложено, строка не меняется.
      for (const row of group.rows) {
        await this.writeMonitor(row, { result: 'ERROR', error: lastError });
        summary.errors += 1;
      }
      return;
    }

    const candles = toClosedArchive(rawCandles, group.timeframe, nowMs, core);
    if (candles.length === 0) {
      for (const row of group.rows) {
        await this.writeMonitor(row, { result: 'SKIP', error: 'NO_CLOSED_CANDLES' });
        summary.skipped += 1;
      }
      return;
    }

    const firstOpenTime = candles[0].openTime;
    const fullWindow = candles.length >= lookbackBars;

    for (const row of group.rows) {
      const setupTime = new Date(row.signalCandleTs).getTime();
      if (!fullWindow && setupTime < firstOpenTime) {
        // Биржа отдала меньше истории, чем запрошено: судить об исходе нельзя.
        await this.writeMonitor(row, { result: 'OUT_OF_WINDOW', error: 'WINDOW_SHORTER_THAN_REQUESTED' });
        summary.outOfWindow += 1;
        continue;
      }
      await this.monitorSignal(row, candles, summary);
    }
  }

  /** Один сигнал: frozen-функция ведения → идемпотентная запись в БД. */
  async monitorSignal(row, candles, summary) {
    const built = toPublishedSetup(row);
    if (!built.ok) {
      await this.writeMonitor(row, { result: 'SKIP', error: built.reason });
      summary.skipped += 1;
      return;
    }

    const core = await this.core_();
    const result = core.trackPublishedSetup(built.entry, candles);

    if (result.kind === 'SKIP') {
      await this.writeMonitor(row, { result: 'SKIP', error: result.reason ?? 'SKIP' });
      summary.skipped += 1;
      return;
    }
    if (result.kind === 'UNCHANGED') {
      await this.writeMonitor(row, { result: 'UNCHANGED' });
      summary.unchanged += 1;
      return;
    }

    const { fill, outcome } = toLifecyclePatch(result);
    const res = await this.syncFn({
      strategyId: row.strategyId,
      symbol: row.symbol,
      timeframe: row.timeframe,
      signalCandleTs: row.signalCandleTs,
      fill,
      outcome,
    });

    if (result.kind === 'FILLED') {
      await this.writeMonitor(row, { result: 'FILLED' });
      summary.filled += 1;
      summary.checked += 1;
      return;
    }

    // RESOLVED
    await this.writeMonitor(row, { result: 'RESOLVED' });
    summary.resolved += 1;
    summary.checked += 1;
  }

  /** Журнал наблюдения по строке. Ошибка записи не должна ронять тик. */
  async writeMonitor(row, { result, error = null }) {
    if (!this.recordMonitorFn) return;
    try {
      await this.recordMonitorFn(row.id, { result, error });
    } catch (e) {
      this.recordError(e);
    }
  }

  async recordGroupError(group, e) {
    const message = e instanceof Error ? e.message : String(e);
    for (const row of group.rows) {
      await this.writeMonitor(row, { result: 'ERROR', error: message });
    }
  }

  /** Запрос свечей через общий фетчер (кэш + дедуп in-flight) или инъекцию. */
  async fetchCandles(exchangeSymbol, timeframe, limit) {
    if (this.getCandlesFn) {
      // Таймаут действует и в инъецированном режиме: тест «рыночные данные
      // недоступны» обязан проверять поведение, а не зависание процесса.
      return withTimeout(this.getCandlesFn(exchangeSymbol, timeframe, limit), this.requestTimeoutMs);
    }
    const fetcher = getMarketDataFetcher();
    return fetcher.getCandles(exchangeSymbol, timeframe, { limit });
  }
}

/** Отменяет промис по таймауту: один зависший тик не должен останавливать монитор. */
function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Candle fetch timeout after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

let singleton = null;

/** @returns {SignalMonitor} */
export function getSignalMonitor() {
  if (!singleton) singleton = new SignalMonitor();
  return singleton;
}

export function resetSignalMonitor() {
  singleton = null;
}

/** Диагностика для API. */
export function signalMonitorStatus() {
  const s = singleton;
  if (!s) {
    return {
      running: false,
      cycles: 0,
      inFlight: false,
      lastTickStartedAt: null,
      lastTickFinishedAt: null,
      lastTickDurationMs: null,
      lastError: null,
      consecutiveFailures: 0,
      stale: false,
      lastSummary: null,
      errors: [],
    };
  }
  return s.stats;
}
