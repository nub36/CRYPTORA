/**
 * CRYPTORA — Сборка отчёта о здоровье бэкенда.
 *
 * КОНТРАКТ ОТВЕТА задокументирован в docs/HEALTH_MONITORING.md и закреплён
 * тестами. Здесь важны три свойства:
 *
 * 1. НИ ОДНОГО СЕКРЕТА. В отчёт попадают только статусы, метки времени,
 *    длительности и счётчики. DATABASE_URL, токены, почты, chat id,
 *    строки подключения и текст SQL-ошибок НЕ сериализуются никогда.
 *    Ошибка БД отдаётся КАТЕГОРИЕЙ ('TIMEOUT' | 'UNAVAILABLE'), а не
 *    сообщением драйвера: сообщение pg содержит хост, порт и имя БД.
 * 2. ДЁШЕВО. Один `SELECT 1` с таймаутом — и чтение in-memory телеметрии.
 *    Ни обхода таблицы сигналов, ни запросов к бирже, ни пересчёта статистики.
 * 3. FAIL-CLOSED. Отсутствие наблюдения — это не «ok». Подсистема, которая
 *    ещё ни разу не отработала цикл, получает `starting` в грейс-период
 *    после старта процесса и `stale` после него.
 */

import { getHealthThresholds } from './healthThresholds.js';
import {
  getHealthTelemetry,
  CYCLE_SIGNAL_MONITOR,
  CYCLE_RADAR_MONITOR,
  CYCLE_STRATEGY_SCHEDULER,
} from './telemetry.js';
import {
  classifyFreshness,
  aggregateFreshness,
  sourceLagAllowanceSeconds,
} from './marketDataFreshness.js';
import { getPool } from '../../db/pool.js';
import { config } from '../../config.js';
import { readPackageVersion } from './version.js';

/** Статусы подсистем, упорядоченные по тяжести. */
const SEVERITY = { ok: 0, starting: 1, stale: 2, degraded: 2, error: 3 };

function worst(...statuses) {
  let result = 'ok';
  for (const status of statuses) {
    if ((SEVERITY[status] ?? 0) > (SEVERITY[result] ?? 0)) result = status;
  }
  return result;
}

/**
 * Лёгкая проверка БД: реальный `SELECT 1` с жёстким таймаутом.
 *
 * Таймаут обязателен: без него зависший пул превратил бы health-запрос в
 * висящее соединение, и внешний мониторинг (который и должен заметить
 * аварию) получил бы таймаут вместо ответа 503.
 *
 * @param {object} [deps]
 * @returns {Promise<{status:'ok'|'error', latencyMs:number|null, errorCode:string|null}>}
 */
