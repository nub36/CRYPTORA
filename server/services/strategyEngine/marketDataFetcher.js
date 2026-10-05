/**
 * CRYPTORA — Загрузка свечей для серверного движка.
 *
 * Требования, которые здесь закрыты:
 *  • только ПУБЛИЧНЫЕ эндпоинты. Никаких торговых ключей, приватных методов и
 *    исполнения ордеров;
 *  • кэш с TTL по (symbol, interval, limit) — движок не должен каждые 60 секунд
 *    тянуть сотни одинаковых наборов свечей;
 *  • дедупликация in-flight: одновременные запросы одного и того же набора
 *    сводятся к одному HTTP-запросу;
 *  • честная ошибка: если эндпоинт недоступен, исключение пробрасывается
 *    наверх. Тихой подмены реальных данных статикой нет.
 *
 * ── Граница нормализации таймфреймов (F-09) ────────────────────────────────
 * Ядро стратегий работает с продуктовым типом `Timeframe` из `src/types/market.ts`
 * и просит дневную серию как `'1D'`. Binance REST ожидает `interval=1d`, и
 * запрос с `1D` возвращает HTTP 400. Раньше этот литерал уходил в URL как есть,
 * ошибка глоталась внутри `scanSymbol()`, и скан выглядел как «сетапов нет»
 * вместо «нет данных».
 *
 * Нормализация делается ЗДЕСЬ — на границе провайдера рыночных данных, а не в
 * стратегиях: алгоритмы продолжают оперировать своими таймфреймами, транспорт
 * приводит их к формату биржи. Тот же маппинг, что в браузере
 * (`LiveMarketDataProvider.mapTimeframeToBinance`, `mapTimeframeToBinanceInterval`).
 *
 * Осознанно НЕ делается blanket-lowercase: у Binance `1M` — месяц, а `1m` —
 * минута. Приведение регистра молча поменяло бы смысл серии, поэтому разрешён
 * только явный список.
 *
 * ── Лимит свечей (F-10) ────────────────────────────────────────────────────
 * Провайдер-адаптер обязан пробрасывать третий аргумент `limit`: ядро просит
 * 1000 баров 1h/4h и 400 баров 1d (`CANDLE_LIMIT_1H/4H/1D` в
 * `src/services/signals/live/LiveSignalEngine.ts`). Без проброса сервер
 * оценивал окно в 300 баров там, где браузер оценивает 1000 — одна и та же
 * стратегия давала разные результаты. Паритет значений проверяется тестом
 * `tests/unit/serverMarketData.test.ts`, а не «на глаз».
 */

import { getHealthTelemetry } from '../health/telemetry.js';

const BINANCE_BASE = 'https://api.binance.com/api/v3/klines';

/** Секунд в баре — для контракта свежести (возраст источника vs длительность бара). */
export const INTERVAL_SECONDS = Object.freeze({
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200,
  '1d': 86400, '3d': 259200, '1w': 604800,
});

/** Таймаут одного запроса. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Максимум свечей в одном запросе Binance /api/v3/klines. Всё, что больше,
 * биржа отклоняет; неограниченный запрос невозможен и на стороне сервера.
 */
export const BINANCE_MAX_KLINES = 1000;

/**
 * Продуктовый таймфрейм → interval Binance.
 * Ключи — литералы `Timeframe` (src/types/market.ts) и `ArchiveTimeframe`
 * (src/services/strategyArchive/types.ts): ядро использует обе формы.
 */
export const BINANCE_INTERVAL_BY_TIMEFRAME = Object.freeze({
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '8h': '8h',
  '12h': '12h',
  '1D': '1d',
  '1d': '1d',
  '3d': '3d',
  '1W': '1w',
  '1w': '1w',
});

