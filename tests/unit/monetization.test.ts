import { describe, it, expect } from 'vitest';
import { PlanManager, PLAN_DEFINITIONS } from '@/services/subscription/PlanManager';

describe('PlanManager Unit Tests (Monetization & Feature Gating)', () => {
  it('correctly provides plan tier definitions with strict analytical features', () => {
    expect(PLAN_DEFINITIONS.FREE.priceMonthlyUsd).toBe(0);
    expect(PLAN_DEFINITIONS.PRO.priceMonthlyUsd).toBe(29);
    expect(PLAN_DEFINITIONS.ENTERPRISE.priceMonthlyUsd).toBe(99);

    // Free tier cannot access backtesting or AI analyst
    expect(PLAN_DEFINITIONS.FREE.limits.canAccessBacktesting).toBe(false);
    expect(PLAN_DEFINITIONS.FREE.limits.canAccessAiAnalyst).toBe(false);

    // Pro tier has access to backtesting, AI analyst, and liquidation clusters
    expect(PLAN_DEFINITIONS.PRO.limits.canAccessBacktesting).toBe(true);
    expect(PLAN_DEFINITIONS.PRO.limits.canAccessAiAnalyst).toBe(true);
    expect(PLAN_DEFINITIONS.PRO.limits.canAccessLiquidationClusters).toBe(true);
  });

  it('evaluates feature access accurately based on tier', () => {
    expect(PlanManager.canAccess('canAccessBacktesting', 'FREE')).toBe(false);
    expect(PlanManager.canAccess('canAccessBacktesting', 'PRO')).toBe(true);
    expect(PlanManager.getMaxAlerts('FREE')).toBe(2);
    expect(PlanManager.getMaxAlerts('PRO')).toBe(25);
    expect(PlanManager.getMaxAlerts('ENTERPRISE')).toBe(999);
  });
});
