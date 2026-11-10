/**
 * Подтверждённая конфигурация V3.4 — выписана из фактического кода CRYPTORA,
 * а не из ТЗ. Каждое значение снабжено ссылкой на источник.
 *
 * Ничего здесь не «подбиралось»: это метаданные (идентификатор, имя, вселенная,
 * таймфреймы, окно данных, интервал скана, качественные пороги, источник
 * рынка). Торговая математика живёт в strategy/ и signals/ и не настраивается
 * конфигом.
 */
import { V33_CONSTANTS } from './strategy/v33Core';
import { V34_ENTRY_ZONE_ATR_PAD, V34_TP1_MIN_R, V34_TP2_MIN_R } from './signals/targetQuality';

/** registry id — `server/services/strategyCatalog.js` и миграция 014. */
export const V34_STRATEGY_ID = 'V3_4_HTF_ZONE_MITIGATION_QUALITY';
export const V34_STRATEGY_VERSION = '3.4';
export const V34_STRATEGY_NAME = 'HTF Zone Mitigation + Target Quality';
export const V34_STRATEGY_NAME_RU = 'Митигация зоны старшего таймфрейма с фильтром качества целей';

/**
 * Статус исследования — строго как в каталоге CRYPTORA:
 * `badge: 'DERIVED_NO_BACKTEST'`, отдельного бэктеста V3.4 не существует.
 * В приложении это должно читаться как «производная, без бэктеста», а не как
 * «проверенная стратегия».
 */
export const V34_RESEARCH_BADGE = 'DERIVED_NO_BACKTEST' as const;
export const V34_RESEARCH_BADGE_LABEL = 'Derived · no backtest';
export const V34_RESEARCH_NOTE =
  'V3.4 — производная от V3.3: обнаружение сетапа, стоп и цели не менялись, добавлены '
  + `расширение коридора на ${V34_ENTRY_ZONE_ATR_PAD} ATR и фильтр качества целей `
  + `(TP1 ≥ ${V34_TP1_MIN_R} R, TP2 ≥ ${V34_TP2_MIN_R} R от худшей границы коридора). `
  + 'Отдельного бэктеста V3.4 не проводилось; исходный вариант V3.3 имеет статус TRAIN only '
  + 'и не валидирован на отложенной выборке.';

/**
 * Источник рынка — публичные спот-клавиши Binance.
 * Источник: `BINANCE_BASE` в server/services/strategyEngine/marketDataFetcher.js,
 * `marketData: 'BINANCE_SPOT_KLINES'` в FROZEN_ASSUMPTIONS
 * (src/services/strategyArchive/types.ts). Только read-only, без ключей.
 */
export const MARKET_DATA_SOURCE = Object.freeze({
  id: 'binance-spot-public-klines',
  exchange: 'Binance',
  venue: 'spot',
  baseUrl: 'https://api.binance.com',
  klinesPath: '/api/v3/klines',
  /** Котировка всех продуктовых пар — USDT-спот. */
  quote: 'USDT',
  /** Комиссионная модель стратегии предполагает Binance USDT-M Futures (2/5 bps). */
  feeVenueAssumed: 'BINANCE_USDT_FUTURES',
  requestTimeoutMs: 10_000,
  /** Максимум свечей в одном ответе Binance /api/v3/klines. */
  maxKlinesPerRequest: 1000,
});

/**
 * Таймфреймы: исполнение — закрытый 1H-бар, контекст — 4H.
 * Источник: `V33_CONSTANTS.EXEC_TF/STRUCT_TF`, `EXEC_TIMEFRAME` в
 * LiveSignalEngine.ts, каталог стратегий (`timeframes: ['1h','4h']`).
 */
export const V34_TIMEFRAMES = Object.freeze({
  exec: '1h' as const,
  context: '4h' as const,
  /** Серии, которые реально нужны V3.4 (1d для V3.4 не запрашивается). */
  all: ['1h', '4h'] as const,
});

/** Вселенная по умолчанию — ровно `V33_CONSTANTS.SYMBOLS`. */
export const V34_SYMBOLS: readonly string[] = Object.freeze([...V33_CONSTANTS.SYMBOLS]);

