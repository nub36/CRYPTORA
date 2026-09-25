/**
 * CRYPTORA — Серверный движок стратегий.
 *
 * Что здесь происходит и чего здесь НЕТ:
 *  • Математики стратегий здесь нет. Движок загружает скомпилированное ядро из
 *    `src/` (см. strategyCoreBundle.js) и вызывает тот же `LiveSignalEngine`,
 *    что и браузер. Ручного пересказа формул нет: именно расхождение копии с
 *    определением породило баг V3.3 на проде.
 *  • Торговых ключей, исполнения ордеров и приватных эндпоинтов нет.
 *  • Жизненный цикл сигналов здесь НЕ изобретается: в БД переносится только то,
 *    что frozen-ядро уже определило по закрытым свечам (`ReplayRecord.fill` /
 *    `ReplayRecord.outcome`).
 *
 * Поток одного скана:
 *   1. взять закрытые свечи через MarketDataFetcher (кэш + дедуп + лимиты ядра);
 *   2. выполнить один проход `LiveSignalEngine.scanNow()` — оценка и проверка
 *      инварианта геометрии происходят внутри ядра;
 *   3. забрать готовые сетапы из ledger ядра и сохранить в PostgreSQL через
 *      signalRepository (дедупликация по `setupOpenTime` закрытого бара);
 *   4. синхронизировать состояние уже сохранённых сигналов (исполнение/исход)
 *      из ретроспективы окна — теми же значениями, что посчитало ядро;
 *   5. вернуть сводку. Ошибки не глотаются: их фиксирует планировщик.
 */

import { loadStrategyCore } from './strategyCoreBundle.js';
import { getMarketDataFetcher, toBinanceInterval, toExchangeSymbol } from './marketDataFetcher.js';
import {
  insertSignal,
  countActiveSignals,
  listOpenSignals,
  syncSignalLifecycle,
} from '../signalRepository.js';
import { getStrategy, PRODUCT_STRATEGIES } from '../strategyCatalog.js';
import { provenanceOfNewSignal } from '../signalProvenance.js';
import { withScanLock } from './scanMutex.js';
import { recordScanResult, recordSignalEmitted } from '../strategySettings.js';

/**
 * Соответствие registry id ↔ ключ стратегии внутри LiveSignalEngine.
 * Ключи движка — это версии, а не registry id; сверено с вызовами
 * runV30/runV33/runV28 в src/services/signals/live/LiveSignalEngine.ts.
 */
export const ENGINE_STRATEGY_KEY = {
  V3_0_HTF_LIQUIDATION_TRAP: 'V3.0',
  V3_3_HTF_ZONE_MITIGATION: 'V3.3',
  V2_8_ZERO_FEE_SNIPER_TRAILING: 'V2.8',
};

/**
 * Таймфрейм исполнения по стратегии.
 *
 * Берётся из каталога (`execTimeframe`), а не отдельной таблицей: раньше здесь
 * стояло `'15m'` для V2.8 — значение из ТЗ исследования, тогда как LIVE-ядро
 * исполняет V2.8 на 1h (`V28_LIVE_TIMEFRAME` в
 * src/services/strategyArchive/definitions/v2_8-zero-fee-sniper-trailing/v28Live.ts:52
 * и `EXEC_TIMEFRAME` в src/services/signals/live/LiveSignalEngine.ts:56).
 * Совпадение каталога и ядра проверяется тестом, а не ревью
 * (tests/unit/serverStrategyContract.test.ts).
 */
export const EXEC_TIMEFRAME = Object.fromEntries(
  PRODUCT_STRATEGIES.map((s) => [s.id, s.execTimeframe ?? '1h'])
);

/**
 * Сколько записей ретроспективы сопоставляется с БД за один скан.
 *
 * Реплей окна возвращает все сетапы окна (сотни записей), а обновлять нужно
 * только те, что уже сохранены и ещё не закрыты. Рабочий набор даёт
 * `listOpenSignals()` (один SELECT), поэтому ограничение — страховка от роста
 * числа UPDATE, а не от потери данных: недосинхронизированные строки
 * добираются следующим сканом (реплей детерминирован и пересчитывает окно).
 */
export const MAX_LIFECYCLE_SYNC_PER_SCAN = 500;

/**
 * Ключ сопоставления «строка БД ↔ запись реплея» — тот же набор полей, что
 * UNIQUE-констрейнт дедупликации из миграции 007.
 */
