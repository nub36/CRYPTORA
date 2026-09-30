/**
 * CRYPTORA — Strategy Lab · метрики (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Считает ТОЛЬКО реально вычислимые метрики. Если метрику посчитать не из чего
 * (нет сделок / нет проигрышей) — возвращается null, а UI показывает «—». Никаких
 * выдуманных нулей или 0% (§19).
 */

import type { LabMetrics, LabTrade } from './types';

/** Порог «безубытка» в R: |netR| ≤ EPS считается break-even. */
export const BREAK_EVEN_EPS_R = 1e-9;

export function computeMetrics(
  trades: LabTrade[],
  candidateCount: number,
  rejectedCount: number
): LabMetrics {
  const tradeCount = trades.length;

  let profitable = 0;
  let losing = 0;
  let breakEven = 0;
  let resolved = 0;
  let sumNetR = 0;
  let sumPositive = 0;
  let sumNegativeAbs = 0;

  for (const t of trades) {
    sumNetR += t.netR;
    if (t.outcome === 'TARGET' || t.outcome === 'STOP') resolved += 1;
    if (t.netR > BREAK_EVEN_EPS_R) {
      profitable += 1;
      sumPositive += t.netR;
    } else if (t.netR < -BREAK_EVEN_EPS_R) {
      losing += 1;
      sumNegativeAbs += Math.abs(t.netR);
    } else {
      breakEven += 1;
    }
  }

  const decided = profitable + losing;
  const winRate = decided > 0 ? profitable / decided : null;
  const averageNetR = tradeCount > 0 ? sumNetR / tradeCount : null;
  const expectancy = averageNetR; // матожидание в R на сделку = средний netR
  const profitFactor = sumNegativeAbs > 0 ? sumPositive / sumNegativeAbs : null;

  // Максимальная просадка кривой суммарного R.
  let maxDrawdownR: number | null = null;
  if (tradeCount > 0) {
    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of trades) {
      equity += t.netR;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;
    }
    maxDrawdownR = maxDd;
  }

  return {
    totalCandidates: candidateCount,
    accepted: tradeCount,
    rejected: rejectedCount,
    trades: tradeCount,
    resolved,
    profitable,
    losing,
    breakEven,
    winRate,
    averageNetR,
    expectancy,
    profitFactor,
    maxDrawdownR,
  };
}
