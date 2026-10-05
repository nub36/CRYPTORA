/**
 * CRYPTORA — Пороги здоровья (единственный источник истины).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ. Порог «данные устарели» — это операционная
 * политика, а не математика стратегий. Разбросанные по коду литералы
 * (`> 300_000`, `>= 2 failures`) невозможно ни объяснить, ни изменить на
 * конкретном стенде, не трогая логику. Здесь все пороги собраны в одном
 * месте, каждый имеет безопасный default и может быть переопределён
 * переменной окружения. Неверное значение в env НЕ применяется молча:
 * оно отбрасывается, а в лог уходит одна строка с именем переменной
 * (значение не печатается — env может содержать что угодно).
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни одного секрета, ни одного хоста, ни одной строки
 * подключения. Этот модуль безопасно сериализовать в публичный ответ
 * `/api/health` (так и делается — раздел `thresholds` в отчёте).
 */

/**
 * Безопасные значения по умолчанию.
 *
 * Обоснование каждого порога — в docs/HEALTH_MONITORING.md; здесь коротко:
 *  • монитор сигналов тикает каждые 30 с  ⇒ stale после 10 пропущенных тиков;
 *  • планировщик стратегий тикает каждые 15 с ⇒ stale после 20 тиков;
 *  • свечи 1h обновляются раз в час ⇒ «источник устарел» считается от
 *    закрытия последней свечи, а не от момента HTTP-запроса;
 *  • cooldown Telegram 30 минут ⇒ при непрерывной аварии приходит не больше
 *    двух сообщений в час на проблему, а не одно в минуту.
 */
export const DEFAULT_HEALTH_THRESHOLDS = Object.freeze({
  /** Таймаут проверки БД (`SELECT 1`). Дольше — считаем БД недоступной. */
  databaseTimeoutMs: 2_000,
  /** Медленнее этого — БД отвечает, но деградирует (status остаётся ok, latency видна). */
  databaseSlowMs: 500,

  /** Рыночные данные: возраст ПОЛУЧЕНИЯ ответа, после которого статус stale. */
  marketDataStaleSeconds: 900,
  /** Возраст, после которого рыночные данные считаются отказом (error). */
  marketDataErrorSeconds: 3_600,
  /**
   * Допустимое отставание ИСТОЧНИКА (timestamp биржи) сверх длительности бара.
   * Свеча 1h, закрывшаяся 70 минут назад, при допуске 600 с ещё свежая;
   * закрывшаяся 2 часа назад — уже нет.
   */
  candleSourceLagSeconds: 600,
  /** Тикер/снапшот: источник обновляется непрерывно, допуск жёстче. */
  tickerSourceLagSeconds: 120,
  /** Open interest / funding: сервер подметает их реже. */
  derivativesSourceLagSeconds: 300,

  /** Монитор сигналов: сколько секунд без ЗАВЕРШЁННОГО цикла = stale. */
  signalMonitorStaleSeconds: 300,
  /** …и после скольких = error. */
  signalMonitorErrorSeconds: 1_800,
  /** Сколько подряд неуспешных циклов монитора считается отказом. */
  signalMonitorMaxConsecutiveFailures: 5,

  /** Radar monitor: секунд без события/обновления вселенной = stale. */
  radarMonitorStaleSeconds: 300,
  radarMonitorErrorSeconds: 1_800,

  /** Планировщик стратегий: секунд без завершённого цикла = stale. */
  strategySchedulerStaleSeconds: 300,
  strategySchedulerErrorSeconds: 1_800,

  /** Пауза между повторными Telegram-уведомлениями об ОДНОЙ и той же проблеме. */
  alertCooldownSeconds: 1_800,
  /**
   * Сколько подряд «плохих» наблюдений нужно, чтобы поднять alert. Одиночный
   * провал тика не должен будить человека ночью.
   */
  alertMinConsecutiveObservations: 2,
  /**
   * Грейс после старта процесса: подсистема, которая ещё ни разу не
   * отработала цикл, помечается `starting`, а не `stale`. Иначе каждый
   * рестарт бэкенда гарантированно выдавал бы ложную тревогу.
   */
  startupGraceSeconds: 180,
});

