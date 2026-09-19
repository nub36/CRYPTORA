/**
 * CRYPTORA — регрессии на «странный V3.3 setup» с прода.
 *
 * НАБЛЮДЕНИЕ (production):
 *   ETH/USDT/USDT · V3.3 · SHORT
 *   Entry 2612.7–2617.3 · Stop «< 2613.45» · Targets 2573.93 / 2611.9 · R:R 1:2
 *
 * УСТАНОВЛЕННАЯ ПРИЧИНА (пошаговый trace, см. отчёт):
 *   A. `LiveSignalEngine.publish()` писал `${symbol}/USDT`, а SignalsPage
 *      добавлял `/USDT` ещё раз → «ETH/USDT/USDT». Чисто presentation.
 *   B. Знак «<» был захардкожен в SignalsPage. Для SHORT стоп ВЫШЕ входа,
 *      поэтому знак должен быть «>». Чисто presentation.
 *   C. Живой адаптер `runV33` считал уровни НЕ так, как замороженное
 *      определение V3.3, и не проверял инвариант порядка, который само
 *      определение проверяет при исполнении (v33Runner.ts):
 *        LONG : stop < entry && tp1 > entry && tp2 > tp1
 *        SHORT: stop > entry && tp1 < entry && tp2 < tp1
 *      Поэтому публиковался SHORT со стопом внутри зоны входа и с TP2 ближе TP1.
 *
 * Числа ниже воспроизводят прод-сетап ТОЧНО по формулам адаптера:
 *   entryMid 2615.0, half 2.3, stop 2613.45 → risk 1.55
 *   tp2 = entryMid − 2·risk = 2611.9      ✓ совпадает с продом
 *   tp1 = 2·eq − entryMid   = 2573.93     ✓ совпадает с продом (eq ≈ 2594.465)
 *   R:R = |tp2 − mid| / |mid − stop| = 3.1 / 1.55 = 2 ✓
 *
 * REAL: validateSetupGeometry, LiveSignalEngine (полный путь scan → publish →
 * ledger), pairLabel/stopComparator. Математика стратегий не переопределяется.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateSetupGeometry,
  isSetupGeometryValid,
} from '@/services/signals/live/setupGeometry';
import { pairLabel, stopComparator } from '@/utils/labels';
import { LiveSignalEngine } from '@/services/signals/live/LiveSignalEngine';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';

/* ══ A. Символ: «ETH/USDT» никогда не становится «ETH/USDT/USDT» ══ */

describe('A — нормализация символа', () => {
  it('добавляет котировочную валюту только один раз', () => {
    expect(pairLabel('ETH')).toBe('ETH/USDT');
    expect(pairLabel('ETH/USDT')).toBe('ETH/USDT');
    expect(pairLabel('ETHUSDT')).toBe('ETH/USDT');
  });

  it('идемпотентна: повторный вызов не удваивает суффикс', () => {
    let s = 'ETH';
    for (let i = 0; i < 5; i++) s = pairLabel(s);
    expect(s).toBe('ETH/USDT');
    expect(s).not.toContain('USDT/USDT');
  });

  it('прод-кейс: ETH/USDT/USDT больше не появляется', () => {
    // Именно это значение лежало в ledger на проде.
    expect(pairLabel('ETH/USDT')).not.toBe('ETH/USDT/USDT');
  });

  it('Ledger хранит уже нормализованную пару', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/services/signals/live/LiveSignalEngine.ts'),
      'utf8'
    );
    expect(src).toContain('symbol: pairLabel(params.symbol)');
    expect(src).not.toContain('symbol: `${params.symbol}/USDT`');
  });
});

/* ══ B. SHORT: правильный знак сравнения у Stop Loss ═════════════ */

