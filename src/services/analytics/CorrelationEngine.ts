export interface CorrelationPair {
  assetA: string;
  assetB: string;
  correlation: number; // -1.0 to 1.0
  periodDays: number;
}

export interface AssetBeta {
  symbol: string;
  name: string;
  betaToBtc: number;
  correlationToBtc: number;
  volatility30d: number; // Annualized standard deviation %
  classification: 'HIGH_BETA' | 'NEUTRAL_BETA' | 'LOW_BETA' | 'INVERSE';
}

export class CorrelationEngine {
  /**
   * Calculates Pearson correlation coefficient between two number series
   */
  public static calculatePearsonCorrelation(seriesA: number[], seriesB: number[]): number {
    const n = Math.min(seriesA.length, seriesB.length);
    if (n < 3) return 0;

    const meanA = seriesA.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanB = seriesB.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomA = 0;
    let denomB = 0;

    for (let i = 0; i < n; i++) {
      const diffA = seriesA[i] - meanA;
      const diffB = seriesB[i] - meanB;
      numerator += diffA * diffB;
      denomA += diffA * diffA;
      denomB += diffB * diffB;
    }

    const denominator = Math.sqrt(denomA * denomB);
    if (denominator === 0) return 0;

    const r = numerator / denominator;
    return Number(Math.max(-1, Math.min(1, r)).toFixed(2));
  }

  /**
   * Calculates Beta of an asset relative to a benchmark (e.g. BTC)
   * Beta = Cov(asset, benchmark) / Var(benchmark)
   */
  public static calculateBeta(assetReturns: number[], benchmarkReturns: number[]): number {
    const n = Math.min(assetReturns.length, benchmarkReturns.length);
    if (n < 3) return 1;

    const meanAsset = assetReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanBench = benchmarkReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let covariance = 0;
    let benchVariance = 0;

    for (let i = 0; i < n; i++) {
      const diffA = assetReturns[i] - meanAsset;
      const diffB = benchmarkReturns[i] - meanBench;
      covariance += diffA * diffB;
      benchVariance += diffB * diffB;
    }

    if (benchVariance === 0) return 1;
    return Number((covariance / benchVariance).toFixed(2));
  }

}

// ---------------------------------------------------------------------------
// Фактический расчёт по свечам (v0.8.26). Чистые функции: вход — закрытия по символам.
// ---------------------------------------------------------------------------
export interface LiveCorrelationReport {
  assets: string[];
  matrix: Record<string, Record<string, number>>;
  betas: AssetBeta[];
  /** Число дневных доходностей в окне (по факту, после выравнивания рядов). */
  windowDays: number;
  /** Символы, исключённые из-за нехватки данных. */
  excluded: string[];
}

/** Логарифмические дневные доходности по массиву закрытий (по возрастанию времени). */
export function toLogReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

export function classifyBeta(beta: number): AssetBeta['classification'] {
  if (beta < 0) return 'INVERSE';
  if (beta > 1.3) return 'HIGH_BETA';
  if (beta < 0.8) return 'LOW_BETA';
  return 'NEUTRAL_BETA';
}

/**
 * Строит матрицу Пирсона и бету к BTC по фактическим закрытиям.
 * Ряды выравниваются по хвосту (последние `windowDays` доходностей). Символы с < minPoints
 * доходностей исключаются и перечисляются в `excluded`. Детерминировано.
 */
export function buildCorrelationReport(
  closesBySymbol: Record<string, number[]>,
  names: Record<string, string> = {},
  windowDays = 30,
  minPoints = 10,
  benchmark = 'BTC',
): LiveCorrelationReport {
  const returns: Record<string, number[]> = {};
  const excluded: string[] = [];
  for (const [sym, closes] of Object.entries(closesBySymbol)) {
    const r = toLogReturns(closes);
    if (r.length < minPoints) {
      excluded.push(sym);
      continue;
    }
    returns[sym] = r.slice(-windowDays);
  }
  const assets = Object.keys(returns);
  if (assets.length === 0) return { assets: [], matrix: {}, betas: [], windowDays: 0, excluded };
  const n = Math.min(...assets.map((s) => returns[s].length));
  for (const s of assets) returns[s] = returns[s].slice(-n);

  const matrix: Record<string, Record<string, number>> = {};
  for (const a of assets) {
    matrix[a] = {};
    for (const b of assets) {
      matrix[a][b] = a === b ? 1 : CorrelationEngine.calculatePearsonCorrelation(returns[a], returns[b]);
    }
  }

  const betas: AssetBeta[] = [];
  if (returns[benchmark]) {
    for (const s of assets) {
      if (s === benchmark) continue;
      const r = returns[s];
      const mean = r.reduce((x, y) => x + y, 0) / r.length;
      const variance = r.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(1, r.length - 1);
      const beta = CorrelationEngine.calculateBeta(r, returns[benchmark]);
      betas.push({
        symbol: s,
        name: names[s] ?? s,
        betaToBtc: beta,
        correlationToBtc: matrix[s][benchmark],
        volatility30d: Number((Math.sqrt(variance) * Math.sqrt(365) * 100).toFixed(1)),
        classification: classifyBeta(beta),
      });
    }
    betas.sort((x, y) => y.betaToBtc - x.betaToBtc);
  }
  return { assets, matrix, betas, windowDays: n, excluded };
}