function signalKey(strategyId, symbol, timeframe, setupOpenTime) {
  return `${strategyId}|${symbol}|${timeframe}|${new Date(setupOpenTime).getTime()}`;
}

/**
 * Универсум скана в биржевой форме.
 *
 * Ядро хранит состояние по тому литералу, который ему передали, и тем же
 * литералом просит свечи у провайдера. Поэтому 'BTC/USDT' и 'BTCUSDT'
 * (обе формы законны в `strategy_settings.symbols` — это JSONB без схемы) дали
 * бы ДВА состояния на один инструмент: двойной HTTP-запрос и двойная оценка.
 * Приведение к биржевой форме делает это невозможным. Невалидные значения не
 * проглатываются: они возвращаются отдельно и видны в сводке скана.
 *
 * @param {Array<string|unknown>} requested
 * @returns {{symbols: string[], invalid: string[]}}
 */
export function normalizeScanSymbols(requested) {
  const symbols = [];
  const invalid = [];
  for (const raw of Array.isArray(requested) ? requested : []) {
    try {
      const market = toExchangeSymbol(raw);
      if (!symbols.includes(market)) symbols.push(market);
    } catch {
      invalid.push(typeof raw === 'string' ? raw : JSON.stringify(raw));
    }
  }
  return { symbols, invalid };
}

/**
 * Отображение сетапа ядра в строку таблицы `signals`.
 *
 * ── ИНВАРИАНТ PROVENANCE (инцидент 2026-09-24: три strategy_id с одним payload) ──
 *
 * `strategyId` строки БД — это НЕ «чей скан сейчас идёт», а «какая стратегия
 * породила этот сетап». Источник истины — `setup.strategyId`: его ставит сам
 * LIVE-реплей стратегии (src/services/signals/live/replays/*), и он же входит
 * в `setup.id` (`${strategyId}-${symbol}-${setupOpenTime}`).
 *
 * Переименование чужого сетапа — незаметная подмена: уровни остаются
 * «правдоподобными», а журнал и статистика стратегии начинают описывать чужую
 * математику. Поэтому relabel здесь запрещён: сетап с чужим strategyId не
 * возвращается и не попадает в БД, а факт расхождения виден в сводке скана
 * (`provenanceMismatch`) и в логе.
 *
 * Функция ЧИСТАЯ: ни БД, ни математики стратегий. Все значения берутся из
 * `AnalyticalSetup` как есть (src/services/signals/SignalsAuditLedger.ts) —
 * уровень, который стратегия посчитала, здесь не пересчитывается и не
 * «улучшается». Единственное преобразование — форма под контракт репозитория:
 *
 *  • `targets` — ВСЯ лестница целей. `tp1`/`tp2` здесь НЕ заполняются: их
 *    выводит репозиторий (`resolveLevels`: tp1 = targets[1], tp2 = targets[2]),
 *    иначе источник истины раздвоился бы. У V2.8 `executableLadder` бывает
 *    длиннее двух уровней, и третий уровень терялся именно на этом шве (F-06);
 *  • `signalCandleTs` — `setupOpenTime` закрытого бара сетапа: стабильный ключ
 *    дедупликации (F-05). Время публикации (`createdAt`) для этого не годится:
 *    оно меняется при каждом перезапуске процесса;
 *  • `metadata` — только аналитический контекст (RR, факторы, задержка). Никаких
 *    уровней в metadata: их место в типизированных колонках.
 *
 * @param {object} p
 * @param {object} p.setup — AnalyticalSetup из ledger ядра
 * @param {string} p.strategyId — registry id (V3_0_HTF_LIQUIDATION_TRAP, …)
 * @param {string} p.fallbackVersion — версия из каталога, если сетап её не несёт
 * @param {string} p.engineKey — ключ стратегии в ядре ('V3.0', 'V3.3', 'V2.8')
 * @param {string} p.execTf — таймфрейм исполнения ядра
 * @returns {{setupOpenTime: number, record: object|null, provenanceMismatch?: string}|null}
 *   null — нет валидного ключа дедупликации: такой сетап НЕ сохраняется
 *   (сохранить без ключа = потерять дедупликацию и получить дубли при каждом
 *   рестарте). `record: null` при `provenanceMismatch` — сетап порождён другой
 *   стратегией: публиковать его под этим strategy_id нельзя.
 *   `record.provenanceStatus` = 'VERIFIED' только когда сетап помнит, какая
 *   стратегия его создала, и это запрошенная стратегия. Иначе — 'UNKNOWN'
 *   (fail-closed), а при доказанном расхождении `record` = null.
 */
