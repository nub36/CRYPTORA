/**
 * Декларации для server/services/strategyEngine/strategyCoreBundle.js.
 *
 * Загрузчик скомпилированного ядра стратегий: esbuild собирает
 * `entry.ts` вместе с TS-зависимостями из `src/` в `.generated/strategyCore.mjs`,
 * и сервер исполняет буквально тот же код оценки, что и браузер. Копий
 * математики на сервере нет — поэтому и типы берутся из `src/`, а не
 * пересказываются здесь.
 */

/**
 * Форма скомпилированного бандла (экспорты `entry.ts`).
 *
 * Классы объявлены как `any` сознательно: бандл собирается в рантайме из
 * `src/`, а серверный код и тесты обращаются к его статикам и внутренним
 * счётчикам (`resetInstance`, `getInstance().getStatus()`), точная форма
 * которых принадлежит ядру и проверяется его собственными тестами
 * (tests/unit/liveSignalEngine.test.ts, tests/integration/strategyEngineCore.test.ts).
 * Константы окна и таймфрейма типизированы строго: их читают движок и
 * parity-тесты, и ошибка здесь означала бы расхождение сервера с ядром.
 */
export interface StrategyCoreModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LiveSignalEngine: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SignalsAuditLedger: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateSetupGeometry: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ohlcvToArchive: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ohlcvArrayToArchive: (...args: any[]) => any;
  ARCHIVE_TF_MS: Readonly<Record<string, number>>;
  /** Сколько баров просит ядро: 1h / 4h / 1d (CANDLE_LIMIT_* из LiveSignalEngine). */
  CANDLE_LIMIT_1H: number;
  CANDLE_LIMIT_4H: number;
  CANDLE_LIMIT_1D: number;
  /** Таймфрейм ИСПОЛНЕНИЯ ядра ('1h') — источник истины для каталога и БД. */
  EXEC_TIMEFRAME: string;
}

/**
 * Загружает ядро: при необходимости собирает бандл (одна сборка на процесс),
 * затем импортирует его с cache-busting. Фолбэка на заглушку нет: молчаливая
 * подмена ядра запрещена, ошибка пробрасывается наружу вместе с причиной.
 */
export declare function loadStrategyCore(): Promise<StrategyCoreModule>;

/** Внутренности для тестов загрузки бандла. */
export declare const __internals: {
  /** mtime бандла новее всех TS-исходников `src/services` и `entry.ts`. */
  isFresh: () => boolean;
  build: () => Promise<void>;
  OUT_FILE: string;
  OUT_DIR: string;
};
