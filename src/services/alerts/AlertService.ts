export type AlertConditionType =
  | 'PRICE_ABOVE'
  | 'PRICE_BELOW'
  | 'CHANGE_24H_ABOVE'
  | 'CHANGE_24H_BELOW'
  | 'OI_SPIKE'
  | 'FUNDING_EXTREME';

export type AlertDeliveryChannel = 'IN_APP' | 'TELEGRAM' | 'WEBHOOK';

export interface AlertRule {
  id: string;
  symbol: string;
  condition: AlertConditionType;
  targetValue: number;
  deliveryChannel: AlertDeliveryChannel;
  createdAt: string;
  lastTriggeredAt?: string;
  isActive: boolean;
}

export interface TriggeredAlertEvent {
  id: string;
  ruleId: string;
  symbol: string;
  condition: AlertConditionType;
  targetValue: number;
  actualValue: number;
  message: string;
  timestamp: string;
  deliveryChannel: AlertDeliveryChannel;
}

export class AlertService {
  private static instance: AlertService | null = null;
  private rules: Map<string, AlertRule> = new Map();
  private triggeredHistory: TriggeredAlertEvent[] = [];
  private cooldownMs: number;
  private ruleCounter = 0;

  constructor(cooldownMs = 300000) {
    // 5 minutes default cooldown
    this.cooldownMs = cooldownMs;
    this.seedDefaultRules();
  }

  public static getInstance(): AlertService {
    if (!AlertService.instance) {
      AlertService.instance = new AlertService();
    }
    return AlertService.instance;
  }

  private seedDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'rule-btc-high',
        symbol: 'BTC',
        condition: 'PRICE_ABOVE',
        targetValue: 66000,
        deliveryChannel: 'IN_APP',
        createdAt: '2026-09-15T08:00:00Z',
        isActive: true,
      },
      {
        id: 'rule-eth-low',
        symbol: 'ETH',
        condition: 'PRICE_BELOW',
        targetValue: 3300,
        deliveryChannel: 'TELEGRAM',
        createdAt: '2026-09-15T08:00:00Z',
        isActive: true,
      },
    ];

    for (const r of defaultRules) {
      this.rules.set(r.id, r);
    }
  }

  public addRule(
    symbol: string,
    condition: AlertConditionType,
    targetValue: number,
    deliveryChannel: AlertDeliveryChannel = 'IN_APP'
  ): AlertRule {
    const id = `alert-${Date.now()}-${++this.ruleCounter}-${Math.floor(Math.random() * 10000)}`;
    const rule: AlertRule = {
      id,
      symbol: symbol.toUpperCase(),
      condition,
      targetValue,
      deliveryChannel,
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    this.rules.set(id, rule);
    return rule;
  }

  public removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  public getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  public getTriggeredHistory(): TriggeredAlertEvent[] {
    return [...this.triggeredHistory];
  }

  /**
   * Evaluate a price tick for a symbol against all active alert rules
   */
  public evaluateTick(
    symbol: string,
    currentPrice: number,
    change24h = 0,
    fundingRate = 0
  ): TriggeredAlertEvent[] {
    const normSymbol = symbol.toUpperCase();
    const triggered: TriggeredAlertEvent[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.isActive || rule.symbol !== normSymbol) continue;

      // Check cooldown
      if (rule.lastTriggeredAt) {
        const lastTime = new Date(rule.lastTriggeredAt).getTime();
        if (now - lastTime < this.cooldownMs) {
          continue; // Snoozed
        }
      }

      let isConditionMet = false;
      let actualValue = currentPrice;
      let msg = '';

      switch (rule.condition) {
        case 'PRICE_ABOVE':
          if (currentPrice >= rule.targetValue) {
            isConditionMet = true;
            actualValue = currentPrice;
            msg = `${rule.symbol} поднялся выше целевого уровня $${rule.targetValue.toLocaleString()} (тек: $${currentPrice.toLocaleString()})`;
          }
          break;

        case 'PRICE_BELOW':
          if (currentPrice <= rule.targetValue) {
            isConditionMet = true;
            actualValue = currentPrice;
            msg = `${rule.symbol} опустился ниже целевого уровня $${rule.targetValue.toLocaleString()} (тек: $${currentPrice.toLocaleString()})`;
          }
          break;

        case 'CHANGE_24H_ABOVE':
          if (change24h >= rule.targetValue) {
            isConditionMet = true;
            actualValue = change24h;
            msg = `${rule.symbol} суточный рост составил +${change24h.toFixed(2)}% (порог: +${rule.targetValue}%)`;
          }
          break;

        case 'CHANGE_24H_BELOW':
          if (change24h <= rule.targetValue) {
            isConditionMet = true;
            actualValue = change24h;
            msg = `${rule.symbol} суточное падение составило ${change24h.toFixed(2)}% (порог: ${rule.targetValue}%)`;
          }
          break;

        case 'FUNDING_EXTREME':
          if (Math.abs(fundingRate) >= rule.targetValue) {
            isConditionMet = true;
            actualValue = fundingRate;
            msg = `${rule.symbol} экстремальный фандинг ${fundingRate.toFixed(4)}% (порог: ${rule.targetValue}%)`;
          }
          break;
      }

      if (isConditionMet) {
        rule.lastTriggeredAt = new Date().toISOString();

        const event: TriggeredAlertEvent = {
          id: `trig-${Date.now()}-${rule.id}`,
          ruleId: rule.id,
          symbol: rule.symbol,
          condition: rule.condition,
          targetValue: rule.targetValue,
          actualValue,
          message: msg,
          timestamp: new Date().toISOString(),
          deliveryChannel: rule.deliveryChannel,
        };

        triggered.push(event);
        this.triggeredHistory.unshift(event);
        if (this.triggeredHistory.length > 100) {
          this.triggeredHistory.pop();
        }
      }
    }

    return triggered;
  }

  public clear(): void {
    this.rules.clear();
    this.triggeredHistory = [];
  }
}
