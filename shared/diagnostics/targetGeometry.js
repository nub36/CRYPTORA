/**
 * CRYPTORA — READ-ONLY диагностика геометрии целей (TP/SL) сохранённых сигналов.
 *
 * ⚠️ ЭТО НЕ СТРАТЕГИЯ И НЕ ЕЁ МАТЕМАТИКА.
 *
 * Здесь нет ни одной формулы, которая создаёт уровни. Модуль умеет ровно одно:
 * взять УЖЕ СОХРАНЁННЫЕ уровни (entryLow, entryHigh, stop, tp1, tp2) и
 * посчитать по ним производные величины — risk, reward, R-мультипликаторы и
 * список структурных нарушений. Уровни не изменяются, не «исправляются» и не
 * округляются.
 *
 * Зачем отдельный модуль, а не код внутри скрипта:
 *  • его можно покрыть модульными тестами без БД и без движка;
 *  • один и тот же расчёт используется CLI-диагностикой и тестами, поэтому
 *    «цифра в отчёте» и «цифра в тесте» не могут разойтись.
 *
 * ── ЧТО ТАКОЕ R ЗДЕСЬ ────────────────────────────────────────────────────────
 * Замороженные раннеры V3.0/V3.3 (`manageTrade`) считают risk от ФАКТИЧЕСКОЙ
 * цены исполнения: `risk = |fill − stop|`, где fill — ХУДШАЯ граница коридора
 * (LONG → entryHigh, SHORT → entryLow). Поэтому здесь считаются ТРИ якоря, а не
 * один, и они подписаны явно:
 *
 *   mid  — середина зоны входа (entryLow + entryHigh) / 2   ← якорь из ТЗ аудита
 *   near — лучшая для сделки граница (LONG → entryLow,  SHORT → entryHigh)
 *   far  — худшая граница = фактический fill раннера
 *          (LONG → entryHigh, SHORT → entryLow)             ← якорь стратегии
 *
 * `far` — это то, что реально попадает в статистику стратегии. `mid` — то, что
 * обычно видит пользователь. Их расхождение само по себе диагностично.
 *
 * ── СТРУКТУРНОЕ ПОВРЕЖДЕНИЕ vs ПЛОХОЙ R:R ───────────────────────────────────
 * Разделение сознательное и завязано на exit-код CLI:
 *  • STRUCTURAL — запись внутренне противоречива (цель не с той стороны, стоп
 *    не с той стороны, TP2 не дальше TP1, риск ≤ 0, NaN/пропуск уровня).
 *    Такую строку нельзя интерпретировать вообще;
 *  • QUALITY — запись корректна, но её R:R плохой (TP1 очень близко, TP2 очень
 *    далеко, широкая зона входа). Это НЕ повреждение и НЕ повод падать.
 */

/** Коды нарушений, при которых запись внутренне противоречива. */
export const STRUCTURAL_CODES = Object.freeze([
  'MISSING_LEVEL',
  'NON_FINITE_LEVEL',
  'ENTRY_ZONE_INVERTED',
  'STOP_ON_WRONG_SIDE',
  'TP1_ON_WRONG_SIDE',
  'TP2_ON_WRONG_SIDE',
  'TP_ORDER_INVERTED',
  'NON_POSITIVE_RISK',
  'UNKNOWN_DIRECTION',
]);

/** Коды «качества»: геометрия валидна, но соотношение плохое. */
export const QUALITY_CODES = Object.freeze([
  'TP1_VERY_CLOSE',
  'TP2_VERY_FAR',
  'WIDE_ENTRY_ZONE',
]);

/**
 * Пороги эвристик качества. Это НЕ пороги стратегии и они ни на что не влияют,
 * кроме пометки в отчёте: стратегия минимального R не знает (проверено кодом
 * v30Core/v33Core — там нет ни одного сравнения с min R:R).
 */