/**
 * Граница нормализации СИМВОЛА (F-09, та же логика, что и для таймфреймов).
 *
 * Ядро (`LiveSignalEngine`) и каталог стратегий оперируют биржевым символом
 * ('BTCUSDT'): именно его Binance принимает в `?symbol=`. Но `strategy_settings.symbols`
 * — JSONB, который админ может заполнить в любой форме ('BTC/USDT', 'btc-usdt',
 * 'BTC'), а клиентский слой везде использует пары. Литерал с разделителем,
 * ушедший в URL как есть, даёт HTTP 400, который ядро глотает внутри
 * `scanSymbol()`: скан выглядел бы как «сетапов нет» вместо «нет данных».
 *
 * Приведение делается ЗДЕСЬ — на границе провайдера рыночных данных, а не в
 * стратегиях: алгоритмы продолжают оперировать своими символами.
 *
 * @param {string} symbol — 'BTCUSDT' | 'BTC/USDT' | 'btc-usdt' | 'BTC'
 * @returns {string} биржевой символ Binance ('BTCUSDT')
 * @throws если символ пустой или содержит символы вне допустимого набора
 */
/**
 * Допустимая форма: BASE, BASE/QUOTE или биржевой символ; разделитель — один.
 * 'BTC/USDT/EUR' и 'BTC USD' — не символы инструмента, и угадывать из них
 * серию нельзя: запрос с выдуманным символом биржа отклонит, а скан выглядел бы
 * как «сетапов нет».
 */
const SYMBOL_SHAPE = /^[A-Z0-9]{1,20}(?:[/_-][A-Z0-9]{1,10})?$/;

export function toExchangeSymbol(symbol) {
  const raw = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  if (!SYMBOL_SHAPE.test(raw)) {
    throw new Error(`Unsupported market symbol: ${JSON.stringify(symbol)}`);
  }
  const compact = raw.replace(/[\/_-]/g, '');
  // Котировка LIVE-провайдера ядра — USDT-спот (toPair в LiveSignalEngine.ts).
  return compact.endsWith('USDT') ? compact : `${compact}USDT`;
}

/**
 * Приводит таймфрейм к interval Binance.
 *
 * @param {string} timeframe
 * @returns {string} interval в формате биржи
 * @throws если таймфрейм неизвестен: честная ошибка лучше тихой подмены серии.
 */
export function toBinanceInterval(timeframe) {
  const mapped = BINANCE_INTERVAL_BY_TIMEFRAME[timeframe];
  if (!mapped) {
    throw new Error(
      `Unsupported timeframe for Binance klines: ${JSON.stringify(timeframe)} ` +
        `(supported: ${Object.keys(BINANCE_INTERVAL_BY_TIMEFRAME).join(', ')})`
    );
  }
  return mapped;
}

/**
 * TTL кэша по interval. Меньше периода свечи: бессмысленно держать кэш дольше,
 * чем появляется новый закрытый бар.
 */
export const CACHE_TTL_MS = {
  '15m': 60_000,
  '30m': 60_000,
  '1h': 60_000,
  '4h': 60_000,
  '1d': 120_000,
};

