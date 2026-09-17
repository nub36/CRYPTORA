import { Timeframe } from '@/types/market';
import { sha256Hex } from '@/utils/sha256';

export interface AnalyticalSetup {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  entryZone: [number, number];
  invalidationLevel: number;
  targets: number[];
  riskRewardRatio: number;
  confirmingFactors: string[];
  invalidationFactors: string[];
  createdAt: string;
  status: 'ACTIVE' | 'TARGET_REACHED' | 'INVALIDATED' | 'EXPIRED';
  closedAt?: string;
  pnlResultPct?: number;
  auditHash: string; // Append-only tamper-proof hash
}

export interface SignalsPerformanceSummary {
  totalSetups: number;
  activeCount: number;
  targetReachedCount: number;
  invalidatedCount: number;
  accuracyRatePct: number;
  averageRiskReward: number;
  averageReturnPct: number;
}

export class SignalsAuditLedger {
  private static instance: SignalsAuditLedger | null = null;
  private setups: AnalyticalSetup[] = [];

  /**
   * Реестр пуст по умолчанию: фактических аналитических сетапов у CRYPTORA нет, а выдуманные записи с «результатами»
   * недопустимы (v0.8.33). Записи добавляются только через append() — например, тестами.
   */
  constructor(initial: ReadonlyArray<Omit<AnalyticalSetup, 'auditHash'>> = []) {
    for (const raw of initial) this.append(raw);
  }

  public static getInstance(): SignalsAuditLedger {
    if (!SignalsAuditLedger.instance) {
      SignalsAuditLedger.instance = new SignalsAuditLedger();
    }
    return SignalsAuditLedger.instance;
  }

  /** Настоящий SHA-256 от канонической сериализации записи + хэша предыдущей (цепочка). */
  private computeHash(setupData: Omit<AnalyticalSetup, 'auditHash'>, prevHash = 'GENESIS'): string {
    return `sha256-${sha256Hex(JSON.stringify({ ...setupData, prevHash }))}`;
  }

  /** Append-only: запись получает хэш, связанный с предыдущей; редактирование задним числом ломает verifyIntegrity(). */
  public append(raw: Omit<AnalyticalSetup, 'auditHash'>): AnalyticalSetup {
    const prev = this.setups.length ? this.setups[this.setups.length - 1].auditHash : 'GENESIS';
    const entry: AnalyticalSetup = { ...raw, auditHash: this.computeHash(raw, prev) };
    this.setups.push(entry);
    return entry;
  }

  public getSetups(): AnalyticalSetup[] {
    return [...this.setups];
  }

  public getSummary(): SignalsPerformanceSummary {
    const totalSetups = this.setups.length;
    const activeCount = this.setups.filter((s) => s.status === 'ACTIVE').length;
    const targetReachedCount = this.setups.filter((s) => s.status === 'TARGET_REACHED').length;
    const invalidatedCount = this.setups.filter((s) => s.status === 'INVALIDATED').length;

    const closedCount = targetReachedCount + invalidatedCount;
    const accuracyRatePct =
      closedCount > 0 ? Number(((targetReachedCount / closedCount) * 100).toFixed(1)) : 0;

    const avgRR =
      totalSetups > 0
        ? Number(
            (this.setups.reduce((acc, s) => acc + s.riskRewardRatio, 0) / totalSetups).toFixed(2)
          )
        : 0;

    const closedWithPnl = this.setups.filter((s) => s.pnlResultPct !== undefined);
    const avgReturn =
      closedWithPnl.length > 0
        ? Number(
            (
              closedWithPnl.reduce((acc, s) => acc + (s.pnlResultPct ?? 0), 0) /
              closedWithPnl.length
            ).toFixed(2)
          )
        : 0;

    return {
      totalSetups,
      activeCount,
      targetReachedCount,
      invalidatedCount,
      accuracyRatePct,
      averageRiskReward: avgRR,
      averageReturnPct: avgReturn,
    };
  }

  public verifyIntegrity(): boolean {
    let prev = 'GENESIS';
    for (const setup of this.setups) {
      const { auditHash, ...data } = setup;
      const expected = this.computeHash(data, prev);
      if (expected !== auditHash) return false;
      prev = auditHash;
    }
    return true;
  }
}