export function buildSignalRecord({ setup, strategyId, fallbackVersion, engineKey, execTf }) {
  const setupOpenTime = Number(setup?.setupOpenTime);
  if (!Number.isFinite(setupOpenTime)) return null;

  /**
   * Provenance-проверка. `setup.strategyId` ставит реплей самой стратегии;
   * отсутствие поля — это старый/неполный сетап, и молча подставлять вместо
   * него вызывающего нельзя, иначе проверка вырождается в «всегда ок».
   *
   * Правила — из `signalProvenance.provenanceOfNewSignal`, одного источника для
   * движка и для БД: `setup.strategyId === strategyId` ⇒ VERIFIED, расхождение
   * ⇒ строка не публикуется вовсе, нет поля ⇒ UNKNOWN (fail-closed: такая
   * строка сохраняется, но не мониторится и не идёт в статистику).
   */
  const provenance = provenanceOfNewSignal(setup, strategyId);
  if (provenance.mismatch) {
    return { setupOpenTime, record: null, provenanceMismatch: provenance.generator };
  }

  return {
    setupOpenTime,
    record: {
      strategyId,
      strategyVersion: setup.strategyVersion ?? fallbackVersion,
      engineSetupId: setup.id ?? null,
      // Пара в форме БД/API: 'BTC/USDT' (ledger хранит именно её).
      symbol: setup.symbol,
      timeframe: setup.timeframe ?? execTf,
      direction: setup.direction,
      signalCandleTs: new Date(setupOpenTime),
      entryType: setup.entryType ?? null,
      validForBars: setup.validForBars ?? null,
      exitRule: setup.exitRule ?? null,
      entryMin: setup.entryZone?.[0] ?? null,
      entryMax: setup.entryZone?.[1] ?? null,
      stopLoss: setup.invalidationLevel ?? null,
      targets: Array.isArray(setup.targets) ? [...setup.targets] : null,
      status: 'ACTIVE',
      /**
       * Происхождение доказано ДО записи и НЕ входит в публикуемый payload
       * (`hashPayloadV2`), поэтому перенос строки в карантин позже не рвёт
       * хэш-цепочку.
       */
      provenanceStatus: provenance.status,
      metadata: {
        engineVersion: engineKey,
        riskRewardRatio: setup.riskRewardRatio ?? null,
        confirmingFactors: setup.confirmingFactors ?? [],
        invalidationFactors: setup.invalidationFactors ?? [],
        latencyBars: setup.latencyBars ?? null,
        publishedAt: setup.createdAt ?? null,
      },
    },
  };
}

/**
 * @param {object} p
 * @param {string} p.strategyId
 * @param {string[]|null} [p.symbols] — переопределение из strategy_settings
 * @param {import('./marketDataFetcher.js').MarketDataFetcher} [p.fetcher]
 * @param {boolean} [p.persist] — false только в тестах
 * @returns {Promise<{strategyId:string, symbolsScanned:number, evaluated:boolean,
 *                    setupsFound:number, inserted:number, duplicates:number,
 *                    skippedNoKey:number, provenanceMismatch:number, rejected:number,
 *                    lifecycle:{synced:number, unchanged:number, notFound:number},
 *                    scan:object, activeSignals:number|null}>}
 */
