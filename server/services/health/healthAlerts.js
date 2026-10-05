/**
 * CRYPTORA — Health → Telegram.
 *
 * ПРИНЦИПЫ
 * --------
 * 1. ВТОРОГО БОТА НЕТ. Доставка идёт через СУЩЕСТВУЮЩИЙ слой
 *    `notificationChannels.deliverSavedTelegram` — тот же бот, та же
 *    расшифровка токена, тот же `notification_delivery_log`. Этот модуль
 *    только решает, ЧТО и КОГДА отправить; как отправить — не его дело.
 * 2. НЕ ШУМИТЬ. Три независимых механизма:
 *      • подтверждение — проблема должна наблюдаться N циклов подряд
 *        (одиночный провал тика человека не будит);
 *      • дедупликация — пока состояние проблемы не изменилось, повторное
 *        сообщение не формируется;
 *      • cooldown — повтор по той же проблеме не раньше, чем через
 *        `alertCooldownSeconds`.
 * 3. ВОССТАНОВЛЕНИЕ ОБЯЗАТЕЛЬНО. Проблема, о которой сообщили, обязана
 *    получить ровно одно сообщение RECOVERED, когда подсистема вернулась в
 *    норму. Тишина — это не «починилось».
 * 4. НЕ ЛОМАТЬ ОСНОВНОЙ ЦИКЛ. Любая ошибка Telegram/сети/БД внутри этого
 *    модуля поглощается: монитор сигналов и планировщик не должны падать
 *    из-за того, что мессенджер недоступен.
 *
 * СЕКРЕТЫ. В текст сообщения попадают только название подсистемы, статус и
 * возраст последнего успешного события. Ни токенов, ни chat id, ни
 * DATABASE_URL, ни текста SQL-ошибок.
 */

import { query } from '../../db/pool.js';
import { deliverSavedTelegram } from '../notificationChannels.js';
import { getHealthThresholds } from './healthThresholds.js';

/** Коды alert'ов — закрытый домен. */
export const HEALTH_ALERT_CODES = Object.freeze([
  'DATABASE_DOWN',
  'MARKET_DATA_STALE',
  'SIGNAL_MONITOR_STALE',
  'RADAR_MONITOR_STALE',
  'STRATEGY_SCHEDULER_STALE',
]);

/** Человекочитаемые названия подсистем (ru, как и остальные уведомления). */
const ALERT_TITLES = Object.freeze({
  DATABASE_DOWN: 'Database unavailable',
  MARKET_DATA_STALE: 'Market data stale',
  SIGNAL_MONITOR_STALE: 'Signal monitor stale',
  RADAR_MONITOR_STALE: 'Radar monitor stale',
  STRATEGY_SCHEDULER_STALE: 'Strategy scheduler stale',
});

const RECOVERY_TITLES = Object.freeze({
  DATABASE_DOWN: 'Database healthy again',
  MARKET_DATA_STALE: 'Market data fresh again',
  SIGNAL_MONITOR_STALE: 'Signal monitor healthy again',
  RADAR_MONITOR_STALE: 'Radar monitor healthy again',
  STRATEGY_SCHEDULER_STALE: 'Strategy scheduler healthy again',
});

