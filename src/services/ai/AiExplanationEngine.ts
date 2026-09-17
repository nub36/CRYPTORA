import { RadarEvent } from '@/types/market';

/**
 * Факты для брифинга. Каждое поле ОБЯЗАНО приходить из детерминированного движка / источника (docs/AI.md);
 * отсутствующее значение опускается, а не подставляется.
 */
export interface MarketContextFact {
  symbol: string;
  price: number;
  change24h: number;
  /** Ставка фандинга за 8ч в процентах (0.01 = 0.01%), как в FuturesAsset.fundingRate. */
  fundingRate8h?: number;
  /** Δ OI за 24ч, %. */
  openInterestDelta24h?: number;
  /** Происхождение Δ OI; ESTIMATED явно оговаривается в тексте. */
  openInterestDeltaSource?: 'ACTUAL' | 'ESTIMATED';
  rsi14?: number;
  anomalies?: RadarEvent[];
}

export interface AiMarketBriefing {
  symbol: string;
  headline: string;
  explanation: string;
  keyDrivers: string[];
  riskObservations: string[];
  disclaimer: string;
  generatedAt: string;
}

export class AiExplanationEngine {
  /**
   * Synthesizes an explanatory analytical briefing strictly grounded in structured engine facts.
   * NEVER generates blind price predictions and NEVER issues trade execution commands.
   */
  public static generateBriefing(context: MarketContextFact): AiMarketBriefing {
    const drivers: string[] = [];
    const risks: string[] = [];

    // 1. Evaluate Price Momentum & RSI
    if (context.rsi14 !== undefined) {
      if (context.rsi14 >= 70) {
        risks.push(
          `Индикатор RSI(14) находится на уровне ${context.rsi14.toFixed(1)} (зона локальной перекупленности).`
        );
      } else if (context.rsi14 <= 30) {
        drivers.push(
          `Индикатор RSI(14) на уровне ${context.rsi14.toFixed(1)} указывает на глубокую локальную перепроданность.`
        );
      } else {
        drivers.push(`Индикатор RSI(14) на нейтральном уровне (${context.rsi14.toFixed(1)}).`);
      }
    }

    // 2. Evaluate Derivatives & Funding
    if (context.fundingRate8h !== undefined) {
      if (context.fundingRate8h < -0.01) {
        drivers.push(
          `Отрицательная ставка финансирования (${context.fundingRate8h.toFixed(4)}% / 8ч) свидетельствует о преобладании шорт-позиций (повышенный риск шорт-сквиза).`
        );
      } else if (context.fundingRate8h > 0.03) {
        risks.push(
          `Повышенная ставка фандинга (${context.fundingRate8h.toFixed(4)}% / 8ч) отражает перегрузку рынка длинными позициями.`
        );
      }
    }

    // 3. Evaluate Open Interest Delta
    if (context.openInterestDelta24h !== undefined) {
      const est = context.openInterestDeltaSource === 'ESTIMATED' ? ' (оценка, не фактический ряд OI)' : '';
      if (context.openInterestDelta24h > 5) {
        drivers.push(
          `Суточный приток открытого интереса (+${context.openInterestDelta24h.toFixed(1)}%${est}) указывает на открытие новых деривативных позиций.`
        );
      } else if (context.openInterestDelta24h < -5) {
        risks.push(
          `Отток открытого интереса (${context.openInterestDelta24h.toFixed(1)}%${est}) указывает на закрытие деривативных позиций.`
        );
      }
    }

    // 4. Evaluate Active Anomalies
    if (context.anomalies && context.anomalies.length > 0) {
      for (const a of context.anomalies) {
        if (a.type === 'VOLUME_SPIKE') {
          drivers.push(`Зафиксирован скачок объемов ликвидности (${a.metricValue})`);
        } else if (a.type === 'VOLATILITY_EXPANSION') {
          risks.push(`Зафиксировано расширение диапазона волатильности (${a.metricValue})`);
        }
      }
    }

    const direction = context.change24h >= 0 ? 'роста' : 'снижения';
    const headline = `Аналитический обзор динамики ${context.symbol}: сессия ${direction} (${context.change24h >= 0 ? '+' : ''}${context.change24h.toFixed(2)}%)`;

    const explanation =
      `Инструмент ${context.symbol} торгуется по цене $${context.price.toLocaleString()} с суточным изменением ${context.change24h >= 0 ? '+' : ''}${context.change24h.toFixed(2)}%. ` +
      `Движок зафиксировал совокупность метрик: ${drivers.length > 0 ? drivers[0] : 'стабильный рыночный режим'}. ` +
      `${risks.length > 0 ? risks[0] : 'Существенных отклонений от нормы не наблюдается.'}`;

    return {
      symbol: context.symbol,
      headline,
      explanation,
      keyDrivers: drivers,
      riskObservations: risks,
      disclaimer:
        'CRYPTORA — аналитический терминал. Брифинг сформирован детерминированными правилами из фактических показателей (без LLM) и не является инвестиционной рекомендацией или торговым сигналом.',
      generatedAt: new Date().toISOString(),
    };
  }
}