/** Окно данных: CANDLE_LIMIT_1H / CANDLE_LIMIT_4H в LiveSignalEngine.ts. */
export const V34_CANDLE_LIMITS = Object.freeze({
  '1h': 1000,
  '4h': 1000,
});

/** Прогрев окна (баров 1H) — `V33_CONSTANTS.WARMUP_BARS`. */
export const V34_WARMUP_BARS = V33_CONSTANTS.WARMUP_BARS;

/** Интервал скана по умолчанию (сек) — каталог стратегий, 60 с. */
export const V34_DEFAULT_SCAN_INTERVAL_SECONDS = 60;

/** Пороги качества целей V3.4 (из кода, не из ТЗ). */
export const V34_QUALITY_GATES = Object.freeze({
  entryZoneAtrPad: V34_ENTRY_ZONE_ATR_PAD,
  tp1MinR: V34_TP1_MIN_R,
  tp2MinR: V34_TP2_MIN_R,
});

/** Коридор входа V3.4: close ± (0.10 + 0.25) ATR по 1H. */
export const V34_ENTRY_ZONE_ATR_FRAC_TOTAL =
  V33_CONSTANTS.CORRIDOR_ATR_FRAC + V34_ENTRY_ZONE_ATR_PAD;

/**
 * Свежесть данных.
 *
 * execSpanMs — длительность бара исполнения. Если последний закрытый 1H-бар
 * старше, чем на два бара от «сейчас», данные считаются устаревшими: биржа не
 * отдала серию, и показывать старый скан как актуальный нельзя.
 *
 * scanStaleAfterMs — если успешный скан не завершался дольше трёх интервалов,
 * статус источника становится `stale` (сервер жив, но данные не обновляются).
 */
export const DATA_FRESHNESS = Object.freeze({
  execBarMs: 3_600_000,
  contextBarMs: 14_400_000,
  /** Разрешённая задержка последнего закрытого бара: 2 бара исполнения. */
  maxBarAgeMs: 2 * 3_600_000,
  /** Скан считается устаревшим после 3 пропущенных интервалов. */
  scanStaleAfterMs: 3 * 60_000,
  /** Меньше этого числа закрытых 1H-баров — окно непригодно для оценки. */
  minClosedBars1h: V33_CONSTANTS.WARMUP_BARS + 1,
});

/**
 * Человекочитаемое подтверждённое описание стратегии для приложения и лендинга.
 * Все утверждения — из кода и документации CRYPTORA; обещаний доходности нет.
 */
export const V34_DESCRIPTION = Object.freeze({
  short:
    'Серверный детектор сетапов: митигация 4H-зоны (order block / FVG) на закрытом 1H-баре '
    + 'с абсорбцией и RVOL ≥ 1.25. V3.4 дополнительно расширяет коридор входа на '
    + `${V34_ENTRY_ZONE_ATR_PAD} ATR и отклоняет сетапы, где TP1 < ${V34_TP1_MIN_R} R или `
    + `TP2 < ${V34_TP2_MIN_R} R первоначального риска.`,
  entry: 'Лимитный коридор вокруг close закрытого 1H-бара: close ± 0.35 ATR (V3.3: 0.10 ATR + V3.4: 0.25 ATR), действует 3 бара, исполнение по худшей границе.',
  stop: 'Первоначальный стоп: min(климакс, грань зоны) ∓ 0.15 ATR (структурный, не переносится при отказе фильтра).',
  targets: 'TP1 = середина displacement-ноги 4H (50 % позиции), TP2 = противоположный подтверждённый 4H-свинг. После TP1 стоп переводится в безубыток со следующего бара.',
  riskNote:
    'Это аналитические наблюдения, а не инвестиционная рекомендация. CRYPTORA не исполняет сделки '
    + 'и не подключается к торговым счетам; автоматической торговли нет.',
  limitations: [
    'Статус исследования: производная без бэктеста (DERIVED_NO_BACKTEST).',
    'Комиссии в расчёте R — модель 2/5 bps; funding, проскальзывание и спред не моделируются.',
    'Сигнал появляется только по закрытому 1H-бару: внутри бара событий нет.',
  ],
});