/** «8m 42s ago» — человеку, а не машине. */
export function formatAge(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Какие проблемы видны в отчёте. ЧИСТАЯ функция — вход отчёт, выход список.
 *
 * `starting` проблемой НЕ считается: подсистема в грейс-периоде после
 * рестарта не является аварией, иначе каждый деплой слал бы тревогу.
 *
 * @param {object} report тело `/api/health`
 * @returns {Array<{code:string, detail:string, ageSeconds:number|null}>}
 */
export function detectHealthProblems(report) {
  const problems = [];
  if (report?.database?.status === 'error') {
    problems.push({
      code: 'DATABASE_DOWN',
      detail: report.database.errorCode === 'TIMEOUT' ? 'SELECT 1 timed out' : 'connection unavailable',
      ageSeconds: null,
    });
  }
  const bad = (status) => status === 'stale' || status === 'error';

  if (bad(report?.marketData?.status)) {
    problems.push({
      code: 'MARKET_DATA_STALE',
      detail: `status: ${report.marketData.status}`,
      ageSeconds: report.marketData.ageSeconds ?? null,
    });
  }
  const cycleMap = [
    ['signalMonitor', 'SIGNAL_MONITOR_STALE'],
    ['radarMonitor', 'RADAR_MONITOR_STALE'],
    ['strategyScheduler', 'STRATEGY_SCHEDULER_STALE'],
  ];
  for (const [section, code] of cycleMap) {
    const node = report?.[section];
    if (bad(node?.status)) {
      problems.push({ code, detail: `status: ${node.status}`, ageSeconds: node.ageSeconds ?? null });
    }
  }
  return problems;
}

/** Текст проблемы. */
export function formatAlertText(problem) {
  const lines = ['🔴 CRYPTORA HEALTH', ALERT_TITLES[problem.code] ?? problem.code];
  if (Number.isFinite(problem.ageSeconds)) lines.push(`Last cycle: ${formatAge(problem.ageSeconds)} ago`);
  if (problem.detail) lines.push(problem.detail);
  return lines.join('\n');
}

/** Текст восстановления. */
export function formatRecoveryText(code, downForSeconds) {
  const lines = ['🟢 CRYPTORA RECOVERED', RECOVERY_TITLES[code] ?? code];
  if (Number.isFinite(downForSeconds)) lines.push(`Degraded for: ${formatAge(downForSeconds)}`);
  return lines.join('\n');
}

/**
 * Состояние одной проблемы между вызовами.
 * @typedef {{ observations:number, firstSeenAtMs:number, notifiedAtMs:number|null,
 *             notifiedDetail:string|null }} AlertState
 */

/**
 * Движок alert'ов.
 *
 * Состояние живёт в памяти процесса. Это сознательно: после рестарта
 * бэкенда «памяти о проблеме» нет, и первая же подтверждённая проблема
 * будет сообщена заново — это правильное поведение (рестарт сам по себе
 * событие), и оно не требует ни миграции, ни таблицы.
 */
export class HealthAlerter {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now]
   * @param {(text:string, code:string) => Promise<any>} [opts.send] доставка (инъекция в тестах)
   * @param {object} [opts.thresholds]
   * @param {(entry:object) => void} [opts.log]
   */
  constructor({ now, send, thresholds, log } = {}) {
    this.now = now ?? (() => Date.now());
    this.sendFn = send ?? ((text, code) => dispatchHealthTelegram(text, code));
    this.thresholdsFn = thresholds ? () => thresholds : () => getHealthThresholds();
    this.log = log ?? ((entry) => {
      // eslint-disable-next-line no-console
      console.info('[health-alert]', JSON.stringify(entry));
    });
    /** @type {Map<string, AlertState>} */
    this.active = new Map();
    this.sent = 0;
    this.suppressed = 0;
    this.recovered = 0;
  }

  /** Диагностика (админ-статус, тесты). Без текста сообщений и получателей. */
  get stats() {
    return {
      activeAlerts: [...this.active.entries()]
        .filter(([, s]) => s.notifiedAtMs !== null)
        .map(([code]) => code),
      pendingAlerts: [...this.active.entries()]
        .filter(([, s]) => s.notifiedAtMs === null)
        .map(([code]) => code),
      sent: this.sent,
      suppressed: this.suppressed,
      recovered: this.recovered,
    };
  }

  /**
   * Обработать очередной отчёт о здоровье.
   *
   * @param {object} report тело `/api/health`
   * @returns {Promise<{sent:string[], suppressed:string[], recovered:string[]}>}
   */
  async evaluate(report) {
    const thresholds = this.thresholdsFn();
    const nowMs = this.now();
    const problems = detectHealthProblems(report);
    const seen = new Set(problems.map((p) => p.code));

    const sent = [];
    const suppressed = [];
    const recovered = [];

    for (const problem of problems) {
      const state = this.active.get(problem.code) ?? {
        observations: 0, firstSeenAtMs: nowMs, notifiedAtMs: null, notifiedDetail: null,
      };
      state.observations += 1;
      this.active.set(problem.code, state);

      // Подтверждение: одиночный провал не будит человека.
      if (state.observations < thresholds.alertMinConsecutiveObservations) {
        suppressed.push(problem.code);
        continue;
      }
      // Дедупликация + cooldown.
      if (state.notifiedAtMs !== null) {
        const sinceSeconds = (nowMs - state.notifiedAtMs) / 1000;
        const detailChanged = state.notifiedDetail !== problem.detail;
        if (sinceSeconds < thresholds.alertCooldownSeconds && !detailChanged) {
          this.suppressed += 1;
          suppressed.push(problem.code);
          continue;
        }
      }

      const delivered = await this.deliver(formatAlertText(problem), problem.code);
      if (delivered) {
        state.notifiedAtMs = nowMs;
        state.notifiedDetail = problem.detail;
        this.sent += 1;
        sent.push(problem.code);
      } else {
        // Доставка не удалась — состояние «сообщено» НЕ ставится, иначе
        // cooldown замолчал бы проблему, о которой никто не узнал.
        suppressed.push(problem.code);
      }
    }

    // Восстановления: проблема, о которой СООБЩАЛИ, исчезла из отчёта.
    for (const [code, state] of [...this.active.entries()]) {
      if (seen.has(code)) continue;
      this.active.delete(code);
      if (state.notifiedAtMs === null) continue; // не сообщали — нечего восстанавливать
      const downSeconds = Math.max(0, Math.round((nowMs - state.firstSeenAtMs) / 1000));
      const delivered = await this.deliver(formatRecoveryText(code, downSeconds), `${code}_RECOVERED`);
      if (delivered) {
        this.recovered += 1;
        recovered.push(code);
      }
    }

    return { sent, suppressed, recovered };
  }

  /** Доставка с поглощением ошибки: Telegram не имеет права ронять монитор. */
  async deliver(text, code) {
    try {
      const result = await this.sendFn(text, code);
      const ok = result === undefined ? true : Boolean(result?.ok ?? result?.delivered ?? false);
      this.log({ event: 'health_alert', code, result: ok ? 'sent' : 'not_delivered' });
      return ok;
    } catch (error) {
      this.log({ event: 'health_alert', code, result: 'failure', message: String(error?.message ?? error).slice(0, 200) });
      return false;
    }
  }
}