/**
 * ГРАНИЦА ФИНАЛЬНОСТИ СВЕЧИ (инцидент PEPE 561186ba, 2026-09-27).
 *
 * Binance /api/v3/klines всегда отдаёт последней СЕЙЧАС ФОРМИРУЮЩУЮСЯ свечу —
 * это снапшот неполного бара. До этого фикса такой ответ целиком ложился в
 * кэш, а `isClosed` потребитель считал ПО МОМЕНТУ ЧТЕНИЯ (`ohlcvAdapter`:
 * `closeTime < nowMs`). Сочетание давало дефект класса look-ahead из кэша:
 *
 *   T0 — ответ получен, бар X ещё формируется (close = цена в T0);
 *   T1 — ответ закэширован (TTL 60 c);
 *   T2 — часы пересекли X.closeTime;
 *   T3 — кэш отдан БЕЗ обновления данных (TTL ещё не истёк);
 *   T4 — потребитель вычисляет `isClosed = now > closeTime` → true;
 *   T5 — ДОзакрытый снапшот T0 используется как финальный бар X.
 *
 * Именно так V3.3 опубликовал сетап PEPE по close формирующегося бара
 * (0.00000446 вместо остановленного 0.00000445), а повторный скан на
 * осевших данных получил уже ДРУГУЮ геометрию → REJECTED_GEOMETRY →
 * «отмена» исполненной строки (см. second guard в signalRepository).
 *
 * ИНВАРИАНТ: снапшот, полученный пока интервал свечи был ещё открыт, НИКОГДА
 * не становится финальной закрытой свечой из-за того, что время шло, пока
 * снапшот лежал в кэше. Финальность — свойство МОМЕНТА ПОЛУЧЕНИЯ ДАННЫХ,
 * а не wall-clock в точке потребления.
 *
 * Реализация: формирующиеся (незавершённые на момент получения) свечи
 * ОТБРАСЫВАЮТСЯ ДО кэша и ДО выдачи потребителю — серия из кэша и живого
 * ответа состоит только из свечей, закрытых на момент acquisition. Индикаторы
 * и стратегии не меняются: они и так видели только `isClosed`-бары, состав
 * закрытых баров не изменяется — меняется лишь то, что незакрытый снапшот
 * больше не может «дозреть» в кэше.
 *
 * @param {Array<{closeTime:number}>} candles — свечи, как их отдал transport
 * @param {number} acquiredAtMs — момент получения снапшота (мс, epoch)
 * @returns {{candles: Array, nextBoundaryMs: number|null}}
 *   `nextBoundaryMs` — ближайший момент, когда отброшенная формирующаяся свеча
 *   станет закрытой (её closeTime + 1). Кэш, у которого эта граница уже
 *   пройдена, обязан обновиться: потребитель, ждущий «последний закрытый бар»,
 *   не должен ждать истечения TTL.
 */
export function dropFormingCandles(candles, acquiredAtMs) {
  const list = Array.isArray(candles) ? candles : [];
  const kept = [];
  let nextBoundaryMs = null;
  for (const c of list) {
    const closeTime = Number(c && c.closeTime);
    // Незавершённая на момент получения: интервал ещё открыт (или closeTime
    // не читается — такое НЕ выдаётся за закрытый бар, fail-closed).
    if (!Number.isFinite(closeTime) || closeTime >= acquiredAtMs) {
      const boundary = (Number.isFinite(closeTime) ? closeTime : acquiredAtMs) + 1;
      if (nextBoundaryMs === null || boundary < nextBoundaryMs) nextBoundaryMs = boundary;
      continue;
    }
    kept.push(c);
  }
  return { candles: kept, nextBoundaryMs };
}

export const DEFAULT_CACHE_TTL_MS = 60_000;

/**
 * Сколько свечей тянуть по умолчанию: ТО ЧТО ПРОСЯТ СТРАТЕГИИ.
 *
 * Значения 1h/4h/1d равны `CANDLE_LIMIT_1H`/`CANDLE_LIMIT_4H`/`CANDLE_LIMIT_1D`
 * из `src/services/signals/live/LiveSignalEngine.ts:53-55` — тогда предзагрузка
 * движка кладёт в кэш ровно то окно, которое ядро запросит следом, и повторных
 * HTTP-запросов нет. Расхождение ловит parity-тест, а не ревью.
 */
export const CANDLE_LIMIT = {
  '15m': 400,
  '30m': 300,
  '1h': 1000,
  '4h': 1000,
  '1d': 400,
};
export const DEFAULT_CANDLE_LIMIT = 300;

/**
 * Валидация и ограничение лимита.
 *
 * Неограниченный запрос невозможен: любое значение приводится к целому в
 * диапазоне [1, BINANCE_MAX_KLINES]. Отсутствие лимита — дефолт таймфрейма.
 *
 * @param {unknown} limit
 * @param {string} interval — уже нормализованный interval Binance
 * @returns {number}
 */