/** Имя переменной окружения → ключ порога. */
export const HEALTH_ENV_KEYS = Object.freeze({
  HEALTH_DB_TIMEOUT_MS: 'databaseTimeoutMs',
  HEALTH_DB_SLOW_MS: 'databaseSlowMs',
  HEALTH_MARKET_DATA_STALE_SECONDS: 'marketDataStaleSeconds',
  HEALTH_MARKET_DATA_ERROR_SECONDS: 'marketDataErrorSeconds',
  HEALTH_CANDLE_SOURCE_LAG_SECONDS: 'candleSourceLagSeconds',
  HEALTH_TICKER_SOURCE_LAG_SECONDS: 'tickerSourceLagSeconds',
  HEALTH_DERIVATIVES_SOURCE_LAG_SECONDS: 'derivativesSourceLagSeconds',
  HEALTH_SIGNAL_MONITOR_STALE_SECONDS: 'signalMonitorStaleSeconds',
  HEALTH_SIGNAL_MONITOR_ERROR_SECONDS: 'signalMonitorErrorSeconds',
  HEALTH_SIGNAL_MONITOR_MAX_FAILURES: 'signalMonitorMaxConsecutiveFailures',
  HEALTH_RADAR_MONITOR_STALE_SECONDS: 'radarMonitorStaleSeconds',
  HEALTH_RADAR_MONITOR_ERROR_SECONDS: 'radarMonitorErrorSeconds',
  HEALTH_STRATEGY_SCHEDULER_STALE_SECONDS: 'strategySchedulerStaleSeconds',
  HEALTH_STRATEGY_SCHEDULER_ERROR_SECONDS: 'strategySchedulerErrorSeconds',
  HEALTH_ALERT_COOLDOWN_SECONDS: 'alertCooldownSeconds',
  HEALTH_ALERT_MIN_OBSERVATIONS: 'alertMinConsecutiveObservations',
  HEALTH_STARTUP_GRACE_SECONDS: 'startupGraceSeconds',
});

/**
 * Разбор порогов из окружения. ЧИСТАЯ функция — тест подаёт любой объект env.
 *
 * Правила:
 *  • принимаются только целые положительные числа (0 запрещён: «порог 0»
 *    означал бы «всё всегда просрочено» и завалил бы Telegram);
 *  • значение, которое не разбирается, ИГНОРИРУЕТСЯ — применяется default;
 *    падать из-за опечатки в env health-слой не имеет права, иначе
 *    мониторинг роняет то, что должен наблюдать;
 *  • `error`-порог не может быть меньше `stale`-порога: иначе состояние
 *    «error, но ещё не stale» было бы недостижимо/противоречиво.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {(entry: object) => void} [log]
 * @returns {typeof DEFAULT_HEALTH_THRESHOLDS}
 */
export function resolveHealthThresholds(env = process.env, log) {
  const write = log ?? ((entry) => {
    // eslint-disable-next-line no-console
    console.warn('[health-config]', JSON.stringify(entry));
  });

  const resolved = { ...DEFAULT_HEALTH_THRESHOLDS };

  for (const [envKey, field] of Object.entries(HEALTH_ENV_KEYS)) {
    const raw = env?.[envKey];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim();
    if (!/^[1-9]\d*$/.test(value)) {
      // Значение НЕ печатается: переменная окружения может содержать что угодно.
      write({ event: 'health_threshold_ignored', variable: envKey, reason: 'not_a_positive_integer' });
      continue;
    }
    resolved[field] = Number(value);
  }

  // Согласованность пар stale/error.
  const pairs = [
    ['marketDataStaleSeconds', 'marketDataErrorSeconds'],
    ['signalMonitorStaleSeconds', 'signalMonitorErrorSeconds'],
    ['radarMonitorStaleSeconds', 'radarMonitorErrorSeconds'],
    ['strategySchedulerStaleSeconds', 'strategySchedulerErrorSeconds'],
  ];
  for (const [staleKey, errorKey] of pairs) {
    if (resolved[errorKey] < resolved[staleKey]) {
      write({ event: 'health_threshold_adjusted', variable: errorKey, reason: 'error_below_stale' });
      resolved[errorKey] = resolved[staleKey];
    }
  }

  return Object.freeze(resolved);
}

let cached = null;

/** Пороги процесса (разбираются один раз). */
export function getHealthThresholds() {
  if (!cached) cached = resolveHealthThresholds();
  return cached;
}

/** Тестовый шов. */
export function __setHealthThresholdsForTests(value) {
  cached = value ? Object.freeze({ ...DEFAULT_HEALTH_THRESHOLDS, ...value }) : null;
}
