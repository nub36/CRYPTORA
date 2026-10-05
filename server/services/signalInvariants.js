/**
 * CRYPTORA — Инварианты сигнала (провенанс, время, жизненный цикл).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Эти правила нужны в трёх местах сразу: на записи
 * (`signalRepository.insertSignal`), в read-only аудите production
 * (`scripts/audit-production-health.mjs`) и в тестах. Три копии правила
 * разъехались бы; здесь оно одно.
 *
 * ЧТО ЭТО НЕ ДЕЛАЕТ. Здесь нет ни одной торговой формулы: ни уровней, ни R,
 * ни правил входа/выхода. Модуль отвечает ТОЛЬКО на вопрос «может ли такая
 * строка существовать», и никогда не «улучшает» значения.
 *
 * FAIL-CLOSED. Сомнительная строка не создаётся. Отказ записи дешевле,
 * чем сигнал, происхождение которого нельзя восстановить.
 */

/** Коды нарушений — закрытый домен, используется и в аудите, и в тестах. */
export const SIGNAL_INVARIANTS = Object.freeze({
  DEMO_PROVIDER: 'DEMO_PROVIDER',
  FUTURE_CANDLE: 'FUTURE_CANDLE',
  STALE_CANDLE: 'STALE_CANDLE',
  MISSING_PROVENANCE: 'MISSING_PROVENANCE',
  FILL_BEFORE_SETUP: 'FILL_BEFORE_SETUP',
  CLOSE_BEFORE_SETUP: 'CLOSE_BEFORE_SETUP',
  CLOSE_BEFORE_FILL: 'CLOSE_BEFORE_FILL',
  LIFECYCLE_REGRESSION: 'LIFECYCLE_REGRESSION',
});

/**
 * Сколько баров после бара сетапа сигнал ещё можно опубликовать.
 *
 * Политика, не математика: сетап, найденный по свече, закрывшейся много
 * баров назад, уже не является «текущим» — публиковать его как новый
 * значит выдавать историю за рынок. Порог осознанно мягкий (12 баров),
 * чтобы не отсекать легитимную задержку скана/рестарт бэкенда.
 */
export const MAX_SETUP_AGE_BARS = 12;

