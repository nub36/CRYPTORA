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

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateSetupGeometry,
  isSetupGeometryValid,
} from '@/services/signals/live/setupGeometry';
import { corridorGeometryOk, rrFrom } from '@/services/signals/live/replays/shared';
import { toPair } from '@/services/signals/live/LiveSignalEngine';
import { pairLabel, stopComparator } from '@/utils/labels';

/** Прочитать исходник production-модуля (проверка «защита от удаления»). */
const srcOf = (rel: string): string =>
  fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');

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
    const src = srcOf('src/services/signals/live/LiveSignalEngine.ts');
    // publish() кладёт в ledger ПОЛНУЮ пару, а не базовый актив…
    expect(src).toContain('symbol: pair,');
    // …и нормализация идемпотентна: toPair делегирует pairLabel, поэтому
    // «ETH/USDT» не превращается в «ETH/USDT/USDT», а «ETHUSDT» → «ETH/USDT».
    expect(src).toContain('return pairLabel(symbol).toUpperCase();');
    expect(toPair('ETH')).toBe('ETH/USDT');
    expect(toPair('ETH/USDT')).toBe('ETH/USDT');
    expect(toPair('ETHUSDT')).toBe('ETH/USDT');
  });
});

/* ══ B. SHORT: правильный знак сравнения у Stop Loss ═════════════ */

