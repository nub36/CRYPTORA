/**
 * CRYPTORA — Адаптер «строка БД → опубликованный сетап» для серверного
 * монитора позиций.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Ведение опубликованного сетапа уже реализовано и заморожено:
 *   `src/services/signals/live/lifecycle.ts` → `trackPublishedSetup(entry, h1)`
 *   • V3.0 / V3.3: `corridorStep` (N+1…N+3) → `manageTrade` версии;
 *   • V2.8:        `v28EntryAtNextOpen` → `v28TrailOutcome`.
 * Браузерный движок вызывает её же (`LiveSignalEngine.trackOpenSetups`), а
 * серверный движок получает fill/outcome из LIVE-реплеев, которые используют те
 * же frozen-функции. Монитор позиций обязан идти тем же путём: копия правил
 * выхода здесь — это ровно тот класс дефекта, который породил баг V3.3 на проде
 * (живой адаптер считал уровни иначе, чем определение).
 *
 * ПОЭТОМУ В ЭТОМ ФАЙЛЕ НЕТ НИ ОДНОЙ ФОРМУЛЫ. Только перевод формы: строка
 * PostgreSQL (`mapRow` из signalRepository) → `AnalyticalSetup`, который
 * принимает frozen-функция. Все уровни, R, статусы и причины выхода приходят
 * отсюда же и не пересчитываются.
 */

import { SIGNAL_STATUSES } from '../signalRepository.js';

/**
 * @typedef {object} SignalRow строка `signals` в форме mapRow() (camelCase)
 */

/** Стратегии, которых ведёт frozen-функция `trackPublishedSetup`. */
export const TRACKED_STRATEGY_IDS = Object.freeze([
  'V3_0_HTF_LIQUIDATION_TRAP',
  'V3_3_HTF_ZONE_MITIGATION',
  'V2_8_ZERO_FEE_SNIPER_TRAILING',
]);

/**
 * Форма публикации, которую ожидает `trackPublishedSetup`.
 *
 * Поля `riskRewardRatio`, `confirmingFactors`, `invalidationFactors`,
 * `createdAt`, `latencyBars`, `prevHash`, `auditHash` frozen-функция не читает,
 * но тип `AnalyticalSetup` их требует; заполняются из строки, а не выдумываются.
 *
 * @param {SignalRow} row
 * @returns {{ok: true, entry: object} | {ok: false, reason: string}}
 */
export function toPublishedSetup(row) {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'EMPTY_ROW' };
  if (!TRACKED_STRATEGY_IDS.includes(row.strategyId)) {
    return { ok: false, reason: `UNTRACKED_STRATEGY ${String(row.strategyId)}` };
  }
  if (!SIGNAL_STATUSES.includes(row.status)) {
    return { ok: false, reason: `UNKNOWN_STATUS ${String(row.status)}` };
  }

  const setupOpenTime = new Date(row.signalCandleTs).getTime();
  if (!Number.isFinite(setupOpenTime)) return { ok: false, reason: 'NO_SETUP_TIME' };

  const entryMin = row.entryMin;
  const entryMax = row.entryMax;
  if (typeof entryMin !== 'number' || !Number.isFinite(entryMin)) {
    return { ok: false, reason: 'NO_ENTRY_ZONE' };
  }
  if (typeof row.stopLoss !== 'number' || !Number.isFinite(row.stopLoss)) {
    return { ok: false, reason: 'NO_STOP' };
  }
  const targets = Array.isArray(row.targets) ? row.targets.filter((t) => Number.isFinite(t)) : [];
  if (targets.length === 0) return { ok: false, reason: 'NO_TARGETS' };

  // Уже исполненная строка: эффективные уровни после сдвига на дельту входа.
  // Frozen-функция всё равно пересчитывает путь от бара сетапа (это детерминировано
  // и идемпотентно), поэтому уровень публикации остаётся источником для входа.
  const entry = {
    id: row.engineSetupId ?? `db-${row.id}`,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion ?? null,
    symbol: row.symbol,
    direction: row.direction,
    timeframe: row.timeframe,
    setupOpenTime,
    entryType: row.entryType,
    entryZone: [entryMin, typeof entryMax === 'number' ? entryMax : entryMin],
    invalidationLevel: row.stopLoss,
    targets,
    riskRewardRatio: row.metadata?.riskRewardRatio ?? 0,
    confirmingFactors: Array.isArray(row.metadata?.confirmingFactors)
      ? row.metadata.confirmingFactors
      : [],
    invalidationFactors: Array.isArray(row.metadata?.invalidationFactors)
      ? row.metadata.invalidationFactors
      : [],
    exitRule: row.exitRule ?? '',
    validForBars: row.validForBars ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date(setupOpenTime).toISOString(),
    latencyBars: row.metadata?.latencyBars ?? 0,
    status: row.status,
    prevHash: row.previousHash ?? 'GENESIS',
    auditHash: row.hash ?? 'GENESIS',
    ...(row.fillPrice != null && row.filledAt
      ? {
          fill: {
            price: row.fillPrice,
            at: new Date(row.filledAt).toISOString(),
            barOpenTime: new Date(row.filledAt).getTime(),
            ...(Number.isFinite(row.fillStop) ? { stop: row.fillStop } : {}),
            ...(Array.isArray(row.fillTargets) ? { targets: row.fillTargets } : {}),
          },
        }
      : {}),
  };
  return { ok: true, entry };
}

/**
 * Результат frozen-функции → то, что умеет писать репозиторий.
 *
 * `syncSignalLifecycle` принимает `fill` и `outcome` в форме ядра; монитор
 * передаёт их БЕЗ ИЗМЕНЕНИЙ. Единственное добавление — `closedAt`: форма
 * `SetupOutcome.closedAt` ядра — это ISO-время ЗАКРЫТИЯ бара исхода, и её
 * оставляет как есть (движок скана делает то же самое).
 *
 * @param {{kind: string, fill?: object, outcome?: object, reason?: string}} result
 * @returns {{fill: object|null, outcome: object|null}}
 */
export function toLifecyclePatch(result) {
  return {
    fill: result?.fill ?? null,
    outcome: result?.outcome ?? null,
  };
}
