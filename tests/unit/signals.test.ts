import { describe, it, expect } from 'vitest';
import { SignalsAuditLedger, type AnalyticalSetup } from '@/services/signals/SignalsAuditLedger';
import { sha256Hex } from '@/utils/sha256';

const fixture: Omit<AnalyticalSetup, 'auditHash'> = {
  id: 'fx-1',
  symbol: 'BTC',
  direction: 'LONG',
  timeframe: '1D',
  entryZone: [1, 2],
  invalidationLevel: 0.5,
  targets: [3],
  riskRewardRatio: 2,
  confirmingFactors: ['a'],
  invalidationFactors: ['b'],
  createdAt: '2026-01-01T00:00:00Z',
  status: 'ACTIVE',
};

describe('sha256Hex', () => {
  it('matches FIPS test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('SignalsAuditLedger (append-only, real SHA-256 chain)', () => {
  it('is empty by default — no fabricated setups or track record', () => {
    const ledger = SignalsAuditLedger.getInstance();
    expect(ledger.getSetups()).toEqual([]);
    const s = ledger.getSummary();
    expect(s.totalSetups).toBe(0);
    expect(s.accuracyRatePct).toBe(0);
    expect(ledger.verifyIntegrity()).toBe(true);
  });

  it('chains entries with 64-hex sha256 and detects tampering', () => {
    const ledger = new SignalsAuditLedger([fixture, { ...fixture, id: 'fx-2', status: 'INVALIDATED', pnlResultPct: -1 }]);
    const setups = ledger.getSetups();
    expect(setups).toHaveLength(2);
    expect(setups[0].auditHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(ledger.verifyIntegrity()).toBe(true);
    expect(ledger.getSummary().accuracyRatePct).toBe(0);
    (ledger as unknown as { setups: AnalyticalSetup[] }).setups[0].targets = [99];
    expect(ledger.verifyIntegrity()).toBe(false);
  });
});
