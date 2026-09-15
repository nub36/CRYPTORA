export type PlanTier = 'FREE' | 'PRO' | 'ENTERPRISE';

export interface PlanFeatureLimits {
  realtimeSpeed: 'STANDARD' | 'ULTRA_FAST';
  maxAlerts: number;
  maxCustomScreenerPresets: number;
  canAccessBacktesting: boolean;
  canAccessAiAnalyst: boolean;
  canAccessLiquidationClusters: boolean;
  canExportData: boolean;
}

export interface PlanDefinition {
  id: PlanTier;
  name: string;
  priceMonthlyUsd: number;
  priceAnnualUsd: number;
  description: string;
  features: string[];
  limits: PlanFeatureLimits;
}

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Free Explorer',
    priceMonthlyUsd: 0,
    priceAnnualUsd: 0,
    description: 'Базовый доступ к рыночным данным и стандартным аналитическим инструментам',
    features: [
      'Стандартный поток котировок Binance и KuCoin',
      'Базовый мультифакторный скринер',
      'До 2 активных алертов',
      'Просмотр рыночных аномалий Market Radar',
    ],
    limits: {
      realtimeSpeed: 'STANDARD',
      maxAlerts: 2,
      maxCustomScreenerPresets: 1,
      canAccessBacktesting: false,
      canAccessAiAnalyst: false,
      canAccessLiquidationClusters: false,
      canExportData: false,
    },
  },
  PRO: {
    id: 'PRO',
    name: 'Pro Analyst',
    priceMonthlyUsd: 29,
    priceAnnualUsd: 290,
    description: 'Полный аналитический стек для независимых крипто-исследователей и аналитиков',
    features: [
      'Субсекундный WebSocket поток реального времени',
      'Неограниченные пресеты скринера',
      'До 25 активных алертов с Telegram и Webhook',
      'Движок бэктестинга без look-ahead bias',
      'Модель кластеров ликвидаций и тепловые карты',
      'AI-аналитик рыночного контекста и аномалий',
    ],
    limits: {
      realtimeSpeed: 'ULTRA_FAST',
      maxAlerts: 25,
      maxCustomScreenerPresets: 20,
      canAccessBacktesting: true,
      canAccessAiAnalyst: true,
      canAccessLiquidationClusters: true,
      canExportData: true,
    },
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Institutional Terminal',
    priceMonthlyUsd: 99,
    priceAnnualUsd: 990,
    description: 'Для исследовательских команд, фондов и институциональных пользователей',
    features: [
      'Все преимущества Pro-тарифа',
      'Неограниченное число алертов и каналов',
      'Полный доступ к сырым данным и экспорту TimeSeries',
      'Приоритетный доступ к Strategy Lab и оптимизации параметров',
      'SLA доступности 99.9%',
    ],
    limits: {
      realtimeSpeed: 'ULTRA_FAST',
      maxAlerts: 999,
      maxCustomScreenerPresets: 999,
      canAccessBacktesting: true,
      canAccessAiAnalyst: true,
      canAccessLiquidationClusters: true,
      canExportData: true,
    },
  },
};

export class PlanManager {
  private static userPlan: PlanTier = 'PRO'; // Default for terminal user

  public static getCurrentPlan(): PlanTier {
    return this.userPlan;
  }

  public static setPlan(tier: PlanTier): void {
    this.userPlan = tier;
  }

  public static canAccess(feature: keyof PlanFeatureLimits, tier = this.userPlan): boolean {
    const limits = PLAN_DEFINITIONS[tier].limits;
    const value = limits[feature];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    return true;
  }

  public static getMaxAlerts(tier = this.userPlan): number {
    return PLAN_DEFINITIONS[tier].limits.maxAlerts;
  }
}
