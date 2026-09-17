/**
 * CRYPTORA — политика режима данных.
 * ---------------------------------------------------------------------------
 * РЕШЕНИЕ ВЛАДЕЛЬЦА: в production пользовательского DEMO-режима НЕТ ВООБЩЕ.
 *
 *  - production runtime работает ТОЛЬКО с фактическим источником (LIVE);
 *  - никаких переключателей DEMO/LIVE, кнопок «включить демо» и восстановления
 *    demo из localStorage (ключ `cryptora_data_mode` больше не читается и не пишется);
 *  - при недоступном источнике — «Источник недоступен / Нет данных» + повтор запроса,
 *    без demo-fallback.
 *
 * DEV / TEST: `DemoMarketDataProvider` и детерминированные фикстуры сохраняются,
 * но включаются только явным механизмом разработки/тестирования, которого нет в
 * production-сборке:
 *  - dev-сервер Vite (`import.meta.env.DEV`) или сборка с `VITE_CRYPTORA_QA_FIXTURE=1`,
 *    И ключ `cryptora_qa_fixture=1` в localStorage (оба условия обязательны);
 *  - тестовые раннеры без Vite (Playwright/JSDOM, Vitest) считаются dev-окружением.
 *
 * В production-сборке (`vite build` без переменной) `QA_FIXTURE_ALLOWED` — статический
 * `false`: ключ localStorage игнорируется, режим всегда `live`.
 * Фикстуры никогда не маскируются под LIVE: любой QA-датасет маркируется `QA`.
 */
export type DataMode = 'demo' | 'live';

/** Ключ localStorage для явного включения QA-фикстуры (только dev/test). */
export const QA_FIXTURE_STORAGE_KEY = 'cryptora_qa_fixture';

interface ViteLikeEnv {
  DEV?: boolean;
  PROD?: boolean;
  VITE_CRYPTORA_QA_FIXTURE?: string;
}

function readEnv(): ViteLikeEnv | undefined {
  try {
    return (import.meta as unknown as { env?: ViteLikeEnv }).env;
  } catch {
    return undefined;
  }
}

function computeQaFixtureAllowed(): boolean {
  const env = readEnv();
  // Нет Vite-окружения (Playwright + Babel, чистый Node) — это тестовый раннер.
  if (!env) return true;
  if (env.VITE_CRYPTORA_QA_FIXTURE === '1') return true;
  return env.DEV === true;
}

/** Разрешён ли QA-датасет в текущей сборке (dev-сервер, тесты или явная QA-сборка). */
export const QA_FIXTURE_ALLOWED: boolean = computeQaFixtureAllowed();

/** Production runtime: только LIVE, DEMO недоступен ни при каких условиях. */
export const IS_PRODUCTION_RUNTIME: boolean = !QA_FIXTURE_ALLOWED;

/**
 * Разрешение режима данных при старте.
 * Production (`allowed === false`) → всегда `live`, хранилище не читается.
 * Dev/test → `demo`, только если фикстура явно включена ключом `cryptora_qa_fixture=1`.
 */
export function resolveInitialDataMode(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  allowed: boolean = QA_FIXTURE_ALLOWED
): DataMode {
  if (!allowed) return 'live';
  try {
    return storage?.getItem(QA_FIXTURE_STORAGE_KEY) === '1' ? 'demo' : 'live';
  } catch {
    return 'live';
  }
}