/**
 * Получатели health-alert'ов: АДМИНЫ с включённым Telegram.
 *
 * Health — операционное событие, а не торговый сигнал: рассылать его всем
 * пользователям было бы и шумом, и утечкой эксплуатационного состояния.
 */
export async function listHealthAlertRecipients() {
  const { rows } = await query(
    `SELECT nc.user_id
       FROM notification_channels nc
       JOIN users u ON u.id = nc.user_id
      WHERE nc.telegram_enabled = true AND u.role = 'admin'`
  );
  return rows.map((r) => r.user_id);
}

/**
 * Отправка через существующий Telegram delivery layer.
 * Возвращает `{ ok }` — ok=true, если доставлено хотя бы одному админу.
 */
export async function dispatchHealthTelegram(text, code) {
  const recipients = await listHealthAlertRecipients();
  if (recipients.length === 0) return { ok: false, recipients: 0 };
  const settled = await Promise.allSettled(
    recipients.map((userId) => deliverSavedTelegram(userId, { eventType: `HEALTH_${code}`, text }))
  );
  const ok = settled.some((s) => s.status === 'fulfilled' && s.value?.ok === true);
  return { ok, recipients: recipients.length };
}

let singleton = null;

/** @returns {HealthAlerter} */
export function getHealthAlerter() {
  if (!singleton) singleton = new HealthAlerter();
  return singleton;
}

export function resetHealthAlerter() {
  singleton = null;
}
