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
  expiredCount: number;
  accuracyRatePct: number;
  averageRiskReward: number;
  averageReturnPct: number;
}

const STORAGE_KEY = 'cryptora_signals_ledger';
const MAX_STORED = 200; // Keep last 200 signals

export class SignalsAuditLedger {
  private static instance: SignalsAuditLedger | null = null;
  private setups: AnalyticalSetup[] = [];

  constructor(initial: ReadonlyArray<Omit<AnalyticalSetup, 'auditHash'>> = []) {
    // Hydrate from localStorage first
    this.loadFromStorage();
    // Append any initial seed data (e.g. from tests)
    for (const raw of initial) this.append(raw);
  }

  public static getInstance(): SignalsAuditLedger {
    if (!SignalsAuditLedger.instance) {
      SignalsAuditLedger.instance = new SignalsAuditLedger();
    }
    return SignalsAuditLedger.instance;
  }

  public static resetInstance(): void {
    SignalsAuditLedger.instance = null;
  }

  /** SHA-256 chain: each entry hashes data + previous hash. */
  private computeHash(setupData: Omit<AnalyticalSetup, 'auditHash'>, prevHash = 'GENESIS'): string {
    return `sha256-${sha256Hex(JSON.stringify({ ...setupData, prevHash }))}`;
  }

  /** Append-only: entry gets a hash chained to previous. */
  public append(raw: Omit<AnalyticalSetup, 'auditHash'>): AnalyticalSetup {
    // Deduplicate by id
    if (this.setups.some((s) => s.id === raw.id)) {
      return this.setups.find((s) => s.id === raw.id)!;
    }

    const prev = this.setups.length ? this.setups[this.setups.length - 1].auditHash : 'GENESIS';
    const entry: AnalyticalSetup = { ...raw, auditHash: this.computeHash(raw, prev) };
    this.setups.push(entry);
    this.saveToStorage();
    return entry;
  }

  public getSetups(): AnalyticalSetup[] {
    return [...this.setups];
  }

  public getActiveSetups(): AnalyticalSetup[] {
    return this.setups.filter((s) => s.status === 'ACTIVE');
  }

  public getSummary(): SignalsPerformanceSummary {
    const totalSetups = this.setups.length;
    const activeCount = this.setups.filter((s) => s.status === 'ACTIVE').length;
    const targetReachedCount = this.setups.filter((s) => s.status === 'TARGET_REACHED').length;
    const invalidatedCount = this.setups.filter((s) => s.status === 'INVALIDATED').length;
    const expiredCount = this.setups.filter((s) => s.status === 'EXPIRED').length;

    const closedCount = targetReachedCount + invalidatedCount + expiredCount;
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
      expiredCount,
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

  /** Expire signals older than maxAgeMs (default 4 hours). */
  public expireStale(maxAgeMs = 4 * 60 * 60 * 1000): number {
    const now = Date.now();
    let expired = 0;
    for (const s of this.setups) {
      if (s.status === 'ACTIVE') {
        const age = now - new Date(s.createdAt).getTime();
        if (age > maxAgeMs) {
          s.status = 'EXPIRED';
          s.closedAt = new Date().toISOString();
          expired++;
        }
      }
    }
    if (expired > 0) this.saveToStorage();
    return expired;
  }

  /** Persist to localStorage (survives page refresh). */
  private saveToStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        // Keep only the last MAX_STORED entries
        const toStore = this.setups.slice(-MAX_STORED);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      }
    } catch {
      // localStorage unavailable or full — non-fatal
    }
  }

  /** Hydrate from localStorage on construction. */
  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AnalyticalSetup[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.setups = parsed;
          }
        }
      }
    } catch {
      // Corrupted data — start fresh
      this.setups = [];
    }
  }
}