export async function runStrategyScan({ strategyId, symbols = null, fetcher, persist = true }) {
  const meta = getStrategy(strategyId);
  if (!meta) {
    const err = new Error(`Unknown strategy: ${strategyId}`);
    /** @type {any} */ (err).statusCode = 404;
    throw err;
  }
  const engineKey = ENGINE_STRATEGY_KEY[strategyId];
  if (!engineKey) {
    const err = new Error(`No live adapter for strategy: ${strategyId}`);
    /** @type {any} */ (err).statusCode = 501;
    throw err;
  }

  const requested = Array.isArray(symbols) && symbols.length > 0 ? symbols : meta.defaultSymbols;
  const { symbols: universe, invalid: invalidSymbols } = normalizeScanSymbols(requested);
  if (universe.length === 0) {
    const err = new Error(
      `No scannable symbols for ${strategyId}: ${JSON.stringify(requested)} ` +
        `(invalid: ${JSON.stringify(invalidSymbols)})`
    );
    /** @type {any} */ (err).code = 'NO_SCANNABLE_SYMBOLS';
    throw err;
  }
  const dataFetcher = fetcher ?? getMarketDataFetcher();
  const core = await loadStrategyCore();

  /**
   * Таймфрейм исполнения — из ЯДРА, а не из копии: публикации сетапов несут
   * `setup.timeframe === EXEC_TIMEFRAME` ядра, и сопоставление с БД обязано
   * использовать то же значение. Каталог проверяется на совпадение тестом.
   */
  const coreExecTf = typeof core.EXEC_TIMEFRAME === 'string' ? core.EXEC_TIMEFRAME : null;
  const execTf = coreExecTf ?? EXEC_TIMEFRAME[strategyId] ?? '1h';

  /** Лимиты свечей — тоже из ядра (CANDLE_LIMIT_1H/4H/1D), чтобы предзагрузка
   *  клала в кэш ровно то окно, которое ядро запросит следом. */
  const coreLimit = (interval) => {
    if (interval === '1h') return core.CANDLE_LIMIT_1H;
    if (interval === '4h') return core.CANDLE_LIMIT_4H;
    if (interval === '1d') return core.CANDLE_LIMIT_1D;
    return undefined; // остальное — дефолт фетчера
  };

  /**
   * Предзагрузка свечей.
   *
   * Ядро глотает ошибки по каждому символу внутри scanSymbol(), поэтому полный
   * отказ рыночных данных выглядел бы как «сигналов нет» — а это подмена
   * «нет данных» на «нет сетапов», что запрещено. Здесь данные тянем явно:
   *   • сбой пробрасывается наверх и попадает в strategy_settings.last_error;
   *   • ядро затем берёт свечи из кэша фетчера, повторных HTTP-запросов нет.
   *
   * Серии — исполнение + контекст из каталога (`timeframes`), включая дневную
   * для V2.8: ядро просит её как `'1D'`, и без предзагрузки этот запрос ушёл бы
   * в сеть уже внутри скана.
   *
   * Предзагрузка СОЗНАТЕЛЬНО ВНЕ мьютекса скана (см. критическую секцию ниже):
   * общий `MarketDataFetcher` дедуплицирует in-flight серии (`inFlight`),
   * поэтому параллельные сканы стратегий не превращаются в N×запросов к бирже,
   * а под блокировкой ядро просто берёт свечи из кэша и не дергает сеть.
   */
  const timeframes = [...new Set([execTf, ...meta.timeframes])];
  const fetchResults = await Promise.allSettled(
    universe.flatMap((symbol) =>
      timeframes.map((tf) =>
        dataFetcher.getCandles(symbol, tf, { limit: coreLimit(toBinanceInterval(tf)) })
      )
    )
  );
  const failures = fetchResults.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    const first = /** @type {PromiseRejectedResult} */ (failures[0]).reason;
    const err = new Error(
      `Market data unavailable for ${failures.length}/${fetchResults.length} series: ` +
        (first instanceof Error ? first.message : String(first))
    );
    /** @type {any} */ (err).code = 'MARKET_DATA_UNAVAILABLE';
    throw err;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   *  КРИТИЧЕСКАЯ СЕКЦИЯ СКАНА (инцидент 2026-09-24: три strategy_id с одним
   *  payload). Здесь создаётся scan-scoped контекст ядра и он же исполняется.
   * ══════════════════════════════════════════════════════════════════════
   *
   * Что здесь сделано и почему — три рубежа, каждый следующий страхует
   * предыдущий.
   *
   * РУБЕЖ 1. СВОЙ ДВИЖОК НА СКАН — глобальный синглтон не трогается вообще.
   *   `new core.LiveSignalEngine({...})` вместо
   *   `resetInstance() + getInstance()`. Класс и конструктор ядра публичны,
   *   поэтому статический `instance` серверному скану больше не нужен. Это
   *   снимает сразу два класса аварий:
   *     • «украсть сетап» — чужой скан больше не может обнулить
   *       `LiveSignalEngine.instance`, потому что наш движок там не лежит;
   *     • «сбросить зависимость на ходу» — `resetInstance()` в ядре делает
   *       `instance.stop()` для запущенного движка; мы этот метод не вызываем,
   *       значит чужой скан не может остановить наш.
   *
   * РУБЕЖ 2. ССЫЛКА НА ЖУРНАЛ ЗАХВАЧЕНА СИНХРОННО С СОЗДАНИЕМ ДВИЖКА.
   *   Конструктор ядра сам делает `this.ledger =
   *   SignalsAuditLedger.getInstance()` (src/…/LiveSignalEngine.ts:250), а
   *   `LiveSignalConfig` НЕ содержит поля `ledger` — точки внедрения нет,
   *   сделать журнал по-настоящему scan-scoped замороженное API не даёт.
   *   Поэтому журнал получается через статический синглтон, но:
   *     • сброс и чтение идут в ОДНОМ синхронном блоке, который планировщик
   *       не может разорвать — между `resetInstance()` и `getInstance()` нет
   *       ни одного `await`;
   *     • после блока журнал больше никто не перечитывает: весь скан
   *       работает с захваченной ссылкой, а не с синглтоном. Чужой
   *       `resetInstance()` обнулит статику, но наша ссылка останется на наш
   *       объект — в JS обнуление поля не трогает уже взятые ссылки.
   *   Раньше `ledger` читался ПОСЛЕ `await` предзагрузки свечей: к моменту
   *   возобновления синглтон уже принадлежал движку стратегии, запущенной
   *   последней. Три скана читали ОДИН чужой журнал, а `buildSignalRecord`
   *   ставил в строку `strategyId` вызывающего — так один payload ушёл в БД
   *   под всеми тремя strategy_id, а сетапы двух других стратегий пропали.
   *
   * РУБЕЖ 3. МЬЮТЕКС. Внутри замороженного ядра в каждый момент находится
   *   ровно один скан (см. scanMutex.js). Он страхует то, что сервер не
   *   видит: статический синглтон журнала и любые модульные кэши бандла.
   *   Стоимость — wall-clock (сканы идут последовательно), а НЕ нагрузка на
   *   биржу: свечи предзагружены выше и дедуплицированы in-flight в
   *   `MarketDataFetcher`, под блокировкой сеть не дергается.
   *
   * РУБЕЖ 4 (в `buildSignalRecord`). Даже если чужой сетап всё же попадёт в
   *   выборку, он не будет переименован: `setup.strategyId` обязан совпасть с
   *   `strategyId` скана, иначе строка не публикуется, а факт подмены идёт в
   *   лог и в счётчик `provenanceMismatch`.
   */
  const { engine, status, fresh } = await withScanLock(async () => {
    // Свой журнал на скан. `resetInstance` у журнала только обнуляет статику —
    // уже взятые ссылки это не трогает.
    core.SignalsAuditLedger.resetInstance?.();

    const scanEngine = new core.LiveSignalEngine({
      provider: dataFetcher.asProvider(),
      symbols: universe,
      strategies: [engineKey],
    });
    if (!scanEngine) throw new Error('Failed to instantiate strategy core engine');

    // СИНХРОННО с конструктором: журнал, который движок только что привязал
    // к себе (см. рубеж 2). Между двумя строками нет `await`.
    const scanLedger = core.SignalsAuditLedger.getInstance();

    const before = new Set(scanLedger.getSetups().map((s) => s.id));

    /**
     * ОДИН проход по требованию, без setInterval: расписанием владеет
     * StrategyScheduler, а не ядро.
     *
     * Метод ядра называется `scanNow()` (src/services/signals/live/
     * LiveSignalEngine.ts:370) и возвращает `Promise<void>`; `scanOnce()` в
     * ядре никогда не существовало — вызов несуществующего метода давал
     * TypeError на каждом скане и нуль сигналов (F-01). Контракт проверяется
     * тестом, который реально исполняется:
     * tests/integration/strategyEngineCore.test.ts.
     */
    await scanEngine.scanNow();

    const scanStatus = scanEngine.getStatus();
    const scanFresh = scanLedger.getSetups().filter((s) => !before.has(s.id));
    return { engine: scanEngine, status: scanStatus, fresh: scanFresh };
  });

  let inserted = 0;
  let duplicates = 0;
  let skippedNoKey = 0;
  let provenanceMismatch = 0;
  /** Кто именно породил отвергнутые сетапы — для честного лога, а не «что-то пошло не так». */
  const alienStrategyIds = new Set();

  for (const setup of fresh) {
    /**
     * Идентификатор сетапа для дедупликации — `setupOpenTime` (openTime
     * ЗАКРЫТОГО бара, на котором сетап сформирован). Поле `sourceCandleTs`
     * в типе `SetupIssuance` не существует, и прежний фолбэк на время
     * публикации означал, что повторный скан того же бара создавал бы новый
     * «уникальный» ключ, а рестарт процесса — дубли (F-05).
     *
     * Без валидного ключа сигнал НЕ сохраняется: сохранить без ключа — значит
     * потерять дедупликацию. Это видно в сводке (`skippedNoKey`), а не тихо.
     */
    const built = buildSignalRecord({
      setup,
      strategyId,
      fallbackVersion: meta.version,
      engineKey,
      execTf,
    });
    if (!built) {
      skippedNoKey++;
      continue;
    }
    /**
     * Provenance: уровни этого сетапа посчитала ДРУГАЯ стратегия. Публиковать их
     * под текущим `strategyId` — значит подменить авторство сигнала: в журнале
     * появится запись, которой эта стратегия не создавала. Такой сетап
     * пропускается и считается; молча писать его нельзя, поэтому расхождение
     * уходит и в лог, и в сводку скана.
     */
    if (!built.record) {
      provenanceMismatch++;
      if (built.provenanceMismatch) alienStrategyIds.add(built.provenanceMismatch);
      continue;
    }
    if (!persist) continue;

    const res = await insertSignal(built.record);
    if (res.inserted) inserted++;
    else duplicates++;
  }

  if (provenanceMismatch > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[strategyEngine] provenance violation: скан ${strategyId} получил ${provenanceMismatch} `
      + `сетап(ов) стратегий ${[...alienStrategyIds].join(', ') || 'UNKNOWN'} — они НЕ опубликованы. `
      + 'Причина: общий статический ledger ядра между параллельными сканами.',
    );
  }

  if (inserted > 0) await recordSignalEmitted(strategyId);

  const lifecycle = persist
    ? await syncLifecycleFromCore({ core, engine, strategyId, execTf: coreExecTf ?? execTf, status })
    : { synced: 0, unchanged: 0, notFound: 0 };

  /**
   * Сводка реплея — настоящие значения из статуса ядра.
   *
   * `engine.lastRejected` не существует (прежнее поле `rejected` всегда было
   * null). Реальный счётчик отклонённых сетапов — `unpublishable` в
   * `ReplaySummary`: pending, которые frozen-раннер отклонил бы на баре
   * исполнения по геометрии (в журнал не публикуются).
   */
  const summaries = Object.values(status.perSymbol ?? {}).flatMap((st) =>
    Object.values(st?.replays ?? {})
  );
  const rejected = summaries.reduce((acc, s) => acc + (Number(s?.unpublishable) || 0), 0);
  const evaluatedBars = summaries.reduce((acc, s) => acc + (Number(s?.evaluatedBars) || 0), 0);

  return {
    strategyId,
    symbols: universe,
    invalidSymbols,
    symbolsScanned: universe.length,
    evaluated: true,
    setupsFound: fresh.length,
    inserted,
    duplicates,
    skippedNoKey,
    provenanceMismatch,
    rejected,
    lifecycle,
    scan: {
      execTimeframe: execTf,
      timeframes,
      scanCount: status.scanCount ?? null,
      lastScanStartedAt: status.lastScanStartedAt ?? null,
      lastScanFinishedAt: status.lastScanFinishedAt ?? null,
      lastScanDurationMs: status.lastScanDurationMs ?? null,
      lastError: status.lastError ?? null,
      evaluatedBars,
      providerIsDemo: Boolean(status.providerIsDemo),
      /**
       * Снимок состояния ядра ПОСЛЕ скана — diagnostics и тесты.
       *
       * Движок теперь scan-scoped (`new LiveSignalEngine(...)`), поэтому
       * статический синглтон больше НЕ является источником истины о прошедшем
       * скане: спросить `getInstance().getStatus()` после скана нельзя, его
       * просто нет. Наблюдаемость обязана жить в результате, иначе её нет
       * вообще — а «скан прошёл, но проверить нечем» хуже любого лишнего поля.
       *
       * Это НЕ пересчёт: состояние отдано самим ядром (`engine.getStatus()`),
       * сервер его не интерпретирует и не переписывает.
       */
      runtime: status,
    },
    activeSignals: persist ? await countActiveSignals(strategyId) : null,
  };
}

/**
 * Перенос исполнения/исхода из ретроспективы окна в сохранённые строки.
 *
 * Границы, которые здесь важны:
 *  • обновляются ТОЛЬКО строки, которые уже сохранены и ещё не закрыты
 *    (`listOpenSignals` — один SELECT с границей);
 *  • значения берутся из `ReplayRecord.fill` / `ReplayRecord.outcome` как есть —
 *    никаких собственных расчётов R, стопов или целей;
 *  • если ядро исход не определило (`outcome === null`), статус не меняется:
 *    «ещё не известно» не превращается в «закрыто»;
 *  • переход монотонен: закрытую строку репозиторий не изменяет.
 *
 * @returns {Promise<{synced:number, unchanged:number, notFound:number}>}
 */
async function syncLifecycleFromCore({ core, engine, strategyId, execTf, status }) {
  const result = { synced: 0, unchanged: 0, notFound: 0 };
  if (typeof engine.getRetrospective !== 'function') return result;

  const open = await listOpenSignals(strategyId, MAX_LIFECYCLE_SYNC_PER_SCAN);
  if (open.length === 0) return result;

  const openByKey = new Map(
    open.map((row) => [
      signalKey(row.strategyId, row.symbol, row.timeframe, row.signalCandleTs),
      row,
    ])
  );

  // Пара в форме БД ('BTC/USDT') — из статуса ядра: запись реплея несёт
  // биржевой символ ('BTCUSDT'), а строка сигнала хранит пару.
  const pairBySymbol = new Map(
    Object.entries(status?.perSymbol ?? {}).map(([sym, st]) => [sym, st?.pair ?? null])
  );

  const tfMs = core?.ARCHIVE_TF_MS?.[execTf] ?? null;
  const records = engine.getRetrospective({ strategyId });
  let considered = 0;

  for (const rec of records) {
    if (considered >= MAX_LIFECYCLE_SYNC_PER_SCAN) break;
    if (!rec || (!rec.fill && !rec.outcome)) continue;

    const pair = pairBySymbol.get(rec.symbol) ?? null;
    if (!pair) continue;

    // Таймфрейма в ReplayRecord нет: live-реплей всегда идёт по EXEC_TIMEFRAME
    // ядра (1h), поэтому сопоставление идёт по нему же.
    const key = signalKey(strategyId, pair, execTf, rec.setupOpenTime);
    const row = openByKey.get(key);
    if (!row) {
      // Сетап из окна, которого нет в БД (например, он был сформирован до
      // включения стратегии). Строка не выдумывается: она появится, когда ядро
      // опубликует сетап последнего закрытого бара, а её исход доберётся
      // следующим сканом.
      result.notFound++;
      continue;
    }
    considered++;

    const outcome = rec.outcome
      ? {
          status: rec.outcome.status,
          // closed_at — время ЗАКРЫТИЯ бара исхода (семантика клиентского
          // SetupOutcome.closedAt); barOpenTime ядра + длительность бара.
          closedAt:
            tfMs !== null
              ? new Date(rec.outcome.barOpenTime + tfMs)
              : new Date(rec.outcome.barOpenTime),
          exitReason: rec.outcome.exitReason ?? null,
          exitPrice: rec.outcome.exitPrice ?? null,
          resultR: rec.outcome.grossR ?? null,
          netResultR: rec.outcome.netR ?? null,
          pnlResultPct: null,
          barsHeld: rec.outcome.barsHeld ?? null,
        }
      : null;

    const res = await syncSignalLifecycle({
      strategyId,
      symbol: pair,
      timeframe: execTf,
      signalCandleTs: rec.setupOpenTime,
      fill: rec.fill ?? null,
      outcome,
    });

    if (res.changed) {
      result.synced++;
      openByKey.delete(key); // строка закрыта — больше не кандидат
    } else {
      result.unchanged++;
    }
  }

  return result;
}

/**
 * Сканирует одну стратегию и фиксирует результат в strategy_settings.
 * Ошибка НЕ пробрасывается наружу как крах: она записывается в last_error,
 * чтобы бэкенд продолжал работать.
 */
export async function scanStrategySafely({ strategyId, symbols = null, fetcher, persist = true }) {
  try {
    const result = await runStrategyScan({ strategyId, symbols, fetcher, persist });
    if (persist) await recordScanResult({ strategyId, error: null });
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (persist) {
      await recordScanResult({ strategyId, error: message }).catch(() => {});
    }
    return { ok: false, strategyId, error: message };
  }
}
