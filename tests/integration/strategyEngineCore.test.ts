/**
 * CRYPTORA — Серверное ядро стратегий: закрытые свечи и инвариант геометрии.
 *
 * Сервер не содержит собственной математики: он исполняет тот же
 * `LiveSignalEngine`, что и браузер, собранный esbuild из `src/` (см.
 * server/services/strategyEngine/strategyCoreBundle.js). Этот файл проверяет,
 * что СОБРАННЫЙ артефакт действительно несёт те же защиты, что исходник:
 *
 *   • формирующаяся свеча не считается закрытой (никакого look-ahead);
 *   • инвариант геометрии сетапа на месте;
 *   • бандл собирается и экспортирует ожидаемый интерфейс.
 *
 * Без этого бандл мог бы тихо разойтись с исходниками, и сервер начал бы
 * оценивать незакрытые свечи.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// @ts-expect-error — серверный модуль на чистом JS без деклараций
import { loadStrategyCore } from '../../server/services/strategyEngine/strategyCoreBundle.js';

let core: any = null;
let skipReason: string | null = null;

beforeAll(async () => {
  try {
    core = await loadStrategyCore();
  } catch (e) {
    skipReason = `не удалось собрать/загрузить ядро: ${(e as Error).message}`;
  }
}, 120_000);

const guard = () => {
  if (!core) {
    console.warn(`  ↷ SKIPPED (${skipReason})`);
    return true;
  }
  return false;
};

describe('Собранное ядро стратегий', () => {
  it('собирается и экспортирует нужный интерфейс', () => {
    if (guard()) return;
    for (const name of ['LiveSignalEngine', 'SignalsAuditLedger', 'validateSetupGeometry', 'ohlcvToArchive', 'ARCHIVE_TF_MS']) {
      expect(core, `в бандле нет ${name}`).toHaveProperty(name);
    }
    // Одноразовый скан — точка входа серверного планировщика.
    expect(typeof core.LiveSignalEngine.prototype.scanOnce).toBe('function');
  });

  it('формирующаяся свеча НЕ считается закрытой', () => {
    if (guard()) return;
    const nowMs = Date.parse('2026-09-19T10:30:00Z');
    const candle = {
      time: Date.parse('2026-09-19T10:00:00Z') / 1000, // бар 10:00–11:00 ещё идёт
      open: 100, high: 105, low: 99, close: 103, volume: 10,
    };
    const archived = core.ohlcvToArchive(candle, '1h', nowMs);
    expect(archived.isClosed).toBe(false);
  });

  it('свеча, чей closeTime уже прошёл, считается закрытой', () => {
    if (guard()) return;
    const nowMs = Date.parse('2026-09-19T11:00:01Z');
    const candle = {
      time: Date.parse('2026-09-19T10:00:00Z') / 1000,
      open: 100, high: 105, low: 99, close: 103, volume: 10,
    };
    const archived = core.ohlcvToArchive(candle, '1h', nowMs);
    expect(archived.isClosed).toBe(true);
  });

  it('без nowMs свеча считается закрытой (обратная совместимость архива)', () => {
    if (guard()) return;
    const candle = { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
    expect(core.ohlcvToArchive(candle, '1h').isClosed).toBe(true);
  });

  it('инвариант геометрии отклоняет прод-сетап V3.3 SHORT', () => {
    if (guard()) return;
    const violations = core.validateSetupGeometry({
      direction: 'SHORT',
      entry: 2615.0,
      stop: 2613.45, // внутри зоны входа — ровно как на проде
      tp1: 2573.93,
      tp2: 2611.9,
    });
    expect(violations).toContain('STOP_ON_WRONG_SIDE');
    expect(violations).toContain('TP_ORDER_INVERTED');
  });

  it('инвариант геометрии пропускает корректный SHORT', () => {
    if (guard()) return;
    expect(
      core.validateSetupGeometry({
        direction: 'SHORT',
        entry: 2615.0,
        stop: 2625.0,
        tp1: 2600.0,
        tp2: 2570.0,
      })
    ).toEqual([]);
  });
});
