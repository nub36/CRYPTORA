/**
 * Точка сборки серверного ядра стратегий.
 *
 * Сервер написан на чистом JS, а стратегии — на TypeScript в `src/`. Чтобы НЕ
 * КОПИРОВАТЬ математику вручную (именно копия-пересказ и породила баг V3.3),
 * esbuild собирает этот файл вместе с его TS-зависимостями в один ESM-модуль,
 * который импортирует Node. Сервер исполняет буквально тот же код оценки,
 * что и браузер.
 *
 * Артефакт сборки кладётся в .generated/ и в Git не попадает.
 */

export { LiveSignalEngine } from '@/services/signals/live/LiveSignalEngine';
export { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
export { validateSetupGeometry } from '@/services/signals/live/setupGeometry';
export { ohlcvToArchive, ohlcvArrayToArchive } from '@/services/signals/live/ohlcvAdapter';
export { ARCHIVE_TF_MS } from '@/services/strategyArchive/types';

/**
 * Ведение ОПУБЛИКОВАННОГО сетапа — та же frozen-функция, которой браузерный
 * движок ведёт журнал (`LiveSignalEngine.trackOpenSetups` → `trackPublishedSetup`)
 * и которой серверный движок получает `ReplayRecord.fill` / `ReplayRecord.outcome`
 * через LIVE-реплеи. Серверный монитор позиций обязан вызывать ИМЕННО ЕЁ, а не
 * собственную копию правил выхода: любая копия расходится с определением (именно
 * так появился баг V3.3). Экспорт аддитивен и не меняет поведение функции.
 */
export { trackPublishedSetup } from '@/services/signals/live/lifecycle';
export type { LifecycleResult } from '@/services/signals/live/lifecycle';

/**
 * Константы окна и таймфрейма исполнения — экспортируются, чтобы сервер НЕ
 * держал их ручную копию (именно копия-пересказ математики породила баг V3.3).
 * Серверный движок и parity-тесты читают требования к данным из того же
 * скомпилированного ядра, которое исполняют.
 */
export {
  CANDLE_LIMIT_1H,
  CANDLE_LIMIT_4H,
  CANDLE_LIMIT_1D,
  EXEC_TIMEFRAME,
} from '@/services/signals/live/LiveSignalEngine';
