/**
 * CRYPTORA — Каталог продуктовых стратегий (серверная сторона).
 *
 * ⚠️ Значения сверены с фактической реализацией, а не скопированы из ТЗ:
 *   src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/definition.ts:128
 *   src/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/definition.ts:168
 *   src/services/strategyArchive/definitions/v2_8-zero-fee-sniper-trailing/definition.ts:175
 *
 * Здесь ТОЛЬКО презентационные и операционные метаданные. Математика стратегий
 * (пороги RVOL, wick/body, ATR, коридоры, цели) живёт в коде определений и
 * отсюда не меняется.
 *
 * РОВНО ТРИ стратегии. Четвёртой нет и через API она не появится: id зашиты в
 * PRIMARY KEY и CHECK-ограничение таблицы strategy_settings (миграция 006).
 */

/** @typedef {'RESEARCH'|'TRAIN_ONLY'|'GROSS_ONLY'} StrategyBadge */

/**
 * @typedef {object} ProductStrategy
 * @property {string} id       — registry id, ключ strategy_settings
 * @property {string} version  — «3.0» / «3.3» / «2.8»
 * @property {string} name     — имя из определения
 * @property {string} nameRu   — русское имя из определения
 * @property {string[]} timeframes — ВСЕ серии, которые стратегия реально
 *   использует (исполнение + структурный контекст). Именно они греются
 *   серверным движком перед сканом.
 * @property {string} execTimeframe — таймфрейм ИСПОЛНЕНИЯ: бар, на котором
 *   формируется и публикуется сетап (`EXEC_TIMEFRAME` ядра = '1h' для всех трёх
 *   стратегий). Это то, что должен видеть пользователь и будущий Signals UI.
 * @property {string[]} contextTimeframes — старшие серии, которые стратегия
 *   читает как контекст (зоны/структура), но на которых сетапы НЕ формируются.
 * @property {string[]} defaultSymbols
 * @property {number} defaultScanIntervalSeconds
 * @property {StrategyBadge} badge
 */

/** @type {readonly ProductStrategy[]} */
export const PRODUCT_STRATEGIES = [
  {
    id: 'V3_0_HTF_LIQUIDATION_TRAP',
    version: '3.0',
    name: 'HTF Liquidation Trap',
    nameRu: 'Ловушка ликвидности на старшем таймфрейме',
    timeframes: ['1h', '4h'],
    // Сетап формируется и публикуется на закрытом 1h-баре; 4h — свип/структура.
    execTimeframe: '1h',
    contextTimeframes: ['4h'],
    defaultSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'],
    defaultScanIntervalSeconds: 60,
    badge: 'RESEARCH',
  },
  {
    id: 'V3_3_HTF_ZONE_MITIGATION',
    version: '3.3',
    name: 'HTF Zone Mitigation & LTF Squeeze',
    nameRu: 'Митигация зоны старшего таймфрейма и сжатие на младшем',
    timeframes: ['1h', '4h'],
    // Зона строится на 4h, митигация и публикация — на закрытом 1h-баре.
    execTimeframe: '1h',
    contextTimeframes: ['4h'],
    defaultSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'],
    defaultScanIntervalSeconds: 60,
    badge: 'TRAIN_ONLY',
  },
  {
    id: 'V2_8_ZERO_FEE_SNIPER_TRAILING',
    version: '2.8',
    name: 'Zero-fee Sniper + Trailing (gross-only)',
    nameRu: 'Снайпер + трейлинг при нулевых комиссиях (только gross)',
    // F-08: здесь было ['15m'] — значение из ТЗ исследования, а не из кода.
    // LIVE-движок исполняет V2.8 на 1h (EXEC_TIMEFRAME ядра), дневная серия
    // нужна только как контекст (`needs1d = strategies.includes('V2.8')` →
    // provider.getCandles(symbol, '1D', CANDLE_LIMIT_1D)). Алгоритм не менялся:
    // исправлены МЕТАДАННЫЕ, чтобы пользователь и будущий Signals UI видели
    // фактический таймфрейм исполнения. Литерал '1D' — продуктовый Timeframe
    // (src/types/market.ts); к interval биржи его приводит marketDataFetcher.
    timeframes: ['1h', '4h', '1D'],
    execTimeframe: '1h',
    contextTimeframes: ['4h', '1D'],
    defaultSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'],
    defaultScanIntervalSeconds: 60,
    badge: 'GROSS_ONLY',
  },
];

/** Множество допустимых id — тот же список, что в CHECK-ограничении 006. */
export const KNOWN_STRATEGY_IDS = new Set(PRODUCT_STRATEGIES.map((s) => s.id));

/** @param {string} id */
export function getStrategy(id) {
  return PRODUCT_STRATEGIES.find((s) => s.id === id) ?? null;
}

/**
 * Короткая версия для публичного API. Внутренние исследовательские поля
 * (варианты, артефакты, sha256, funnel) наружу не отдаются.
 */
export function isKnownStrategyId(id) {
  return typeof id === 'string' && KNOWN_STRATEGY_IDS.has(id);
}

/**
 * Человекочитаемая подпись статуса верификации.
 *
 * ⚠️ НИКОГДА не утверждать «рабочая», «прибыльная» или «проверенная в live»:
 * ни одна стратегия не прошла live-валидацию.
 */
export const BADGE_LABELS = {
  RESEARCH: 'Research validated',
  TRAIN_ONLY: 'Train only',
  GROSS_ONLY: 'Gross-only validated',
};
