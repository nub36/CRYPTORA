/**
 * CRYPTORA — Происхождение сигнала (provenance) и правила допуска.
 *
 * ПОЧЕМУ ЭТОТ МОДУЛЬ СУЩЕСТВУЕТ ОТДЕЛЬНО
 * ---------------------------------------
 * Инцидент 2026-09-24: один и тот же payload (направление / зона входа / стоп /
 * цели / `signal_candle_ts`) оказался записан под тремя разными `strategy_id`.
 * Причина — инфраструктурная (разделяемый singleton `SignalsAuditLedger`,
 * читаемый ПОСЛЕ первого `await`, плюс параллельные тики планировщика), а не
 * математика стратегий. Но СЛЕДСТВИЕ лежит в данных: у части строк
 * `strategy_id` (чей сигнал по записи) не совпадает с тем, какая стратегия его
 * реально сгенерировала.
 *
 * Здесь собраны ВСЕ правила, отвечающие на вопрос «можно ли эту строку
 * использовать», чтобы они не расходились между монитором, статистикой и
 * процедурой классификации. Одно правило — одно место.
 *
 * ГЛАВНОЕ
 * -------
 * Доказательство происхождения — `engine_setup_id`. Его формат фиксирован
 * (`src/services/signals/live/LiveSignalEngine.ts`):
 *
 *     `${strategyId}-${symbol.toUpperCase()}-${setupOpenTime}`
 *
 * поэтому префикс до первого `-` — это идентификатор стратегии, которая РЕАЛЬНО
 * создала сетап. Три исхода и только три:
 *
 *   VERIFIED — префикс совпадает с сохранённым `strategy_id`.
 *              Запись согласна с генератором. Это доказуемый MATCH.
 *   MISMATCH — префикс есть, но это ДРУГОЙ `strategy_id`.
 *              Строка перемаркирована. Доказательство прямое: генератор
 *              известен, и он не тот, кому приписан результат.
 *   UNKNOWN  — префикса нет или он не читается (NULL / пусто / без `-`).
 *              Доказательства НЕТ. UNKNOWN НИКОГДА не повышается до VERIFIED
 *              автоматически: «нет улик» ≠ «всё в порядке».
 *
 * FAIL-CLOSED ПО УМОЛЧАНИЮ
 * ------------------------
 * Мониторится и попадает в статистику ТОЛЬКО VERIFIED. MISMATCH и UNKNOWN
 * остаются в таблице (удалять и переписывать их запрещено: это доказательство
 * и часть хэш-цепочки), но не мониторятся и не считаются. Ошибка «не посчитали
 * свой результат» дешевле ошибки «посчитали чужой результат как свой».
 *
 * ЧЕГО ЗДЕСЬ НЕТ
 * --------------
 * Ничего из этого модуля не меняет `strategy_id`, `engine_setup_id`, уровни
 * сигнала, `hash`, `previous_hash` или `outcome_hash`. `provenance_status` не
 * входит в публикуемый payload (`hashPayloadV2`), поэтому простановка карантина
 * не ломает хэш-цепочку — это проверяется тестом.
 */

/** Домен `signals.provenance_status` (миграция 011). Порядок — как в CHECK. */
export const PROVENANCE_STATUSES = Object.freeze(['VERIFIED', 'MISMATCH', 'UNKNOWN']);

export const PROVENANCE_VERIFIED = 'VERIFIED';
export const PROVENANCE_MISMATCH = 'MISMATCH';
export const PROVENANCE_UNKNOWN = 'UNKNOWN';

/**
 * Разделитель в `engine_setup_id` — ровно тот, что использует ядро:
 * `${strategyId}-${symbol}-${setupOpenTime}`.
 */
const SETUP_ID_SEPARATOR = '-';

/**
 * Классификация УЖЕ СОХРАНЁННОЙ строки по единственному признаку:
 * префиксу `engine_setup_id`.
 *
 * Чистая функция — одинаково пригодна для тестов, для production-процедуры
 * (`scripts/signal-provenance-classify.mjs`) и для чтения кода человеком.
 *
 * @param {object} row
 * @param {string|null|undefined} row.strategyId сохранённый `strategy_id`
 * @param {string|null|undefined} row.engineSetupId сохранённый `engine_setup_id`
 * @returns {'VERIFIED'|'MISMATCH'|'UNKNOWN'}
 */
