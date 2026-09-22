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