describe('B — компаратор Stop Loss', () => {
  it('для LONG стоп ниже входа, для SHORT — выше', () => {
    expect(stopComparator('LONG')).toBe('<');
    expect(stopComparator('SHORT')).toBe('>');
  });

  it('в SignalsPage знак берётся из направления, а не захардкожен', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/pages/SignalsPage.tsx'),
      'utf8'
    );
    expect(src).toContain('stopComparator(setup.direction)');
    expect(src).not.toMatch(/&lt;\s*\$\{setup\.invalidationLevel/);
  });
});

/* ══ C. Геометрия: точные прод-числа ════════════════════════════ */

describe('C — геометрия прод-сетапа V3.3 SHORT', () => {
  // Ровно то, что было на проде.
  const PROD = {
    direction: 'SHORT' as const,
    entry: 2615.0,
    stop: 2613.45,
    tp1: 2573.93,
    tp2: 2611.9,
  };

  it('прод-сетап действительно противоречив (стоп внутри зоны входа)', () => {
    const v = validateSetupGeometry(PROD);
    expect(v).toContain('STOP_ON_WRONG_SIDE');
    expect(v).toContain('TP_ORDER_INVERTED');
    expect(isSetupGeometryValid(PROD)).toBe(false);
  });

  it('R:R 1:2 воспроизводится формулой адаптера — trace подтверждён', () => {
    const risk = Math.abs(PROD.entry - PROD.stop);
    const reward = Math.abs(PROD.tp2 - PROD.entry);
    expect(risk).toBeCloseTo(1.55, 6);
    expect(reward).toBeCloseTo(3.1, 6);
    expect(Number((reward / risk).toFixed(2))).toBe(2);
  });

  it('корректный SHORT с теми же уровнями, но правильным порядком — валиден', () => {
    expect(
      isSetupGeometryValid({
        direction: 'SHORT',
        entry: 2615.0,
        stop: 2625.0, // выше входа
        tp1: 2600.0, // ближе
        tp2: 2570.0, // дальше
      })
    ).toBe(true);
  });

  it('корректный LONG валиден', () => {
    expect(
      isSetupGeometryValid({
        direction: 'LONG',
        entry: 100,
        stop: 95,
        tp1: 108,
        tp2: 120,
      })
    ).toBe(true);
  });

  it('нулевой риск отклоняется', () => {
    expect(
      validateSetupGeometry({ direction: 'LONG', entry: 100, stop: 100, tp1: 110, tp2: 120 })
    ).toContain('NON_POSITIVE_RISK');
  });

  it('не конечные значения отклоняются', () => {
    expect(
      validateSetupGeometry({ direction: 'LONG', entry: 100, stop: NaN, tp1: 110, tp2: 120 })
    ).toContain('NON_POSITIVE_RISK');
  });
});

/* ══ D. Движок не публикует противоречивые сетапы ═══════════════ */

const providerStub = (): MarketDataProvider =>
  ({
    isDemo: false,
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles: vi.fn().mockResolvedValue([]),
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockResolvedValue({ total24h: 0, dataStatus: 'UNAVAILABLE' }),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getMarketOverview: vi.fn().mockResolvedValue({}),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  }) as unknown as MarketDataProvider;

/**
 * Вызывает НАСТОЯЩИЙ production `LiveSignalEngine.publish()` (не копию).
 * `publish` объявлен private, но это внутреннее разделение движка: тест
 * проверяет именно тот код, который публикует сигналы в проде.
 */
function callPublish(engine: LiveSignalEngine, params: Record<string, unknown>): void {
  (engine as unknown as { publish: (p: unknown) => void }).publish({
    id: params.id ?? 'test-setup',
    strategy: params.strategy ?? 'V3.3',
    symbol: params.symbol ?? 'ETH',
    direction: params.direction ?? 'SHORT',
    entryLow: params.entryLow ?? 2612.7,
    entryHigh: params.entryHigh ?? 2617.3,
    stop: params.stop ?? 2613.45,
    tp1: params.tp1 ?? 2573.93,
    tp2: params.tp2 ?? 2611.9,
    confirmingFactors: params.confirmingFactors ?? ['RVOL 2.4', 'Wick rejection 68%'],
    invalidationFactors: params.invalidationFactors ?? [],
  });
}