export function normalizeCandleLimit(limit, interval) {
  if (limit === undefined || limit === null || limit === '') {
    return CANDLE_LIMIT[interval] ?? DEFAULT_CANDLE_LIMIT;
  }
  // Только число или числовая строка (query-параметры приходят строками).
  // `Number([])` дал бы 0, а `Number({})` — NaN: без проверки типа массив
  // молча превратился бы в «одну свечу».
  if (typeof limit !== 'number' && typeof limit !== 'string') {
    throw new Error(`Invalid candle limit: ${JSON.stringify(limit)} (expected a finite number)`);
  }
  if (typeof limit === 'string' && limit.trim() === '') {
    return CANDLE_LIMIT[interval] ?? DEFAULT_CANDLE_LIMIT;
  }
  const n = Number(limit);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid candle limit: ${JSON.stringify(limit)} (expected a finite number)`);
  }
  return Math.max(1, Math.min(BINANCE_MAX_KLINES, Math.floor(n)));
}

export class MarketDataFetcher {
  /**
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetchFn] — инъекция для тестов
   * @param {number} [opts.nowMs] — инъекция времени для тестов
   */
  constructor({ fetchFn, nowMs, telemetry } = {}) {
    this.fetchFn = fetchFn ?? ((...a) => globalThis.fetch(...a));
    this.nowFn = nowMs ?? (() => Date.now());
    /**
     * Реестр свежести для `/api/health`. Запись делается на границе
     * транспорта — единственном месте, где известны ОБА времени:
     * closeTime последней закрытой свечи (источник) и момент получения.
     * Ошибка телеметрии не влияет на загрузку свечей (см. recordFreshness).
     */
    this.telemetry = telemetry ?? null;
    /** @type {Map<string, {at: number, candles: Array, nextBoundaryMs: number|null}>} */
    this.cache = new Map();
    /** @type {Map<string, Promise<Array>>} */
    this.inFlight = new Map();
    this.requestCount = 0;
  }

  /**
   * Ключ кэша включает limit: серия на 200 баров не должна выдаваться тому,
   * кто просил 1000 (иначе стратегия молча получила бы короткое окно).
   */
  key(symbol, timeframe, limit) {
    return `${symbol}|${timeframe}|${limit ?? ''}`;
  }

  /**
   * Публикация свежести. Никогда не бросает: мониторинг не имеет права
   * сломать горячий путь загрузки рыночных данных.
   */
  recordFreshness(interval, candles, acquiredAtMs) {
    try {
      const registry = this.telemetry ?? getHealthTelemetry();
      const last = Array.isArray(candles) && candles.length > 0 ? candles[candles.length - 1] : null;
      registry.recordMarketData('binance-spot-candles', {
        sourceTimestampMs: Number(last?.closeTime) || null,
        receivedAtMs: acquiredAtMs,
        intervalSeconds: INTERVAL_SECONDS[interval] ?? 0,
      });
    } catch {
      // Телеметрия — наблюдение, а не зависимость.
    }
  }

  recordFreshnessFailure(error) {
    try {
      (this.telemetry ?? getHealthTelemetry()).recordMarketDataFailure('binance-spot-candles', error);
    } catch {
      // см. выше
    }
  }

  /** Счётчик реальных HTTP-запросов — для теста «нет веера дублей». */
  get stats() {
    return {
      httpRequests: this.requestCount,
      cacheEntries: this.cache.size,
      inFlight: this.inFlight.size,
    };
  }

  clearCache() {
    this.cache.clear();
  }

  /**
   * Закрытые свечи. Формирующаяся свеча возвращается эндпоинтом, но НЕ может
   * пережить границу кэша: `dropFormingCandles` отбрасывает её по моменту
   * ПОЛУЧЕНИЯ ответа (см. комментарий к функции — инвариант финальности),
   * поэтому в кэш и потребителю уходят только свечи, закрытые на момент
   * acquisition. Потребитель по-прежнему может фильтровать `isClosed`
   * (`ohlcvToArchive`) — после границы фетчера этот фильтр уже не может
   * «дозакрыть» чужой незавершённый снапшот.
   *
   * @param {string} symbol — 'BTCUSDT'
   * @param {string} timeframe — '1h' | '4h' | '1D' | … (нормализуется здесь)
   * @param {{limit?: number}|number} [opts] — лимит свечей; принимается и
   *   числом (форма провайдера `getCandles(symbol, tf, limit)`), и объектом.
   * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number,closeTime:number}>>}
   */
  async getCandles(symbol, timeframe, opts) {
    const interval = toBinanceInterval(timeframe);
    // Символ приводится к биржевой форме ДО ключа кэша: 'BTC/USDT' и 'BTCUSDT'
    // обязаны попадать в одну запись, иначе одна и та же серия тянется дважды.
    const market = toExchangeSymbol(symbol);
    const requested = typeof opts === 'number' ? opts : opts?.limit;
    const limit = normalizeCandleLimit(requested, interval);
    const key = this.key(market, interval, limit);
    const now = this.nowFn();
    const ttl = CACHE_TTL_MS[interval] ?? DEFAULT_CACHE_TTL_MS;

    const hit = this.cache.get(key);
    if (
      hit &&
      now - hit.at < ttl &&
      // Граница финальности: если с момента acquisition закрылась свеча,
      // которой в кэше нет, серия НЕ выдаётся — потребитель, ждущий последний
      // закрытый бар, получает свежие данные, а не ожидание конца TTL.
      (hit.nextBoundaryMs === null || now < hit.nextBoundaryMs)
    ) {
      return hit.candles;
    }

    // Дедупликация одновременных запросов одного набора.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.fetchCandles(market, interval, limit)
      .then((raw) => {
        // Момент ПОЛУЧЕНИЯ снапшота — единственная точка, где можно честно
        // судить, какие свечи уже финальны. Всё, что не финально, отбрасывается
        // ДО кэша: «дозреть» в кэше незавершённый бар больше не может.
        const acquiredAt = this.nowFn();
        const snap = dropFormingCandles(raw, acquiredAt);
        this.cache.set(key, { at: acquiredAt, candles: snap.candles, nextBoundaryMs: snap.nextBoundaryMs });
        this.inFlight.delete(key);
        this.recordFreshness(interval, snap.candles, acquiredAt);
        return snap.candles;
      })
      .catch((e) => {
        this.inFlight.delete(key);
        this.recordFreshnessFailure(e);
        throw e;
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * @param {string} symbol
   * @param {string} interval — УЖЕ нормализованный interval Binance
   * @param {number} limit — УЖЕ валидированный и ограниченный
   */
  async fetchCandles(symbol, interval, limit) {
    const url = `${BINANCE_BASE}?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${limit}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.requestCount++;
    try {
      const res = await this.fetchFn(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Binance klines HTTP ${res.status} for ${symbol} ${interval}`);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error(`Unexpected klines payload for ${symbol} ${interval}`);

      // [openTime, open, high, low, close, volume, closeTime, ...]
      return raw.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000), // секунды — как в OHLCV фронтенда
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
      }));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Провайдер в форме, которую ожидает LiveSignalEngine.
   * Движку нужны только getCandles; остальное он не вызывает, но интерфейс
   * MarketDataProvider требует присутствия полей.
   *
   * ⚠️ Третий аргумент `limit` ОБЯЗАТЕЛЬНО пробрасывается: ядро просит
   * 1000 баров 1h/4h и 400 баров 1d, и потеря лимита означала бы, что сервер
   * считает стратегию на другом окне, чем браузер (F-10).
   */
  asProvider() {
    const self = this;
    const unavailable = async () => {
      throw new Error('Not available in server strategy engine context');
    };
    return {
      isDemo: false,
      getCandles: (symbol, timeframe, limit) => self.getCandles(symbol, timeframe, { limit }),
      getAssets: unavailable,
      getAssetDetail: unavailable,
      getFuturesList: unavailable,
      getLiquidations: unavailable,
      getRadarEvents: unavailable,
      getMarketOverview: unavailable,
      getScreenerResults: unavailable,
    };
  }
}

let singleton = null;

/** @returns {MarketDataFetcher} */
export function getMarketDataFetcher() {
  if (!singleton) singleton = new MarketDataFetcher();
  return singleton;
}

export function resetMarketDataFetcher() {
  singleton = null;
}
