/**
 * CRYPTORA — Привязка health-alert'ов к СУЩЕСТВУЮЩЕМУ циклу.
 *
 * Отдельного `setInterval` ради health НЕТ. Монитор сигналов уже тикает
 * каждые 30 секунд; по завершении его тика вызывается этот хук, он собирает
 * отчёт и отдаёт его alert-движку.
 *
 * Хук:
 *  • регистрируется ТОЛЬКО в production-входе (server/index.js). Тесты и
 *    импорт модуля монитора никого не уведомляют;
 *  • никогда не бросает наружу: вызов из монитора — fire-and-forget,
 *    ошибка Telegram/БД не может прервать наблюдение за сигналами;
 *  • сам себя троттлит: проверка не чаще `minIntervalMs`, чтобы частый цикл
 *    не превращался в частый `SELECT 1`.
 */

let hook = null;

/** @param {null | (() => Promise<void>|void)} fn */
export function registerHealthAlertHook(fn) {
  hook = typeof fn === 'function' ? fn : null;
}

/** Вызов из уже существующего цикла. Никогда не бросает и ничего не ждёт. */
export function notifyHealthCycle() {
  if (!hook) return;
  try {
    Promise.resolve(hook()).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[health-alert-hook]', JSON.stringify({ result: 'failure', message: String(error?.message ?? error).slice(0, 200) }));
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[health-alert-hook]', JSON.stringify({ result: 'failure', message: String(error?.message ?? error).slice(0, 200) }));
  }
}

/**
 * Готовый хук для production: собрать отчёт и прогнать alert-движок,
 * но не чаще одного раза в `minIntervalMs`.
 *
 * @param {object} p
 * @param {() => Promise<{body:object}>} p.buildReport
 * @param {{ evaluate: (report:object) => Promise<any> }} p.alerter
 * @param {number} [p.minIntervalMs]
 * @param {() => number} [p.now]
 */
export function createThrottledHealthAlertHook({ buildReport, alerter, minIntervalMs = 60_000, now = () => Date.now() }) {
  let lastRunMs = 0;
  let inFlight = false;
  return async () => {
    const t = now();
    if (inFlight || t - lastRunMs < minIntervalMs) return;
    inFlight = true;
    lastRunMs = t;
    try {
      const { body } = await buildReport();
      await alerter.evaluate(body);
    } finally {
      inFlight = false;
    }
  };
}