describe('D — LiveSignalEngine не публикует противоречивые сетапы', () => {
  beforeEach(() => {
    LiveSignalEngine.resetInstance();
    // Ledger гидратируется из localStorage при конструировании, поэтому
    // сброса синглтона недостаточно — иначе сетапы перетекают между тестами.
    localStorage.removeItem('cryptora_signals_ledger');
    SignalsAuditLedger['instance'] = null;
  });

  it('publish() защищён инвариантом (защита от удаления)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/services/signals/live/LiveSignalEngine.ts'),
      'utf8'
    );
    expect(src).toContain('validateSetupGeometry({');
    expect(src).toMatch(/if \(violations\.length > 0\)[\s\S]{0,400}return;/);
  });

  it('ТОЧНЫЙ прод-сетап V3.3 SHORT НЕ попадает в ledger', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const engine = LiveSignalEngine.getInstance({ provider: providerStub() })!;

    callPublish(engine, {
      direction: 'SHORT',
      entryLow: 2612.7,
      entryHigh: 2617.3,
      stop: 2613.45,
      tp1: 2573.93,
      tp2: 2611.9,
    });

    expect(ledger.getSetups()).toHaveLength(0);
    expect(engine.lastRejected).not.toBeNull();
    expect(engine.lastRejected!.strategy).toBe('V3.3');
    expect(engine.lastRejected!.violations).toContain('STOP_ON_WRONG_SIDE');
    expect(engine.lastRejected!.violations).toContain('TP_ORDER_INVERTED');
  });

  it('корректный SHORT тем же путём публикуется (проверка не отсекает всё)', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const engine = LiveSignalEngine.getInstance({ provider: providerStub() })!;

    callPublish(engine, {
      id: 'ok-short',
      direction: 'SHORT',
      entryLow: 2612.7,
      entryHigh: 2617.3,
      stop: 2625.0,
      tp1: 2600.0,
      tp2: 2570.0,
    });

    const setups = ledger.getSetups();
    expect(setups).toHaveLength(1);
    expect(setups[0]!.symbol).toBe('ETH/USDT');
    expect(setups[0]!.targets).toEqual([2600.0, 2570.0]);
  });

  it('R:R корректного сетапа считается по TP2 и больше 1', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const engine = LiveSignalEngine.getInstance({ provider: providerStub() })!;
    callPublish(engine, {
      id: 'ok-short',
      direction: 'SHORT',
      entryLow: 2612.7,
      entryHigh: 2617.3,
      stop: 2625.0,
      tp1: 2600.0,
      tp2: 2570.0,
    });
    const s = ledger.getSetups()[0]!;
    // risk = 2625 − 2615 = 10; reward = 2615 − 2570 = 45 → 4.5
    expect(s.riskRewardRatio).toBeCloseTo(4.5, 6);
  });

  it('LONG со стопом выше входа тоже отклоняется', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const engine = LiveSignalEngine.getInstance({ provider: providerStub() })!;
    callPublish(engine, {
      direction: 'LONG',
      entryLow: 2612.7,
      entryHigh: 2617.3,
      stop: 2616.45,
      tp1: 2660.0,
      tp2: 2700.0,
    });
    expect(ledger.getSetups()).toHaveLength(0);
    expect(engine.lastRejected!.violations).toContain('STOP_ON_WRONG_SIDE');
  });

  it('LONG с корректной геометрией публикуется', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const engine = LiveSignalEngine.getInstance({ provider: providerStub() })!;
    callPublish(engine, {
      id: 'ok-long',
      direction: 'LONG',
      entryLow: 2612.7,
      entryHigh: 2617.3,
      stop: 2600.0,
      tp1: 2640.0,
      tp2: 2680.0,
    });
    expect(ledger.getSetups()).toHaveLength(1);
  });
});
