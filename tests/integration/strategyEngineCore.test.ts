/** @vitest-environment node */
/**
 * CRYPTORA — Серверное ядро стратегий: загрузка бандла, контракт методов и
 * инварианты, которые сервер обязан сохранить.
 *
 * Сервер не содержит собственной математики: он исполняет тот же
 * `LiveSignalEngine`, что и браузер, собранный esbuild из `src/` (см.
 * server/services/strategyEngine/strategyCoreBundle.js). Этот файл проверяет,
 * что СОБРАННЫЙ артефакт действительно несёт те же защиты, что исходник:
 *
 *   • бандл собирается и загружается (иначе сервер не сканирует ничего);
 *   • точка входа скана — РЕАЛЬНО существующий метод `scanNow()` (F-01: движок
 *     вызывал `scanOnce()`, которого в ядре никогда не было ⇒ TypeError на
 *     каждом скане и нуль сигналов при зелёном планировщике);
 *   • формирующаяся свеча не считается закрытой (никакого look-ahead);
 *   • инвариант геометрии сетапа на месте.
 *
 * ── Почему `@vitest-environment node` (F-03) ────────────────────────────────
 * Глобальное окружение набора — jsdom (фронтенд). esbuild, который собирает
 * бандл, при старте проверяет собственные инварианты и в jsdom падает:
 *   Invariant violation: "new TextEncoder().encode("") instanceof Uint8Array"
 *   is incorrectly false
 * Прежняя версия файла ловила эту ошибку в beforeAll, печатала `↷ SKIPPED` в
 * stderr и ВОЗВРАЩАЛА SUCCESS из каждого теста: vitest засчитывал их как
 * passed. В CI, где `.generated/` отсутствует и бандл собирается с нуля, все
 * шесть контрактов ядра молча не выполнялись НИ РАЗУ — ложно-зелёный набор.
 *
 * Теперь: (1) окружение node — сборка проходит, тесты реально исполняются;
 * (2) если ядро всё же не загрузилось, первый тест КРАСНЫЙ с причиной, а
 * остальные видны в отчёте как skipped (ctx.skip()), а не как passed.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { loadStrategyCore } from '../../server/services/strategyEngine/strategyCoreBundle.js';

let core: any = null;
let loadError: string | null = null;

beforeAll(async () => {
  try {
    core = await loadStrategyCore();
  } catch (e) {
    loadError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  }
}, 180_000);

/**
 * Тесты, требующие загруженного ядра. Пропуск оформляется через `ctx.skip()` —
 * так vitest показывает их как skipped. Прежняя форма (`console.warn` + return)
 * давала passed при невыполненных проверках.
 */
const withCore = (name: string, fn: () => void | Promise<void>) =>
  it(name, async (ctx) => {
    if (!core) {
      ctx.skip();
      return;
    }
    await fn();
  });

describe('Собранное ядро стратегий', () => {
  it('собирается и загружается (без этого сервер не может сканировать)', () => {
    // Якорь против ложно-зелёного прогона: если бандл не собрался, файл обязан
    // быть КРАСНЫМ, а не «6 passed».
    if (loadError) {
      throw new Error(
        `Ядро стратегий не загрузилось — контракты ниже непроверяемы.\n${loadError}`
      );
    }
    expect(core, 'loadStrategyCore() вернул пустой модуль').toBeTruthy();
  });

  withCore('экспортирует интерфейс, который использует серверный движок', () => {
    for (const name of [
      'LiveSignalEngine',
      'SignalsAuditLedger',
      'validateSetupGeometry',
      'ohlcvToArchive',
      'ARCHIVE_TF_MS',
    ]) {
      expect(core, `в бандле нет ${name}`).toHaveProperty(name);
    }
    // Окно данных и таймфрейм исполнения движок берёт ИЗ ЯДРА, а не из ручной
    // копии: именно копия-пересказ математики породила баг V3.3 на проде.
    for (const name of ['EXEC_TIMEFRAME', 'CANDLE_LIMIT_1H', 'CANDLE_LIMIT_4H', 'CANDLE_LIMIT_1D']) {
      expect(core, `в бандле нет константы ${name}`).toHaveProperty(name);
    }
    expect(typeof core.LiveSignalEngine.getInstance).toBe('function');
    expect(typeof core.LiveSignalEngine.resetInstance).toBe('function');
    expect(typeof core.SignalsAuditLedger.getInstance).toBe('function');
  });

  withCore('точка входа скана — scanNow(); фантомного scanOnce() в ядре нет (F-01)', () => {
    const proto = core.LiveSignalEngine.prototype;
    expect(
      typeof proto.scanNow,
      'LiveSignalEngine.scanNow обязан существовать: его вызывает server/services/strategyEngine/strategyEngine.js'
    ).toBe('function');
    expect(
      proto.scanOnce,
      'scanOnce() никогда не существовал в ядре; его появление означало бы подмену контракта'
    ).toBeUndefined();
    expect(typeof proto.getStatus).toBe('function');
    expect(typeof proto.getRetrospective).toBe('function');
  });

  withCore('scanNow() исполняется на синтетическом провайдере и возвращает Promise', async () => {
    core.LiveSignalEngine.resetInstance();
    const engine = core.LiveSignalEngine.getInstance({
      provider: { isDemo: true, getCandles: async () => [] },
      symbols: ['BTCUSDT'],
      strategies: ['V3.0'],
    });
    const p = engine.scanNow();
    expect(p, 'scanNow() обязан возвращать Promise — движок ждёт его через await').toBeInstanceOf(
      Promise
    );
    await p;
    const status = engine.getStatus();
    expect(status.scanCount, 'скан обязан увеличить счётчик ядра').toBeGreaterThan(0);
    core.LiveSignalEngine.resetInstance();
  });

  withCore('формирующаяся свеча НЕ считается закрытой', () => {
    const nowMs = Date.parse('2026-09-19T10:30:00Z');
    const candle = {
      time: Date.parse('2026-09-19T10:00:00Z') / 1000, // бар 10:00–11:00 ещё идёт
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 10,
    };
    const archived = core.ohlcvToArchive(candle, '1h', nowMs);
    expect(archived.isClosed).toBe(false);
  });

  withCore('свеча, чей closeTime уже прошёл, считается закрытой', () => {
    const nowMs = Date.parse('2026-09-19T11:00:01Z');
    const candle = {
      time: Date.parse('2026-09-19T10:00:00Z') / 1000,
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 10,
    };
    const archived = core.ohlcvToArchive(candle, '1h', nowMs);
    expect(archived.isClosed).toBe(true);
  });

  withCore('без nowMs свеча считается закрытой (обратная совместимость архива)', () => {
    const candle = { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
    expect(core.ohlcvToArchive(candle, '1h').isClosed).toBe(true);
  });

  withCore('инвариант геометрии отклоняет прод-сетап V3.3 SHORT', () => {
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

  withCore('инвариант геометрии пропускает корректный SHORT', () => {
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

  withCore('окно исполнения ядра — 1h, а не 15m из ТЗ исследования (V2.8 metadata)', () => {
    expect(core.EXEC_TIMEFRAME).toBe('1h');
    expect(core.ARCHIVE_TF_MS['1h']).toBe(3_600_000);
    expect(core.ARCHIVE_TF_MS['4h']).toBe(14_400_000);
    expect(core.ARCHIVE_TF_MS['1d']).toBe(86_400_000);
  });
});