export function classifyProvenance(row) {
  const strategyId = typeof row?.strategyId === 'string' ? row.strategyId : '';
  const setupId = typeof row?.engineSetupId === 'string' ? row.engineSetupId.trim() : '';

  // Доказательства нет: пустой id сетапа, нет разделителя или нет самого
  // идентификатора стратегии. НИКАКИХ догадок «наверное, это strategy_id».
  if (!strategyId || !setupId) return PROVENANCE_UNKNOWN;

  const sep = setupId.indexOf(SETUP_ID_SEPARATOR);
  if (sep <= 0) return PROVENANCE_UNKNOWN;

  const generator = setupId.slice(0, sep);
  if (!generator) return PROVENANCE_UNKNOWN;

  return generator === strategyId ? PROVENANCE_VERIFIED : PROVENANCE_MISMATCH;
}

/**
 * Тот же классификатор в виде SQL-выражения — чтобы production-процедура
 * работала ОДНИМ UPDATE на всю таблицу (а не выгружала строки в Node) и чтобы
 * SQL и JS не разъехались.
 *
 * Логика построчно повторяет `classifyProvenance()`; тест
 * `tests/integration/signalProvenanceQuarantine.test.ts` сверяет обе реализации
 * на всех формах `engine_setup_id` и падает, если они расходятся.
 */
export const PROVENANCE_CASE_SQL = `
       CASE
         WHEN strategy_id IS NULL OR btrim(strategy_id) = '' THEN 'UNKNOWN'
         WHEN engine_setup_id IS NULL OR btrim(engine_setup_id) = '' THEN 'UNKNOWN'
         WHEN position('${SETUP_ID_SEPARATOR}' in engine_setup_id) <= 1 THEN 'UNKNOWN'
         WHEN split_part(engine_setup_id, '${SETUP_ID_SEPARATOR}', 1) = strategy_id THEN 'VERIFIED'
         ELSE 'MISMATCH'
       END`;

/**
 * Может ли монитор вести эту строку.
 *
 * Монитор доводит сетап до терминального исхода и пишет `result_r` в историю
 * стратегии. Для перемаркированной строки это означало бы записать ЧУЖОЙ исход
 * в репутацию стратегии: сетап создала одна стратегия, её логика выхода
 * (`exit_rule`) — её собственная, а результат достался бы другой. Поэтому
 * открытый MISMATCH не мониторится НИКОГДА, а UNKNOWN — пока не проверен явно.
 *
 * @param {object} row строка `signals`
 * @param {readonly string[]} openStatuses домен «открытых» статусов
 */
export function isMonitorEligible(row, openStatuses = ['ACTIVE', 'FILLED']) {
  if (!row) return false;
  if (row.provenanceStatus !== PROVENANCE_VERIFIED) return false;
  return openStatuses.includes(row.status);
}

/**
 * Может ли строка попадать в знаменатель win rate / R / сравнения стратегий.
 *
 * `result_r` посчитан ядром по логике СГЕНЕРИРОВАВШЕЙ стратегии, а приписан
 * `strategy_id` строки. Для MISMATCH это заведомо ложная атрибуция; для
 * UNKNOWN она не доказана. Исключаются обе.
 *
 * @param {object} row строка `signals`
 */
export function isStatisticsEligible(row) {
  return !!row && row.provenanceStatus === PROVENANCE_VERIFIED;
}

/**
 * Статус происхождения для НОВОГО сигнала — проверка ДО записи в БД.
 *
 * `setup.strategyId` — идентификатор, который поставило ядро, создавшее сетап.
 * `strategyId` — стратегия, от имени которой выполнялся скан. Совпали —
 * происхождение доказано. Не совпали — это и есть инцидент, такая строка не
 * должна существовать вовсе (код генерации не записывает её и поднимает счётчик
 * `provenanceMismatch`). Нет `setup.strategyId` — доказательства нет: строку
 * можно сохранить, но статус будет UNKNOWN, и она не будет ни мониториться, ни
 * считаться.
 *
 * @param {object} setup сетап из ядра
 * @param {string} strategyId стратегия, выполнявшая скан
 * @returns {{status: 'VERIFIED'|'UNKNOWN', mismatch: boolean, generator: string|null}}
 */
export function provenanceOfNewSignal(setup, strategyId) {
  const requested = typeof strategyId === 'string' ? strategyId : '';
  const generator = typeof setup?.strategyId === 'string' ? setup.strategyId : '';

  if (!requested) {
    return { status: PROVENANCE_UNKNOWN, mismatch: false, generator: generator || null };
  }
  if (generator && generator !== requested) {
    return { status: PROVENANCE_MISMATCH, mismatch: true, generator };
  }
  // generator === requested — доказано. generator пуст — доказательства нет.
  return { status: generator ? PROVENANCE_VERIFIED : PROVENANCE_UNKNOWN, mismatch: false, generator: generator || null };
}
