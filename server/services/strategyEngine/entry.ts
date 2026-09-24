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