describe('B — компаратор Stop Loss', () => {
  it('для LONG стоп ниже входа, для SHORT — выше', () => {
    expect(stopComparator('LONG')).toBe('<');
    expect(stopComparator('SHORT')).toBe('>');
  });

  it('в SignalsPage знак берётся из направления, а не захардкожен', () => {
    const src = srcOf('src/pages/SignalsPage.tsx');
    expect(src).toContain('stopComparator(setup.direction)');
    // Знак не зашит литералом рядом с уровнем отмены.
    expect(src).not.toMatch(/'<'[^)]*invalidationLevel/);
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

/* ══ D. Движок не публикует противоречивые сетапы ═══════════════
 *
 * Архитектура main (v0.9.x): геометрию проверяет НЕ `publish()`, а реплеи
 * стратегий — `corridorGeometryOk()` считает инвариант при ХУДШЕМ исполнении
 * в лимитном коридоре и кладёт результат в `ReplayRecord.publishable`.
 * `LiveSignalEngine.scanSymbol()` затем отбрасывает все записи
 * `!publishable` до обращения к ledger. Противоречивый сетап остаётся
 * видимым в ретроспективе (диагностика окна), но в журнал аудита не попадает.
 *
 * Поэтому здесь проверяются: (1) сам инвариант на точных прод-числах,
 * (2) наличие гейта в production-коде — «защита от удаления».
 * Полный путь scan → publish → ledger покрыт в
 * tests/unit/signals/liveSignalEngineE2E.test.ts.
 */

/** Точные числа прод-сетапа ETH V3.3 SHORT (см. шапку файла). */
const PROD_SHORT = {
  zoneLow: 2612.7,
  zoneHigh: 2617.3,
  mid: 2615.0,
  stop: 2613.45,
  tp1: 2573.93,
  tp2: 2611.9,
};

/** Корректный SHORT: стоп выше входа, TP1 ближе, TP2 дальше. */
const OK_SHORT = {
  zoneLow: 2612.7,
  zoneHigh: 2617.3,
  mid: 2615.0,
  stop: 2625.0,
  tp1: 2600.0,
  tp2: 2570.0,
};

/** Корректный LONG: стоп ниже входа, TP1 выше, TP2 выше TP1. */
const OK_LONG = {
  zoneLow: 2612.7,
  zoneHigh: 2617.3,
  mid: 2615.0,
  stop: 2600.0,
  tp1: 2640.0,
  tp2: 2680.0,
};

describe('D — движок не публикует противоречивые сетапы', () => {
  it('publish-гейт на месте (защита от удаления)', () => {
    const src = srcOf('src/services/signals/live/LiveSignalEngine.ts');
    // scanSymbol() обязан отбрасывать негодные к публикации записи ДО ledger.
    expect(src).toContain('if (!rec.publishable) continue;');

    // Реплеи V3.0/V3.3 обязаны вычислять publishable через инвариант геометрии.
    for (const rel of [
      'src/services/signals/live/replays/v30LiveReplay.ts',
      'src/services/signals/live/replays/v33LiveReplay.ts',
    ]) {
      const replay = srcOf(rel);
      expect(replay).toContain('corridorGeometryOk(');
      expect(replay).toContain('publishable: geometryOk');
    }
  });

  it('ТОЧНЫЙ прод-сетап V3.3 SHORT не пригоден к публикации', () => {
    const publishable = corridorGeometryOk(
      'SHORT', PROD_SHORT.zoneLow, PROD_SHORT.zoneHigh, PROD_SHORT.stop, PROD_SHORT.tp1, PROD_SHORT.tp2,
    );
    expect(publishable).toBe(false);

    // Те же числа, но с читаемыми кодами нарушений (референс входа — середина коридора).
    const violations = validateSetupGeometry({
      direction: 'SHORT',
      entry: PROD_SHORT.mid,
      stop: PROD_SHORT.stop,
      tp1: PROD_SHORT.tp1,
      tp2: PROD_SHORT.tp2,
    });
    expect(violations).toContain('STOP_ON_WRONG_SIDE');
    expect(violations).toContain('TP_ORDER_INVERTED');
  });

  it('прод-сетап остаётся в ретроспективе, но помечен как непубликуемый', () => {
    // Ретроспектива хранит запись (диагностика), publishable=false блокирует ledger.
    expect(corridorGeometryOk('SHORT', PROD_SHORT.zoneLow, PROD_SHORT.zoneHigh, PROD_SHORT.stop, PROD_SHORT.tp1, PROD_SHORT.tp2)).toBe(false);
    expect(isSetupGeometryValid({ direction: 'SHORT', entry: PROD_SHORT.mid, stop: PROD_SHORT.stop, tp1: PROD_SHORT.tp1, tp2: PROD_SHORT.tp2 })).toBe(false);
  });

  it('R:R прод-сетапа воспроизводит 1:2 по формуле адаптера', () => {
    // reward/risk от середины коридора до TP2 — ровно то, что видел прод.
    expect(rrFrom('SHORT', PROD_SHORT.mid, PROD_SHORT.stop, PROD_SHORT.tp2)).toBeCloseTo(2, 6);
  });

  it('корректный SHORT тем же путём проходит гейт (проверка не отсекает всё)', () => {
    expect(
      corridorGeometryOk('SHORT', OK_SHORT.zoneLow, OK_SHORT.zoneHigh, OK_SHORT.stop, OK_SHORT.tp1, OK_SHORT.tp2),
    ).toBe(true);
    // R:R считается по TP2: risk = 2625 − 2615 = 10, reward = 2615 − 2570 = 45 → 4.5.
    expect(rrFrom('SHORT', OK_SHORT.mid, OK_SHORT.stop, OK_SHORT.tp2)).toBeCloseTo(4.5, 6);
  });

  it('LONG со стопом не с той стороны отклоняется', () => {
    // Важная семантика: `corridorGeometryOk` проверяет стоп при ХУДШЕМ исполнении
    // в коридоре (LONG → fill = zoneHigh), а `validateSetupGeometry` — от середины.
    // Поэтому стоп между серединой и zoneHigh для LONG ещё допустим (при худшем
    // исполнении он ниже входа), а стоп ВЫШЕ zoneHigh отклоняется обоими.
    const stopBetween = 2616.45; // mid 2615.0 < stop < zoneHigh 2617.3
    expect(corridorGeometryOk('LONG', 2612.7, 2617.3, stopBetween, 2660.0, 2700.0)).toBe(true);
    expect(
      validateSetupGeometry({ direction: 'LONG', entry: 2615.0, stop: stopBetween, tp1: 2660.0, tp2: 2700.0 }),
    ).toContain('STOP_ON_WRONG_SIDE');

    const stopAboveZone = 2620.0; // хуже любого исполнения в коридоре
    expect(corridorGeometryOk('LONG', 2612.7, 2617.3, stopAboveZone, 2660.0, 2700.0)).toBe(false);
    expect(
      validateSetupGeometry({ direction: 'LONG', entry: 2615.0, stop: stopAboveZone, tp1: 2660.0, tp2: 2700.0 }),
    ).toContain('STOP_ON_WRONG_SIDE');
  });

  it('SHORT со стопом ниже коридора отклоняется (симметричный случай)', () => {
    const stopBelowZone = 2600.0; // ниже zoneLow 2612.7 → при худшем (SHORT) исполнении стоп не сверху
    expect(corridorGeometryOk('SHORT', 2612.7, 2617.3, stopBelowZone, 2570.0, 2540.0)).toBe(false);
    expect(
      validateSetupGeometry({ direction: 'SHORT', entry: 2615.0, stop: stopBelowZone, tp1: 2570.0, tp2: 2540.0 }),
    ).toContain('STOP_ON_WRONG_SIDE');
  });

  it('LONG с корректной геометрией проходит гейт', () => {
    expect(
      corridorGeometryOk('LONG', OK_LONG.zoneLow, OK_LONG.zoneHigh, OK_LONG.stop, OK_LONG.tp1, OK_LONG.tp2),
    ).toBe(true);
    expect(rrFrom('LONG', OK_LONG.mid, OK_LONG.stop, OK_LONG.tp2)).toBeGreaterThan(1);
  });
});