export const QUALITY_THRESHOLDS = Object.freeze({
  /** TP1 ближе этого числа R от середины зоны — «аномально близко». */
  tp1CloseR: 0.25,
  /** TP2 дальше этого числа R — «аномально далеко». */
  tp2FarR: 10,
  /** Ширина зоны входа в долях риска (|entryHigh − entryLow| / risk_mid). */
  wideZoneRiskFrac: 0.5,
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Перцентиль методом линейной интерполяции по отсортированному массиву
 * (тот же метод, что у `numpy.percentile` с linear и у R type 7).
 *
 * @param {readonly number[]} sorted отсортированный по возрастанию массив
 * @param {number} p доля в [0, 1]
 * @returns {number|null} null для пустого массива
 */
export function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Сводка распределения. Пустая выборка даёт count = 0 и null во всех
 * статистиках: «нет данных» никогда не превращается в 0.
 *
 * @param {readonly number[]} values
 */
export function summarize(values) {
  const clean = (Array.isArray(values) ? values : []).filter(isNum).slice().sort((a, b) => a - b);
  if (clean.length === 0) {
    return { count: 0, min: null, p10: null, p25: null, median: null, p75: null, p90: null, max: null, mean: null };
  }
  const sum = clean.reduce((s, x) => s + x, 0);
  return {
    count: clean.length,
    min: clean[0],
    p10: percentile(clean, 0.10),
    p25: percentile(clean, 0.25),
    median: percentile(clean, 0.50),
    p75: percentile(clean, 0.75),
    p90: percentile(clean, 0.90),
    max: clean[clean.length - 1],
    mean: sum / clean.length,
  };
}

/**
 * Доли выборки ниже/выше порогов R. Возвращает count и pct по каждому порогу.
 * pct = null при пустой выборке (а не 0).
 *
 * @param {readonly number[]} values
 * @param {readonly number[]} [thresholds]
 */
export function thresholdShares(values, thresholds = [0.25, 0.5, 1.0]) {
  const clean = (Array.isArray(values) ? values : []).filter(isNum);
  const n = clean.length;
  const below = thresholds.map((t) => {
    const c = clean.filter((v) => v < t).length;
    return { threshold: t, count: c, pct: n === 0 ? null : (c / n) * 100 };
  });
  const atLeastOne = clean.filter((v) => v >= 1).length;
  return {
    n,
    below,
    atLeastOneR: { count: atLeastOne, pct: n === 0 ? null : (atLeastOne / n) * 100 },
  };
}

/**
 * Геометрия одного сохранённого сигнала.
 *
 * Вход — РОВНО то, что лежит в БД. Функция чистая: ничего не читает и не пишет.
 *
 * @param {{
 *   id?: string, symbol?: string, direction?: string, timeframe?: string,
 *   strategyVersion?: string|null,
 *   entryLow?: number|null, entryHigh?: number|null,
 *   stop?: number|null, tp1?: number|null, tp2?: number|null,
 * }} input
 */
export function analyzeSignalGeometry(input) {
  const {
    id = null, symbol = null, direction: rawDirection = null, timeframe = null,
    strategyVersion = null, entryLow, entryHigh, stop, tp1, tp2,
  } = input ?? {};

  const direction = rawDirection === 'LONG' || rawDirection === 'SHORT' ? rawDirection : null;
  const structural = [];
  const quality = [];

  const levels = { entryLow, entryHigh, stop, tp1, tp2 };
  const missing = Object.entries(levels)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  const nonFinite = Object.entries(levels)
    .filter(([, v]) => v !== null && v !== undefined && !isNum(v))
    .map(([k]) => k);

  if (direction === null) structural.push('UNKNOWN_DIRECTION');
  if (missing.length > 0) structural.push('MISSING_LEVEL');
  if (nonFinite.length > 0) structural.push('NON_FINITE_LEVEL');

  const base = {
    id, symbol, direction, timeframe, strategyVersion,
    entryLow: isNum(entryLow) ? entryLow : null,
    entryHigh: isNum(entryHigh) ? entryHigh : null,
    stop: isNum(stop) ? stop : null,
    tp1: isNum(tp1) ? tp1 : null,
    tp2: isNum(tp2) ? tp2 : null,
    entryMid: null, zoneWidth: null, zoneWidthPct: null, zoneWidthInRisk: null,
    riskMid: null, riskNear: null, riskFar: null,
    reward1Mid: null, reward2Mid: null,
    r1Mid: null, r2Mid: null, r1Near: null, r2Near: null, r1Far: null, r2Far: null,
    missingLevels: missing,
    nonFiniteLevels: nonFinite,
    structural,
    quality,
    ok: false,
  };

  if (direction === null || missing.length > 0 || nonFinite.length > 0) return base;

  const long = direction === 'LONG';

  if (!(entryHigh >= entryLow)) structural.push('ENTRY_ZONE_INVERTED');

  const entryMid = (entryLow + entryHigh) / 2;
  // near — лучшая граница для сделки, far — худшая (= fill замороженного раннера).
  const near = long ? entryLow : entryHigh;
  const far = long ? entryHigh : entryLow;

  const riskOf = (anchor) => (long ? anchor - stop : stop - anchor);
  const rewardOf = (anchor, target) => (long ? target - anchor : anchor - target);

  const riskMid = riskOf(entryMid);
  const riskNear = riskOf(near);
  const riskFar = riskOf(far);

  if (!(riskMid > 0)) structural.push('STOP_ON_WRONG_SIDE', 'NON_POSITIVE_RISK');

  if (long ? !(tp1 > entryMid) : !(tp1 < entryMid)) structural.push('TP1_ON_WRONG_SIDE');
  if (long ? !(tp2 > entryMid) : !(tp2 < entryMid)) structural.push('TP2_ON_WRONG_SIDE');
  if (long ? !(tp2 > tp1) : !(tp2 < tp1)) structural.push('TP_ORDER_INVERTED');

  const div = (reward, risk) => (risk > 0 ? reward / risk : null);

  const out = {
    ...base,
    entryMid,
    zoneWidth: entryHigh - entryLow,
    zoneWidthPct: entryMid !== 0 ? ((entryHigh - entryLow) / Math.abs(entryMid)) * 100 : null,
    zoneWidthInRisk: riskMid > 0 ? (entryHigh - entryLow) / riskMid : null,
    riskMid, riskNear, riskFar,
    reward1Mid: rewardOf(entryMid, tp1),
    reward2Mid: rewardOf(entryMid, tp2),
    r1Mid: div(rewardOf(entryMid, tp1), riskMid),
    r2Mid: div(rewardOf(entryMid, tp2), riskMid),
    r1Near: div(rewardOf(near, tp1), riskNear),
    r2Near: div(rewardOf(near, tp2), riskNear),
    r1Far: div(rewardOf(far, tp1), riskFar),
    r2Far: div(rewardOf(far, tp2), riskFar),
    structural,
    quality,
  };

  // Эвристики качества считаются ТОЛЬКО для структурно валидной записи:
  // у противоречивой геометрии «плохой R:R» не имеет смысла.
  if (structural.length === 0) {
    if (out.r1Mid !== null && out.r1Mid < QUALITY_THRESHOLDS.tp1CloseR) quality.push('TP1_VERY_CLOSE');
    if (out.r2Mid !== null && out.r2Mid > QUALITY_THRESHOLDS.tp2FarR) quality.push('TP2_VERY_FAR');
    if (out.zoneWidthInRisk !== null && out.zoneWidthInRisk > QUALITY_THRESHOLDS.wideZoneRiskFrac) {
      quality.push('WIDE_ENTRY_ZONE');
    }
  }

  out.ok = structural.length === 0;
  return out;
}

/**
 * Пакетный разбор. Возвращает построчные результаты и агрегаты по R1/R2
 * (якорь mid, как просит ТЗ аудита; far/near доступны построчно).
 *
 * @param {readonly object[]} rows
 */
export function analyzeSignalBatch(rows) {
  const results = (Array.isArray(rows) ? rows : []).map(analyzeSignalGeometry);
  const valid = results.filter((r) => r.ok);
  const r1 = valid.map((r) => r.r1Mid).filter(isNum);
  const r2 = valid.map((r) => r.r2Mid).filter(isNum);
  const r1Far = valid.map((r) => r.r1Far).filter(isNum);
  const r2Far = valid.map((r) => r.r2Far).filter(isNum);

  const counts = {};
  for (const code of [...STRUCTURAL_CODES, ...QUALITY_CODES]) counts[code] = 0;
  for (const r of results) {
    for (const c of r.structural) counts[c] = (counts[c] ?? 0) + 1;
    for (const c of r.quality) counts[c] = (counts[c] ?? 0) + 1;
  }

  return {
    total: results.length,
    structurallyValid: valid.length,
    structurallyBroken: results.length - valid.length,
    r1Mid: summarize(r1),
    r2Mid: summarize(r2),
    r1Far: summarize(r1Far),
    r2Far: summarize(r2Far),
    r1Shares: thresholdShares(r1),
    r2Shares: thresholdShares(r2),
    anomalyCounts: counts,
    results,
  };
}

/**
 * Группировка построчных результатов по произвольному ключу с теми же
 * агрегатами. Пустая группа не создаётся.
 *
 * @param {readonly object[]} results результат `analyzeSignalGeometry`
 * @param {(r: object) => string} keyOf
 */
export function groupStats(results, keyOf) {
  const buckets = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    const key = keyOf(r) ?? '—';
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const out = [];
  for (const [key, list] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const valid = list.filter((r) => r.ok);
    const r1 = valid.map((r) => r.r1Mid).filter(isNum);
    const r2 = valid.map((r) => r.r2Mid).filter(isNum);
    out.push({
      key,
      total: list.length,
      structurallyValid: valid.length,
      r1: summarize(r1),
      r2: summarize(r2),
      r1Shares: thresholdShares(r1),
      r2Shares: thresholdShares(r2),
    });
  }
  return out;
}

/**
 * Классификация исхода по `close_reason` замороженного ядра.
 *
 * ВАЖНО: в БД нет отдельного факта «TP1 достигнут» — есть только ПРИЧИНА
 * финального выхода (`manageTrade` возвращает один из шести литералов).
 * Поэтому «TP1 hit» ВЫВОДИТСЯ: он истинен для TP2 и для всех TP1_THEN_*.
 * Это не догадка, а прямое следствие кода `manageTrade`
 * (v30Core.ts / v33Core.ts): без факта TP1 эти литералы недостижимы.
 *
 * @param {string|null|undefined} closeReason
 * @returns {{tp1: boolean|null, tp2: boolean|null, sl: boolean|null, trade: boolean|null, known: boolean}}
 */
export function classifyOutcome(closeReason) {
  const r = typeof closeReason === 'string' ? closeReason : null;
  if (r === null || r.length === 0) return { tp1: null, tp2: null, sl: null, trade: null, known: false };
  switch (r) {
    case 'TP2':
      return { tp1: true, tp2: true, sl: false, trade: true, known: true };
    case 'TP1_THEN_BE':
      // Стоп был переведён в безубыток ПОСЛЕ TP1 — это не срабатывание
      // исходного SL: половина позиции закрыта в плюс, остаток в ноль.
      return { tp1: true, tp2: false, sl: false, trade: true, known: true };
    case 'TP1_THEN_SL':
      return { tp1: true, tp2: false, sl: true, trade: true, known: true };
    case 'TP1_THEN_TIMEOUT':
      return { tp1: true, tp2: false, sl: false, trade: true, known: true };
    case 'SL':
      return { tp1: false, tp2: false, sl: true, trade: true, known: true };
    case 'TIMEOUT':
      return { tp1: false, tp2: false, sl: false, trade: true, known: true };
    case 'EXPIRED':
    case 'CANCELLED':
    case 'REJECTED_GEOMETRY':
    case 'OUT_OF_DATA_WINDOW':
      return { tp1: null, tp2: null, sl: null, trade: false, known: true };
    default:
      return { tp1: null, tp2: null, sl: null, trade: null, known: false };
  }
}

/**
 * Сводка исходов по набору строк (status + close_reason).
 *
 * Знаменатель hit-rate — только сделки, которые СОСТОЯЛИСЬ и РАЗРЕШИЛИСЬ
 * (`trade === true`). Незавершённые и безсделковые в него не попадают, поэтому
 * hit-rate не «разбавляется» истёкшими коридорами.
 *
 * @param {readonly {status?: string|null, closeReason?: string|null}[]} rows
 */
export function summarizeOutcomes(rows) {
  const out = {
    total: 0,
    open: 0,
    entered: 0,
    noTrade: 0,
    resolvedTrades: 0,
    unknownReason: 0,
    byReason: {},
    byStatus: {},
    tp1Hits: 0,
    tp2Hits: 0,
    slHits: 0,
    tp1HitRatePct: null,
    tp2HitRatePct: null,
    slRatePct: null,
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    out.total += 1;
    const status = typeof row?.status === 'string' ? row.status : 'UNKNOWN';
    out.byStatus[status] = (out.byStatus[status] ?? 0) + 1;
    if (status === 'ACTIVE' || status === 'FILLED') out.open += 1;
    if (status === 'FILLED') out.entered += 1;

    const reason = typeof row?.closeReason === 'string' && row.closeReason.length > 0 ? row.closeReason : null;
    if (reason !== null) out.byReason[reason] = (out.byReason[reason] ?? 0) + 1;

    const c = classifyOutcome(reason);
    if (!c.known && reason !== null) out.unknownReason += 1;
    if (c.trade === false) out.noTrade += 1;
    if (c.trade === true) {
      out.resolvedTrades += 1;
      out.entered += 1;
      if (c.tp1) out.tp1Hits += 1;
      if (c.tp2) out.tp2Hits += 1;
      if (c.sl) out.slHits += 1;
    }
  }
  if (out.resolvedTrades > 0) {
    out.tp1HitRatePct = (out.tp1Hits / out.resolvedTrades) * 100;
    out.tp2HitRatePct = (out.tp2Hits / out.resolvedTrades) * 100;
    out.slRatePct = (out.slHits / out.resolvedTrades) * 100;
  }
  return out;
}

/**
 * Достаточно ли знаков у сохранённого уровня, чтобы отличить его от соседнего
 * тика инструмента. Проверяет ФАКТ ХРАНЕНИЯ, а не отображение.
 *
 * @param {number} price
 * @param {number} [significantDigits]
 * @returns {{ok: boolean, significantDigits: number|null, reason: string|null}}
 */
export function priceResolution(price, significantDigits = 6) {
  if (!isNum(price) || price === 0) {
    return { ok: false, significantDigits: null, reason: 'NOT_A_FINITE_NONZERO_PRICE' };
  }
  // Сколько значащих цифр реально записано (без хвостовых нулей).
  // `toExponential()` БЕЗ аргумента даёт кратчайшее round-trip представление,
  // поэтому двоичный шум (0.00000812 → 8.12000000000000042e-6 при фиксированной
  // точности) не считается «значащими цифрами».
  const s = Math.abs(price).toExponential();
  const mantissa = s.slice(0, s.indexOf('e')).replace('.', '').replace(/0+$/, '');
  const digits = Math.max(1, mantissa.length);
  return {
    ok: digits >= significantDigits,
    significantDigits: digits,
    reason: digits >= significantDigits ? null : 'FEWER_SIGNIFICANT_DIGITS_THAN_REQUIRED',
  };
}