export async function checkDatabaseHealth({ pool, timeoutMs, now = () => Date.now() } = {}) {
  const limit = timeoutMs ?? getHealthThresholds().databaseTimeoutMs;
  const startedAt = now();
  let timer = null;
  try {
    const p = pool ?? getPool();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'HEALTH_DB_TIMEOUT' })), limit);
      if (typeof timer.unref === 'function') timer.unref();
    });
    await Promise.race([p.query('SELECT 1 AS ok'), timeout]);
    return { status: 'ok', latencyMs: Math.max(0, now() - startedAt), errorCode: null };
  } catch (error) {
    // Категория, а не текст: сообщение pg содержит хост/порт/имя базы.
    const code = error?.code === 'HEALTH_DB_TIMEOUT' ? 'TIMEOUT' : 'UNAVAILABLE';
    return { status: 'error', latencyMs: Math.max(0, now() - startedAt), errorCode: code };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Статус одного цикла по его телеметрии.
 *
 * @param {object|null} snapshot
 * @param {{stale:number, error:number, maxConsecutiveFailures?:number}} limits
 * @param {number} nowMs
 * @param {number} processStartedAtMs
 * @param {number} graceSeconds
 */
export function classifyCycle(snapshot, limits, nowMs, processStartedAtMs, graceSeconds) {
  const lastSuccess = snapshot?.lastSuccessfulCycleAt ? Date.parse(snapshot.lastSuccessfulCycleAt) : null;
  const lastCompleted = snapshot?.lastCycleCompletedAt ? Date.parse(snapshot.lastCycleCompletedAt) : null;
  const reference = Number.isFinite(lastSuccess) ? lastSuccess : null;
  const ageSeconds = reference === null ? null : Math.max(0, Math.round((nowMs - reference) / 1000));
  const processAgeSeconds = Math.max(0, Math.round((nowMs - processStartedAtMs) / 1000));

  const base = {
    lastCycleStartedAt: snapshot?.lastCycleStartedAt ?? null,
    lastCycleCompletedAt: snapshot?.lastCycleCompletedAt ?? null,
    lastSuccessfulCycleAt: snapshot?.lastSuccessfulCycleAt ?? null,
    lastCycleAt: snapshot?.lastCycleCompletedAt ?? snapshot?.lastCycleStartedAt ?? null,
    ageSeconds,
    durationMs: snapshot?.durationMs ?? null,
    cycles: snapshot?.cycles ?? 0,
    inspectedSignals: snapshot?.inspected ?? 0,
    updatedSignals: snapshot?.updated ?? 0,
    errors: snapshot?.errors ?? 0,
    consecutiveFailures: snapshot?.consecutiveFailures ?? 0,
  };

  if (reference === null) {
    // Ни одного успешного цикла. В грейс-период после старта это нормальный
    // «ещё поднимаюсь», после — честный stale (а не «ok, потому что тихо»).
    const starting = processAgeSeconds <= graceSeconds && (lastCompleted === null || snapshot?.cycles === 0);
    return { ...base, status: starting ? 'starting' : 'stale', reason: starting ? 'STARTING' : 'NO_SUCCESSFUL_CYCLE' };
  }

  const failures = base.consecutiveFailures;
  const maxFailures = limits.maxConsecutiveFailures;
  if (ageSeconds >= limits.error) return { ...base, status: 'error', reason: 'CYCLE_AGE_EXCEEDED' };
  if (Number.isFinite(maxFailures) && failures >= maxFailures) {
    return { ...base, status: 'error', reason: 'CONSECUTIVE_FAILURES' };
  }
  if (ageSeconds >= limits.stale) return { ...base, status: 'stale', reason: 'CYCLE_AGE_EXCEEDED' };
  return { ...base, status: 'ok', reason: null };
}

/** Свежесть рыночных данных по наблюдениям телеметрии. */
export function buildMarketDataSection(observations, thresholds, nowMs) {
  const feeds = {};
  let newestSuccessMs = null;

  for (const [feedId, observation] of Object.entries(observations)) {
    const verdict = classifyFreshness({
      sourceTimestampMs: observation.sourceTimestampMs,
      receivedAtMs: observation.receivedAtMs,
      nowMs,
      staleAfterSeconds: thresholds.marketDataStaleSeconds,
      errorAfterSeconds: thresholds.marketDataErrorSeconds,
      sourceLagAllowanceSeconds: sourceLagAllowanceSeconds(observation.class, thresholds),
      intervalSeconds: observation.intervalSeconds,
      lastError: observation.lastError,
    });
    feeds[feedId] = {
      exchange: observation.exchange,
      market: observation.market,
      kind: observation.kind,
      critical: observation.critical,
      observed: observation.observed,
      status: observation.observed ? verdict.status : 'unobserved',
      reason: observation.observed ? verdict.reason : 'NEVER_REQUESTED',
      // Контракт свежести: ОБА времени, а не «запрос когда-то прошёл».
      sourceTimestamp: Number.isFinite(observation.sourceTimestampMs)
        ? new Date(observation.sourceTimestampMs).toISOString() : null,
      receivedAt: Number.isFinite(observation.receivedAtMs)
        ? new Date(observation.receivedAtMs).toISOString() : null,
      ageSeconds: verdict.ageSeconds,
      sourceAgeSeconds: verdict.sourceAgeSeconds,
      thresholdSeconds: thresholds.marketDataStaleSeconds,
      successes: observation.successes,
      failures: observation.failures,
    };
    if (Number.isFinite(observation.lastSuccessAtMs)) {
      newestSuccessMs = newestSuccessMs === null ? observation.lastSuccessAtMs : Math.max(newestSuccessMs, observation.lastSuccessAtMs);
    }
  }

  const observed = Object.fromEntries(Object.entries(feeds).filter(([, f]) => f.observed));
  const status = aggregateFreshness(observed);

  return {
    status,
    lastSuccessfulUpdate: newestSuccessMs === null ? null : new Date(newestSuccessMs).toISOString(),
    ageSeconds: newestSuccessMs === null ? null : Math.max(0, Math.round((nowMs - newestSuccessMs) / 1000)),
    staleThresholdSeconds: thresholds.marketDataStaleSeconds,
    feeds,
  };
}

/**
 * Полный отчёт.
 *
 * @param {object} [deps] инъекции для тестов (часы, телеметрия, проверка БД)
 * @returns {Promise<{httpStatus:number, body:object}>}
 */
export async function buildHealthReport(deps = {}) {
  const thresholds = deps.thresholds ?? getHealthThresholds();
  const telemetry = deps.telemetry ?? getHealthTelemetry();
  const now = deps.now ?? (() => Date.now());
  const nowMs = now();
  const checkDb = deps.checkDatabase ?? ((opts) => checkDatabaseHealth(opts));

  const database = await checkDb({ timeoutMs: thresholds.databaseTimeoutMs, now });
  const cycles = telemetry.cycleSnapshots();
  const processStartedAtMs = telemetry.processStartedAtMs;
  const grace = thresholds.startupGraceSeconds;

  const signalMonitor = classifyCycle(
    cycles[CYCLE_SIGNAL_MONITOR] ?? null,
    {
      stale: thresholds.signalMonitorStaleSeconds,
      error: thresholds.signalMonitorErrorSeconds,
      maxConsecutiveFailures: thresholds.signalMonitorMaxConsecutiveFailures,
    },
    nowMs, processStartedAtMs, grace
  );
  const radarMonitor = classifyCycle(
    cycles[CYCLE_RADAR_MONITOR] ?? null,
    { stale: thresholds.radarMonitorStaleSeconds, error: thresholds.radarMonitorErrorSeconds },
    nowMs, processStartedAtMs, grace
  );
  const strategyScheduler = classifyCycle(
    cycles[CYCLE_STRATEGY_SCHEDULER] ?? null,
    { stale: thresholds.strategySchedulerStaleSeconds, error: thresholds.strategySchedulerErrorSeconds },
    nowMs, processStartedAtMs, grace
  );

  const marketData = buildMarketDataSection(telemetry.marketDataObservations(), thresholds, nowMs);

  /**
   * Итоговый статус.
   *   error — БД недоступна. Это единственное состояние, при котором
   *           бэкенд не может выполнять свою работу вообще ⇒ HTTP 503,
   *           и балансировщик обязан вывести узел из ротации.
   *   degraded — подсистема устарела/сбоит, но процесс обслуживает запросы.
   *           HTTP 200: выводить узел из ротации в этом случае вредно —
   *           пользователь потеряет работающее чтение.
   */
  const subsystemStatus = worst(
    signalMonitor.status, radarMonitor.status, strategyScheduler.status, marketData.status
  );
  let status = 'ok';
  if (database.status === 'error') status = 'error';
  else if (subsystemStatus !== 'ok' && subsystemStatus !== 'starting') status = 'degraded';
  else if (subsystemStatus === 'starting') status = 'degraded';

  const body = {
    status,
    timestamp: new Date(nowMs).toISOString(),
    uptimeSeconds: telemetry.uptimeSeconds(),
    version: readPackageVersion(),
    environment: config.NODE_ENV,
    database: {
      status: database.status,
      latencyMs: database.latencyMs,
      // Категория, никогда не текст драйвера.
      errorCode: database.errorCode,
      slowThresholdMs: thresholds.databaseSlowMs,
    },
    marketData,
    signalMonitor: { ...signalMonitor, staleThresholdSeconds: thresholds.signalMonitorStaleSeconds },
    radarMonitor: { ...radarMonitor, staleThresholdSeconds: thresholds.radarMonitorStaleSeconds },
    strategyScheduler: { ...strategyScheduler, staleThresholdSeconds: thresholds.strategySchedulerStaleSeconds },
    thresholds,
  };

  return { httpStatus: status === 'error' ? 503 : 200, body };
}

/**
 * Readiness: может ли узел принимать трафик.
 *
 * Готовность = БД доступна И критические подсистемы инициализированы
 * (цикл стартовал — не обязательно «успел отработать удачно»: иначе первая
 * минута после рестарта всегда отдавала бы 503 и деплой выглядел бы
 * как авария).
 */
export async function buildReadinessReport(deps = {}) {
  const thresholds = deps.thresholds ?? getHealthThresholds();
  const telemetry = deps.telemetry ?? getHealthTelemetry();
  const now = deps.now ?? (() => Date.now());
  const checkDb = deps.checkDatabase ?? ((opts) => checkDatabaseHealth(opts));
  const required = deps.requiredCycles ?? [CYCLE_SIGNAL_MONITOR, CYCLE_STRATEGY_SCHEDULER];

  const database = await checkDb({ timeoutMs: thresholds.databaseTimeoutMs, now });
  const snapshots = telemetry.cycleSnapshots();

  const subsystems = {};
  for (const name of required) {
    const snapshot = snapshots[name];
    subsystems[name] = {
      initialized: Boolean(snapshot?.startedAt || snapshot?.lastCycleStartedAt),
      lastCycleAt: snapshot?.lastCycleCompletedAt ?? snapshot?.lastCycleStartedAt ?? null,
    };
  }

  const ready = database.status === 'ok' && Object.values(subsystems).every((s) => s.initialized);
  return {
    httpStatus: ready ? 200 : 503,
    body: {
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date(now()).toISOString(),
      database: { status: database.status, latencyMs: database.latencyMs, errorCode: database.errorCode },
      subsystems,
    },
  };
}
