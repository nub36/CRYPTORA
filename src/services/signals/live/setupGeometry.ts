/**
 * Геометрическая валидность сетапа.
 *
 * ⚠️ Это НЕ новая математика и не изменение стратегии.
 *
 * Инвариант порядка уровней взят дословно из замороженного определения V3.3
 * (`definitions/v3_3-htf-zone-mitigation/v33Runner.ts`, проверка при исполнении):
 *
 *   LONG : stop < entry && tp1 > entry && tp2 > tp1
 *   SHORT: stop > entry && tp1 < entry && tp2 < tp1
 *
 * Определение само отбрасывает сетапы, нарушающие порядок. Живой адаптер
 * (`LiveSignalEngine.runV33`) такой проверки не имел, из-за чего в ledger
 * попадали внутренне противоречивые сетапы — например SHORT ETH с уровнем
 * отмены внутри зоны входа и с TP2 ближе, чем TP1.
 *
 * Функция чистая и экспортируется отдельно, чтобы её можно было покрыть
 * регрессионными тестами без поднятия движка.
 */

export interface SetupGeometry {
  direction: 'LONG' | 'SHORT';
  /** Референсная цена входа (середина лимитного коридора). */
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
}

export type SetupGeometryViolation =
  | 'STOP_ON_WRONG_SIDE'
  | 'TP1_ON_WRONG_SIDE'
  | 'TP_ORDER_INVERTED'
  | 'NON_POSITIVE_RISK';

/**
 * Возвращает список нарушений инварианта. Пустой массив — сетап корректен.
 * Все числа должны быть конечными; иначе это тоже нарушение.
 */
export function validateSetupGeometry(g: SetupGeometry): SetupGeometryViolation[] {
  const { direction, entry, stop, tp1, tp2 } = g;
  const bad: SetupGeometryViolation[] = [];

  if (![entry, stop, tp1, tp2].every((n) => Number.isFinite(n))) {
    return ['NON_POSITIVE_RISK'];
  }

  const long = direction === 'LONG';

  // Стоп обязан быть по «нерабочую» сторону от входа.
  if (long ? !(stop < entry) : !(stop > entry)) bad.push('STOP_ON_WRONG_SIDE');

  // TP1 обязан быть по ходу движения.
  if (long ? !(tp1 > entry) : !(tp1 < entry)) bad.push('TP1_ON_WRONG_SIDE');

  // TP2 всегда дальше TP1 (см. frozen runner: `tp2 > tp1` / `tp2 < tp1`).
  if (long ? !(tp2 > tp1) : !(tp2 < tp1)) bad.push('TP_ORDER_INVERTED');

  if (!(Math.abs(entry - stop) > 0)) bad.push('NON_POSITIVE_RISK');

  return bad;
}

export const isSetupGeometryValid = (g: SetupGeometry): boolean =>
  validateSetupGeometry(g).length === 0;