/** Допуск часов: расхождение времени сервера и биржи в пределах минуты — не «будущее». */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/** Длительность бара в мс по таймфрейму. Неизвестный таймфрейм → 0 (проверка возраста пропускается). */
export function timeframeDurationMs(timeframe) {
  const m = /^(\d+)\s*([mhdwMD])$/.exec(String(timeframe ?? '').trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === 'm') return n * 60_000;
  if (unit === 'h') return n * 3_600_000;
  if (unit === 'd' || unit === 'D') return n * 86_400_000;
  if (unit === 'w') return n * 604_800_000;
  if (unit === 'M') return n * 2_592_000_000;
  return 0;
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Монотонность жизненного цикла.
 *
 * Ранг отражает, насколько далеко сделка продвинулась. Откат назад
 * (CLOSED → ACTIVE, FILLED → ACTIVE) запрещён: это переписывание истории.
 * Терминальные состояния имеют одинаковый максимальный ранг — переход между
 * двумя терминальными статусами тоже запрещён (append-only).
 */
export const LIFECYCLE_RANK = Object.freeze({
  ACTIVE: 0,
  FILLED: 1,
  TARGET_REACHED: 2,
  INVALIDATED: 2,
  CLOSED: 2,
  EXPIRED: 2,
  CANCELLED: 2,
  UNRESOLVED: 2,
});

/**
 * Допустим ли переход статуса.
 * @returns {boolean} false — переход откатывает жизненный цикл назад.
 */
export function isMonotonicTransition(fromStatus, toStatus) {
  if (!toStatus || fromStatus === toStatus) return true;
  const from = LIFECYCLE_RANK[fromStatus];
  const to = LIFECYCLE_RANK[toStatus];
  if (from === undefined || to === undefined) return false;
  return to > from;
}

/**
 * ЖЁСТКИЕ инварианты — те, нарушение которых не может быть легитимным ни на
 * одном пути записи. Их проверяет сама граница персистентности
 * (`insertSignal`), и обойти её нельзя.
 *
 * Остальные инварианты (просроченная свеча, полнота provenance) зависят от
 * КОНТЕКСТА: «свежесть» имеет смысл только для живого скана, а восстановление
 * архива или импорт исторических данных законно работает со старыми барами.
 * Они проверяются на границе скана (`runStrategyScan`) и в read-only аудите.
 */
export const HARD_INVARIANTS = Object.freeze([
  SIGNAL_INVARIANTS.DEMO_PROVIDER,
  SIGNAL_INVARIANTS.FUTURE_CANDLE,
]);

/**
 * Проверка НОВОГО сигнала перед записью.
 *
 * @param {object} signal кандидат на запись (camelCase, как в репозитории)
 * @param {object} [ctx]
 * @param {number} [ctx.nowMs]
 * @param {boolean} [ctx.providerIsDemo] работает ли сканер на demo-провайдере
 * @param {number} [ctx.maxSetupAgeBars]
 * @param {readonly string[]} [ctx.only] проверять только эти коды (см. HARD_INVARIANTS)
 * @returns {{ok: boolean, violations: Array<{code:string, detail:string}>}}
 */
export function validateNewSignal(signal, ctx = {}) {
  const nowMs = ctx.nowMs ?? Date.now();
  const violations = [];
  const enabled = (code) => !ctx.only || ctx.only.includes(code);

  /**
   * 1. PRODUCTION-СИГНАЛ ИЗ DEMO-ПРОВАЙДЕРА НЕВОЗМОЖЕН.
   * Demo-данные — фикстуры. Сигнал по ним выглядит как настоящий, но не
   * описывает рынок; попав в `signals`, он навсегда отравляет статистику.
   */
  if (ctx.providerIsDemo === true && enabled(SIGNAL_INVARIANTS.DEMO_PROVIDER)) {
    violations.push({ code: SIGNAL_INVARIANTS.DEMO_PROVIDER, detail: 'market data provider reports isDemo=true' });
  }

  const candleMs = toMs(signal?.signalCandleTs);
  if (candleMs === null) {
    if (enabled(SIGNAL_INVARIANTS.MISSING_PROVENANCE)) {
      violations.push({ code: SIGNAL_INVARIANTS.MISSING_PROVENANCE, detail: 'signalCandleTs is missing or unparsable' });
    }
  } else {
    // 2. СВЕЧА ИЗ БУДУЩЕГО. Бар, который ещё не закрылся (или вообще не
    //    наступил), не может быть основанием сигнала: это look-ahead.
    if (candleMs > nowMs + CLOCK_SKEW_TOLERANCE_MS && enabled(SIGNAL_INVARIANTS.FUTURE_CANDLE)) {
      violations.push({
        code: SIGNAL_INVARIANTS.FUTURE_CANDLE,
        detail: `signal candle is ${Math.round((candleMs - nowMs) / 1000)}s in the future`,
      });
    }

    // 3. ПРОСРОЧЕННАЯ СВЕЧА. Сетап старше допустимого окна публикуется как
    //    «новый», хотя рынок давно ушёл.
    const barMs = timeframeDurationMs(signal?.timeframe);
    const maxBars = ctx.maxSetupAgeBars ?? MAX_SETUP_AGE_BARS;
    if (barMs > 0 && enabled(SIGNAL_INVARIANTS.STALE_CANDLE)) {
      const ageBars = (nowMs - candleMs) / barMs;
      if (ageBars > maxBars) {
        violations.push({
          code: SIGNAL_INVARIANTS.STALE_CANDLE,
          detail: `signal candle is ${ageBars.toFixed(1)} bars old (max ${maxBars})`,
        });
      }
    }
  }

  // 4. ПРОВЕНАНС. Версия стратегии и идентификатор сетапа — часть
  //    доказательства происхождения; без них строку нельзя соотнести с тем,
  //    какой код её посчитал.
  if (!signal?.strategyId && enabled(SIGNAL_INVARIANTS.MISSING_PROVENANCE)) {
    violations.push({ code: SIGNAL_INVARIANTS.MISSING_PROVENANCE, detail: 'strategyId is missing' });
  }
  if (!signal?.strategyVersion && enabled(SIGNAL_INVARIANTS.MISSING_PROVENANCE)) {
    violations.push({ code: SIGNAL_INVARIANTS.MISSING_PROVENANCE, detail: 'strategyVersion is missing' });
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Проверка ВРЕМЕННЫ́Х инвариантов уже существующей/обновляемой строки.
 *
 * Правило одно и очевидное: исполнение не раньше сетапа, выход не раньше
 * входа. Нарушение означает, что порядок событий сделки невосстановим,
 * а значит её R и длительность не имеют смысла.
 *
 * @param {{signalCandleTs?:any, filledAt?:any, closedAt?:any}} row
 * @returns {{ok:boolean, violations:Array<{code:string, detail:string}>}}
 */
export function validateLifecycleTimestamps(row) {
  const violations = [];
  const setup = toMs(row?.signalCandleTs ?? row?.signal_candle_ts);
  const filled = toMs(row?.filledAt ?? row?.filled_at);
  const closed = toMs(row?.closedAt ?? row?.closed_at);

  if (setup !== null && filled !== null && filled < setup) {
    violations.push({ code: SIGNAL_INVARIANTS.FILL_BEFORE_SETUP, detail: 'filledAt < signalCandleTs' });
  }
  if (setup !== null && closed !== null && closed < setup) {
    violations.push({ code: SIGNAL_INVARIANTS.CLOSE_BEFORE_SETUP, detail: 'closedAt < signalCandleTs' });
  }
  if (filled !== null && closed !== null && closed < filled) {
    violations.push({ code: SIGNAL_INVARIANTS.CLOSE_BEFORE_FILL, detail: 'closedAt < filledAt' });
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Полнота provenance сохранённой строки — какие поля доказательства есть.
 *
 * Используется read-only аудитом. Поля, которых в схеме НЕТ (источник-биржа,
 * отдельная отметка времени расчёта), перечислены в
 * docs/SIGNAL_PROVENANCE_GAPS.md и сознательно не добавляются миграцией в
 * этом PR.
 *
 * @param {object} row строка в форме репозитория (camelCase)
 */
export function provenanceCompleteness(row) {
  const fields = {
    strategyId: Boolean(row?.strategyId),
    strategyVersion: Boolean(row?.strategyVersion),
    engineSetupId: Boolean(row?.engineSetupId),
    symbol: Boolean(row?.symbol),
    timeframe: Boolean(row?.timeframe),
    signalCandleTs: toMs(row?.signalCandleTs) !== null,
    createdAt: toMs(row?.createdAt) !== null,
    status: Boolean(row?.status),
    provenanceStatus: Boolean(row?.provenanceStatus),
  };
  const missing = Object.entries(fields).filter(([, present]) => !present).map(([key]) => key);
  return { complete: missing.length === 0, missing, fields };
}
