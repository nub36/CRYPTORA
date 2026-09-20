import { describe, it, expect, beforeEach } from 'vitest';
import {
  SignalsAuditLedger, SIGNALS_LEDGER_STORAGE_KEY, type AnalyticalSetup, type SetupInput,
} from '@/services/signals/SignalsAuditLedger';
import { sha256Hex } from '@/utils/sha256';

const fixture: SetupInput = {
  id: 'fx-1',
  strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
  strategyVersion: '3.0',
  symbol: 'BTC/USDT',
  direction: 'LONG',
  timeframe: '1h',
  setupOpenTime: 1_700_000_000_000,
  entryType: 'LIMIT_CORRIDOR',
  entryZone: [1, 2],
  invalidationLevel: 0.5,
  targets: [3, 4],
  riskRewardRatio: 2,
  confirmingFactors: ['a'],
  invalidationFactors: ['b'],
  exitRule: 'test rule',
  validForBars: 3,
  createdAt: '2026-01-01T00:00:00Z',
  latencyBars: 0,
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
  beforeEach(() => {
    SignalsAuditLedger.resetInstance();
    localStorage.removeItem(SIGNALS_LEDGER_STORAGE_KEY);
  });

  it('is empty by default — no fabricated setups or track record', () => {
    const ledger = SignalsAuditLedger.getInstance();
    expect(ledger.getSetups()).toEqual([]);
    const s = ledger.getSummary();
    expect(s.totalSetups).toBe(0);
    expect(s.accuracyRatePct).toBe(0);
    expect(s.tradesClosed).toBe(0);
    expect(ledger.verifyIntegrity()).toBe(true);
  });

  it('chains entries with 64-hex sha256 and detects tampering', () => {
    const ledger = new SignalsAuditLedger([fixture, { ...fixture, id: 'fx-2', status: 'INVALIDATED', pnlResultPct: -1, resultR: -1 }]);
    const setups = ledger.getSetups();
    expect(setups).toHaveLength(2);
    expect(setups[0].auditHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(setups[0].prevHash).toBe('GENESIS');
    expect(setups[1].prevHash).toBe(setups[0].auditHash);
    expect(setups[1].outcomeHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(ledger.verifyIntegrity()).toBe(true);
    expect(ledger.getSummary().accuracyRatePct).toBe(0);
    (ledger as unknown as { setups: AnalyticalSetup[] }).setups[0].targets = [99];
    expect(ledger.verifyIntegrity()).toBe(false);
  });

  it('ignores duplicate ids (idempotent publish)', () => {
    const ledger = new SignalsAuditLedger();
    ledger.append(fixture);
    ledger.append({ ...fixture, targets: [100] });
    expect(ledger.getSetups()).toHaveLength(1);
    expect(ledger.getSetups()[0].targets).toEqual([3, 4]);
  });

  it('fill and outcome are recorded once, hashed separately, and keep the issuance chain intact', () => {
    const ledger = new SignalsAuditLedger();
    ledger.append(fixture);
    ledger.append({ ...fixture, id: 'fx-2' });

    expect(ledger.markFilled('fx-1', { price: 1.5, at: '2026-01-01T01:00:00Z', barOpenTime: 1_700_003_600_000 })).not.toBeNull();
    expect(ledger.getById('fx-1')!.status).toBe('FILLED');
    // second fill is refused
    expect(ledger.markFilled('fx-1', { price: 9, at: '2026-01-01T02:00:00Z', barOpenTime: 1 })).toBeNull();
    expect(ledger.verifyIntegrity()).toBe(true);

    const resolved = ledger.resolve('fx-1', {
      status: 'TARGET_REACHED', closedAt: '2026-01-01T05:59:59Z', exitReason: 'TP2', exitPrice: 4,
      resultR: 2.25, netResultR: 2.2, pnlResultPct: 166.67, barsHeld: 5,
    });
    expect(resolved!.outcomeHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(ledger.verifyIntegrity()).toBe(true);

    // outcome cannot be rewritten
    expect(ledger.resolve('fx-1', {
      status: 'INVALIDATED', closedAt: '2026-01-02T00:00:00Z', exitReason: 'SL', exitPrice: 0.5,
      resultR: -1, netResultR: -1.05, pnlResultPct: -66, barsHeld: 9,
    })).toBeNull();
    expect(ledger.getById('fx-1')!.status).toBe('TARGET_REACHED');

    // tampering with the outcome breaks the outcome hash
    (ledger as unknown as { setups: AnalyticalSetup[] }).setups[0].resultR = 99;
    expect(ledger.verifyIntegrity()).toBe(false);

    // the still-open second entry remains chained to the first issuance hash
    const [a, b] = ledger.getSetups();
    expect(b.prevHash).toBe(a.auditHash);
  });

  it('summary: accuracy counts only trades with an outcome; expired/cancelled are no-trade', () => {
    const ledger = new SignalsAuditLedger();
    ledger.append({ ...fixture, id: 'a' });
    ledger.append({ ...fixture, id: 'b' });
    ledger.append({ ...fixture, id: 'c' });
    ledger.append({ ...fixture, id: 'd' });
    ledger.resolve('a', { status: 'TARGET_REACHED', closedAt: 'x', exitReason: 'TP2', exitPrice: 4, resultR: 2, netResultR: 1.9, pnlResultPct: 10, barsHeld: 3 },
      { price: 1.5, at: 'x', barOpenTime: 1 });
    ledger.resolve('b', { status: 'INVALIDATED', closedAt: 'x', exitReason: 'SL', exitPrice: 0.5, resultR: -1, netResultR: -1.1, pnlResultPct: -5, barsHeld: 2 },
      { price: 1.5, at: 'x', barOpenTime: 1 });
    ledger.resolve('c', { status: 'EXPIRED', closedAt: 'x', exitReason: 'EXPIRED', exitPrice: null, resultR: null, netResultR: null, pnlResultPct: null, barsHeld: null });
    const s = ledger.getSummary();
    expect(s.totalSetups).toBe(4);
    expect(s.tradesClosed).toBe(2);
    expect(s.accuracyRatePct).toBe(50);
    expect(s.expiredCount).toBe(1);
    expect(s.activeCount).toBe(1);
    expect(s.averageResultR).toBe(0.5);
    expect(s.averageNetResultR).toBe(0.4);
    expect(s.totalNetResultR).toBe(0.8);
    expect(ledger.verifyIntegrity()).toBe(true);
  });

  it('persists to localStorage and reloads with the chain intact', () => {
    const ledger = new SignalsAuditLedger();
    ledger.append(fixture);
    ledger.append({ ...fixture, id: 'fx-2' });
    SignalsAuditLedger.resetInstance();
    const again = SignalsAuditLedger.getInstance();
    expect(again.getSetups().map((s) => s.id)).toEqual(['fx-1', 'fx-2']);
    expect(again.verifyIntegrity()).toBe(true);
  });
});
