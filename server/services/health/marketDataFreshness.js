/**
 * CRYPTORA — Единый контракт свежести рыночных данных.
 *
 * ПРОБЛЕМА, КОТОРУЮ ЭТО ЗАКРЫВАЕТ. «HTTP-запрос когда-то прошёл» не означает,
 * что данные актуальны. Биржа может отдать 200 OK с серией, последняя свеча
 * которой закрылась три часа назад; снапшот может лежать в кэше и
 * обслуживаться после сбоя апстрима («serve last good»). Поэтому свежесть
 * описывается ДВУМЯ независимыми временами:
 *
 *   sourceTimestamp — время, которое проставила БИРЖА (closeTime последней
 *                     закрытой свечи, eventTime тикера, время свипа OI);
 *   receivedAt      — когда НАШ процесс получил этот ответ.
 *
 * Возраст считается по обоим. Данные здоровы, только если свежи оба:
 * старый источник = рынок ушёл вперёд без нас; старый приём = мы перестали
 * ходить на биржу (и, возможно, живём на кэше).
 *
 * ЗАПРЕТ ПОДМЕНЫ. Здесь нет и не может быть ветки «если данные устарели —
 * подставить demo/синтетику». Устаревшие данные помечаются `stale` и
 * остаются устаревшими: подмена реального рынка фикстурой — это
 * фальсификация, а не деградация.
 */

/**
 * Классы источников. Каждый класс задаёт, какой допуск отставания источника
 * применяется (см. healthThresholds.js).
 */
export const FRESHNESS_CLASSES = Object.freeze({
  CANDLES: 'candles',
  TICKER: 'ticker',
  DERIVATIVES: 'derivatives',
});

/**
 * Реестр наблюдаемых потоков рыночных данных.
 *
 * `critical: true` означает «деградация этого потока деградирует весь
 * бэкенд». Производные (OI/funding) участвуют в аналитике деривативов, но
 * сигнальные стратегии на них не строятся, поэтому их устаревание не должно
 * переводить весь сервис в degraded.
 */
export const MARKET_DATA_FEEDS = Object.freeze({
  'binance-spot-candles': {
    exchange: 'binance', market: 'spot', kind: 'candles',
    class: FRESHNESS_CLASSES.CANDLES, critical: true,
  },
  'binance-spot-ticker': {
    exchange: 'binance', market: 'spot', kind: 'ticker',
    class: FRESHNESS_CLASSES.TICKER, critical: true,
  },
  'binance-futures-snapshot': {
    exchange: 'binance', market: 'futures', kind: 'ticker',
    class: FRESHNESS_CLASSES.TICKER, critical: false,
  },
  'binance-futures-open-interest': {
    exchange: 'binance', market: 'futures', kind: 'openInterest',
    class: FRESHNESS_CLASSES.DERIVATIVES, critical: false,
  },
  'binance-futures-funding': {
    exchange: 'binance', market: 'futures', kind: 'funding',
    class: FRESHNESS_CLASSES.DERIVATIVES, critical: false,
  },
  'kucoin-spot-candles': {
    exchange: 'kucoin', market: 'spot', kind: 'candles',
    class: FRESHNESS_CLASSES.CANDLES, critical: false,
  },
});

/** Допуск отставания источника для класса потока. */
export function sourceLagAllowanceSeconds(feedClass, thresholds) {
  if (feedClass === FRESHNESS_CLASSES.TICKER) return thresholds.tickerSourceLagSeconds;
  if (feedClass === FRESHNESS_CLASSES.DERIVATIVES) return thresholds.derivativesSourceLagSeconds;
  return thresholds.candleSourceLagSeconds;
}

const SECOND = 1000;

function ageSeconds(fromMs, nowMs) {
  if (!Number.isFinite(fromMs)) return null;
  return Math.max(0, Math.round((nowMs - fromMs) / SECOND));
}

/**
 * Классификация одного наблюдения свежести. ЧИСТАЯ функция.
 *
 * @param {object} p
 * @param {number|null} p.sourceTimestampMs время биржи (closeTime/eventTime)
 * @param {number|null} p.receivedAtMs когда получили ответ
 * @param {number} p.nowMs
 * @param {number} p.staleAfterSeconds порог «приём устарел»
 * @param {number} p.errorAfterSeconds порог «приём провален»
 * @param {number} p.sourceLagAllowanceSeconds допуск отставания источника
 * @param {number} [p.intervalSeconds] длительность бара (для свечей)
 * @param {string|null} [p.lastError] последняя ошибка потока
 * @returns {{status:'ok'|'stale'|'error', ageSeconds:number|null,
 *            sourceAgeSeconds:number|null, reason:string|null}}
 */
export function classifyFreshness({
  sourceTimestampMs = null,
  receivedAtMs = null,
  nowMs,
  staleAfterSeconds,
  errorAfterSeconds,
  sourceLagAllowanceSeconds: lagAllowance,
  intervalSeconds = 0,
  lastError = null,
}) {
  const received = ageSeconds(receivedAtMs, nowMs);
  const source = ageSeconds(sourceTimestampMs, nowMs);

  // Поток ни разу не отдавал данных. Это НЕ «ok»: отсутствие наблюдений —
  // отсутствие доказательства свежести (fail-closed).
  if (received === null) {
    return { status: lastError ? 'error' : 'stale', ageSeconds: null, sourceAgeSeconds: null, reason: 'NO_OBSERVATION' };
  }

  if (received >= errorAfterSeconds) {
    return { status: 'error', ageSeconds: received, sourceAgeSeconds: source, reason: 'RECEIVE_AGE_EXCEEDED' };
  }
  if (received >= staleAfterSeconds) {
    return { status: 'stale', ageSeconds: received, sourceAgeSeconds: source, reason: 'RECEIVE_AGE_EXCEEDED' };
  }

  // Источник: для свечей допустимое отставание = длительность бара + допуск.
  if (source !== null) {
    const allowed = Math.max(0, intervalSeconds) + Math.max(0, lagAllowance);
    if (source > allowed) {
      return { status: 'stale', ageSeconds: received, sourceAgeSeconds: source, reason: 'SOURCE_AGE_EXCEEDED' };
    }
  }

  // Запрос проходил недавно, но последним результатом была ошибка: честно
  // stale, а не ok. «Отдаём последнее удачное» — это деградация.
  if (lastError) {
    return { status: 'stale', ageSeconds: received, sourceAgeSeconds: source, reason: 'LAST_REQUEST_FAILED' };
  }

  return { status: 'ok', ageSeconds: received, sourceAgeSeconds: source, reason: null };
}

/** Агрегирование статусов потоков в один статус подсистемы marketData. */
export function aggregateFreshness(feeds) {
  const list = Object.values(feeds ?? {});
  const observed = list.filter((f) => f.observed);
  if (observed.length === 0) return 'stale';
  const critical = observed.filter((f) => f.critical);
  const scope = critical.length > 0 ? critical : observed;
  if (scope.some((f) => f.status === 'error')) return 'error';
  if (scope.some((f) => f.status === 'stale')) return 'stale';
  return 'ok';
}
