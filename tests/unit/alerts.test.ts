import { describe, it, expect, beforeEach } from 'vitest';
import { AlertService } from '@/services/alerts/AlertService';

describe('AlertService Unit Tests', () => {
  let service: AlertService;

  beforeEach(() => {
    service = new AlertService(60000); // 60s cooldown
    service.clear();
  });

  it('triggers an alert when current price rises above PRICE_ABOVE target', () => {
    service.addRule('BTC', 'PRICE_ABOVE', 65000, 'IN_APP');

    // Price below -> no trigger
    const events1 = service.evaluateTick('BTC', 64800);
    expect(events1.length).toBe(0);

    // Price above -> triggers
    const events2 = service.evaluateTick('BTC', 65200);
    expect(events2.length).toBe(1);
    expect(events2[0].symbol).toBe('BTC');
    expect(events2[0].condition).toBe('PRICE_ABOVE');
    expect(events2[0].actualValue).toBe(65200);
  });

  it('triggers an alert when price falls below PRICE_BELOW target', () => {
    service.addRule('ETH', 'PRICE_BELOW', 3400, 'TELEGRAM');

    const events = service.evaluateTick('ETH', 3350);
    expect(events.length).toBe(1);
    expect(events[0].symbol).toBe('ETH');
    expect(events[0].deliveryChannel).toBe('TELEGRAM');
  });

  it('suppresses duplicate triggers within the cooldown period', () => {
    service.addRule('SOL', 'PRICE_ABOVE', 150, 'IN_APP');

    // 1st time triggers
    const events1 = service.evaluateTick('SOL', 155);
    expect(events1.length).toBe(1);

    // Immediate next tick -> suppressed by cooldown
    const events2 = service.evaluateTick('SOL', 156);
    expect(events2.length).toBe(0);
  });

  it('manages adding, listing, and removing alert rules', () => {
    const r1 = service.addRule('BTC', 'PRICE_ABOVE', 70000);
    const r2 = service.addRule('SOL', 'CHANGE_24H_ABOVE', 10);

    const rules = service.getRules();
    expect(rules.length).toBe(2);

    const removed = service.removeRule(r1.id);
    expect(removed).toBe(true);
    expect(service.getRules().length).toBe(1);
    expect(service.getRules()[0].id).toBe(r2.id);
  });
});
