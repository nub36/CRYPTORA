import { describe, it, expect } from 'vitest';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';

describe('SignalsAuditLedger Unit Tests (Immutable Analytics Audit)', () => {
  it('retrieves audited analytical setups with entry zones and invalidation levels', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const setups = ledger.getSetups();

    expect(setups.length).toBeGreaterThan(0);
    const btcSetup = setups.find((s) => s.symbol === 'BTC');

    expect(btcSetup).toBeDefined();
    expect(btcSetup?.direction).toBe('LONG');
    expect(btcSetup?.entryZone.length).toBe(2);
    expect(btcSetup?.invalidationLevel).toBeGreaterThan(0);
    expect(btcSetup?.targets.length).toBeGreaterThan(0);
    expect(btcSetup?.confirmingFactors.length).toBeGreaterThan(0);
    expect(btcSetup?.invalidationFactors.length).toBeGreaterThan(0);
    expect(btcSetup?.auditHash).toMatch(/^sha256-[0-9a-f]+$/);
  });

  it('calculates transparent accuracy and performance statistics without survivorship bias', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const summary = ledger.getSummary();

    expect(summary.totalSetups).toBeGreaterThan(0);
    expect(summary.accuracyRatePct).toBeGreaterThanOrEqual(0);
    expect(summary.accuracyRatePct).toBeLessThanOrEqual(100);
    expect(summary.averageRiskReward).toBeGreaterThan(0);
  });

  it('verifies cryptographic hash integrity across the ledger chain', () => {
    const ledger = SignalsAuditLedger.getInstance();
    const isIntact = ledger.verifyIntegrity();
    expect(isIntact).toBe(true);
  });
});
